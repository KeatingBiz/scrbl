// lib/verify/circuits.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import { gatherProblemText, parseNumber, approxEqual, relClose } from "./utils";

const NUM = "(-?\\d*\\.?\\d+(?:e[+-]?\\d+)?)";

type UnitsKind = "R" | "V" | "I" | "P";

function unitScale(s: string, kind: UnitsKind): number {
  const t = s.toLowerCase();
  const has = (re: RegExp) => re.test(t);
  const prefix =
    has(/\bma\b| milliamp/) ? 1e-3 :
    has(/\bµa\b|μa|microamp/) ? 1e-6 :
    has(/\bka\b/) ? 1e3 :
    has(/\bmv\b| millivolt/) ? 1e-3 :
    has(/\bkv\b/) ? 1e3 :
    has(/\bmw\b(?!h)| milliwatt/) ? 1e-3 :
    has(/\bkw\b/) ? 1e3 :
    has(/\bkΩ\b|kohm|k-?ohm| kilo-?ohm/) ? 1e3 :
    has(/\bmΩ\b|mohm|m-?ohm| milli-?ohm/) ? 1e-3 :
    has(/\bmΩ\b/) ? 1e-3 :
    has(/\bm\s*ohm/) ? 1e-3 :
    has(/\bMΩ\b|Mohm|mega-?ohm/) ? 1e6 :
    1;

  switch (kind) {
    case "I": return prefix;           // A base
    case "V": return prefix;           // V base
    case "P": return prefix;           // W base
    case "R": return prefix;           // Ω base
  }
}

function findVal(text: string, label: RegExp, kind: UnitsKind): number | null {
  const m = text.match(label);
  if (!m || !m[1]) return null;
  const n = parseNumber(m[1]);
  if (n == null) return null;
  const around = text.slice((m.index || 0), (m.index || 0) + m[0].length + 10);
  const scale = unitScale(around, kind);
  return n * scale;
}

function findManyResistors(text: string): number[] {
  // capture R, R1, R2, etc. like "R1=2kΩ", "R=100", "R2 = 470 ohm"
  const re = new RegExp(`\\bR\\d*\\s*=\\s*${NUM}`, "gi");
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const n = parseNumber(m[1]);
    if (n == null) continue;
    const val = n * unitScale(raw, "R");
    if (Number.isFinite(val)) out.push(val);
  }
  return out;
}

export function verifyCircuits(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.replace(/[–—−]/g, "-");
  const lower = text.toLowerCase();
  const finalS = String(result.final ?? "");
  const finalN_raw = parseNumber(finalS);

  // sniff test
  const looksCircuit = /\b(ohm|resistor|voltage|current|amper|ampere|divider|series|parallel|kcl|kvl|loop|source|battery|power)\b/.test(lower)
    || /\bR\d?\s*=/.test(text);
  if (!looksCircuit) return null;

  const checks: Verification["checks"] = [];

  const V = findVal(text, new RegExp(`\\bV\\s*=\\s*${NUM}`, "i"), "V");
  const I = findVal(text, new RegExp(`\\bI\\s*=\\s*${NUM}`, "i"), "I");
  const R = findVal(text, new RegExp(`\\bR\\s*=\\s*${NUM}`, "i"), "R");
  const P = findVal(text, new RegExp(`\\bP\\s*=\\s*${NUM}`, "i"), "P");

  // If final has unit hint, normalize it to base for comparison in each check
  const finalHasA = /(?:\b|\/)\s*(?:a|ma|µa|μa)\b/i.test(finalS);
  const finalHasV = /(?:\b|\/)\s*(?:v|mv|kv)\b/i.test(finalS);
  const finalHasW = /(?:\b|\/)\s*(?:w|mw|kw)\b/i.test(finalS);
  const finalHasOhm = /(Ω|ohm)/i.test(finalS);

  const finalA = finalN_raw != null ? finalN_raw * (finalHasA ? unitScale(finalS, "I") : 1) : null;
  const finalV = finalN_raw != null ? finalN_raw * (finalHasV ? unitScale(finalS, "V") : 1) : null;
  const finalW = finalN_raw != null ? finalN_raw * (finalHasW ? unitScale(finalS, "P") : 1) : null;
  const finalR = finalN_raw != null ? finalN_raw * (finalHasOhm ? unitScale(finalS, "R") : 1) : null;

  /* ---------------- Ohm’s law ---------------- */
  if (/ohm'?s?\s*law|v\s*=\s*i\s*r|i\s*=\s*v\s*\/\s*r|r\s*=\s*v\s*\/\s*i/i.test(lower)) {
    if (V != null && R != null && finalA != null) {
      const i = R === 0 ? NaN : V / R;
      if (Number.isFinite(i)) {
        const ok = relClose(i, finalA, 1e-6, 1e-6) || approxEqual(i, finalA, 1e-6);
        checks.push({ value: `I=${finalA}`, ok, lhs: i, rhs: finalA, reason: ok ? null : "I = V/R mismatch" } as any);
      }
    }
    if (I != null && R != null && finalV != null) {
      const v = I * R;
      const ok = relClose(v, finalV, 1e-6, 1e-6) || approxEqual(v, finalV, 1e-6);
      checks.push({ value: `V=${finalV}`, ok, lhs: v, rhs: finalV, reason: ok ? null : "V = I·R mismatch" } as any);
    }
    if (V != null && I != null && finalR != null) {
      const r = I === 0 ? NaN : V / I;
      if (Number.isFinite(r)) {
        const ok = relClose(r, finalR, 1e-6, 1e-6) || approxEqual(r, finalR, 1e-6);
        checks.push({ value: `R=${finalR}`, ok, lhs: r, rhs: finalR, reason: ok ? null : "R = V/I mismatch" } as any);
      }
    }
  }

  /* ---------------- Power identities ---------------- */
  if (/\bpower\b|\bP\s*=/.test(lower)) {
    if (V != null && I != null && finalW != null) {
      const p = V * I;
      const ok = relClose(p, finalW, 1e-6, 1e-6) || approxEqual(p, finalW, 1e-6);
      checks.push({ value: `P=${finalW}`, ok, lhs: p, rhs: finalW, reason: ok ? null : "P = V·I mismatch" } as any);
    }
    if (I != null && R != null && finalW != null) {
      const p = I * I * R;
      const ok = relClose(p, finalW, 1e-6, 1e-6) || approxEqual(p, finalW, 1e-6);
      checks.push({ value: `P=${finalW}`, ok, lhs: p, rhs: finalW, reason: ok ? null : "P = I²R mismatch" } as any);
    }
    if (V != null && R != null && finalW != null) {
      const p = R === 0 ? NaN : (V * V) / R;
      if (Number.isFinite(p)) {
        const ok = relClose(p, finalW, 1e-6, 1e-6) || approxEqual(p, finalW, 1e-6);
        checks.push({ value: `P=${finalW}`, ok, lhs: p, rhs: finalW, reason: ok ? null : "P = V²/R mismatch" } as any);
      }
    }
  }

  /* ---------------- Series / Parallel Req ---------------- */
  const resistors = findManyResistors(text);
  if (/series/.test(lower) && resistors.length >= 2 && (finalR != null)) {
    const req = resistors.reduce((s, v) => s + v, 0);
    const ok = relClose(req, finalR, 1e-6, 1e-6) || approxEqual(req, finalR, 1e-6);
    checks.push({ value: `Req(series)=${finalR}`, ok, lhs: req, rhs: finalR, reason: ok ? null : "Series Req mismatch" } as any);
  }
  if (/parallel/.test(lower) && resistors.length >= 2 && (finalR != null)) {
    let inv = 0;
    for (const r of resistors) inv += (r === 0 ? Infinity : 1 / r);
    const req = inv === 0 ? Infinity : 1 / inv;
    const ok = relClose(req, finalR, 1e-6, 1e-6) || approxEqual(req, finalR, 1e-6);
    checks.push({ value: `Req(parallel)=${finalR}`, ok, lhs: req, rhs: finalR, reason: ok ? null : "Parallel Req mismatch" } as any);
  }

  /* ---------------- Single-loop current (V source with series resistors) ---------------- */
  if (/loop|kvl|series/.test(lower) && /current|I\b/.test(lower) && finalA != null) {
    if (V != null && resistors.length >= 1) {
      const sumR = resistors.reduce((s, v) => s + v, 0);
      if (sumR > 0) {
        const i = V / sumR;
        const ok = relClose(i, finalA, 1e-6, 1e-6) || approxEqual(i, finalA, 1e-6);
        checks.push({ value: `I(loop)=${finalA}`, ok, lhs: i, rhs: finalA, reason: ok ? null : "Loop current mismatch" } as any);
      }
    }
  }

  /* ---------------- Voltage divider (two resistors) ---------------- */
  if (/divider|vout|vo\b/i.test(lower)) {
    const Vin = findVal(text, new RegExp(`\\bV(?:in|source)?\\s*=\\s*${NUM}`, "i"), "V") ?? V;
    const R1 = findVal(text, new RegExp(`\\bR1\\s*=\\s*${NUM}`, "i"), "R");
    const R2 = findVal(text, new RegExp(`\\bR2\\s*=\\s*${NUM}`, "i"), "R");
    if (Vin != null && R1 != null && R2 != null && finalV != null) {
      // Two possibilities depending on which is “bottom”
      const vBottom = Vin * (R2 / (R1 + R2));
      const vTop = Vin * (R1 / (R1 + R2));
      const ok = relClose(vBottom, finalV, 1e-5, 1e-6) || approxEqual(vBottom, finalV, 1e-3)
              || relClose(vTop, finalV, 1e-5, 1e-6) || approxEqual(vTop, finalV, 1e-3);
      checks.push({ value: `Vout=${finalV}`, ok, lhs: vBottom, rhs: finalV, reason: ok ? null : "Voltage divider mismatch" } as any);
    }
  }

  /* ---------------- Current divider (two branches) ---------------- */
  if (/current\s*divider|branch\s*current/i.test(lower)) {
    const It = findVal(text, new RegExp(`\\bI(?:total|t)?\\s*=\\s*${NUM}`, "i"), "I") ?? I;
    const R1 = findVal(text, new RegExp(`\\bR1\\s*=\\s*${NUM}`, "i"), "R");
    const R2 = findVal(text, new RegExp(`\\bR2\\s*=\\s*${NUM}`, "i"), "R");
    if (It != null && R1 != null && R2 != null && finalA != null) {
      // I through R1 is It * (R2 / (R1 + R2)) ; through R2 is It * (R1 / (R1 + R2))
      const i1 = It * (R2 / (R1 + R2));
      const i2 = It * (R1 / (R1 + R2));
      const ok = relClose(i1, finalA, 1e-5, 1e-6) || approxEqual(i1, finalA, 1e-3)
              || relClose(i2, finalA, 1e-5, 1e-6) || approxEqual(i2, finalA, 1e-3);
      checks.push({ value: `Ibranch=${finalA}`, ok, lhs: i1, rhs: finalA, reason: ok ? null : "Current divider mismatch" } as any);
    }
  }

  if (!checks.length) return null;
  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "circuits", method: "circuits-dc", allVerified, checks } as unknown as Verification;
}
