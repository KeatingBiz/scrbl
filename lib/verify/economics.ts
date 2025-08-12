// lib/verify/economics.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import {
  gatherProblemText,
  parseNumber,
  parsePercentOrNumber,
  approxEqual,
  relClose,
} from "./utils";

const NUM = "(-?\\d*\\.?\\d+(?:e[+-]?\\d+)?)";

type LinForm =
  | { kind: "QofP"; a: number; b: number } // Q = a + b P
  | { kind: "PofQ"; A: number; B: number }; // P = A + B Q

type Curves = {
  demand?: LinForm;
  supply?: LinForm;
};

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
function findPct(text: string, ...labels: RegExp[]): number | null {
  for (const lab of labels) {
    const m = text.match(lab);
    if (m && m[1]) {
      const n = parsePercentOrNumber(m[1]);
      if (n != null) return n;
    }
  }
  return null;
}

/* ---------------- Linear curve parsing ----------------
   Supports:
   - Qd = a - b P        (or +)
   - Qs = c + d P
   - P  = A - B Q  (with "demand" or "supply" near the line)
------------------------------------------------------- */
function parseCurves(blob: string): Curves {
  const text = blob.replace(/\s+/g, " ");

  const curves: Curves = {};

  // Q-of-P forms
  const qd = text.match(new RegExp(`\\bQd?\\s*=\\s*${NUM}\\s*([+-])\\s*${NUM}\\s*[* ]?P\\b`, "i"));
  if (qd) {
    const a = parseFloat(qd[1]);
    const s = qd[2] === "-" ? -1 : 1;
    const b = s * parseFloat(qd[3]);
    curves.demand = { kind: "QofP", a, b };
  }
  const qs = text.match(new RegExp(`\\bQs?\\s*=\\s*${NUM}\\s*([+-])\\s*${NUM}\\s*[* ]?P\\b`, "i"));
  if (qs) {
    const a = parseFloat(qs[1]);
    const s = qs[2] === "-" ? -1 : 1;
    const b = s * parseFloat(qs[3]);
    curves.supply = { kind: "QofP", a, b };
  }

  // P-of-Q forms; try to bind to demand/supply by label proximity, else infer by slope sign
  const pLineRE = new RegExp(`\\bP\\s*=\\s*${NUM}\\s*([+-])\\s*${NUM}\\s*[* ]?Q\\b`, "ig");
  let m: RegExpExecArray | null;
  const pForms: Array<{ A: number; B: number; idx: number }> = [];
  while ((m = pLineRE.exec(text)) !== null) {
    const A = parseFloat(m[1]);
    const s = m[2] === "-" ? -1 : 1;
    const B = s * parseFloat(m[3]);
    pForms.push({ A, B, idx: m.index });
  }
  for (const pf of pForms) {
    const windowText = text.slice(Math.max(0, pf.idx - 40), pf.idx + 80);
    const labelDemand = /demand|Qd/i.test(windowText);
    const labelSupply = /supply|Qs/i.test(windowText);
    if (labelDemand && !curves.demand) curves.demand = { kind: "PofQ", A: pf.A, B: pf.B };
    else if (labelSupply && !curves.supply) curves.supply = { kind: "PofQ", A: pf.A, B: pf.B };
  }
  // If still missing, infer: demand typically has negative slope in P(Q) ⇒ B < 0; supply B > 0
  for (const pf of pForms) {
    if (!curves.demand && pf.B < 0) curves.demand = { kind: "PofQ", A: pf.A, B: pf.B };
    if (!curves.supply && pf.B > 0) curves.supply = { kind: "PofQ", A: pf.A, B: pf.B };
  }

  return curves;
}

/* -------------- Curve conversions -------------- */
function toPofQ(f: LinForm): { A: number; B: number } {
  return f.kind === "PofQ" ? { A: f.A, B: f.B } : { A: -f.a / f.b, B: 1 / f.b };
}
function toQofP(f: LinForm): { a: number; b: number } {
  return f.kind === "QofP" ? { a: f.a, b: f.b } : { a: -f.A / f.B, b: 1 / f.B };
}

/* -------------- Equilibrium solve -------------- */
function equilibrium(curves: Curves): { P: number; Q: number } | null {
  const d = curves.demand, s = curves.supply;
  if (!d || !s) return null;

  // Solve in the most numerically stable common form
  if (d.kind === "QofP" && s.kind === "QofP") {
    const { a: ad, b: bd } = d;
    const { a: as, b: bs } = s;
    const denom = bs - bd;
    if (Math.abs(denom) < 1e-12) return null;
    const P = (ad - as) / denom;
    const Q = ad + bd * P;
    return { P, Q };
  } else {
    const D = toPofQ(d);
    const S = toPofQ(s);
    const denom = S.B - D.B;
    if (Math.abs(denom) < 1e-12) return null;
    const Q = (D.A - S.A) / denom;
    const P = D.A + D.B * Q;
    return { P, Q };
  }
}

/* -------------- Intercepts for CS/PS -------------- */
function demandChokePrice(d: LinForm): number {
  // P when Q=0
  const inv = toPofQ(d);
  return inv.A; // P = A + B*0
}
function supplyIntercept(s: LinForm): number {
  const inv = toPofQ(s);
  return inv.A; // P at Q=0
}

/* -------------- Elasticity -------------- */
function arcElasticity(p1: number, q1: number, p2: number, q2: number): number | null {
  if (q1 + q2 === 0 || p1 + p2 === 0) return null;
  const dq = q2 - q1;
  const dp = p2 - p1;
  const qavg = (q1 + q2) / 2;
  const pavg = (p1 + p2) / 2;
  if (qavg === 0 || pavg === 0) return null;
  return (dq / qavg) / (dp / pavg);
}
function pointElasticityAt(d: LinForm, P: number, Q: number): number | null {
  // E = (dQ/dP) * (P/Q)
  const qf = toQofP(d);
  if (Q === 0) return null;
  return qf.b * (P / Q); // note: demand slope is negative → negative elasticity
}

/* -------------- Main verifier -------------- */
export function verifyEconomics(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.toLowerCase();
  const finalS = String(result.final ?? "");
  const finalN = parseNumber(finalS);
  const finalPct = parsePercentOrNumber(finalS);

  const looksEcon = /\b(demand|supply|equilibrium|elasticity|consumer\s*surplus|producer\s*surplus|tax|deadweight|shortage|surplus|ceiling|floor|gdp|deflator|cpi|inflation|real|nominal|unemployment|labor\s*force|money\s*multiplier|reserve\s*ratio|fisher)\b/.test(
    text
  );
  if (!looksEcon) return null;

  const checks: Verification["checks"] = [];

  /* ========== MICRO ========== */
  const curves = parseCurves(blob);

  // Equilibrium (P*, Q*)
  const eq = equilibrium(curves);
  if (eq && (/\beq|equilibrium\b/.test(text) || /\b(p\*|q\*)\b/i.test(blob))) {
    if (/p\*|\bprice\b|\bp\_?eq\b/i.test(text) && finalN != null) {
      const ok = relClose(eq.P, finalN, 1e-6, 1e-6) || approxEqual(eq.P, finalN, 1e-6);
      checks.push({ value: `P*=${finalN}`, ok, lhs: eq.P, rhs: finalN, reason: ok ? null : "Equilibrium price mismatch" } as any);
    } else if (/q\*|\bquantity\b|\bq\_?eq\b/i.test(text) && finalN != null) {
      const ok = relClose(eq.Q, finalN, 1e-6, 1e-6) || approxEqual(eq.Q, finalN, 1e-6);
      checks.push({ value: `Q*=${finalN}`, ok, lhs: eq.Q, rhs: finalN, reason: ok ? null : "Equilibrium quantity mismatch" } as any);
    }
  }

  // Consumer/Producer Surplus at equilibrium
  if (eq && (/\bconsumer\s*surplus\b/i.test(text) || /\bproducer\s*surplus\b/i.test(text))) {
    if (curves.demand && /\bconsumer\s*surplus\b/i.test(text) && finalN != null) {
      const Pd0 = demandChokePrice(curves.demand);
      const CS = 0.5 * (Pd0 - eq.P) * eq.Q;
      const ok = relClose(CS, finalN, 1e-5, 1e-6) || approxEqual(CS, finalN, 1e-3);
      checks.push({ value: `CS=${finalN}`, ok, lhs: CS, rhs: finalN, reason: ok ? null : "Consumer surplus mismatch" } as any);
    }
    if (curves.supply && /\bproducer\s*surplus\b/i.test(text) && finalN != null) {
      const Ps0 = supplyIntercept(curves.supply);
      const PS = 0.5 * (eq.P - Ps0) * eq.Q;
      const ok = relClose(PS, finalN, 1e-5, 1e-6) || approxEqual(PS, finalN, 1e-3);
      checks.push({ value: `PS=${finalN}`, ok, lhs: PS, rhs: finalN, reason: ok ? null : "Producer surplus mismatch" } as any);
    }
  }

  // Elasticity
  if (/\belasticity\b/i.test(text)) {
    // Arc elasticity if two points given
    const pairs = Array.from(blob.matchAll(new RegExp(`\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*\\)`, "g")));
    if (pairs.length >= 2 && finalPct != null) {
      const [m1, m2] = pairs;
      const x1 = parseFloat(m1[1]), y1 = parseFloat(m1[2]);
      const x2 = parseFloat(m2[1]), y2 = parseFloat(m2[2]);
      // Try interpreting as (Q,P) first; if NaN, flip as (P,Q)
      const tryQP = arcElasticity(y1, x1, y2, x2); // (P1,Q1,P2,Q2) with pairs as (Q,P)
      const tryPQ = arcElasticity(x1, y1, x2, y2);
      const e = tryQP ?? tryPQ;
      if (e != null) {
        const ok = approxEqual(Math.abs(e), Math.abs(finalPct), 1e-4) || relClose(Math.abs(e), Math.abs(finalPct), 1e-4, 1e-6);
        checks.push({ value: `|E_arc|=${finalPct}`, ok, lhs: e, rhs: finalPct, reason: ok ? null : "Arc elasticity mismatch" } as any);
      }
    } else if (eq && curves.demand && finalPct != null) {
      const e = pointElasticityAt(curves.demand, eq.P, eq.Q);
      if (e != null) {
        const ok = approxEqual(Math.abs(e), Math.abs(finalPct), 1e-4) || relClose(Math.abs(e), Math.abs(finalPct), 1e-4, 1e-6);
        checks.push({ value: `|E_point|=${finalPct}`, ok, lhs: e, rhs: finalPct, reason: ok ? null : "Point elasticity mismatch" } as any);
      }
    }
  }

  // Tax: per-unit tax t, new EQ, revenue, DWL
  if (/\btax\b/i.test(text) && (/\brevenue\b/i.test(text) || /\bdwl|deadweight\b/i.test(text) || /\bnew\s*equilibrium\b/i.test(text))) {
    const t = findNum(text, new RegExp(`\\btax\\s*=\\s*${NUM}`, "i")) ?? findNum(text, new RegExp(`\\bt\\s*=\\s*${NUM}`, "i"));
    if (t != null && curves.demand && curves.supply) {
      const D = toPofQ(curves.demand);
      const S0 = toPofQ(curves.supply);
      const S1 = { A: S0.A + t, B: S0.B }; // shift up by t
      // Pre- and post-tax EQ
      const denom0 = S0.B - D.B;
      const denom1 = S1.B - D.B;
      if (Math.abs(denom0) > 1e-12 && Math.abs(denom1) > 1e-12) {
        const Q0 = (D.A - S0.A) / denom0;
        const P0 = D.A + D.B * Q0;
        const Q1 = (D.A - S1.A) / denom1;
        const Pb = D.A + D.B * Q1; // buyer price
        const revenue = t * Q1;
        const dwl = 0.5 * t * (Q0 - Q1);
        if (/\brevenue\b/i.test(text) && finalN != null) {
          const ok = relClose(revenue, finalN, 1e-5, 1e-6) || approxEqual(revenue, finalN, 1e-3);
          checks.push({ value: `TaxRevenue=${finalN}`, ok, lhs: revenue, rhs: finalN, reason: ok ? null : "Tax revenue mismatch" } as any);
        }
        if (/\bdwl|deadweight\b/i.test(text) && finalN != null) {
          const ok = relClose(dwl, finalN, 1e-5, 1e-6) || approxEqual(dwl, finalN, 1e-3);
          checks.push({ value: `DWL=${finalN}`, ok, lhs: dwl, rhs: finalN, reason: ok ? null : "DWL mismatch" } as any);
        }
        if (/\bnew\s*equilibrium\b/i.test(text) && finalN != null) {
          // if they ask for Q or P we try both; most often Q is the asked value
          const okQ = relClose(Q1, finalN, 1e-6, 1e-6) || approxEqual(Q1, finalN, 1e-6);
          const okP = relClose(Pb, finalN, 1e-6, 1e-6) || approxEqual(Pb, finalN, 1e-6);
          if (okQ) checks.push({ value: `Q1=${finalN}`, ok: okQ, lhs: Q1, rhs: finalN } as any);
          else if (okP) checks.push({ value: `P1=${finalN}`, ok: okP, lhs: Pb, rhs: finalN } as any);
        }
      }
    }
  }

  // Price ceiling/floor → shortage/surplus (requires curves)
  if ((/\bceiling\b/i.test(text) || /\bfloor\b/i.test(text)) && curves.demand && curves.supply && finalN != null) {
    const pc = findNum(text, new RegExp(`\\bp(?:rice)?\\s*(?:ceiling|cap)\\s*=\\s*${NUM}`, "i")) ??
               findNum(text, new RegExp(`\\bfloor\\s*=\\s*${NUM}`, "i"));
    if (pc != null) {
      const Qd = toQofP(curves.demand).a + toQofP(curves.demand).b * pc;
      const Qs = toQofP(curves.supply).a + toQofP(curves.supply).b * pc;
      const gap = /\bshortage\b/i.test(text) ? (Qd - Qs) : /\bsurplus\b/i.test(text) ? (Qs - Qd) : (Qd - Qs);
      const ok = relClose(gap, finalN, 1e-6, 1e-6) || approxEqual(gap, finalN, 1e-6);
      checks.push({ value: `${/\bshortage\b/i.test(text) ? "shortage" : "surplus"}=${finalN}`, ok, lhs: gap, rhs: finalN, reason: ok ? null : "Gap mismatch" } as any);
    }
  }

  /* ========== MACRO ========== */
  // GDP: Y = C + I + G + NX (NX = X - M)
  if (/\bgdp\b|y\s*=/.test(text)) {
    const C = findNum(text, new RegExp(`\\bC\\s*=\\s*${NUM}`, "i"));
    const I = findNum(text, new RegExp(`\\bI\\s*=\\s*${NUM}`, "i"));
    const G = findNum(text, new RegExp(`\\bG\\s*=\\s*${NUM}`, "i"));
    const NX = findNum(text, new RegExp(`\\bNX\\s*=\\s*${NUM}`, "i"));
    const X = findNum(text, new RegExp(`\\bX\\s*=\\s*${NUM}`, "i"));
    const M = findNum(text, new RegExp(`\\bM\\s*=\\s*${NUM}`, "i"));
    const Y = findNum(text, new RegExp(`\\bY\\s*=\\s*${NUM}`, "i"));
    const nxUse = NX != null ? NX : (X != null && M != null ? X - M : null);
    if (C != null && I != null && G != null && nxUse != null) {
      const gdp = C + I + G + nxUse;
      if (finalN != null) {
        const ok = relClose(gdp, finalN, 1e-6, 1e-6) || approxEqual(gdp, finalN, 1e-6);
        checks.push({ value: `GDP=${finalN}`, ok, lhs: gdp, rhs: finalN, reason: ok ? null : "GDP mismatch" } as any);
      } else if (Y != null) {
        const ok = relClose(gdp, Y, 1e-6, 1e-6) || approxEqual(gdp, Y, 1e-6);
        checks.push({ value: `GDP check`, ok, lhs: gdp, rhs: Y, reason: ok ? null : "Y != C+I+G+NX" } as any);
      }
    }
  }

  // Deflator & Real vs Nominal GDP: deflator = (Nominal / Real) * 100
  if (/\bdeflator\b|real\b|nominal\b/i.test(text)) {
    const Nom = findNum(text, new RegExp(`\\bnominal\\s*gdp\\s*=\\s*${NUM}`, "i"));
    const Real = findNum(text, new RegExp(`\\breal\\s*gdp\\s*=\\s*${NUM}`, "i"));
    const Def = findNum(text, new RegExp(`\\bdeflator\\s*=\\s*${NUM}`, "i"));
    if (Nom != null && Real != null && finalN != null && /\bdeflator\b/i.test(text)) {
      const d = (Nom / Real) * 100;
      const ok = relClose(d, finalN, 1e-6, 1e-6) || approxEqual(d, finalN, 1e-6);
      checks.push({ value: `Deflator=${finalN}`, ok, lhs: d, rhs: finalN, reason: ok ? null : "Deflator mismatch" } as any);
    } else if (Nom != null && Def != null && finalN != null && /\breal\b/i.test(text)) {
      const real = (Nom / Def) * 100;
      const ok = relClose(real, finalN, 1e-6, 1e-6) || approxEqual(real, finalN, 1e-6);
      checks.push({ value: `RealGDP=${finalN}`, ok, lhs: real, rhs: finalN, reason: ok ? null : "Real GDP mismatch" } as any);
    } else if (Real != null && Def != null && finalN != null && /\bnominal\b/i.test(text)) {
      const nom = (Real * Def) / 100;
      const ok = relClose(nom, finalN, 1e-6, 1e-6) || approxEqual(nom, finalN, 1e-6);
      checks.push({ value: `NominalGDP=${finalN}`, ok, lhs: nom, rhs: finalN, reason: ok ? null : "Nominal GDP mismatch" } as any);
    }
  }

  // CPI inflation & growth rates
  if (/\bcpi\b|\binflation\b|\bgrowth\b/i.test(text)) {
    const CPI0 = findNum(text, new RegExp(`\\bCPI\\s*(?:0|t-1)?\\s*=\\s*${NUM}`, "i"));
    const CPI1 = findNum(text, new RegExp(`\\bCPI\\s*(?:1|t)?\\s*=\\s*${NUM}`, "i"));
    if (CPI0 != null && CPI1 != null && finalPct != null && (/\binflation\b/i.test(text) || /\bCPI\b/i.test(text))) {
      const inf = (CPI1 - CPI0) / CPI0;
      const ok = relClose(inf, finalPct, 1e-6, 1e-6) || approxEqual(inf, finalPct, 1e-6);
      checks.push({ value: `Inflation=${finalPct}`, ok, lhs: inf, rhs: finalPct, reason: ok ? null : "Inflation mismatch" } as any);
    }
    const Y0 = findNum(text, new RegExp(`\\b(?:Y|GDP)\\s*(?:0|t-1)?\\s*=\\s*${NUM}`, "i"));
    const Y1 = findNum(text, new RegExp(`\\b(?:Y|GDP)\\s*(?:1|t)?\\s*=\\s*${NUM}`, "i"));
    if (Y0 != null && Y1 != null && finalPct != null && /\bgrowth\b/i.test(text)) {
      const g = (Y1 - Y0) / Y0;
      const ok = relClose(g, finalPct, 1e-6, 1e-6) || approxEqual(g, finalPct, 1e-6);
      checks.push({ value: `Growth=${finalPct}`, ok, lhs: g, rhs: finalPct, reason: ok ? null : "Growth rate mismatch" } as any);
    }
  }

  // Fisher: i ≈ r + π
  if (/\bfisher\b|real\s*rate|nominal\s*rate/i.test(text)) {
    const iRate = findPct(text, new RegExp(`\\bi\\s*=\\s*${NUM}%?`, "i")) ?? findPct(text, new RegExp(`\\bnominal\\s*rate\\s*=\\s*${NUM}%?`, "i"));
    const rRate = findPct(text, new RegExp(`\\br\\s*=\\s*${NUM}%?`, "i")) ?? findPct(text, new RegExp(`\\breal\\s*rate\\s*=\\s*${NUM}%?`, "i"));
    const pi = findPct(text, new RegExp(`\\bpi|π|inflation\\s*=?\\s*${NUM}%?`, "i"));
    if (iRate != null && rRate != null && finalPct != null && /\binflation\b/i.test(text)) {
      const calc = iRate - rRate;
      const ok = relClose(calc, finalPct, 1e-6, 1e-6) || approxEqual(calc, finalPct, 1e-6);
      checks.push({ value: `π=${finalPct}`, ok, lhs: calc, rhs: finalPct, reason: ok ? null : "Fisher (π) mismatch" } as any);
    } else if (iRate != null && pi != null && finalPct != null && /\breal\b/i.test(text)) {
      const rcalc = iRate - pi;
      const ok = relClose(rcalc, finalPct, 1e-6, 1e-6) || approxEqual(rcalc, finalPct, 1e-6);
      checks.push({ value: `r=${finalPct}`, ok, lhs: rcalc, rhs: finalPct, reason: ok ? null : "Fisher (r) mismatch" } as any);
    } else if (rRate != null && pi != null && finalPct != null && /\bnominal\b/i.test(text)) {
      const icalc = rRate + pi;
      const ok = relClose(icalc, finalPct, 1e-6, 1e-6) || approxEqual(icalc, finalPct, 1e-6);
      checks.push({ value: `i=${finalPct}`, ok, lhs: icalc, rhs: finalPct, reason: ok ? null : "Fisher (i) mismatch" } as any);
    }
  }

  // Money multiplier m = 1/rr ; ∆D = initial * m (if asked)
  if (/\bmoney\s*multiplier\b|reserve\s*ratio\b/i.test(text)) {
    const rr = findPct(text, new RegExp(`\\brr|reserve\\s*ratio\\s*=\\s*${NUM}%?`, "i"));
    if (rr != null) {
      const m = rr === 0 ? NaN : 1 / rr;
      if (finalN != null) {
        const ok = relClose(m, finalN, 1e-6, 1e-6) || approxEqual(m, finalN, 1e-6);
        checks.push({ value: `m=${finalN}`, ok, lhs: m, rhs: finalN, reason: ok ? null : "Multiplier mismatch" } as any);
      }
      const initDep = findNum(text, new RegExp(`\\b(initial|excess)\\s*deposits?\\s*=\\s*${NUM}`, "i"));
      if (initDep != null && /\b(total|change)\s*deposits?\b/i.test(text) && finalN != null) {
        const delta = initDep * m;
        const ok = relClose(delta, finalN, 1e-6, 1e-6) || approxEqual(delta, finalN, 1e-6);
        checks.push({ value: `ΔDeposits=${finalN}`, ok, lhs: delta, rhs: finalN, reason: ok ? null : "Deposit change mismatch" } as any);
      }
    }
  }

  // Labor: unemployment rate and LFPR
  if (/\bunemployment\b|labor\s*force|lfpr/i.test(text)) {
    const U = findNum(text, new RegExp(`\\bunemployed\\s*=\\s*${NUM}`, "i"));
    const E = findNum(text, new RegExp(`\\bemployed\\s*=\\s*${NUM}`, "i"));
    const LF = findNum(text, new RegExp(`\\blabor\\s*force\\s*=\\s*${NUM}`, "i")) ?? (U != null && E != null ? U + E : null);
    const Pop = findNum(text, new RegExp(`\\b(?:adult|working[-\\s]*age)\\s*population\\s*=\\s*${NUM}`, "i"));
    if (U != null && LF != null && finalPct != null && /\bunemployment\b/i.test(text)) {
      const ur = LF === 0 ? NaN : (U / LF);
      const ok = relClose(ur, finalPct, 1e-6, 1e-6) || approxEqual(ur, finalPct, 1e-6);
      checks.push({ value: `UnempRate=${finalPct}`, ok, lhs: ur, rhs: finalPct, reason: ok ? null : "Unemployment rate mismatch" } as any);
    }
    if (LF != null && Pop != null && finalPct != null && /\blfpr\b|labor\s*force\s*participation/i.test(text)) {
      const lfpr = Pop === 0 ? NaN : (LF / Pop);
      const ok = relClose(lfpr, finalPct, 1e-6, 1e-6) || approxEqual(lfpr, finalPct, 1e-6);
      checks.push({ value: `LFPR=${finalPct}`, ok, lhs: lfpr, rhs: finalPct, reason: ok ? null : "LFPR mismatch" } as any);
    }
  }

  /* ---------- Verdict ---------- */
  if (!checks.length) return null;
  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "economics", method: "economics-basic", allVerified, checks } as unknown as Verification;
}
