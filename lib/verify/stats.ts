import type { BoardUnderstanding, Verification } from "@/lib/types";

function extractNumberList(text: string): number[] {
  // find things like [1, 2, 3.5] or 1, 2, 3 in a line mentioning mean/average
  const bracket = text.match(/\[(.*?)\]/);
  let segment = bracket?.[1] ?? text;

  // if we didn't find brackets, try to find a colon segment like "numbers: 1, 2, 3"
  const colon = text.match(/(?:numbers?|data|values?)\s*[:\-]\s*([^\n]+)/i);
  if (colon?.[1]) segment = colon[1];

  const nums = (segment.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi) || []).map(parseFloat);
  // filter out obvious junk (NaN) and keep at least 2 values
  return nums.filter(n => Number.isFinite(n));
}

function extractMeanFromFinal(final?: string | null): number | null {
  if (!final) return null;
  // Look for "mean = 12.3" or "average = 12.3" or just a bare number if the text mentions mean
  const m = final.match(/(?:mean|average)\s*=\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)/i);
  if (m) return parseFloat(m[1]);
  const bare = final.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/);
  return bare ? parseFloat(bare[0]) : null;
}

export function verifyStatsMean(result: BoardUnderstanding): Verification | null {
  const blob = [result.question, result.raw_text, ...(result.steps || []).map(s => s.text || "")]
    .filter(Boolean)
    .join("\n");

  // Heuristic: only run if it looks like a mean/average task
  if (!/(mean|average)\b/i.test(blob + " " + (result.final || ""))) return null;

  const nums = extractNumberList(blob);
  if (nums.length < 2) return null;

  const computed = nums.reduce((a, b) => a + b, 0) / nums.length;
  const target = extractMeanFromFinal(result.final);
  if (target == null) return null;

  const ok = Math.abs(computed - target) <= 1e-6;

  return {
    subject: "stats",
    method: "stats-recompute",
    allVerified: ok,
    checks: [
      {
        value: `mean=${target}`,
        ok,
        lhs: computed,
        rhs: target,
        reason: ok ? null : "mean mismatch"
      }
    ]
  };
}
