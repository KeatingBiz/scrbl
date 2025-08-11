import type { BoardUnderstanding, Verification } from "@/lib/types";
import { gatherProblemText, extractNumberList, parsePercentOrNumber, parseNumber, approxEqual } from "./utils";

// NPV: rate r, cash flows CF0, CF1, ...
function npv(r: number, cfs: number[]): number {
  return cfs.reduce((acc, cf, i) => acc + cf / Math.pow(1 + r, i), 0);
}

// IRR: find r s.t. NPV(r)=0
function irr(cfs: number[], guess = 0.1): number | null {
  // Try Newton-Raphson; fallback to bisection
  let r = guess;
  for (let k = 0; k < 20; k++) {
    let f = 0, df = 0;
    for (let i = 0; i < cfs.length; i++) {
      const denom = Math.pow(1 + r, i);
      f += cfs[i] / denom;
      if (i > 0) df += -i * cfs[i] / (denom * (1 + r));
    }
    if (!Number.isFinite(f) || !Number.isFinite(df) || Math.abs(df) < 1e-12) break;
    const rNext = r - f / df;
    if (!Number.isFinite(rNext)) break;
    if (Math.abs(rNext - r) < 1e-10) return rNext;
    r = rNext;
  }
  // Bisection on [-0.999, 10] (very wide)
  let lo = -0.999, hi = 10;
  let flo = npv(lo, cfs), fhi = npv(hi, cfs);
  if (Number.isNaN(flo) || Number.isNaN(fhi)) return null;
  if (flo * fhi > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid, cfs);
    if (!Number.isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-10) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

// PMT (payment) for loan: r per period, n periods, PV present value
function pmt(r: number, n: number, pv: number): number {
  if (Math.abs(r) < 1e-12) return -(pv / n);
  const k = Math.pow(1 + r, n);
  return -(r * pv * k) / (k - 1);
}

// CAGR
function cagr(pv: number, fv: number, years: number): number | null {
  if (pv <= 0 || fv <= 0 || years <= 0) return null;
  return Math.pow(fv / pv, 1 / years) - 1;
}

export function verifyFinance(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps).toLowerCase();

  const checks: Verification["checks"] = [];
  const finalN = parseNumber(result.final || "");
  const finalPct = parsePercentOrNumber(result.final || "");

  // Cash flows list
  const cfs = extractNumberList(blob);

  // NPV
  if (/\bnpv\b|net present value/i.test(blob) && cfs.length >= 1) {
    const r = parsePercentOrNumber(blob.match(/(?:rate|discount|r|i)\s*=?\s*([-\d.]+%?)/i)?.[1] || "") ?? null;
    if (r != null && finalN != null) {
      const val = npv(r, cfs);
      const ok = approxEqual(val, finalN, 1e-4);
      checks.push({ value: `npv=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "NPV mismatch" });
    }
  }

  // IRR
  if (/\birr\b|internal rate of return/i.test(blob) && cfs.length >= 2) {
    const val = irr(cfs);
    if (val != null && finalPct != null) {
      const ok = approxEqual(val, finalPct, 1e-6);
      checks.push({ value: `irr=${finalPct}`, ok, lhs: val, rhs: finalPct, reason: ok ? null : "IRR mismatch" });
    }
  }

  // PMT
  if (/\bpmt\b|payment\b/i.test(blob)) {
    const r = parsePercentOrNumber(blob.match(/(?:rate|interest|r|i)\s*=?\s*([-\d.]+%?)/i)?.[1] || "") ?? null;
    const n = parseNumber(blob.match(/(?:n|periods|months|years)\s*=?\s*([-\d.]+)/i)?.[1] || "") ?? null;
    const pv = parseNumber(blob.match(/(?:pv|present value|loan|principal)\s*=?\s*([-\d.]+)/i)?.[1] || "") ?? null;
    if (r != null && n != null && pv != null && finalN != null) {
      const val = pmt(r, n, pv);
      const ok = approxEqual(val, finalN, 1e-3);
      checks.push({ value: `pmt=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "PMT mismatch" });
    }
  }

  // CAGR
  if (/\bcagr\b|compound annual growth rate/i.test(blob)) {
    const years = parseNumber(blob.match(/(?:years?|n)\s*=?\s*([-\d.]+)/i)?.[1] || "") ?? null;
    // Try (start,end)
    const start = parseNumber(blob.match(/(?:start|begin|pv)\s*=?\s*([-\d.]+)/i)?.[1] || "") ?? null;
    const end = parseNumber(blob.match(/(?:end|finish|fv|final)\s*=?\s*([-\d.]+)/i)?.[1] || "") ?? null;
    if (years != null && start != null && end != null && finalPct != null) {
      const val = cagr(start, end, years);
      if (val != null) {
        const ok = approxEqual(val, finalPct, 1e-6);
        checks.push({ value: `cagr=${finalPct}`, ok, lhs: val, rhs: finalPct, reason: ok ? null : "CAGR mismatch" });
      }
    }
  }

  if (!checks.length) return null;
  const allVerified = checks.every(c => c.ok);
  return { subject: "finance", method: "finance-tvm", allVerified, checks };
}

