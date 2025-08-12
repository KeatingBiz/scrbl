// lib/verify/stats.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import {
  extractNumberList,
  approxEqual,
  relClose,
  gatherProblemText,
  parseNumber,
} from "./utils";

/* ---------- basic stats ---------- */
function median(vals: number[]): number {
  const a = [...vals].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function mean(vals: number[]): number {
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}
function variance(vals: number[], sample = false): number {
  const m = mean(vals);
  const denom = sample ? vals.length - 1 : vals.length;
  if (denom <= 0) return NaN;
  return vals.reduce((s, v) => s + (v - m) ** 2, 0) / denom;
}
function stddev(vals: number[], sample = false): number {
  const v = variance(vals, sample);
  return Number.isFinite(v) && v >= 0 ? Math.sqrt(v) : NaN;
}

/* ---------- parsing helpers ---------- */
function parseInterval(s: string): { lo: number; hi: number } | null {
  const m = s.match(/[\[\(]\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*[,–-]\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*[\]\)]/i);
  if (m) {
    const lo = parseFloat(m[1]), hi = parseFloat(m[2]);
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi) return { lo, hi };
  }
  return null;
}
function parsePlusMinus(s: string): { center: number; moe: number } | null {
  const m = s.match(/(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*[±]\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)/i);
  if (m) {
    const center = parseFloat(m[1]), moe = parseFloat(m[2]);
    if (Number.isFinite(center) && Number.isFinite(moe) && moe >= 0) return { center, moe };
  }
  return null;
}
function parseAlphaFromText(text: string): number | null {
  const m = text.match(/(\d{2})(?:\.\d+)?\s*%\s*(?:confidence|ci)/i);
  if (m) {
    const conf = parseFloat(m[1]);
    if ([90, 95, 99].includes(conf)) return 1 - conf / 100;
  }
  return null;
}
function parseN(text: string): number | null {
  const m = text.match(/\bn\s*=\s*(\d{1,5})\b/i);
  if (m) return parseInt(m[1], 10);
  return null;
}
function parseSD(text: string): number | null {
  const m = text.match(/\b(s|sd|std|standard deviation|σ|sigma)\s*=\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)\b/i);
  return m ? parseFloat(m[2]) : null;
}
function parseSE(text: string): number | null {
  const m = text.match(/\b(?:se|standard error)\b\s*=?\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)/i);
  return m ? parseFloat(m[1]) : null;
}
function parsePValue(text: string): number | null {
  const m = text.match(/\bp(?:-?value)?\s*[:=]\s*(\d*\.?\d+(?:e[+-]?\d+)?)/i);
  return m ? parseFloat(m[1]) : null;
}
function parseCorrelation(text: string): number | null {
  const m = text.match(/\b(r|corr(?:elation)?)\s*[:=]\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)/i);
  return m ? parseFloat(m[2]) : null;
}

/* ---------- critical values ---------- */
const zCrit: Record<number, number> = { 0.1: 1.6448536269, 0.05: 1.9599639845, 0.01: 2.5758293035 };
const tCrit95: number[] = [
  NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042
];
const tCrit90: number[] = [
  NaN, 6.314, 2.920, 2.353, 2.132, 2.015, 1.943, 1.895, 1.860, 1.833, 1.812,
  1.796, 1.782, 1.771, 1.761, 1.753, 1.746, 1.740, 1.734, 1.729, 1.725,
  1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697
];
const tCrit99: number[] = [
  NaN, 63.657, 9.925, 5.841, 4.604, 4.032, 3.707, 3.499, 3.355, 3.250, 3.169,
  3.106, 3.055, 3.012, 2.977, 2.947, 2.921, 2.898, 2.878, 2.861, 2.845,
  2.831, 2.819, 2.807, 2.797, 2.787, 2.779, 2.771, 2.763, 2.756
];
function tCriticalTwoSided(alpha: number, df: number): number {
  const conf = 1 - alpha;
  const table =
    Math.abs(conf - 0.95) < 1e-3 ? tCrit95 :
    Math.abs(conf - 0.90) < 1e-3 ? tCrit90 :
    Math.abs(conf - 0.99) < 1e-3 ? tCrit99 : null;
  if (!table) return zCrit[alpha] ?? 1.96;
  if (df <= 0) return table[1];
  if (df < table.length) return table[df];
  return zCrit[alpha] ?? 1.96;
}

/* ---------- main ---------- */
export function verifyStats(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const finalS = String(result.final ?? "");
  const text = (blob + "\n" + finalS).toLowerCase();

  const looksStats =
    /(mean|average|median|variance|std|standard deviation|sd|confidence interval|\bci\b|p-?value|proportion|correlation|r=)/i.test(
      blob
    );
  if (!looksStats) return null;

  const data = extractNumberList(blob);
  const nFromData = data.length >= 2 ? data.length : null;

  const checks: Verification["checks"] = [];

  const f = finalS.toLowerCase();
  if (/mean|average/.test(f) && nFromData) {
    const reported = parseNumber(finalS);
    if (reported != null) {
      const m = mean(data);
      const ok = relClose(m, reported);
      checks.push({ value: `mean=${reported}`, ok, lhs: m, rhs: reported, reason: ok ? null : "mean mismatch" });
    }
  }

  if (/median/.test(f) && nFromData) {
    const reported = parseNumber(finalS);
    if (reported != null) {
      const md = median(data);
      const ok = relClose(md, reported);
      checks.push({ value: `median=${reported}`, ok, lhs: md, rhs: reported, reason: ok ? null : "median mismatch" });
    }
  }

  if (/(variance|std|standard deviation|sd)/.test(f) && nFromData) {
    const reported = parseNumber(finalS);
    if (reported != null) {
      const vPop = variance(data, false);
      const vSam = variance(data, true);
      const sPop = Math.sqrt(vPop);
      const sSam = Math.sqrt(vSam);
      if (/variance/.test(f)) {
        const ok = relClose(vPop, reported) || relClose(vSam, reported);
        checks.push({ value: `variance=${reported}`, ok, lhs: vPop, rhs: reported, reason: ok ? null : "variance mismatch" });
      } else {
        const ok = relClose(sPop, reported) || relClose(sSam, reported);
        checks.push({ value: `std=${reported}`, ok, lhs: sPop, rhs: reported, reason: ok ? null : "std mismatch" });
      }
    }
  }

  // invariants / ranges
  if (/(variance|std|standard deviation|sd|se|standard error)/i.test(text)) {
    const val = parseNumber(finalS);
    if (val != null && /variance/i.test(text)) {
      checks.push({ value: `variance>=0`, ok: val >= 0, reason: val >= 0 ? null : "variance negative" });
    }
    if (val != null && /(std|standard deviation|sd)/i.test(text)) {
      checks.push({ value: `sd>=0`, ok: val >= 0, reason: val >= 0 ? null : "sd negative" });
    }
  }
  if (/\bp-?value\b|\bp=/.test(text)) {
    const p = parsePValue(finalS) ?? parsePValue(blob);
    if (p != null) {
      const ok = p >= 0 && p <= 1;
      checks.push({ value: `p=${p}`, ok, reason: ok ? null : "p-value out of [0,1]" });
    }
  }
  if (/correlation|r=/.test(text)) {
    const r = parseCorrelation(finalS) ?? parseCorrelation(blob);
    if (r != null) {
      const ok = r >= -1 && r <= 1;
      checks.push({ value: `r=${r}`, ok, reason: ok ? null : "correlation out of [-1,1]" });
    }
  }

  // CI for a mean
  const mentionsCI = /(confidence interval|\bci\b|±|\[.*?,.*?\])/.test(text);
  if (mentionsCI) {
    const alpha = parseAlphaFromText(text) ?? 0.05;
    let interval = parseInterval(finalS) || parseInterval(blob) || null;
    if (!interval) {
      const pm = parsePlusMinus(finalS) || parsePlusMinus(blob);
      if (pm) interval = { lo: pm.center - pm.moe, hi: pm.center + pm.moe };
    }
    if (interval) {
      const center = (interval.lo + interval.hi) / 2;
      const halfWidth = (interval.hi - interval.lo) / 2;

      const nExplicit = parseN(text);
      const n = nExplicit ?? nFromData ?? null;

      const seExplicit = parseSE(text);
      const sdExplicit = parseSD(text);
      const sData = nFromData ? stddev(data, true) : null;
      const se =
        seExplicit ??
        (sdExplicit != null && n ? sdExplicit / Math.sqrt(n) : null) ??
        (sData != null && nFromData ? sData / Math.sqrt(nFromData) : null);

      const useT = !!(!seExplicit && (sdExplicit != null || sData != null)) && (n ?? 0) > 1 && (n ?? 0) <= 30;
      const crit = useT ? tCriticalTwoSided(alpha, (n ?? 2) - 1) : (zCrit[alpha] ?? 1.96);

      if (se != null && Number.isFinite(se) && se >= 0) {
        const expectedHalf = crit * se;
        const okWidth = relClose(halfWidth, expectedHalf, 2e-2, 1e-6) || approxEqual(halfWidth, expectedHalf, 1e-3);
        checks.push({
          value: `CI half-width≈crit*SE (${halfWidth.toFixed(6)}≈${expectedHalf.toFixed(6)})`,
          ok: okWidth,
          lhs: halfWidth,
          rhs: expectedHalf,
          reason: okWidth ? null : "CI width mismatch",
        });
      }
      if (nFromData) {
        const m = mean(data);
        const okCenter = relClose(center, m, 2e-2, 1e-6) || approxEqual(center, m, 1e-3);
        checks.push({
          value: `CI center≈mean (${center.toFixed(6)}≈${m.toFixed(6)})`,
          ok: okCenter,
          lhs: center,
          rhs: m,
          reason: okCenter ? null : "CI center not sample mean",
        });
      }
    }
  }

  if (!checks.length) return null;
  const allVerified = checks.every((c) => c.ok);
  return { subject: "stats", method: "stats-recompute", allVerified, checks };
}


