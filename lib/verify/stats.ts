import type { BoardUnderstanding, Verification } from "@/lib/types";
import { extractNumberList, approxEqual, gatherProblemText, parseNumber } from "./utils";

function median(vals: number[]): number {
  const a = [...vals].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function mean(vals: number[]): number { return vals.reduce((s, v) => s + v, 0) / vals.length; }
function variance(vals: number[], sample = false): number {
  const m = mean(vals);
  const denom = sample ? vals.length - 1 : vals.length;
  if (denom <= 0) return NaN;
  return vals.reduce((s, v) => s + (v - m) ** 2, 0) / denom;
}
function stddev(vals: number[], sample = false): number { return Math.sqrt(variance(vals, sample)); }

export function verifyStats(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const hasStats = /(mean|average|median|variance|std|standard deviation|sd)\b/i.test(
    (blob + " " + (result.final || "")).toLowerCase()
  );
  if (!hasStats) return null;

  const nums = extractNumberList(blob);
  if (nums.length < 2) return null;

  const checks: Verification["checks"] = [];
  const f = (result.final || "").toLowerCase();

  // Mean
  if (/mean|average/.test(f)) {
    const reported = parseNumber(result.final || "");
    if (reported != null) {
      const m = mean(nums);
      const ok = approxEqual(m, reported);
      checks.push({ value: `mean=${reported}`, ok, lhs: m, rhs: reported, reason: ok ? null : "mean mismatch" });
    }
  }

  // Median
  if (/median/.test(f)) {
    const reported = parseNumber(result.final || "");
    if (reported != null) {
      const md = median(nums);
      const ok = approxEqual(md, reported);
      checks.push({ value: `median=${reported}`, ok, lhs: md, rhs: reported, reason: ok ? null : "median mismatch" });
    }
  }

  // Variance / Std (try both population & sample)
  if (/variance|std|standard deviation|sd/.test(f)) {
    const reported = parseNumber(result.final || "");
    if (reported != null) {
      const vPop = variance(nums, false);
      const vSam = variance(nums, true);
      const sPop = Math.sqrt(vPop);
      const sSam = Math.sqrt(vSam);

      if (/variance/.test(f)) {
        const ok = approxEqual(vPop, reported) || approxEqual(vSam, reported);
        checks.push({ value: `variance=${reported}`, ok, lhs: vPop, rhs: reported, reason: ok ? null : "variance mismatch" });
      } else {
        const ok = approxEqual(sPop, reported) || approxEqual(sSam, reported);
        checks.push({ value: `std=${reported}`, ok, lhs: sPop, rhs: reported, reason: ok ? null : "std mismatch" });
      }
    }
  }

  if (!checks.length) return null;
  const allVerified = checks.every(c => c.ok);
  return { subject: "stats", method: "stats-recompute", allVerified, checks };
}

