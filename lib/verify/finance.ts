// lib/verify/finance.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import {
  gatherProblemText,
  extractNumberList,
  parsePercentOrNumber,
  parseNumber,
  approxEqual,
  relClose,
} from "./utils";

/* ====================== Core math helpers ====================== */
const ABS_EPS = 1e-9;

function npv(r: number, cfs: number[]): number {
  return cfs.reduce((acc, cf, i) => acc + cf / Math.pow(1 + r, i), 0);
}

function irr(cfs: number[], guess = 0.1): number | null {
  let r = guess;
  for (let k = 0; k < 30; k++) {
    let f = 0, df = 0;
    for (let i = 0; i < cfs.length; i++) {
      const den = Math.pow(1 + r, i);
      f += cfs[i] / den;
      if (i > 0) df += -i * cfs[i] / (den * (1 + r));
    }
    if (!Number.isFinite(f) || !Number.isFinite(df) || Math.abs(df) < 1e-14) break;
    const rNext = r - f / df;
    if (!Number.isFinite(rNext)) break;
    if (Math.abs(rNext - r) < 1e-12) return rNext;
    r = rNext;
  }
  let lo = -0.999, hi = 10;
  let flo = npv(lo, cfs), fhi = npv(hi, cfs);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let k = 0; k < 300; k++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid, cfs);
    if (!Number.isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-12) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

function mirr(cfs: number[], financeRate: number, reinvestRate: number): number | null {
  if (!cfs.length) return null;
  const negs = cfs.map((cf, i) => cf < 0 ? cf * Math.pow(1 + financeRate, i) : 0).reduce((a, b) => a + b, 0);
  const possFV = cfs.map((cf, i) => cf > 0 ? cf * Math.pow(1 + reinvestRate, cfs.length - 1 - i) : 0).reduce((a, b) => a + b, 0);
  if (negs === 0) return null;
  const n = cfs.length - 1;
  return Math.pow(-possFV / negs, 1 / n) - 1;
}

function pmt(r: number, n: number, pv: number, fv = 0, due = false): number {
  if (n <= 0) return NaN;
  if (Math.abs(r) < ABS_EPS) {
    const base = -(pv + fv) / n;
    return due ? base / (1 + r) : base;
  }
  const k = Math.pow(1 + r, n);
  const ann = (r * pv * k + r * fv) / (k - 1);
  return due ? -(ann) / (1 + r) : -ann;
}
function pv_lump(fv: number, r: number, n: number): number { return fv / Math.pow(1 + r, n); }
function fv_lump(pv: number, r: number, n: number): number { return pv * Math.pow(1 + r, n); }
function pv_annuity(pmtAmt: number, r: number, n: number, due = false): number {
  if (Math.abs(r) < ABS_EPS) return pmtAmt * n;
  const factor = (1 - Math.pow(1 + r, -n)) / r;
  return pmtAmt * (due ? (1 + r) * factor : factor);
}
function fv_annuity(pmtAmt: number, r: number, n: number, due = false): number {
  if (Math.abs(r) < ABS_EPS) return pmtAmt * n;
  const factor = (Math.pow(1 + r, n) - 1) / r;
  return pmtAmt * (due ? (1 + r) * factor : factor);
}
function pv_perpetuity(c: number, r: number): number { return c / r; }
function pv_growing_perpetuity(c: number, r: number, g: number): number { if (r <= g) return NaN; return c / (r - g); }
function pv_growing_annuity(c: number, r: number, g: number, n: number): number {
  if (r === g) return c * n / (1 + r);
  return c * (1 - Math.pow((1 + g) / (1 + r), n)) / (r - g);
}

function aprToEar(apr: number, m: number): number { return Math.pow(1 + apr / m, m) - 1; }
function earToApr(ear: number, m: number): number { return m * (Math.pow(1 + ear, 1 / m) - 1); }

function bondPrice(face: number, couponRate: number, ytm: number, years: number, freq = 2): number {
  const N = Math.round(years * freq);
  const c = (couponRate * face) / freq;
  const r = ytm / freq;
  const pvCoupons = c * (1 - Math.pow(1 + r, -N)) / r;
  const pvFace = face * Math.pow(1 + r, -N);
  return pvCoupons + pvFace;
}
function bondYTM(price: number, face: number, couponRate: number, years: number, freq = 2): number | null {
  const N = Math.round(years * freq);
  const c = (couponRate * face) / freq;
  const cfs = [-price, ...Array.from({ length: N - 1 }, () => c), c + face];
  const rPer = irr(cfs);
  return rPer == null ? null : rPer * freq;
}

/* ====================== Parsing helpers ====================== */
function findRate(text: string, ...labels: RegExp[]): number | null {
  for (const lab of labels) {
    const m = text.match(lab);
    if (m && m[1]) {
      const r = parsePercentOrNumber(m[1]);
      if (r != null) return r;
    }
  }
  return null;
}
function findNum(text: string, ...labels: RegExp[]): number | null {
  for (const lab of labels) {
    const m = text.match(lab);
    if (m && m[1]) {
      const n = parseNumber(m[1]);
      if (n != null) return n;
    }
  }
  return null;
}
function findInt(text: string, ...labels: RegExp[]): number | null {
  const n = findNum(text, ...labels);
  return n != null ? Math.round(n) : null;
}
function compFreq(text: string): number | null {
  if (/\b(semi-?annual|semiannual)\b/i.test(text)) return 2;
  if (/\bquarterly\b/i.test(text)) return 4;
  if (/\bmonthly\b/i.test(text)) return 12;
  if (/\bweekly\b/i.test(text)) return 52;
  if (/\bdaily\b/i.test(text)) return 365;
  if (/\b(annual|yearly)\b/i.test(text)) return 1;
  return findInt(text, /\bm\s*=\s*(\d{1,3})\b/i);
}

/* ====================== Verifier ====================== */
export function verifyFinance(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.toLowerCase();
  const finalS = String(result.final ?? "");

  const looksFinance = /\b(npv|irr|mirr|pmt|pv|fv|apr|apy|ear|coupon|ytm|bond|wacc|beta|capm|portfolio|return|variance|perpetuity|annuity|payback|cagr|eaa|cash\s*flows?)\b/i.test(
    text
  );
  if (!looksFinance) return null;

  const checks: Verification["checks"] = [];
  const finalN = parseNumber(finalS);
  const finalPct = parsePercentOrNumber(finalS);
  const cfs = extractNumberList(blob);

  /* ---------- NPV ---------- */
  if (/\bnpv\b|net\s*present\s*value/i.test(text) && cfs.length >= 1) {
    const r =
      findRate(text, /(?:discount|rate|r|i|k)\s*=?\s*([-\d.]+%?)/i) ??
      findRate(finalS, /(?:@|at)\s*([-\d.]+%)/i);
    if (r != null && finalN != null) {
      const val = npv(r, cfs);
      const ok = relClose(val, finalN, 1e-6, 1e-6) || approxEqual(val, finalN, 1e-4);
      checks.push({ value: `NPV=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "NPV mismatch" });
    }
  }

  /* ---------- IRR / MIRR ---------- */
  if (/\birr\b|internal\s*rate\s*of\s*return/i.test(text) && cfs.length >= 2) {
    const val = irr(cfs);
    if (val != null && finalPct != null) {
      const ok = approxEqual(val, finalPct, 1e-6) || relClose(val, finalPct, 1e-6, 1e-8);
      checks.push({ value: `IRR=${finalPct}`, ok, lhs: val, rhs: finalPct, reason: ok ? null : "IRR mismatch" });
    }
  }
  if (/\bmirr\b/i.test(text) && cfs.length >= 2) {
    const fr = findRate(text, /(?:finance|borrow|cost\s*of\s*capital|hurdle)\s*rate\s*=?\s*([-\d.]+%?)/i) ??
               findRate(text, /\bk_f\s*=\s*([-\d.]+%?)/i);
    const rr = findRate(text, /(?:reinvest(?:ment)?)\s*rate\s*=?\s*([-\d.]+%?)/i) ??
               findRate(text, /\bk_r\s*=\s*([-\d.]+%?)/i);
    if (fr != null && rr != null) {
      const val = mirr(cfs, fr, rr);
      if (val != null && finalPct != null) {
        const ok = approxEqual(val, finalPct, 1e-6) || relClose(val, finalPct, 1e-6, 1e-8);
        checks.push({ value: `MIRR=${finalPct}`, ok, lhs: val, rhs: finalPct, reason: ok ? null : "MIRR mismatch" });
      }
    }
  }

  /* ---------- PMT / PV / FV ---------- */
  const isDue = /\b(annuity\s*due|beginning\s*of\s*period|payments?\s*at\s*beginning)\b/i.test(text);
  const rateAny = findRate(text, /(?:rate|interest|discount|r|i|k|yield)\s*=?\s*([-\d.]+%?)/i);
  const m = compFreq(text) ?? 1;
  const rPer = rateAny != null ? rateAny / m : null;
  const n =
    findInt(text, /\b(?:n|#\s*periods|periods|years|months)\s*=\s*(\d{1,5})/i) ?? null;
  const pv = findNum(text, /\b(?:pv|present\s*value|loan|principal)\s*=\s*([-\d.]+)/i);
  const fv = findNum(text, /\b(?:fv|future\s*value)\s*=\s*([-\d.]+)/i);
  const pmtText = findNum(text, /\b(?:pmt|payment)\s*=\s*([-\d.]+)/i);

  if (/\bpmt\b|payment\b/i.test(text)) {
    if (rPer != null && n != null && pv != null && finalN != null) {
      const val = pmt(rPer, n, pv, fv ?? 0, isDue);
      const ok = relClose(val, finalN, 1e-5, 1e-4) || approxEqual(val, finalN, 1e-3);
      checks.push({ value: `PMT=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "PMT mismatch" });
    }
  }
  if (/\bpv\b|present\s*value\b/i.test(text)) {
    if (rPer != null && n != null && pmtText != null && finalN != null) {
      const val = pv_annuity(-pmtText, rPer, n, isDue);
      const ok = relClose(val, finalN, 1e-5, 1e-4) || approxEqual(val, finalN, 1e-3);
      checks.push({ value: `PV=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "PV annuity mismatch" });
    } else if (rPer != null && n != null && pv != null && fv != null && finalN != null) {
      // If final is PV, and we have FV and PV both, this path won't be used. Kept minimal.
      const val = pv_lump(fv, rPer, n);
      const ok = relClose(val, finalN, 1e-6, 1e-4) || approxEqual(val, finalN, 1e-3);
      checks.push({ value: `PV=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "PV lump mismatch" });
    }
  }
  if (/\bfv\b|future\s*value\b/i.test(text)) {
    if (rPer != null && n != null && pmtText != null && finalN != null) {
      const val = fv_annuity(-pmtText, rPer, n, isDue);
      const ok = relClose(val, finalN, 1e-5, 1e-4) || approxEqual(val, finalN, 1e-3);
      checks.push({ value: `FV=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "FV annuity mismatch" });
    } else if (rPer != null && n != null && pv != null && finalN != null) {
      const val = fv_lump(pv, rPer, n);
      const ok = relClose(val, finalN, 1e-6, 1e-4) || approxEqual(val, finalN, 1e-3);
      checks.push({ value: `FV=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "FV lump mismatch" });
    }
  }

  /* ---------- Perpetuities / Growing flows ---------- */
  if (/\bperpetuity\b/i.test(text)) {
    const c = findNum(text, /\b(c|cf|coupon|payment)\s*=\s*([-\d.]+)/i) ?? pmtText ?? finalN;
    const r = rateAny;
    if (c != null && r != null && finalN != null) {
      const val = pv_perpetuity(c, r);
      const ok = relClose(val, finalN, 1e-5, 1e-4) || approxEqual(val, finalN, 1e-3);
      checks.push({ value: `PV_perp=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "Perpetuity PV mismatch" });
    }
  }
  if (/\bgrowing\s+perpetuity\b/i.test(text)) {
    const c0 = findNum(text, /\b(c|cf|payment)\s*=\s*([-\d.]+)/i) ?? pmtText;
    const r = rateAny;
    const g = findRate(text, /\b(?:growth|g)\s*=\s*([-\d.]+%?)/i);
    if (c0 != null && r != null && g != null && finalN != null) {
      const val = pv_growing_perpetuity(c0, r, g);
      if (Number.isFinite(val)) {
        const ok = relClose(val!, finalN, 1e-5, 1e-4) || approxEqual(val!, finalN, 1e-3);
        checks.push({ value: `PV_gperp=${finalN}`, ok, lhs: val!, rhs: finalN, reason: ok ? null : "Growing perpetuity PV mismatch" });
      }
    }
  }
  if (/\bgrowing\s+annuity\b/i.test(text)) {
    const c0 = findNum(text, /\b(c|cf|payment)\s*=\s*([-\d.]+)/i) ?? pmtText;
    const r = rateAny;
    const g = findRate(text, /\b(?:growth|g)\s*=\s*([-\d.]+%?)/i);
    const nGA = findInt(text, /\bn\s*=\s*(\d{1,5})\b/i) ?? n;
    if (c0 != null && r != null && g != null && nGA != null && finalN != null) {
      const val = pv_growing_annuity(c0, r, g, nGA);
      const ok = relClose(val, finalN, 1e-5, 1e-4) || approxEqual(val, finalN, 1e-3);
      checks.push({ value: `PV_gann=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "Growing annuity PV mismatch" });
    }
  }

  /* ---------- APR ↔ EAR / APY ---------- */
  if (/\b(?:apr|nominal)\b/i.test(text) && /\b(?:ear|apy|effective)\b/i.test(text)) {
    const apr = findRate(text, /\b(?:apr|nominal)\b\s*=?\s*([-\d.]+%?)/i) ?? finalPct;
    const mApr = compFreq(text) ?? 12;
    if (apr != null && finalPct != null) {
      const ear = aprToEar(apr, mApr);
      const ok = relClose(ear, finalPct, 1e-8, 1e-8) || approxEqual(ear, finalPct, 1e-6);
      checks.push({ value: `EAR=${finalPct}`, ok, lhs: ear, rhs: finalPct, reason: ok ? null : "EAR mismatch" });
    }
  }
  if (/\b(?:ear|apy|effective)\b/i.test(text) && /\b(?:apr|nominal)\b/i.test(text)) {
    const ear = findRate(text, /\b(?:ear|apy|effective)\b\s*=?\s*([-\d.]+%?)/i) ?? finalPct;
    const mApr = compFreq(text) ?? 12;
    if (ear != null && finalPct != null) {
      const apr = earToApr(ear, mApr);
      const ok = relClose(apr, finalPct, 1e-8, 1e-8) || approxEqual(apr, finalPct, 1e-6);
      checks.push({ value: `APR=${finalPct}`, ok, lhs: apr, rhs: finalPct, reason: ok ? null : "APR mismatch" });
    }
  }

  /* ---------- Bonds (price / YTM) ---------- */
  if (/\bbond\b|coupon|ytm/i.test(text)) {
    const face = findNum(text, /\b(face|par|fv)\s*=?\s*([-\d.]+)/i);
    const price = findNum(text, /\bprice\s*=?\s*([-\d.]+)/i) ?? finalN;
    const cpnRate = findRate(text, /\b(?:coupon\s*rate|cpn)\b\s*=?\s*([-\d.]+%?)/i);
    const ytm = findRate(text, /\b(?:ytm|yield\s*to\s*maturity)\b\s*=?\s*([-\d.]+%?)/i) ?? finalPct;
    const years = findNum(text, /\b(?:maturity|years?|n)\s*=?\s*(\d{1,4})/i);
    const freqHint = compFreq(text);

    // Price check – if comp freq unspecified, try 2 then 1
    if (face != null && cpnRate != null && ytm != null && years != null && finalN != null) {
      const tryFreqs = freqHint ? [freqHint] : [2, 1];
      for (const f of tryFreqs) {
        const val = bondPrice(face, cpnRate, ytm, years, f);
        const ok = relClose(val, finalN, 1e-5, 1e-3) || approxEqual(val, finalN, 5e-3);
        if (ok) {
          checks.push({ value: `BondPrice=${finalN}`, ok: true, lhs: val, rhs: finalN, reason: null });
          break;
        }
        if (f === tryFreqs[tryFreqs.length - 1]) {
          checks.push({ value: `BondPrice=${finalN}`, ok: false, lhs: val, rhs: finalN, reason: "Bond price mismatch" });
        }
      }
    }

    // YTM check – same freq fallback
    if (price != null && face != null && cpnRate != null && years != null && finalPct != null) {
      const tryFreqs = freqHint ? [freqHint] : [2, 1];
      for (const f of tryFreqs) {
        const val = bondYTM(price, face, cpnRate, years, f);
        if (val != null) {
          const ok = relClose(val, finalPct, 1e-6, 1e-6) || approxEqual(val, finalPct, 1e-6);
          checks.push({ value: `YTM=${finalPct}`, ok, lhs: val, rhs: finalPct, reason: ok ? null : "YTM mismatch" });
          break;
        }
      }
    }
  }

  /* ---------- Payback & Discounted Payback ---------- */
  if (/\bpayback\b/i.test(text) && cfs.length >= 2) {
    const pb = (function payback(cfs: number[]): number | null {
      let cum = cfs[0] ?? 0;
      if (!Number.isFinite(cum)) return null;
      for (let i = 1; i < cfs.length; i++) {
        const prev = cum;
        cum += cfs[i];
        if (prev < 0 && cum >= 0) {
          const frac = -prev / cfs[i];
          return i - 1 + frac;
        }
      }
      return cum >= 0 ? 0 : null;
    })(cfs);
    if (pb != null && finalN != null) {
      const ok = relClose(pb, finalN, 1e-3, 1e-3) || approxEqual(pb, finalN, 1e-3);
      checks.push({ value: `Payback=${finalN}`, ok, lhs: pb, rhs: finalN, reason: ok ? null : "Payback mismatch" });
    }
  }
  if (/\bdiscounted\s*payback\b/i.test(text) && cfs.length >= 2) {
    const r = findRate(text, /(?:discount|rate|r|i|k)\s*=?\s*([-\d.]+%?)/i);
    if (r != null) {
      let cum = cfs[0] ?? 0;
      let dpb: number | null = null;
      for (let i = 1; i < cfs.length; i++) {
        const add = cfs[i] / Math.pow(1 + r, i);
        const prev = cum;
        cum += add;
        if (prev < 0 && cum >= 0) {
          const frac = -prev / add;
          dpb = i - 1 + frac;
          break;
        }
      }
      if (dpb == null && cum >= 0) dpb = 0;
      if (dpb != null && finalN != null) {
        const ok = relClose(dpb, finalN, 1e-3, 1e-3) || approxEqual(dpb, finalN, 1e-3);
        checks.push({ value: `DiscPayback=${finalN}`, ok, lhs: dpb, rhs: finalN, reason: ok ? null : "Discounted payback mismatch" });
      }
    }
  }

  /* ---------- CAPM ---------- */
  if (/\b(capm|expected\s*return|cost\s*of\s*equity)\b/i.test(text)) {
    const rf  = findRate(text, /\b(?:rf|risk[-\s]*free)\b\s*=?\s*([-\d.]+%?)/i);
    const rm  = findRate(text, /\b(?:rm|market\s*return)\b\s*=?\s*([-\d.]+%?)/i);
    const beta = findNum(text, /\b(?:beta|β)\b\s*=\s*([-\d.]+)/i);
    if (rf != null && rm != null && beta != null && finalPct != null) {
      const re = rf + beta * (rm - rf);
      const ok = relClose(re, finalPct, 1e-6, 1e-6) || approxEqual(re, finalPct, 1e-6);
      checks.push({ value: `CAPM=${finalPct}`, ok, lhs: re, rhs: finalPct, reason: ok ? null : "CAPM mismatch" });
    }
  }

  /* ---------- WACC ---------- */
  if (/\bwacc\b|weighted\s*average\s*cost\s*of\s*capital/i.test(text)) {
    const E  = findNum(text, /\bE\s*=\s*([-\d.]+)/i) ?? findNum(text, /\bequity\s*=\s*([-\d.]+)/i);
    const D  = findNum(text, /\bD\s*=\s*([-\d.]+)/i) ?? findNum(text, /\bdebt\s*=\s*([-\d.]+)/i);
    const Re = findRate(text, /\b(?:Re|cost\s*of\s*equity)\b\s*=\s*([-\d.]+%?)/i);
    const Rd = findRate(text, /\b(?:Rd|cost\s*of\s*debt)\b\s*=\s*([-\d.]+%?)/i);
    const T  = findRate(text, /\b(?:tax\s*rate|t)\b\s*=\s*([-\d.]+%?)/i);
    if (E != null && D != null && Re != null && Rd != null && T != null && finalPct != null) {
      const V = E + D;
      const wacc = (E / V) * Re + (D / V) * Rd * (1 - T);
      const ok = relClose(wacc, finalPct, 1e-6, 1e-6) || approxEqual(wacc, finalPct, 1e-6);
      checks.push({ value: `WACC=${finalPct}`, ok, lhs: wacc, rhs: finalPct, reason: ok ? null : "WACC mismatch" });
    }
  }

  /* ---------- Portfolio (2-asset) ---------- */
  if (/\bportfolio\b/i.test(text)) {
    const w1 = findRate(text, /\b(?:w1|weight\s*1)\b\s*=\s*([-\d.]+%?)/i) ?? findRate(text, /\bw\s*=\s*([-\d.]+%?)/i);
    const w2 = findRate(text, /\b(?:w2|weight\s*2)\b\s*=\s*([-\d.]+%?)/i);
    const r1 = findRate(text, /\b(?:r1|return\s*1)\b\s*=\s*([-\d.]+%?)/i);
    const r2 = findRate(text, /\b(?:r2|return\s*2)\b\s*=\s*([-\d.]+%?)/i);
    const s1 = findRate(text, /\b(?:s1|sd1|σ1|sigma1)\b\s*=\s*([-\d.]+%?)/i);
    const s2 = findRate(text, /\b(?:s2|sd2|σ2|sigma2)\b\s*=\s*([-\d.]+%?)/i);
    const rho = findNum(text, /\b(?:rho|corr(?:elation)?)\b\s*=\s*([-\d.]+)/i) ?? 0;

    if (w1 != null && w2 != null && Math.abs(w1 + w2 - 1) < 1e-6) {
      if (r1 != null && r2 != null && finalPct != null && /\bexpected\s*return\b/i.test(text)) {
        const er = w1 * r1 + w2 * r2;
        const ok = relClose(er, finalPct, 1e-6, 1e-6) || approxEqual(er, finalPct, 1e-6);
        checks.push({ value: `E[Rp]=${finalPct}`, ok, lhs: er, rhs: finalPct, reason: ok ? null : "Portfolio return mismatch" });
      }
      if (s1 != null && s2 != null && (/\bvar(iance)?\b/i.test(text) || /\b(sd|stdev|vol(atility)?)\b/i.test(text))) {
        const varP = w1 * w1 * s1 * s1 + w2 * w2 * s2 * s2 + 2 * w1 * w2 * rho * s1 * s2;
        if (/\bvar(iance)?\b/i.test(text) && finalN != null) {
          const ok = relClose(varP, finalN, 1e-6, 1e-6) || approxEqual(varP, finalN, 1e-6);
          checks.push({ value: `Var_p=${finalN}`, ok, lhs: varP, rhs: finalN, reason: ok ? null : "Portfolio variance mismatch" });
        } else if (/\b(sd|stdev|vol(atility)?)\b/i.test(text) && finalPct != null) {
          const sdP = Math.sqrt(varP);
          const ok = relClose(sdP, finalPct, 1e-6, 1e-6) || approxEqual(sdP, finalPct, 1e-6);
          checks.push({ value: `SD_p=${finalPct}`, ok, lhs: sdP, rhs: finalPct, reason: ok ? null : "Portfolio SD mismatch" });
        }
      }
    }
  }

  /* ---------- CAGR ---------- */
  if (/\bcagr\b|compound\s+annual\s+growth\s+rate/i.test(text)) {
    const years = findNum(text, /\byears?\s*=\s*([-\d.]+)/i) ?? findNum(text, /\bn\s*=\s*([-\d.]+)/i);
    const start = findNum(text, /\b(start|begin|pv)\s*=\s*([-\d.]+)/i);
    const end = findNum(text, /\b(end|finish|fv|final)\s*=\s*([-\d.]+)/i);
    if (years != null && start != null && end != null && finalPct != null) {
      const val = cagr(start, end, years);
      if (val != null) {
        const ok = approxEqual(val, finalPct, 1e-6) || relClose(val, finalPct, 1e-6, 1e-8);
        checks.push({ value: `CAGR=${finalPct}`, ok, lhs: val, rhs: finalPct, reason: ok ? null : "CAGR mismatch" });
      }
    }
  }

  /* ---------- EAA ---------- */
  if (/\beaa\b|equivalent\s+annual\s+annuity/i.test(text)) {
    const r = rateAny;
    const nE = n;
    if (r != null && nE != null && /\bnpv\b/i.test(text)) {
      const valNPV = npv(r, cfs);
      if (finalN != null) {
        const eaaVal = (valNPV * r) / (1 - Math.pow(1 + r, -nE));
        const ok = relClose(eaaVal, finalN, 1e-5, 1e-4) || approxEqual(eaaVal, finalN, 1e-3);
        checks.push({ value: `EAA=${finalN}`, ok, lhs: eaaVal, rhs: finalN, reason: ok ? null : "EAA mismatch" });
      }
    }
  }

  if (!checks.length) return null;
  const allVerified = checks.every((c) => c.ok);
  return { subject: "finance", method: "finance-tvm", allVerified, checks };
}


