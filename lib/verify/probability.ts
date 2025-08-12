// lib/verify/probability.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import {
  gatherProblemText,
  parseNumber,
  parsePercentOrNumber,
  approxEqual,
  relClose,
} from "./utils";

/* ========================= tiny math helpers ========================= */
const TINY = 1e-300;

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
function lnFactorial(k: number): number {
  // Stirling for large k; exact sum for small k
  if (k < 0) return NaN;
  if (k <= 1) return 0;
  if (k < 50) {
    let s = 0;
    for (let i = 2; i <= k; i++) s += Math.log(i);
    return s;
  }
  // Stirling with 1/(12n) correction
  return k * Math.log(k) - k + 0.5 * Math.log(2 * Math.PI * k) + 1 / (12 * k);
}
function lnChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  k = Math.min(k, n - k);
  return lnFactorial(n) - lnFactorial(k) - lnFactorial(n - k);
}
function choose(n: number, k: number): number {
  const v = Math.exp(lnChoose(n, k));
  return Number.isFinite(v) ? v : NaN;
}
function perm(n: number, k: number): number {
  if (k < 0 || k > n) return NaN;
  return Math.exp(lnFactorial(n) - lnFactorial(n - k));
}

/* ----- normal CDF / inverse CDF (approximations) ----- */
// erf approximation (Abramowitz & Stegun 7.1.26)
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * Math.abs(x));
  const y =
    1 -
    (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-x * x);
  return sign * y;
}
function normCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}
// Inverse normal (Peter J. Acklam approximation)
function invNorm(p: number): number {
  // Clamp and mirror for tails
  const eps = 1e-12;
  p = Math.min(1 - eps, Math.max(eps, p));
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425, ph = 1 - pl;
  let q, r, x;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p > ph) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
         ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else {
    q = p - 0.5; r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  // Halley's refinement
  const e = normCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
  return x - u / (1 + x * u / 2);
}

/* ----- Student t CDF via incomplete beta (robust for typical dfs) ----- */
function logGamma(z: number): number {
  // Lanczos approximation
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) x += p[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x) - Math.log(z + 1);
}
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d;
  let h = d;
  for (let m = 1, m2 = 2; m <= MAXIT; m++, m2 += 2) {
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function betainc(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}
function tCdf(t: number, df: number): number {
  if (df <= 0) return NaN;
  const x = df / (df + t * t);
  const a = df / 2, b = 0.5;
  const ib = betainc(a, b, x);
  const sign = t >= 0 ? 1 : -1;
  // CDF = 1 - 0.5 * I_{df/(df+t^2)}(df/2, 1/2) for t>=0; mirror for t<0
  const c = 1 - 0.5 * ib;
  return sign > 0 ? c : 1 - c;
}

/* Common z* map */
const ZSTAR: Record<number, number> = {
  0.80: 1.2815515655446004,
  0.90: 1.6448536269514722,
  0.95: 1.959963984540054,
  0.98: 2.3263478740408408,
  0.99: 2.5758293035489004,
  0.999: 3.2905267314919255,
};
function zStarFromCL(cl: number): number {
  const key = Object.keys(ZSTAR).map(parseFloat).find(k => Math.abs(k - cl) < 1e-6);
  if (key) return ZSTAR[key];
  // fallback: two-tailed alpha = 1 - cl
  const alpha2 = (1 - cl) / 2;
  return invNorm(1 - alpha2);
}

/* ========================= parsing helpers ========================= */
const NUM = "(-?\\d*\\.?\\d+(?:e[+-]?\\d+)?)";

function find(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m || m[1] == null) return null;
  return parseNumber(m[1]);
}
function findPctOrNum(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m || m[1] == null) return null;
  return parsePercentOrNumber(m[1]);
}

/* =============================== main =============================== */
export function verifyProbability(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.replace(/[–—−]/g, "-");
  const lower = text.toLowerCase();
  const finalS = String(result.final ?? "");
  const finalN = parsePercentOrNumber(finalS) ?? parseNumber(finalS);

  const looksProb =
    /\b(combination|permutation|choose|ncr|npr|binomial|bernoulli|poisson|normal|gaussian|z[-\s]*score|t[-\s]*score|confidence\s*interval|margin\s*of\s*error|sample\s*size|alpha|significance|p[-\s]*value)\b/.test(
      lower
    ) ||
    /x\s*~\s*(bin|pois|n|normal|t)\b/i.test(lower);
  if (!looksProb) return null;

  const checks: Verification["checks"] = [];

  /* ---------- Combinatorics: nCr, nPr ---------- */
  if (/\b(ncr|combination|choose)\b/i.test(lower) || /C\s*\(\s*\d+\s*,\s*\d+\s*\)/i.test(text)) {
    // n, k
    const n = find(text, new RegExp(`\\bn\\s*=\\s*${NUM}`, "i")) ?? find(text, /\bchoose\s+(\d+)/i);
    const k = find(text, new RegExp(`\\bk\\s*=\\s*${NUM}`, "i")) ?? find(text, /\bchoose\s+\d+\s*(?:,|\s)\s*(\d+)/i);
    if (n != null && k != null && finalN != null) {
      const val = choose(Math.round(n), Math.round(k));
      if (Number.isFinite(val)) {
        const ok = relClose(val, finalN, 1e-12, 1e-6) || approxEqual(val, finalN, 1e-6);
        checks.push({ value: `nCr=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "nCr mismatch" } as any);
      }
    }
  }
  if (/\b(npr|permutation)\b/i.test(lower)) {
    const n = find(text, new RegExp(`\\bn\\s*=\\s*${NUM}`, "i"));
    const k = find(text, new RegExp(`\\bk\\s*=\\s*${NUM}`, "i"));
    if (n != null && k != null && finalN != null) {
      const val = perm(Math.round(n), Math.round(k));
      if (Number.isFinite(val)) {
        const ok = relClose(val, finalN, 1e-12, 1e-6) || approxEqual(val, finalN, 1e-6);
        checks.push({ value: `nPr=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "nPr mismatch" } as any);
      }
    }
  }

  /* ---------- Binomial ---------- */
  if (/\bbinomial|x\s*~\s*bin\b/i.test(lower)) {
    const n = find(text, new RegExp(`\\bn\\s*=\\s*${NUM}`, "i"));
    const p = findPctOrNum(text, new RegExp(`\\bp\\s*=\\s*${NUM}`, "i"));
    const k = find(text, new RegExp(`\\bk\\s*=\\s*${NUM}`, "i"));
    if (n != null && p != null && finalN != null) {
      const N = Math.round(n);
      const P = clamp01(p);
      const wantLE = /\b(at\s*most|≤|<=)\b/i.test(lower);
      const wantGE = /\b(at\s*least|≥|>=)\b/i.test(lower);
      const wantEQ = /\bexact(ly)?\b/i.test(lower) || (!wantLE && !wantGE);
      let prob = NaN;

      function binPMF(N: number, k: number, P: number): number {
        const ln = lnChoose(N, k) + (k * Math.log(P)) + ((N - k) * Math.log(1 - P));
        return Math.exp(ln);
      }

      if (wantEQ && k != null) {
        prob = binPMF(N, Math.round(k), P);
      } else if (wantLE && k != null) {
        const K = Math.round(k);
        let s = 0;
        for (let i = 0; i <= K; i++) s += binPMF(N, i, P);
        prob = s;
      } else if (wantGE && k != null) {
        const K = Math.round(k);
        let s = 0;
        for (let i = K; i <= N; i++) s += binPMF(N, i, P);
        prob = s;
      }

      if (Number.isFinite(prob)) {
        const ok = relClose(prob, finalN, 1e-8, 1e-8) || approxEqual(prob, finalN, 1e-8);
        checks.push({ value: `P_bin=${finalN}`, ok, lhs: prob, rhs: finalN, reason: ok ? null : "binomial probability mismatch" } as any);
      }
    }
  }

  /* ---------- Poisson ---------- */
  if (/\bpoisson|x\s*~\s*pois\b/i.test(lower)) {
    const lambda = find(text, new RegExp(`\\b(?:lambda|λ)\\s*=\\s*${NUM}`, "i")) ?? find(text, new RegExp(`\\bl\\s*=\\s*${NUM}`, "i"));
    const k = find(text, new RegExp(`\\bk\\s*=\\s*${NUM}`, "i"));
    if (lambda != null && finalN != null) {
      const wantLE = /\b(at\s*most|≤|<=)\b/i.test(lower);
      const wantGE = /\b(at\s*least|≥|>=)\b/i.test(lower);
      const wantEQ = /\bexact(ly)?\b/i.test(lower) || (!wantLE && !wantGE);

      function poisPMF(l: number, k: number): number {
        if (k < 0) return 0;
        return Math.exp(-l + k * Math.log(l) - lnFactorial(k));
      }

      let prob = NaN;
      if (wantEQ && k != null) {
        prob = poisPMF(lambda, Math.round(k));
      } else if (wantLE && k != null) {
        const K = Math.round(k);
        let s = 0;
        for (let i = 0; i <= K; i++) s += poisPMF(lambda, i);
        prob = s;
      } else if (wantGE && k != null) {
        const K = Math.round(k);
        let s = 0;
        // Tail sum to a reasonable cap
        const cap = Math.max(K + 10 * Math.sqrt(lambda), K + 200);
        for (let i = K; i <= cap; i++) s += poisPMF(lambda, i);
        prob = s;
      }

      if (Number.isFinite(prob)) {
        const ok = relClose(prob, finalN, 1e-8, 1e-8) || approxEqual(prob, finalN, 1e-8);
        checks.push({ value: `P_pois=${finalN}`, ok, lhs: prob, rhs: finalN, reason: ok ? null : "poisson probability mismatch" } as any);
      }
    }
  }

  /* ---------- Normal (z) ---------- */
  if (/\bnormal|gaussian|z[-\s]*score\b/i.test(lower) || /x\s*~\s*n\(/i.test(lower)) {
    const mu = find(text, new RegExp(`\\b(?:mu|μ|mean)\\s*=\\s*${NUM}`, "i"));
    const sigma = find(text, new RegExp(`\\b(?:sigma|σ|std|sd)\\s*=\\s*${NUM}`, "i"));
    const x = find(text, new RegExp(`\\b(?:x|value)\\s*=\\s*${NUM}`, "i"));
    const z = find(text, new RegExp(`\\bz\\s*=\\s*${NUM}`, "i"));

    if (finalN != null) {
      // If they gave z → compute two-tailed p-value or one tail depending on text
      if (z != null) {
        const Z = z;
        const left = normCdf(Z);
        let p: number | null = null;
        if (/\btwo[-\s]*tailed|two\s*sided|±/i.test(lower)) {
          p = 2 * (1 - normCdf(Math.abs(Z)));
        } else if (/\bgreater|>\b/.test(lower)) {
          p = 1 - left;
        } else if (/\bless|<\b/.test(lower)) {
          p = left;
        }
        if (p != null) {
          const ok = relClose(p, finalN, 1e-8, 1e-8) || approxEqual(p, finalN, 1e-8);
          checks.push({ value: `p_z=${finalN}`, ok, lhs: p, rhs: finalN, reason: ok ? null : "z p-value mismatch" } as any);
        }
      } else if (mu != null && sigma != null && x != null) {
        const Z = (x - mu) / sigma;
        // If they want a probability area:
        if (/\bp\s*\(|prob|area|cdf|less|greater|<=|>=|<|>/i.test(lower)) {
          let p: number | null = null;
          if (/\bgreater|>\b/.test(lower)) p = 1 - normCdf(Z);
          else p = normCdf(Z); // default "P(X<=x)"
          if (p != null) {
            const ok = relClose(p, finalN, 1e-8, 1e-8) || approxEqual(p, finalN, 1e-8);
            checks.push({ value: `P_norm=${finalN}`, ok, lhs: p, rhs: finalN, reason: ok ? null : "normal probability mismatch" } as any);
          }
        } else {
          // Else they might be asking for z-score
          const ok = relClose(Z, finalN, 1e-8, 1e-8) || approxEqual(Z, finalN, 1e-8);
          checks.push({ value: `z=${finalN}`, ok, lhs: Z, rhs: finalN, reason: ok ? null : "z-score mismatch" } as any);
        }
      }
    }
  }

  /* ---------- t distribution p-values (two-tailed default) ---------- */
  if (/\bt[-\s]*score|student'?s?\s*t\b/i.test(lower)) {
    const t = find(text, new RegExp(`\\bt\\s*=\\s*${NUM}`, "i"));
    const df = find(text, new RegExp(`\\bdf\\s*=\\s*${NUM}`, "i"));
    if (t != null && df != null && finalN != null) {
      const T = t, DF = Math.max(1, Math.round(df));
      let p: number | null = null;
      if (/\btwo[-\s]*tailed|two\s*sided|±/i.test(lower)) {
        p = 2 * (1 - tCdf(Math.abs(T), DF));
      } else if (/\bgreater|>\b/.test(lower)) {
        p = 1 - tCdf(T, DF);
      } else if (/\bless|<\b/.test(lower)) {
        p = tCdf(T, DF);
      } else {
        p = 2 * (1 - tCdf(Math.abs(T), DF)); // default two-tailed
      }
      const ok = relClose(p!, finalN, 1e-8, 1e-8) || approxEqual(p!, finalN, 1e-8);
      checks.push({ value: `p_t=${finalN}`, ok, lhs: p!, rhs: finalN, reason: ok ? null : "t p-value mismatch" } as any);
    }
  }

  /* ---------- Confidence intervals ---------- */
  if (/\bconfidence\s*interval|ci\b/i.test(lower) && finalN != null) {
    // Detect CL (e.g., 95%)
    const cl = findPctOrNum(lower, new RegExp(`\\b(?:cl|conf(?:idence)?\\s*level|confidence)\\s*=?\\s*${NUM}`, "i")) ??
               (() => { const m = lower.match(/(\d{2,3})\s*%/); return m ? parseFloat(m[1]) / 100 : null; })() ?? 0.95;
    const zStar = zStarFromCL(cl);

    // Proportion CI
    const pHat = findPctOrNum(lower, new RegExp(`\\b(?:p\\^|p_hat|phat)\\s*=?\\s*${NUM}`, "i"));
    const nProp = find(lower, new RegExp(`\\bn\\s*=\\s*${NUM}`, "i"));
    if (pHat != null && nProp != null) {
      const se = Math.sqrt(pHat * (1 - pHat) / nProp);
      const half = zStar * se;
      const // They might supply "margin of error" as finalN
        meOk = relClose(half, finalN, 1e-8, 1e-8) || approxEqual(half, finalN, 1e-8);
      checks.push({ value: `ME_prop=${finalN}`, ok: meOk, lhs: half, rhs: finalN, reason: meOk ? null : "ME proportion mismatch" } as any);
    }

    // Mean CI (σ known vs s unknown)
    const xbar = find(lower, new RegExp(`\\b(x̄|xbar|mean|\\bx\\s*bar)\\s*=?\\s*${NUM}`, "i"));
    const sigma = find(lower, new RegExp(`\\b(?:sigma|σ)\\s*=\\s*${NUM}`, "i"));
    const s = find(lower, new RegExp(`\\b(?:s|std|sd)\\s*=\\s*${NUM}`, "i"));
    const n = find(lower, new RegExp(`\\bn\\s*=\\s*${NUM}`, "i"));
    if (xbar != null && n != null) {
      if (sigma != null) {
        const se = sigma / Math.sqrt(n);
        const half = zStar * se;
        const meOk = relClose(half, finalN, 1e-8, 1e-8) || approxEqual(half, finalN, 1e-8);
        checks.push({ value: `ME_mean_z=${finalN}`, ok: meOk, lhs: half, rhs: finalN, reason: meOk ? null : "ME mean (z) mismatch" } as any);
      } else if (s != null) {
        const df = Math.max(1, Math.round(n - 1));
        // Approximate t* via normal if n large; else scale z* a bit (quick heuristic)
        const tstar = n >= 40 ? zStar : zStar * Math.sqrt((n - 1) / (n - 3)); // mild inflate for small n
        const se = s / Math.sqrt(n);
        const half = tstar * se;
        const meOk = relClose(half, finalN, 2e-8, 1e-8) || approxEqual(half, finalN, 1e-8);
        checks.push({ value: `ME_mean_t≈=${finalN}`, ok: meOk, lhs: half, rhs: finalN, reason: meOk ? null : "ME mean (t) mismatch" } as any);
      }
    }
  }

  /* ---------- Sample size calculations ---------- */
  if (/\bsample\s*size|how\s*many\s*samples\b/i.test(lower) && finalN != null) {
    const cl = findPctOrNum(lower, new RegExp(`\\b(?:cl|confidence(?:\s*level)?)\\s*=?\\s*${NUM}`, "i")) ??
               (() => { const m = lower.match(/(\d{2,3})\s*%/); return m ? parseFloat(m[1]) / 100 : null; })() ?? 0.95;
    const zStar = zStarFromCL(cl);
    const E = findPctOrNum(lower, new RegExp(`\\b(?:margin|me|error|E)\\s*=?\\s*${NUM}`, "i")); // margin of error
    if (E != null) {
      // Proportion case if p given or hinted
      const p = findPctOrNum(lower, new RegExp(`\\bp\\s*=?\\s*${NUM}`, "i"));
      const sigma = find(lower, new RegExp(`\\b(?:sigma|σ)\\s*=\\s*${NUM}`, "i"));
      if (p != null) {
        const n = (zStar * zStar * p * (1 - p)) / (E * E);
        const ok = relClose(n, finalN, 1e-8, 1e-6) || approxEqual(n, finalN, 1e-6);
        checks.push({ value: `n_prop=${finalN}`, ok, lhs: n, rhs: finalN, reason: ok ? null : "sample size (prop) mismatch" } as any);
      } else if (sigma != null) {
        const n = (zStar * zStar * sigma * sigma) / (E * E);
        const ok = relClose(n, finalN, 1e-8, 1e-6) || approxEqual(n, finalN, 1e-6);
        checks.push({ value: `n_mean=${finalN}`, ok, lhs: n, rhs: finalN, reason: ok ? null : "sample size (mean) mismatch" } as any);
      } else {
        // Worst-case p=0.5 for proportion if not given
        const n = (zStar * zStar * 0.25) / (E * E);
        const ok = relClose(n, finalN, 1e-8, 1e-6) || approxEqual(n, finalN, 1e-6);
        checks.push({ value: `n_prop(p=0.5)=${finalN}`, ok, lhs: n, rhs: finalN, reason: ok ? null : "sample size (prop, p=0.5) mismatch" } as any);
      }
    }
  }

  /* ---------- verdict ---------- */
  if (!checks.length) return null;
  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "probability", method: "probability-core", allVerified, checks } as unknown as Verification;
}
