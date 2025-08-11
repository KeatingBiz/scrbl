// app/api/classify/route.ts
import { NextRequest } from "next/server";
import type { BoardUnderstanding } from "@/lib/types";

export const runtime = "nodejs";

const TZ = "America/Chicago";

// Structured Outputs schema (strict)
const jsonSchema = {
  name: "board_understanding",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      type: {
        type: "string",
        enum: ["PROBLEM_UNSOLVED", "PROBLEM_SOLVED", "ANNOUNCEMENT", "UNKNOWN"]
      },
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
          properties: {
            n: { type: "integer" },
            text: { type: "string" }
          },
          required: ["n", "text"]
        }
      },
      final: { type: ["string", "null"] },
      answer_status: {
        type: "string",
        enum: ["matches", "mismatch", "no_answer_on_board", "not_applicable"]
      },

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

function clamp01(n: number | undefined): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function safeParse(jsonText: string): BoardUnderstanding | null {
  try {
    return JSON.parse(jsonText) as BoardUnderstanding;
  } catch {
    return null;
  }
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

  // If steps exist but no label → infer problem type
  if ((!parsed.type || parsed.type === "UNKNOWN") && parsed.steps?.length) {
    parsed.type = parsed.given_answer ? "PROBLEM_SOLVED" : "PROBLEM_UNSOLVED";
  }
  // If events exist → ANNOUNCEMENT
  if ((!parsed.type || parsed.type === "UNKNOWN") && parsed.events?.length) {
    parsed.type = "ANNOUNCEMENT";
  }

  parsed.confidence = clamp01(parsed.confidence);

  // If still UNKNOWN, nudge based on keywords in raw_text
  if (parsed.type === "UNKNOWN" && parsed.raw_text) {
    const t = parsed.raw_text.toLowerCase();
    const ann = /(test|exam|quiz|homework|hw|due|assignment|project|presentation|friday|monday|tuesday|wednesday|thursday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(
      t
    );
    const prob = /[=±×÷+\-*/]|sqrt|∫|∑|lim|dx|dy|cos|sin|tan|log|proof|theorem|q[:=]/i.test(t);
    if (ann && !prob) parsed.type = "ANNOUNCEMENT";
    else if (prob) parsed.type = "PROBLEM_UNSOLVED";
  }

  return parsed;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("image") as unknown as File | null;
    if (!file) {
      return new Response(JSON.stringify({ error: "No image provided" }), { status: 400 });
    }

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
- For problems: provide short, numbered steps (no chain-of-thought), and a concise final.
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
          {
            type: "image_url",
            image_url: { url: `data:${mime};base64,${b64}`, detail: "high" as const }
          }
        ]
      }
    ];

    async function callModel(model: string): Promise<BoardUnderstanding | null> {
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
      if (!r.ok) return null;
      const data = await r.json().catch(() => null);
      const jsonText = data?.choices?.[0]?.message?.content ?? "{}";
      const parsed = safeParse(jsonText);
      return applyLightFallbacks(parsed);
    }

    // 1) Fast path: gpt-5-mini
    const first = await callModel("gpt-5-mini");

    // 2) Escalate if UNKNOWN or low confidence
    let final = first;
    if (!final || final.type === "UNKNOWN" || clamp01(final.confidence) < 0.6) {
      const second = await callModel("gpt-5");
      // choose better by score
      final = scoreResult(second) > scoreResult(first) ? second : first;
    }

    // If still null (API failure), return a graceful UNKNOWN
    if (!final) {
      final = {
        type: "UNKNOWN",
        subject_guess: "",
        confidence: 0,
        raw_text: "unavailable",
        question: "",
        given_answer: null,
        steps: [],
        final: null,
        answer_status: "not_applicable",
        events: []
      };
    }

    return new Response(JSON.stringify(final), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Failed" }), { status: 500 });
  }
}

