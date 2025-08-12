// lib/verify/thermo.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import {
  gatherProblemText,
  parseNumber,
  approxEqual,
  relClose,
} from "./utils";

const NUM = "(-?\\d*\\.?\\d+(?:e[+-]?\\d+)?)";
const R_UNIV = 8.314462618; // J/(mol·K)
const gDefault = 9.81; // not used much here, but kept if needed

type Val = { value: number; unit?: string };

// ---------- generic helpers ----------
function findValWithUnit(text: string, label: RegExp, unitHints: RegExp[]): Val | null {
  const m = text.match(label);
  if (!m || !m[1]) return null;
  const value = parseNumber(m[1]);
  if (value == null) return null;
  const start = m.index ?? 0;
  const window = text.slice(start, Math.min(text.length, start + 48));
  for (const u of unitHints) {
    const um = window.match(u);
    if (um) return { value, unit: um[0] };
  }
  return { value };
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

// ---------- unit conversions ----------
function toKelvin(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (/k\b/.test(u)) return x.value;
  if (/°c|degc|c\b/.test(u)) return x.value + 273.15;
  if (/°f|degf|f\b/.test(u)) return (x.value - 32) * (5 / 9) + 273.15;
  return x.value; // assume K if no unit
}
function deltaTempToK(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u) return x.value;
  if (/k\b/.test(u)) return x.value;
  if (/°c|degc|c\b/.test(u)) return x.value; // Δ°C == ΔK
  if (/°f|degf|f\b/.test(u)) return x.value * (5 / 9);
  return x.value;
}
function toKg(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /\bkg\b/.test(u)) return x.value;
  if (/\bg\b/.test(u)) return x.value / 1000;
  if (/\blb\b|\blbm\b/.test(u)) return x.value * 0.45359237;
  return x.value;
}
function toJoules(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /\bj\b/.test(u)) return x.value;
  if (/\bkj\b/.test(u)) return x.value * 1e3;
  if (/\bcal\b/.test(u)) return x.value * 4.184;
  if (/\bkcal\b/.test(u)) return x.value * 4184;
  if (/\bbtu\b/.test(u)) return x.value * 1055.05585;
  return x.value;
}
function toPa(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /\bpa\b/.test(u)) return x.value;
  if (/\bkpa\b/.test(u)) return x.value * 1e3;
  if (/\bmpa\b/.test(u)) return x.value * 1e6;
  if (/\batm\b/.test(u)) return x.value * 101325;
  if (/\bbar\b/.test(u)) return x.value * 1e5;
  return x.value;
}
function toM3(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /m\^?3\b/.test(u)) return x.value;
  if (/\bl\b/.test(u)) return x.value * 1e-3;
  if (/\bml\b/.test(u)) return x.value * 1e-6;
  if (/\bft\^?3\b/.test(u)) return x.value * 0.028316846592;
  return x.value;
}
function toMol(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /\bmol\b/.test(u)) return x.value;
  return x.value; // assume mol if omitted
}
function toMolarMassKgPerMol(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (/\bkg\/mol\b/.test(u)) return x.value;
  if (/\bg\/mol\b/.test(u)) return x.value / 1000;
  return x.value; // assume kg/mol if omitted
}

// Specific heats / heat capacities → returns value in J/(basis·K) and basis
type HeatCap = { c: number; basis: "mass" | "mol" } | null;

// cp or cv given as per-mass or per-mol
function parseHeatCapacity(val: Val | null, fallbackBasis?: "mass" | "mol"): HeatCap {
  if (!val) return null;
  const u = (val.unit || "").toLowerCase();

  // Recognize per-kg-K
  if (/j\/kg·?k\b/.test(u)) return { c: val.value, basis: "mass" };
  if (/kj\/kg·?k\b/.test(u)) return { c: val.value * 1e3, basis: "mass" };
  if (/cal\/g·?(?:°c|k)\b/.test(u)) return { c: val.value * 4.184e3, basis: "mass" }; // cal/gK → J/kgK
  if (/kcal\/kg·?(?:°c|k)\b/.test(u)) return { c: val.value * 4184, basis: "mass" };
  if (/btu\/lb·?f\b/.test(u)) return { c: val.value * (1055.05585 / 0.45359237) * (5/9), basis: "mass" }; // BTU/lb°F → J/kgK

  // Recognize per-mol-K
  if (/j\/mol·?k\b/.test(u)) return { c: val.value, basis: "mol" };
  if (/kj\/mol·?k\b/.test(u)) return { c: val.value * 1e3, basis: "mol" };

  // No units: assume fallback if provided
  if (fallbackBasis) return { c: val.value, basis: fallbackBasis };
  return null;
}

// Latent heats → J/kg
function toLatentJPerKg(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (/j\/kg\b/.test(u)) return x.value;
  if (/kj\/kg\b/.test(u)) return x.value * 1e3;
  if (/cal\/g\b/.test(u)) return x.value * 4.184e3; // cal/g → J/kg
  if (/kcal\/kg\b/.test(u)) return x.value * 4184;
  if (/btu\/lb\b/.test(u)) return x.value * (1055.05585 / 0.45359237);
  // If unit omitted, assume J/kg
  if (!u) return x.value;
  return x.value;
}

// ---------- main ----------
export function verifyThermo(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.replace(/[–—−]/g, "-");
  const lower = text.toLowerCase();
  const finalS = String(result.final ?? "");
  const finalN = parseNumber(finalS);

  const looksThermo =
    /\b(calorimetry|mixing|specific\s*heat|latent|fusion|vaporization|evaporation|boiling|ideal\s*gas|pv\s*=\s*nrt|combined\s*gas|isobaric|isometric|isovolumetric|first\s*law|enthalpy|internal\s*energy|delta\s*u|Δu|delta\s*h|Δh|work|heat)\b/.test(
      lower
    );
  if (!looksThermo) return null;

  const checks: Verification["checks"] = [];

  // ---------- Common parsed inputs ----------
  // masses & temperatures
  const m1 = toKg(findValWithUnit(text, new RegExp(`\\bm1\\s*=\\s*${NUM}`, "i"), [/kg\b/i, /\bg\b/i, /\blb\b/i]));
  const m2 = toKg(findValWithUnit(text, new RegExp(`\\bm2\\s*=\\s*${NUM}`, "i"), [/kg\b/i, /\bg\b/i, /\blb\b/i]));
  const m  = toKg(findValWithUnit(text, new RegExp(`\\bm\\s*=\\s*${NUM}`, "i"),  [/kg\b/i, /\bg\b/i, /\blb\b/i]));

  const T1 = toKelvin(findValWithUnit(text, new RegExp(`\\bT1\\s*=\\s*${NUM}`, "i"), [/k\b/i, /°c|degc|c\b/i, /°f|degf|f\b/i]));
  const T2 = toKelvin(findValWithUnit(text, new RegExp(`\\bT2\\s*=\\s*${NUM}`, "i"), [/k\b/i, /°c|degc|c\b/i, /°f|degf|f\b/i]));
  const T  = toKelvin(findValWithUnit(text, new RegExp(`\\bT\\s*=\\s*${NUM}`,  "i"), [/k\b/i, /°c|degc|c\b/i, /°f|degf|f\b/i]));
  const dT = deltaTempToK(findValWithUnit(text, new RegExp(`\\b(?:ΔT|dT)\\s*=\\s*${NUM}`, "i"), [/k\b/i, /°c|degc|c\b/i, /°f|degf|f\b/i]));

  // energies, heat, work
  const Q = toJoules(findValWithUnit(text, new RegExp(`\\bQ\\s*=\\s*${NUM}`, "i"), [/j\b/i, /kj\b/i, /cal\b/i, /kcal\b/i, /btu\b/i]));
  const W = toJoules(findValWithUnit(text, new RegExp(`\\bW\\s*=\\s*${NUM}`, "i"), [/j\b/i, /kj\b/i, /cal\b/i, /kcal\b/i, /btu\b/i]));

  // cp, cv (allow per-mass or per-mol)
  const cpVal = findValWithUnit(text, new RegExp(`\\bC[pP]|cp\\s*=\\s*${NUM}`, "i"), [/j\/kg·?k\b/i, /kj\/kg·?k\b/i, /cal\/g·?(?:°c|k)\b/i, /kcal\/kg·?(?:°c|k)\b/i, /btu\/lb·?f\b/i, /j\/mol·?k\b/i, /kj\/mol·?k\b/i]);
  const cvVal = findValWithUnit(text, new RegExp(`\\bC[vV]|cv\\s*=\\s*${NUM}`, "i"), [/j\/kg·?k\b/i, /kj\/kg·?k\b/i, /cal\/g·?(?:°c|k)\b/i, /kcal\/kg·?(?:°c|k)\b/i, /btu\/lb·?f\b/i, /j\/mol·?k\b/i, /kj\/mol·?k\b/i]);
  const cp = parseHeatCapacity(cpVal || null);
  const cv = parseHeatCapacity(cvVal || null);

  // latent heat
  const Lf = toLatentJPerKg(findValWithUnit(text, new RegExp(`\\bL[fF]?\\s*=\\s*${NUM}`, "i"), [/j\/kg\b/i, /kj\/kg\b/i, /cal\/g\b/i, /kcal\/kg\b/i, /btu\/lb\b/i]));
  const Lv = toLatentJPerKg(findValWithUnit(text, new RegExp(`\\bL[vV]?\\s*=\\s*${NUM}`, "i"), [/j\/kg\b/i, /kj\/kg\b/i, /cal\/g\b/i, /kcal\/kg\b/i, /btu\/lb\b/i]));
  const Lh = toLatentJPerKg(findValWithUnit(text, new RegExp(`\\bL\\s*=\\s*${NUM}`,    "i"), [/j\/kg\b/i, /kj\/kg\b/i, /cal\/g\b/i, /kcal\/kg\b/i, /btu\/lb\b/i]));

  // ideal gas variables
  const P1 = toPa(findValWithUnit(text, new RegExp(`\\bP1\\s*=\\s*${NUM}`, "i"), [/pa\b/i, /kpa\b/i, /mpa\b/i, /atm\b/i, /bar\b/i]));
  const P2 = toPa(findValWithUnit(text, new RegExp(`\\bP2\\s*=\\s*${NUM}`, "i"), [/pa\b/i, /kpa\b/i, /mpa\b/i, /atm\b/i, /bar\b/i]));
  const P_  = toPa(findValWithUnit(text, new RegExp(`\\bP\\s*=\\s*${NUM}`,  "i"), [/pa\b/i, /kpa\b/i, /mpa\b/i, /atm\b/i, /bar\b/i]));

  const V1 = toM3(findValWithUnit(text, new RegExp(`\\bV1\\s*=\\s*${NUM}`, "i"), [/m\^?3\b/i, /l\b/i, /ml\b/i, /ft\^?3\b/i]));
  const V2 = toM3(findValWithUnit(text, new RegExp(`\\bV2\\s*=\\s*${NUM}`, "i"), [/m\^?3\b/i, /l\b/i, /ml\b/i, /ft\^?3\b/i]));
  const V  = toM3(findValWithUnit(text, new RegExp(`\\bV\\s*=\\s*${NUM}`,  "i"), [/m\^?3\b/i, /l\b/i, /ml\b/i, /ft\^?3\b/i]));

  const n1 = toMol(findValWithUnit(text, new RegExp(`\\bn1\\s*=\\s*${NUM}`, "i"), [/mol\b/i]));
  const n2 = toMol(findValWithUnit(text, new RegExp(`\\bn2\\s*=\\s*${NUM}`, "i"), [/mol\b/i]));
  const n  = toMol(findValWithUnit(text, new RegExp(`\\bn\\s*=\\s*${NUM}`,  "i"), [/mol\b/i]));
  const M  = toMolarMassKgPerMol(findValWithUnit(text, new RegExp(`\\bM\\s*=\\s*${NUM}`, "i"), [/kg\/mol\b/i, /g\/mol\b/i]));
  const massForMol = toKg(findValWithUnit(text, new RegExp(`\\bmass\\s*=\\s*${NUM}`, "i"), [/kg\b/i, /\bg\b/i, /\blb\b/i]));
  const nFromMass = (massForMol != null && M != null) ? (massForMol / M) : null;

  // ---------- 1) Calorimetry q = m c ΔT ----------
  if (/\b(calorimetry|specific\s*heat|q\s*=|heat\s*gained|heat\s*lost)\b/i.test(lower) && finalN != null) {
    const mUse = m ?? m1 ?? m2;
    // ΔT either given directly or inferred from (T and T1/T2)
    const dTuse =
      dT ??
      (T1 != null && T2 != null ? Math.abs(T2 - T1) : null);

    // prefer cp if present; else cv if they wrote "constant volume"
    const C = cp ?? (/\bconstant\s*volume|iso(?:choric|metric)\b/i.test(lower) ? cv : null);

    if (mUse != null && C && dTuse != null) {
      let q: number | null = null;
      if (C.basis === "mass") q = mUse * C.c * dTuse;
      else if (C.basis === "mol" && (n ?? nFromMass) != null) q = (n ?? nFromMass)! * C.c * dTuse;

      if (q != null) {
        const ok = relClose(q, finalN, 1e-5, 1e-6) || approxEqual(q, finalN, 1e-3);
        checks.push({ value: `q=${finalN}`, ok, lhs: q, rhs: finalN, reason: ok ? null : "q=mcΔT mismatch" } as any);
      }
    }
  }

  // ---------- 2) Mixing temperature (two bodies, adiabatic) ----------
  if (/\bmix(?:ing)?\b|final\s*temperature|equilibrium\s*temperature/i.test(lower) && finalN != null) {
    // Try with given cp’s
    const c1 = parseHeatCapacity(findValWithUnit(text, new RegExp(`\\bc1\\s*=\\s*${NUM}`, "i"), [/j\/kg·?k\b/i, /kj\/kg·?k\b/i, /cal\/g/i, /kcal\/kg/i]));
    const c2 = parseHeatCapacity(findValWithUnit(text, new RegExp(`\\bc2\\s*=\\s*${NUM}`, "i"), [/j\/kg·?k\b/i, /kj\/kg·?k\b/i, /cal\/g/i, /kcal\/kg/i]));
    const T1K = T1, T2K = T2;

    if (m1 != null && m2 != null && T1K != null && T2K != null) {
      // Case A: have per-mass cp’s
      if (c1 && c2 && c1.basis === "mass" && c2.basis === "mass") {
        const Tf = (m1 * c1.c * T1K + m2 * c2.c * T2K) / (m1 * c1.c + m2 * c2.c);
        const ok = relClose(Tf, finalN, 1e-6, 1e-6) || approxEqual(Tf, finalN, 1e-6);
        checks.push({ value: `Tf=${finalN}`, ok, lhs: Tf, rhs: finalN, reason: ok ? null : "mixing temp mismatch" } as any);
      } else {
        // Case B: assume equal c (standard intro assumption)
        const Tf = (m1 * T1K + m2 * T2K) / (m1 + m2);
        const ok = relClose(Tf, finalN, 1e-6, 1e-6) || approxEqual(Tf, finalN, 1e-6);
        checks.push({ value: `Tf=${finalN}`, ok, lhs: Tf, rhs: finalN, reason: ok ? null : "mixing temp (equal c) mismatch" } as any);
      }
    }
  }

  // ---------- 3) Phase change q = m L ----------
  if (/\b(phase|latent|fusion|vapor(?:ization)?|boil|melt)\b/i.test(lower) && finalN != null) {
    const mUse = m ?? m1 ?? m2;
    const L = Lh ?? Lf ?? Lv ?? null;
    if (mUse != null && L != null) {
      const q = mUse * L;
      const ok = relClose(q, finalN, 1e-5, 1e-6) || approxEqual(q, finalN, 1e-3);
      checks.push({ value: `q_latent=${finalN}`, ok, lhs: q, rhs: finalN, reason: ok ? null : "q = mL mismatch" } as any);
    }
  }

  // ---------- 4) Ideal gas: PV = nRT ----------
  if (/\bideal\s*gas\b|pv\s*=\s*nrt|boyle|charles|gay-lussac/i.test(lower) && finalN != null) {
    const P = P_ ?? P1 ?? null;
    const Vuse = V ?? V1 ?? null;
    const nUse = n ?? n1 ?? nFromMass ?? null;
    const Tuse = T ?? T1 ?? null;

    const known = { P: P != null, V: Vuse != null, n: nUse != null, T: Tuse != null };
    const count = Object.values(known).filter(Boolean).length;

    if (count >= 3) {
      const R = R_UNIV;
      if (!known.P && Vuse != null && nUse != null && Tuse != null) {
        const Pcalc = (nUse * R * Tuse) / Vuse;
        const ok = relClose(Pcalc, finalN, 1e-5, 1e-6) || approxEqual(Pcalc, finalN, 1e-3);
        checks.push({ value: `P=${finalN}`, ok, lhs: Pcalc, rhs: finalN, reason: ok ? null : "PV=nRT (P) mismatch" } as any);
      } else if (!known.V && P != null && nUse != null && Tuse != null) {
        const Vcalc = (nUse * R * Tuse) / P;
        const ok = relClose(Vcalc, finalN, 1e-5, 1e-6) || approxEqual(Vcalc, finalN, 1e-5);
        checks.push({ value: `V=${finalN}`, ok, lhs: Vcalc, rhs: finalN, reason: ok ? null : "PV=nRT (V) mismatch" } as any);
      } else if (!known.n && P != null && Vuse != null && Tuse != null) {
        const ncalc = (P * Vuse) / (R * Tuse);
        const ok = relClose(ncalc, finalN, 1e-5, 1e-6) || approxEqual(ncalc, finalN, 1e-5);
        checks.push({ value: `n=${finalN}`, ok, lhs: ncalc, rhs: finalN, reason: ok ? null : "PV=nRT (n) mismatch" } as any);
      } else if (!known.T && P != null && Vuse != null && nUse != null) {
        const Tcalc = (P * Vuse) / (nUse * R);
        const ok = relClose(Tcalc, finalN, 1e-5, 1e-6) || approxEqual(Tcalc, finalN, 1e-5);
        checks.push({ value: `T=${finalN}`, ok, lhs: Tcalc, rhs: finalN, reason: ok ? null : "PV=nRT (T) mismatch" } as any);
      }
    }
  }

  // ---------- 5) Combined gas law: P1 V1 / T1 = P2 V2 / T2 ----------
  if (/\bcombined\s*gas\b|p1v1\/t1\s*=\s*p2v2\/t2/i.test(lower) && finalN != null) {
    const P1u = P1 ?? P_;
    const V1u = V1 ?? V;
    const T1u = T1 ?? T;
    const P2u = P2 ?? null;
    const V2u = V2 ?? null;
    const T2u = T2 ?? null;

    const left = (P1u != null && V1u != null && T1u != null) ? (P1u * V1u) / T1u : null;
    const rightKnown = (P2u != null ? 1 : 0) + (V2u != null ? 1 : 0) + (T2u != null ? 1 : 0);

    if (left != null && rightKnown >= 2) {
      if (P2u == null) {
        const P2calc = (left * (T2u ?? 1)) / (V2u ?? 1);
        const ok = relClose(P2calc, finalN, 1e-5, 1e-6) || approxEqual(P2calc, finalN, 1e-3);
        checks.push({ value: `P2=${finalN}`, ok, lhs: P2calc, rhs: finalN, reason: ok ? null : "Combined gas P2 mismatch" } as any);
      } else if (V2u == null) {
        const V2calc = (left * (T2u ?? 1)) / P2u;
        const ok = relClose(V2calc, finalN, 1e-5, 1e-6) || approxEqual(V2calc, finalN, 1e-5);
        checks.push({ value: `V2=${finalN}`, ok, lhs: V2calc, rhs: finalN, reason: ok ? null : "Combined gas V2 mismatch" } as any);
      } else if (T2u == null) {
        const T2calc = (P2u * V2u) / left;
        const ok = relClose(T2calc, finalN, 1e-5, 1e-6) || approxEqual(T2calc, finalN, 1e-5);
        checks.push({ value: `T2=${finalN}`, ok, lhs: T2calc, rhs: finalN, reason: ok ? null : "Combined gas T2 mismatch" } as any);
      }
    }
  }

  // ---------- 6) Process energetics ----------
  // W at constant P: W = P ΔV  (also = nRΔT if ideal gas)
  if (/\b(isobaric|constant\s*pressure|w\s*=|work)\b/i.test(lower) && finalN != null) {
    const Puse = P_ ?? P1 ?? null;
    const Vstart = V1 ?? null;
    const Vend   = V2 ?? null;
    if (Puse != null && Vstart != null && Vend != null) {
      const Wcalc = Puse * (Vend - Vstart);
      const ok = relClose(Wcalc, finalN, 1e-5, 1e-6) || approxEqual(Wcalc, finalN, 1e-3);
      checks.push({ value: `W=${finalN}`, ok, lhs: Wcalc, rhs: finalN, reason: ok ? null : "W=PΔV mismatch" } as any);
    } else {
      const nUse = n ?? n1 ?? nFromMass ?? null;
      const Tstart = T1 ?? null;
      const Tend   = T2 ?? null;
      if (nUse != null && Tstart != null && Tend != null) {
        const Wcalc = nUse * R_UNIV * (Tend - Tstart);
        const ok = relClose(Wcalc, finalN, 1e-5, 1e-6) || approxEqual(Wcalc, finalN, 1e-3);
        checks.push({ value: `W=${finalN}`, ok, lhs: Wcalc, rhs: finalN, reason: ok ? null : "W=nRΔT mismatch" } as any);
      }
    }
  }

  // ΔU and ΔH from heat capacities
  if (finalN != null && /\b(Δu|delta\s*u|internal\s*energy)\b/i.test(lower)) {
    const Tstart = T1 ?? null, Tend = T2 ?? null;
    const dTuse = dT ?? (Tstart != null && Tend != null ? (Tend - Tstart) : null);
    if (dTuse != null) {
      let U: number | null = null;
      if (cv) {
        if (cv.basis === "mol" && (n ?? nFromMass) != null) U = (n ?? nFromMass)! * cv.c * dTuse;
        if (cv.basis === "mass" && m != null) U = m * cv.c * dTuse;
      }
      if (U != null) {
        const ok = relClose(U, finalN, 1e-5, 1e-6) || approxEqual(U, finalN, 1e-3);
        checks.push({ value: `ΔU=${finalN}`, ok, lhs: U, rhs: finalN, reason: ok ? null : "ΔU = nCvΔT (or mcvΔT) mismatch" } as any);
      }
    }
  }
  if (finalN != null && /\b(Δh|delta\s*h|enthalpy)\b/i.test(lower)) {
    const Tstart = T1 ?? null, Tend = T2 ?? null;
    const dTuse = dT ?? (Tstart != null && Tend != null ? (Tend - Tstart) : null);
    if (dTuse != null) {
      let H: number | null = null;
      if (cp) {
        if (cp.basis === "mol" && (n ?? nFromMass) != null) H = (n ?? nFromMass)! * cp.c * dTuse;
        if (cp.basis === "mass" && m != null) H = m * cp.c * dTuse;
      }
      if (H != null) {
        const ok = relClose(H, finalN, 1e-5, 1e-6) || approxEqual(H, finalN, 1e-3);
        checks.push({ value: `ΔH=${finalN}`, ok, lhs: H, rhs: finalN, reason: ok ? null : "ΔH = nCpΔT (or mcpΔT) mismatch" } as any);
      }
    }
  }

  // ---------- 7) First law: ΔU = Q − W ----------
  if (/\bfirst\s*law|Δu\s*=|delta\s*u\s*=|q\s*[-=]|w\s*[-=]/i.test(lower) && finalN != null) {
    // try to compute the missing one, with the final as that variable
    if (Q != null && W != null && /\b(Δu|delta\s*u)\b/i.test(lower)) {
      const dUcalc = Q - W;
      const ok = relClose(dUcalc, finalN, 1e-5, 1e-6) || approxEqual(dUcalc, finalN, 1e-3);
      checks.push({ value: `ΔU=${finalN}`, ok, lhs: dUcalc, rhs: finalN, reason: ok ? null : "ΔU = Q - W mismatch" } as any);
    } else if (W != null && /\bq\b/.test(lower) && /\b=\s*$/i.test(lower) === false && finalN != null && /\bq\s*=/.test(lower) === false) {
      // if they want Q and gave ΔU, W: Q = ΔU + W
      const dU = findNumber(lower, new RegExp(`\\b(?:Δu|delta\\s*u)\\s*=\\s*${NUM}`, "i"));
      if (dU != null) {
        const Qcalc = dU + W;
        const ok = relClose(Qcalc, finalN, 1e-5, 1e-6) || approxEqual(Qcalc, finalN, 1e-3);
        checks.push({ value: `Q=${finalN}`, ok, lhs: Qcalc, rhs: finalN, reason: ok ? null : "Q = ΔU + W mismatch" } as any);
      }
    } else if (Q != null && /\bw\b/.test(lower)) {
      const dU = findNumber(lower, new RegExp(`\\b(?:Δu|delta\\s*u)\\s*=\\s*${NUM}`, "i"));
      if (dU != null) {
        const Wcalc = Q - dU;
        const ok = relClose(Wcalc, finalN, 1e-5, 1e-6) || approxEqual(Wcalc, finalN, 1e-3);
        checks.push({ value: `W=${finalN}`, ok, lhs: Wcalc, rhs: finalN, reason: ok ? null : "W = Q - ΔU mismatch" } as any);
      }
    }
  }

  // ---------- verdict ----------
  if (!checks.length) return null;
  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "thermo", method: "thermo-basic", allVerified, checks } as unknown as Verification;
}
