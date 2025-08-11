// app/api/classify/route.ts
import { NextRequest } from "next/server";
import type { BoardUnderstanding } from "@/lib/types";

export const runtime = "nodejs";
const TZ = "America/Chicago";

/**
 * STRICT Structured Output schema
 * - Steps must include: action (words + numbers), before, after, text
 * - We keep other fields from your types (why/tip/emoji) but they can be null
 * - Top-level fields are all required; use null/[] where not applicable
 */
const jsonSchema = {
  name: "board_understanding",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      type: { type: "string", enum: ["PROBLEM_UNSOLVED","PROBLEM_SOLVED","ANNOUNCEMENT","UNKNOWN"] },
      subject_guess: { type: ["string","null"] },
      confidence: { type: "number" },
      raw_text: { type: ["string","null"] },

      // Problem fields
      question: { type: ["string","null"] },
      given_answer: { type: ["string","null"] },
      steps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            n: { type: "integer" },
            text: { type: "string" },             // short instruction (<= 12 words)
            action: { type: ["string","null"] },  // MUST include numbers/expressions when math
            before: { type: ["string","null"] },  // equation BEFORE the operation
            after: { type: ["string","null"] },   // equation AFTER the operation
            why: { type: ["string","null"] },     // <= 10 words
            tip: { type: ["string","null"] },     // <= 10 words
            emoji: { type: ["string","null"] }
          },
          required: ["n","text","action","before","after","why","tip","emoji"]
        }
      },
      final: { type: ["string","null"] },
      answer_status: {
        type: ["string","null"],
        enum: ["matches","mismatch","no_answer_on_board","not_applicable", null]
      },

      // Announcement fields
      events: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            date_start_iso: { type: "string" },
            date_end_iso: { type: ["string","null"] },
            location: { type: ["string","null"] },
            notes: { type: ["string","null"] }
          },
          required: ["title","date_start_iso","date_end_iso","location","notes"]
        }
      }
    },
    required: [
      "type","subject_guess","confidence","raw_text",
      "question","given_answer","steps","final","answer_status","events"
    ]
  }
} as const;

// ---------- helpers ----------
function clamp01(n: number | undefined) {
  if (typeof n !== "number" || Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
function tryParse<T>(s: string): T | null { try { return JSON.parse(s) as T; } catch { return null; } }
function ensureDefaults(p: any) {
  const d = {
    type: "UNKNOWN",
    subject_guess: null,
    confidence: 0,
    raw_text: "",
    question: null,
    given_answer: null,
    steps: [] as any[],
    final: null,
    answer_status: "not_applicable",
    events: [] as any[]
  };
  return { ...d, ...p };
}
function applyLightFallbacks(parsed: BoardUnderstanding | null) {
  if (!parsed) return null;

  // Infer label if we have clear signals
  if ((!parsed.type || parsed.type === "UNKNOWN") && parsed.steps?.length) {
    parsed.type = parsed.given_answer ? "PROBLEM_SOLVED" : "PROBLEM_UNSOLVED";
  }
  if ((!parsed.type || parsed.type === "UNKNOWN") && parsed.events?.length) {
    parsed.type = "ANNOUNCEMENT";
  }

  parsed.confidence = clamp01(parsed.confidence);

  // Nudge UNKNOWN based on raw_text
  if (parsed.type === "UNKNOWN" && parsed.raw_text) {
    const t = parsed.raw_text.toLowerCase();
    const ann = /(test|exam|quiz|homework|hw|due|assignment|project|presentation|friday|monday|tuesday|wednesday|thursday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t);
    const prob = /[=±×÷+\-*/]|sqrt|∫|∑|lim|dx|dy|cos|sin|tan|log|proof|theorem|q[:=]/i.test(t);
    if (ann && !prob) parsed.type = "ANNOUNCEMENT";
    else if (prob) parsed.type = "PROBLEM_UNSOLVED";
  }

  // Tighten step count for readability: 3–4 steps max
  if (Array.isArray(parsed.steps) && parsed.steps.length > 4) {
    parsed.steps = parsed.steps.slice(0, 4);
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
      temperature: 0.0,                      // lock phrasing
      top_p: 1,
      max_tokens: 500,                       // cap output size
      response_format: { type: "json_schema", json_schema: jsonSchema },
      messages
    })
  });

  const text = await r.text();
  let parsed: BoardUnderstanding | null = null;

  if (r.ok) {
    const asJson = tryParse<any>(text);
    const content = asJson?.choices?.[0]?.message?.content ?? "{}";
    parsed = tryParse<BoardUnderstanding>(content);
    parsed = parsed ? ensureDefaults(parsed) : null;
    parsed = applyLightFallbacks(parsed);
  }

  return { ok: r.ok, status: r.status, statusText: r.statusText, raw: text, parsed };
}

function scoreResult(p: BoardUnderstanding | null) {
  if (!p) return 0;
  const conf = clamp01(p.confidence);
  const hasSteps = Array.isArray(p.steps) && p.steps.length > 0 ? 0.2 : 0;
  const hasEvents = Array.isArray(p.events) && p.events.length > 0 ? 0.2 : 0;
  const notUnknown = p.type && p.type !== "UNKNOWN" ? 0.2 : 0;
  return conf + hasSteps + hasEvents + notUnknown;
}

async function tryModelsInOrder(models: string[], messages: any) {
  const attempts: Array<Awaited<ReturnType<typeof callModelOnce>>> = [];
  for (const m of models) {
    const res = await callModelOnce(m, messages);
    attempts.push(res);
    if (res.ok && res.parsed && res.parsed.type !== "UNKNOWN") {
      return { best: res, attempts };
    }
  }
  const okOnes = attempts.filter(a => a.ok && a.parsed);
  if (okOnes.length) {
    const best = okOnes.reduce((a, b) => (scoreResult(a.parsed!) >= scoreResult(b.parsed!) ? a : b));
    return { best, attempts };
  }
  return { best: attempts[attempts.length - 1] ?? null, attempts };
}

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

    /**
     * STYLE GUIDE (very important)
     * - Keep 3–4 steps MAX. Prefer 3 when possible.
     * - Every math step MUST include numbers or an expression in `action`.
     * - For equations, ALWAYS include `before` and `after` exactly as simple ASCII math:
     *   - exponents like x^2, fractions like (x+3)/4, products like 4x, roots like sqrt(x)
     * - Keep `text` <= 12 words, `why`/`tip` <= 10 words.
     * - Final must be explicit, e.g., "x = 4".
     * - Controlled verbs (use one of these at the start of `action`):
     *   ["Multiply both sides by","Divide both sides by","Add","Subtract","Distribute","Combine like terms","Factor","Move terms","Take square root (±)","Apply quadratic formula","Simplify"]
     *
     * Mini examples:
     *  Step 1:
     *   action: "Multiply both sides by 4"
     *   before: "x/4 + 8/x = 3"
     *   after:  "x + 32/x = 12"
     *   text:   "Clear denominators."
     *   why:    "Remove fractions."
     *   tip:    "Multiply each term."
     */

    const system = `You are a tutoring assistant. Classify the photo and produce STRICT JSON per the schema.
For PROBLEM_* types, output easy steps that a 12-year-old can follow and ALWAYS include numbers/expressions in 'action' and equation 'before' and 'after'.
Keep language consistent, simple, and brief. Do NOT output any prose outside the JSON. Timezone for events: ${TZ}.`;

    const messages = [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: "Return strict JSON only. 3–4 steps max. Include final." },
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}`, detail: "high" as const } }
        ]
      }
    ];

    const { best, attempts } = await tryModelsInOrder(
      ["gpt-5-mini", "gpt-5", "gpt-4o-mini", "gpt-4o"],
      messages
    );

    if (!best) return new Response("OpenAI call did not return any result", { status: 502 });

    if (!best.ok) {
      console.error("[classify] failures:", attempts.map(a => ({ status: a.status, body: a.raw?.slice(0, 400) })));
      return new Response(best.raw || `OpenAI error ${best.status} ${best.statusText}`, { status: best.status || 502 });
    }

    const final = best.parsed!;
    return new Response(JSON.stringify(final), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[classify] exception", e);
    return new Response(JSON.stringify({ error: e?.message || "Failed" }), { status: 500 });
  }
}


