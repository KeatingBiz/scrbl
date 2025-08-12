// lib/verify/circuits_ac.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import { gatherProblemText, parseNumber, approxEqual, relClose } from "./utils";

/* ========================== Complex math helpers ========================== */
type C = { re: number; im: number };
const c = (re = 0, im = 0): C => ({ re, im });
const cAdd = (a: C, b: C): C => c(a.re + b.re, a.im + b.im);
const cSub = (a: C, b: C): C => c(a.re - b.re, a.im - b.im);
const cMul = (a: C, b: C): C => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cInv = (z: C): C => {
  const d = z.re * z.re + z.im * z.im;
  return d === 0 ? c(NaN, NaN) : c(z.re / d, -z.im / d);
};
const cDiv = (a: C, b: C): C => cMul(a, cInv(b));
const cAbs = (z: C): number => Math.hypot(z.re, z.im);
const cArg = (z: C): number => Math.atan2(z.im, z.re);

/* ========================== Parsing helpers ========================== */
type Val = { value: number; unit?: string };

const NUM = "(-?\\d*\\.?\\d+(?:e[+-]?\\d+)?)";

function findValWithUnit(text: string, label: RegExp, unitHints: RegExp[]): Val | null {
  const m = text.match(label);
  if (!m || !m[1]) return null;
  const v = parseNumber(m[1]);
  if (v == null) return null;
  const start = m.index ?? 0;
  const window = text.slice(start, Math.min(text.length, start + 48));
  for (const u of unitHints) {
    const um = window.match(u);
    if (um) return { value: v, unit: um[0] };
  }
  return { value: v };
}
function findNumber(text: string, ...labels: RegExp[]): number | null {
  for (const lab of labels) {
    const m = text.match(lab);
    if (m && m[1] != null) {
      const n = parseNumber(m[1]);
      if (n != null) return n;
    }
  }
  return null;
}

/* ========================== Unit converters ========================== */
function toOhms(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u) return x.value;
  if (/^Ω\b|ohm/.test(u)) return x.value;
  if (/kΩ|kohm|k-?ohm/.test(u)) return x.value * 1e3;
  if (/mΩ\b(?!\w)|milli-?ohm/.test(u)) return x.value * 1e-3;
  if (/m\s*ohm/.test(u)) return x.value * 1e-3;
  if (/mΩ/.test(u)) return x.value * 1e-3;
  if (/MΩ|Mohm|mega-?ohm/.test(u)) return x.value * 1e6;
  return x.value;
}
function toHenry(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /\bh\b/.test(u)) return x.value;
  if (/\bmh\b/.test(u)) return x.value * 1e-3;
  if (/[μu]h\b/.test(u)) return x.value * 1e-6;
  return x.value;
}
function toFarad(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /\bf\b/.test(u)) return x.value;
  if (/\bµf\b|μf|uF/i.test(u)) return x.value * 1e-6;
  if (/\bnf\b/.test(u)) return x.value * 1e-9;
  if (/\bpf\b/.test(u)) return x.value * 1e-12;
  return x.value;
}
function toHz(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  // Accept rad/s too (convert)
  if (!u || /\bhz\b/.test(u)) return x.value;
  if (/\bkhz\b/.test(u)) return x.value * 1e3;
  if (/\bmhz\b/.test(u)) return x.value * 1e6;
  if (/rad\/s/.test(u)) return x.value / (2 * Math.PI);
  return x.value;
}
function toOmega(x: Val | null): number | null { return toOhms(x); }
function toVolt(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /\bv\b/.test(u)) return x.value;
  if (/\bmv\b/.test(u)) return x.value * 1e-3;
  return x.value;
}
function toAmp(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /\ba\b/.test(u)) return x.value;
  if (/\bma\b/.test(u)) return x.value * 1e-3;
  if (/[μu]a\b/.test(u)) return x.value * 1e-6;
  return x.value;
}

/* ========================== Build impedances ========================== */
function Z_R(R: number): C { return c(R, 0); }
function Z_L(omega: number, L: number): C { return c(0, omega * L); }
function Z_C(omega: number, C_: number): C {
  if (omega <= 0 || C_ <= 0) return c(NaN, NaN);
  // 1/(jωC) = -j/(ωC)
  return c(0, -1 / (omega * C_));
}
function Z_series(parts: (C | null)[]): C | null {
  let z = c(0, 0);
  let any = false;
  for (const p of parts) {
    if (!p) continue;
    z = cAdd(z, p);
    any = true;
  }
  return any ? z : null;
}
function Z_parallel(a: C | null, b: C | null): C | null {
  if (!a || !b) return null;
  const inv = cAdd(cInv(a), cInv(b));
  return cInv(inv);
}

/* ========================== Main verifier ========================== */
export function verifyAC(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.replace(/[–—−]/g, "-");
  const lower = text.toLowerCase();
  const finalS = String(result.final ?? "");
  const finalN = parseNumber(finalS);

  const looksAC =
    /\b(phasor|ac|impedance|reactance|power\s*factor|apparent|reactive|real\s*power|cutoff|corner|-3db|resonance|resonant|rc|rl|rlc)\b/.test(lower)
    || /j\w|ω|omega\b/i.test(text);
  if (!looksAC) return null;

  const checks: Verification["checks"] = [];

  /* ---------- Inputs ---------- */
  const f = toHz(findValWithUnit(text, new RegExp(`\\bf\\s*=\\s*${NUM}`, "i"), [/hz\b/i, /khz\b/i, /mhz\b/i, /rad\/s\b/i]));
  const omega_explicit = findNumber(lower, new RegExp(`\\b(?:ω|omega)\\s*=\\s*${NUM}`, "i"));
  const omega = omega_explicit != null ? omega_explicit : (f != null ? 2 * Math.PI * f : null);

  const R = toOmega(findValWithUnit(text, new RegExp(`\\bR\\s*=\\s*${NUM}`, "i"), [/Ω|ohm|kΩ|MΩ/i]));
  const X = findNumber(lower, new RegExp(`\\bX\\s*=\\s*${NUM}`, "i")); // if reactance given directly
  const L = toHenry(findValWithUnit(text, new RegExp(`\\bL\\s*=\\s*${NUM}`, "i"), [/h\b/i, /mh\b/i, /µh|μh|uh\b/i]));
  const C_ = toFarad(findValWithUnit(text, new RegExp(`\\bC\\s*=\\s*${NUM}`, "i"), [/f\b/i, /µf|μf|uf\b/i, /nf\b/i, /pf\b/i]));

  const R1 = toOmega(findValWithUnit(text, new RegExp(`\\bR1\\s*=\\s*${NUM}`, "i"), [/Ω|ohm|kΩ|MΩ/i]));
  const R2 = toOmega(findValWithUnit(text, new RegExp(`\\bR2\\s*=\\s*${NUM}`, "i"), [/Ω|ohm|kΩ|MΩ/i]));
  const L1 = toHenry(findValWithUnit(text, new RegExp(`\\bL1\\s*=\\s*${NUM}`, "i"), [/h|mh|µh|μh|uh/i]));
  const C1 = toFarad(findValWithUnit(text, new RegExp(`\\bC1\\s*=\\s*${NUM}`, "i"), [/f|µf|μf|uf|nf|pf/i]));
  const L2 = toHenry(findValWithUnit(text, new RegExp(`\\bL2\\s*=\\s*${NUM}`, "i"), [/h|mh|µh|μh|uh/i]));
  const C2 = toFarad(findValWithUnit(text, new RegExp(`\\bC2\\s*=\\s*${NUM}`, "i"), [/f|µf|μf|uf|nf|pf/i]));

  const V = toVolt(findValWithUnit(text, new RegExp(`\\bV\\s*=\\s*${NUM}`, "i"), [/v\b/i, /mv\b/i]));
  const I = toAmp(findValWithUnit(text, new RegExp(`\\bI\\s*=\\s*${NUM}`, "i"), [/a\b/i, /ma\b/i, /µa|μa|ua\b/i]));
  const PF_given = findNumber(lower, new RegExp(`\\bpf\\s*=\\s*${NUM}`, "i"));

  /* ---------- 1) Impedance magnitude / phase ---------- */
  if (/\bimpedance|Z\s*=\b/i.test(lower) && finalN != null) {
    if (omega != null && (R != null || L != null || C_ != null)) {
      const parts: (C | null)[] = [];
      if (R != null) parts.push(Z_R(R));
      if (L != null) parts.push(Z_L(omega, L));
      if (C_ != null) parts.push(Z_C(omega, C_));
      const Zs = Z_series(parts);
      if (Zs) {
        const mag = cAbs(Zs);
        const ok = relClose(mag, finalN, 1e-6, 1e-6) || approxEqual(mag, finalN, 1e-6);
        checks.push({ value: `|Z|=${finalN}`, ok, lhs: mag, rhs: finalN, reason: ok ? null : "impedance magnitude mismatch" } as any);
      }
    }
  }

  /* ---------- 2) Series/Parallel combos (simple) ---------- */
  if (/series/.test(lower) && finalN != null) {
    // Support R + jX if X provided explicitly
    if (R != null && (X != null || omega != null && (L != null || C_ != null))) {
      const jX = X != null ? c(0, X) : c(0, (L ? omega! * L : 0) + (C_ ? -1 / (omega! * C_) : 0));
      const Zs = cAdd(c(R, 0), jX);
      const mag = cAbs(Zs);
      const ok = relClose(mag, finalN, 1e-6, 1e-6) || approxEqual(mag, finalN, 1e-6);
      checks.push({ value: `|Z_series|=${finalN}`, ok, lhs: mag, rhs: finalN, reason: ok ? null : "series |Z| mismatch" } as any);
    }
  }
  if (/parallel/.test(lower) && finalN != null && omega != null) {
    // Support parallel of two elements among R/L/C
    const candidates: (C | null)[] = [
      R != null ? Z_R(R) : null,
      L != null ? Z_L(omega, L!) : null,
      C_ != null ? Z_C(omega, C_!) : null,
    ].filter(Boolean) as C[];
    if (candidates.length >= 2) {
      const Zp = Z_parallel(candidates[0], candidates[1]);
      if (Zp) {
        const mag = cAbs(Zp);
        const ok = relClose(mag, finalN, 1e-6, 1e-6) || approxEqual(mag, finalN, 1e-6);
        checks.push({ value: `|Z_parallel|=${finalN}`, ok, lhs: mag, rhs: finalN, reason: ok ? null : "parallel |Z| mismatch" } as any);
      }
    }
  }

  /* ---------- 3) Power & power factor ---------- */
  if (/\bpower\s*factor|pf\b/i.test(lower) && finalN != null) {
    if (R != null && omega != null && (L != null || C_ != null)) {
      const Xl = L ? omega * L : 0;
      const Xc = C_ ? (1 / (omega * C_)) : 0;
      const Xnet = Xl - Xc;
      const phi = Math.atan2(Xnet, R);
      const pf = Math.cos(phi);
      const ok = relClose(pf, finalN, 1e-6, 1e-6) || approxEqual(pf, finalN, 1e-6);
      checks.push({ value: `pf=${finalN}`, ok, lhs: pf, rhs: finalN, reason: ok ? null : "power factor mismatch" } as any);
    }
  }
  if (/\b(apparent|real|reactive)\s*power\b|\bS=|P=|Q=/i.test(lower) && finalN != null) {
    // Need V & I or (V & Z & pf)
    if (V != null && I != null) {
      const S = V * I;
      if (/apparent|S=/.test(lower)) {
        const ok = relClose(S, finalN, 1e-6, 1e-6) || approxEqual(S, finalN, 1e-6);
        checks.push({ value: `S=${finalN}`, ok, lhs: S, rhs: finalN, reason: ok ? null : "S=VI mismatch" } as any);
      }
      // try compute pf if we can
      let pf: number | null = PF_given ?? null;
      if (pf == null && R != null && omega != null && (L != null || C_ != null)) {
        const Xl = L ? omega * L : 0;
        const Xc = C_ ? (1 / (omega * C_)) : 0;
        const phi = Math.atan2(Xl - Xc, R);
        pf = Math.cos(phi);
      }
      if (pf != null) {
        const P = S * pf;
        const Q = S * Math.sqrt(Math.max(0, 1 - pf * pf)) * ((L && !C_) ? 1 : -1); // sign heuristic
        if (/real\s*power|P=/.test(lower)) {
          const ok = relClose(P, finalN, 1e-6, 1e-6) || approxEqual(P, finalN, 1e-6);
          checks.push({ value: `P=${finalN}`, ok, lhs: P, rhs: finalN, reason: ok ? null : "P mismatch" } as any);
        }
        if (/reactive\s*power|Q=/.test(lower)) {
          const ok = relClose(Math.abs(Q), Math.abs(finalN), 1e-6, 1e-6) || approxEqual(Math.abs(Q), Math.abs(finalN), 1e-6);
          checks.push({ value: `Q≈${finalN}`, ok, lhs: Q, rhs: finalN, reason: ok ? null : "Q mismatch" } as any);
        }
      }
    } else if (V != null && R != null && omega != null && (L != null || C_ != null)) {
      // Use Z to infer I
      const Zs = Z_series([Z_R(R), L ? Z_L(omega, L) : null, C_ ? Z_C(omega, C_) : null]);
      if (Zs) {
        const Icalc = V / cAbs(Zs);
        const S = V * Icalc;
        if (/apparent|S=/.test(lower)) {
          const ok = relClose(S, finalN, 1e-6, 1e-6) || approxEqual(S, finalN, 1e-6);
          checks.push({ value: `S=${finalN}`, ok, lhs: S, rhs: finalN, reason: ok ? null : "S mismatch (from Z)" } as any);
        }
      }
    }
  }

  /* ---------- 4) Cutoff frequency ---------- */
  if (/\b(cutoff|corner|-3db|f_c|fc)\b/i.test(lower) && finalN != null) {
    if (R != null && C_ != null) {
      const fc = 1 / (2 * Math.PI * R * C_);
      const ok = relClose(fc, finalN, 2e-6, 1e-6) || approxEqual(fc, finalN, 1e-6);
      checks.push({ value: `f_c(RC)=${finalN}`, ok, lhs: fc, rhs: finalN, reason: ok ? null : "RC cutoff mismatch" } as any);
    } else if (R != null && L != null) {
      const fc = R / (2 * Math.PI * L);
      const ok = relClose(fc, finalN, 2e-6, 1e-6) || approxEqual(fc, finalN, 1e-6);
      checks.push({ value: `f_c(RL)=${finalN}`, ok, lhs: fc, rhs: finalN, reason: ok ? null : "RL cutoff mismatch" } as any);
    }
  }

  /* ---------- 5) Resonance (series/parallel RLC — frequency only) ---------- */
  if (/\b(resonance|resonant|f0|ω0)\b/i.test(lower) && finalN != null) {
    if (L != null && C_ != null) {
      const w0 = 1 / Math.sqrt(L * C_);
      const f0 = w0 / (2 * Math.PI);
      // If the problem uses ω units, final likely rad/s; otherwise Hz
      const wantsOmega = /ω0|rad\/s/.test(lower) || /rad\/s/.test(finalS.toLowerCase());
      const target = wantsOmega ? w0 : f0;
      const ok = relClose(target, finalN, 1e-6, 1e-6) || approxEqual(target, finalN, 1e-6);
      checks.push({ value: `${wantsOmega ? "ω0" : "f0"}=${finalN}`, ok, lhs: target, rhs: finalN, reason: ok ? null : "resonant freq mismatch" } as any);
    }
  }

  /* ---------- 6) AC voltage divider (two elements) ---------- */
  if (/\bdivider|vout|vo\b/i.test(lower) && finalN != null && (omega != null)) {
    // Build two impedances Z1 (top) and Z2 (bottom) from R1/L1/C1 and R2/L2/C2
    const buildZ = (R?: number | null, L?: number | null, Cx?: number | null): C | null => {
      const parts: (C | null)[] = [];
      if (R != null) parts.push(Z_R(R));
      if (L != null) parts.push(Z_L(omega!, L));
      if (Cx != null) parts.push(Z_C(omega!, Cx));
      return Z_series(parts);
    };
    const Z1 = buildZ(R1 ?? null, L1 ?? null, C1 ?? null);
    const Z2 = buildZ(R2 ?? null, L2 ?? null, C2 ?? null);
    const Vin = toVolt(findValWithUnit(text, new RegExp(`\\bV(?:in|source)?\\s*=\\s*${NUM}`, "i"), [/v\b/i, /mv\b/i])) ?? V;

    if (Z1 && Z2 && Vin != null) {
      const Vout = cMul(c(Vin, 0), cDiv(Z2, cAdd(Z1, Z2)));
      const mag = cAbs(Vout);
      const ok = relClose(mag, finalN, 1e-5, 1e-6) || approxEqual(mag, finalN, 1e-4);
      checks.push({ value: `|Vout|=${finalN}`, ok, lhs: mag, rhs: finalN, reason: ok ? null : "AC divider |Vout| mismatch" } as any);
    }
  }

  /* ---------- Verdict ---------- */
  if (!checks.length) return null;
  const allVerified = checks.every((x: any) => x.ok);
  return { subject: "circuits-ac", method: "circuits-ac", allVerified, checks } as unknown as Verification;
}
