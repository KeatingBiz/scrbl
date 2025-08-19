import { NextRequest } from "next/server";
import type { BoardUnderstanding } from "@/lib/types";
import { verifyBoard } from "@/lib/verify/units";

export const runtime = "nodejs";
const TZ = "America/Chicago";

// Feature toggles (all optional)
const RETRY_ON_MISMATCH = process.env.SCRBL_RETRY_ON_MISMATCH === "1";
const RETRY_MODEL = process.env.SCRBL_RETRY_MODEL || ""; // e.g. "gpt-5"
const MODEL_ORDER = (process.env.SCRBL_MODEL_ORDER || "gpt-5-mini,gpt-5,gpt-4o-mini,gpt-4o")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// --- keep your existing strict schema here (unchanged) ---
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
      question: { type: ["string","null"] },
      given_answer: { type: ["string","null"] },
      steps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            n: { type: "integer" },
            text: { type: "string" },
            action: { type: ["string","null"] },
            before: { type: ["string","null"] },
            after: { type: ["string","null"] },
            why: { type: ["string","null"] },
            tip: { type: ["string","null"] },
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

// ---- helpers (your originals, plus a few small additions) ----
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
  if ((!parsed.type || parsed.type === "UNKNOWN") && parsed.steps?.length) {
    parsed.type = parsed.given_answer ? "PROBLEM_SOLVED" : "PROBLEM_UNSOLVED";
  }
  if ((!parsed.type || parsed.type === "UNKNOWN") && parsed.events?.length) {
    parsed.type = "ANNOUNCEMENT";
  }
  parsed.confidence = clamp01(parsed.confidence);
  return parsed;
}
function hasNumbersOrEquations(p: BoardUnderstanding): boolean {
  const blob = [p.question, p.raw_text, ...(p.steps || []).map(s => `${s.before} ${s.after} ${s.text}`)]
    .filter(Boolean).join("\n");
  return /-?\d/.test(blob) || /=/.test(blob) || /∑|∫|d\/dx|v=u\+at/i.test(blob);
}
function firstModelNameFromAttempts(attempts: Array<Awaited<ReturnType<typeof callModelOnce>>>) {
  // we return the model we actually used in "best" by inspecting assistant tool? we can’t; pass via wrapper.
  return undefined as unknown as string;
}

// Subject-aware retry hint (very small + safe)
function verificationHint(verification: any): string | null {
  if (!verification || verification.allVerified) return null;
  const subj = String(verification.subject || "");
  const firstFail = (verification.checks || []).find((c: any) => !c.ok);
  const reason = firstFail?.reason ? String(firstFail.reason) : "";
  // Generic nudge
  const generic = reason ? `Verifier failed: ${reason}. ` : "";

  if (subj === "stats") {
    return generic + "If using standard deviation/variance, confirm sample (n-1) vs population (n).";
  }
  if (subj === "finance") {
    return generic + "Confirm interest rate units (annual vs monthly), rate as decimal (e.g., 5% → 0.05), and cash flow signs.";
  }
  if (subj === "circuits-ac") {
    return generic + "Confirm frequency units (Hz vs rad/s) and use complex impedances (R, jωL, 1/jωC).";
  }
  if (subj === "heat") {
    return generic + "Use Kelvin for absolute temperatures, check area/thickness units, and expected heat transfer relation.";
  }
  if (subj === "units") {
    return generic + "Check dimensional consistency and correct units (e.g., µF vs mF, °C vs K).";
  }
  // algebra/calculus/physics/geometry etc.
  return generic + "Recompute carefully and match required units/rounding.";
}

async function callModelOnce(model: string, messages: any, extra?: { response_format?: any }) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.0,
      top_p: 1,
      max_tokens: 500,
      response_format: extra?.response_format ?? { type: "json_schema", json_schema: jsonSchema },
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
  const attempts: Array<Awaited<ReturnType<typeof callModelOnce>> & { model?: string }> = [];
  for (const m of models) {
    const res = await callModelOnce(m, messages);
    (res as any).model = m;
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

// ---- route ----
export async function POST(req: NextRequest) {
  const t0 = Date.now();
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

    const system = `You are a tutoring assistant. Classify the photo and produce STRICT JSON per the schema.
For PROBLEM_* types, output 3–4 clear steps with numbers/expressions in 'action' and equation 'before'/'after'. Include a concise final answer. Timezone for events: ${TZ}.`;

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

    // 1) Primary solve (with escalation order)
    const { best, attempts } = await tryModelsInOrder(MODEL_ORDER, messages);
    if (!best) return new Response("OpenAI call did not return any result", { status: 502 });
    if (!best.ok) {
      console.error("[classify] failures:", attempts.map(a => ({ model: (a as any).model, status: a.status, body: a.raw?.slice(0, 400) })));
      return new Response(best.raw || `OpenAI error ${best.status} ${best.statusText}`, { status: best.status || 502 });
    }
    let final = best.parsed!;
    const usedModel = (best as any).model || MODEL_ORDER[0];

    // 2) Verify (fast, non-blocking)
    let verification: any = null;
    const tv0 = Date.now();
    try {
      verification = await verifyBoard(final);
      if (verification) {
        (final as any).verification = verification;

        if (final.type === "PROBLEM_SOLVED" || final.type === "PROBLEM_UNSOLVED") {
          if (verification.allVerified) {
            final.answer_status = (final.answer_status && final.answer_status !== "not_applicable")
              ? final.answer_status
              : "matches";
          } else {
            final.answer_status = "mismatch";
          }
        }
      }
    } catch (e) {
      console.warn("[verify] failed:", (e as Error).message);
    }
    const verifyMs = Date.now() - tv0;

    // 3) Optional single retry with a tiny hint (quantitative only)
    let retried = false;
    let retryModelUsed: string | null = null;

    if (
      RETRY_ON_MISMATCH &&
      final &&
      (final.type === "PROBLEM_SOLVED" || final.type === "PROBLEM_UNSOLVED") &&
      verification &&
      verification.allVerified === false &&
      hasNumbersOrEquations(final)
    ) {
      const hint = verificationHint(verification);
      if (hint) {
        retried = true;
        // Choose retry model: explicit env override > gpt-5 > same model
        const retryModel = RETRY_MODEL || "gpt-5";
        const retryMessages = [
          { role: "system", content: system },
          ...messages.slice(1), // original user message with the image
          { role: "user", content: `Your previous answer failed verification. Fix it using this hint, then return STRICT JSON per the same schema.\nHint: ${hint}` }
        ];
        const retryRes = await callModelOnce(retryModel, retryMessages);
        retryModelUsed = retryModel;

        if (retryRes.ok && retryRes.parsed) {
          const corrected = retryRes.parsed;
          try {
            const v2 = await verifyBoard(corrected);
            if (v2) {
              (corrected as any).verification = v2;
              if (corrected.type === "PROBLEM_SOLVED" || corrected.type === "PROBLEM_UNSOLVED") {
                corrected.answer_status = v2.allVerified ? "matches" : "mismatch";
              }
              // Prefer corrected if it verified or if original was mismatch
              if (!verification || !verification.allVerified || v2.allVerified) {
                final = corrected;
                verification = v2;
              }
            }
          } catch (e) {
            console.warn("[verify][retry] failed:", (e as Error).message);
          }
        } else {
          console.warn("[retry] model failed or returned bad JSON");
        }
      }
    }

    // 4) Attach meta + log
    const totalMs = Date.now() - t0;
    (final as any)._meta = {
      model_used: usedModel,
      verify_ms: verifyMs,
      total_ms: totalMs,
      retried,
      retry_model: retryModelUsed,
      verification_subject: verification?.subject || null,
      verification_method: verification?.method || null,
      all_verified: verification?.allVerified ?? null,
    };

    console.info("[classify] done", {
      model: usedModel,
      retried,
      retry_model: retryModelUsed,
      verify_ms: verifyMs,
      total_ms: totalMs,
      subject: verification?.subject,
      method: verification?.method,
      verified: verification?.allVerified,
    });

    return new Response(JSON.stringify(final), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[classify] exception", e);
    return new Response(JSON.stringify({ error: e?.message || "Failed" }), { status: 500 });
  }
}

