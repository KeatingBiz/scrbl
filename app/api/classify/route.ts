// app/api/classify/route.ts
import { NextRequest } from "next/server";
import type { BoardUnderstanding } from "@/lib/types";

export const runtime = "nodejs";

const TZ = "America/Chicago";

// ---- Strict JSON schema for Structured Outputs ----
const jsonSchema = {
  name: "board_understanding",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      type: { type: "string", enum: ["PROBLEM_UNSOLVED", "PROBLEM_SOLVED", "ANNOUNCEMENT", "UNKNOWN"] },
      subject_guess: { type: "string" },
      confidence: { type: "number" },
      raw_text: { type: "string" },

      // Problems
      question: { type: "string" },
      given_answer: { type: ["string", "null"] },
      steps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { n: { type: "integer" }, text: { type: "string" } },
          required: ["n", "text"]
        }
      },
      final: { type: ["string", "null"] },
      answer_status: { type: "string", enum: ["matches", "mismatch", "no_answer_on_board", "not_applicable"] },

      // Announcements
      events: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            date_start_iso: { type: "string" },
            date_end_iso: { type: ["string", "null"] },
            location: { type: ["string", "null"] },
            notes: { type: ["string", "null"] }
          },
          required: ["title", "date_start_iso"]
        }
      }
    },
    required: ["type", "confidence", "raw_text"]
  }
} as const;

// ---- Helpers ----
function clamp01(n: number | undefined): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function tryParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

function scoreResult(p: BoardUnderstanding | null): number {
  if (!p) return 0;
  const conf = clamp01(p.confidence);
  const hasSteps = Array.isArray(p.steps) && p.steps.length > 0 ? 0.2 : 0;
  const hasEvents = Array.isArray(p.events) && p.events.length > 0 ? 0.2 : 0;
  const notUnknown = p.type && p.type !== "UNKNOWN" ? 0.2 : 0;
  return conf + hasSteps + hasEvents + notUnknown; // max ~1.6
}

function applyLightFallbacks(parsed: BoardUnderstanding | null): BoardUnderstanding | null {
  if (!parsed) return null;

  if ((!parsed.type || parsed.type === "UNKNOWN") && parsed.steps?.length) {
    parsed.type = parsed.given_answer ? "PROBLEM_SOLVED" : "PROBLEM_UNSOLVED";
  }
  if ((!parsed.type || parsed.type === "UNKNOWN") && parsed.events?.length) {
    parsed.type = "ANNOUNCEMENT";
  }

  parsed.confidence = clamp01(parsed.confidence);

  if (parsed.type === "UNKNOWN" && parsed.raw_text) {
    const t = parsed.raw_text.toLowerCase();
    const ann = /(test|exam|quiz|homework|hw|due|assignment|project|presentation|friday|monday|tuesday|wednesday|thursday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t);
    const prob = /[=±×÷+\-*/]|sqrt|∫|∑|lim|dx|dy|cos|sin|tan|log|proof|theorem|q[:=]/i.test(t);
    if (ann && !prob) parsed.type = "ANNOUNCEMENT";
    else if (prob) parsed.type = "PROBLEM_UNSOLVED";
  }
  return parsed;
}

async function callModelOnce(model: string, messages: any) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_schema", json_schema: jsonSchema },
      messages
    })
  });

  const text = await r.text(); // capture raw for diagnostics
  let parsed: BoardUnderstanding | null = null;

  if (r.ok) {
    const asJson = tryParse<any>(text);
    const content = asJson?.choices?.[0]?.message?.content ?? "{}";
    parsed = tryParse<BoardUnderstanding>(content);
    parsed = applyLightFallbacks(parsed);
  }

  return {
    ok: r.ok,
    status: r.status,
    statusText: r.statusText,
    raw: text,
    parsed,
  };
}

// Try a list of models until one succeeds or gives the best parsed result
async function tryModelsInOrder(models: string[], messages: any) {
  const attempts: Array<Awaited<ReturnType<typeof callModelOnce>>> = [];
  for (const m of models) {
    const res = await callModelOnce(m, messages);
    attempts.push(res);
    // If successful and not UNKNOWN, return immediately
    if (res.ok && res.parsed && res.parsed.type !== "UNKNOWN") {
      return { best: res, attempts };
    }
  }
  // Pick best by score among ok attempts
  const okOnes = attempts.filter(a => a.ok && a.parsed);
  if (okOnes.length) {
    const best = okOnes.reduce((a, b) => (scoreResult(a.parsed!) >= scoreResult(b.parsed!) ? a : b));
    return { best, attempts };
  }
  // None worked
  return { best: attempts[attempts.length - 1] ?? null, attempts };
}

// ---- Route ----
export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return new Response("OPENAI_API_KEY is not set on the server", { status: 500 });
    }

    const form = await req.formData();
    const file = form.get("image") as unknown as File | null;
    if (!file) return new Response(JSON.stringify({ error: "No image provided" }), { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    const b64 = buf.toString("base64");
    const mime = file.type || "image/jpeg";

    const system = `You are a tutor + organizer reading a whiteboard/notebook photo.
Classify into exactly one of:
- PROBLEM_UNSOLVED: a problem is shown and NOT fully solved on the board.
- PROBLEM_SOLVED: worked steps and a final answer are shown.
- ANNOUNCEMENT: scheduling/reminder content (e.g., "Test Friday", "HW due Wed").
- UNKNOWN: only if the image is unreadable or unrelated.

Rules:
- Prefer one of the first three; use UNKNOWN ONLY if unreadable.
- For problems: provide short, numbered steps (no chain-of-thought) and a concise final.
- If the board shows an answer, re-derive succinctly and set answer_status to matches/mismatch/no_answer_on_board/not_applicable.
- For announcements: extract events[] with ISO 8601 in ${TZ}. If no time given, default start 09:00 local. Keep titles short.
- Always fill raw_text with the most salient exact text you can see.
- Keep confidence in [0,1].
Return STRICT JSON per the schema. No extra commentary.`;

    const messages = [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: `Timezone for parsing dates: ${TZ}` },
          { type: "text", text: "Return strict JSON matching the schema only." },
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}`, detail: "high" as const } }
        ]
      }
    ];

    // Stage A: fast → powerful
    const stageA = ["gpt-5-mini", "gpt-5", "gpt-4o-mini", "gpt-4o"];
    const { best, attempts } = await tryModelsInOrder(stageA, messages);

    // If no attempt object (shouldn't happen), bail clearly
    if (!best) {
      return new Response("OpenAI call did not return any result", { status: 502 });
    }

    // If all attempts failed (non-2xx), return the last error so the client shows a real error
    if (!best.ok) {
      // Log for server debugging
      console.error("[classify] All attempts failed:", attempts.map(a => ({ status: a.status, body: a.raw?.slice(0, 400) })));
      return new Response(best.raw || `OpenAI error ${best.status} ${best.statusText}`, { status: best.status || 502 });
    }

    // Success path: return parsed JSON (even if UNKNOWN, though with our fallbacks that should be rare)
    const final = best.parsed!;
    return new Response(JSON.stringify(final), { headers: { "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("[classify] exception", e);
    return new Response(JSON.stringify({ error: e?.message || "Failed" }), { status: 500 });
  }
}


