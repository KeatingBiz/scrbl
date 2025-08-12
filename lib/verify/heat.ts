// lib/verify/heat.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import { gatherProblemText, parseNumber, approxEqual, relClose } from "./utils";

const NUM = "(-?\\d*\\.?\\d+(?:e[+-]?\\d+)?)";
const SIGMA = 5.670374419e-8; // W/m^2/K^4

type Val = { value: number; unit?: string };

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

/* ---------------- unit converters ---------------- */
function toMeters(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /\bm\b(?!m)/.test(u)) return x.value;
  if (/\bcm\b/.test(u)) return x.value / 100;
  if (/\bmm\b/.test(u)) return x.value / 1000;
  if (/\bft\b/.test(u)) return x.value * 0.3048;
  return x.value;
}
function toAreaM2(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /m\^?2\b/.test(u)) return x.value;
  if (/cm\^?2\b/.test(u)) return x.value / 1e4;
  if (/mm\^?2\b/.test(u)) return x.value / 1e6;
  if (/ft\^?2\b/.test(u)) return x.value * 0.09290304;
  return x.value;
}
function toWatts(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /\bw\b(?!h)/.test(u)) return x.value;
  if (/\bkw\b/.test(u)) return x.value * 1e3;
  return x.value;
}
function toWPerM_K(x: Val | null): number | null {
  // thermal conductivity k
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /(w\/m·?k)/.test(u)) return x.value;
  return x.value; // assume W/mK if omitted
}
function toWPerM2_K(x: Val | null): number | null {
  // convection coefficient h
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /(w\/m\^?2·?k)/.test(u)) return x.value;
  return x.value; // assume W/m^2K
}
function toKelvin(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (/k\b/.test(u)) return x.value;
  if (/°c|degc|c\b/.test(u)) return x.value + 273.15;
  if (/°f|degf|f\b/.test(u)) return (x.value - 32) * (5 / 9) + 273.15;
  return x.value; // assume K if omitted
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

/* ---------------- geometry helpers ---------------- */
function areaFromD(d: number | null): number | null {
  return d == null ? null : Math.PI * (d * d) / 4;
}

/* ---------------- main ---------------- */
export function verifyHeat(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.replace(/[–—−]/g, "-");
  const lower = text.toLowerCase();
  const finalS = String(result.final ?? "");
  const finalN = parseNumber(finalS);

  const looksHeat = /\b(conduction|convection|radiation|stefan|emissivity|thermal\s*resistance|composite\s*wall|cylindrical|pipe|fin|fins|heat\s*rate|heat\s*flux|q\s*=)\b/.test(lower);
  if (!looksHeat) return null;

  const checks: Verification["checks"] = [];

  /* ===== Common parsed inputs ===== */
  // temperatures
  const T1 = toKelvin(findValWithUnit(text, new RegExp(`\\bT1\\s*=\\s*${NUM}`, "i"), [/k\b/i, /°c|degc|c\b/i, /°f|degf|f\b/i]));
  const T2 = toKelvin(findValWithUnit(text, new RegExp(`\\bT2\\s*=\\s*${NUM}`, "i"), [/k\b/i, /°c|degc|c\b/i, /°f|degf|f\b/i]));
  const Ts = toKelvin(findValWithUnit(text, new RegExp(`\\bT[sS]\\s*=\\s*${NUM}`, "i"), [/k\b/i, /°c|degc|c\b/i, /°f|degf|f\b/i])); // surface temp
  const Tinf = toKelvin(findValWithUnit(text, new RegExp(`\\bT(?:_?inf|∞)\\s*=\\s*${NUM}`, "i"), [/k\b/i, /°c|degc|c\b/i, /°f|degf|f\b/i]));
  const Tsur = toKelvin(findValWithUnit(text, new RegExp(`\\bT(?:_?sur|surroundings?)\\s*=\\s*${NUM}`, "i"), [/k\b/i, /°c|degc|c\b/i, /°f|degf|f\b/i]));
  const dT = deltaTempToK(findValWithUnit(text, new RegExp(`\\b(?:ΔT|dT)\\s*=\\s*${NUM}`, "i"), [/k\b/i, /°c\b/i, /°f\b/i]));

  // areas & lengths
  const A = toAreaM2(findValWithUnit(text, new RegExp(`\\bA\\s*=\\s*${NUM}`, "i"), [/m\^?2\b/i, /cm\^?2\b/i, /mm\^?2\b/i, /ft\^?2\b/i]));
  const L = toMeters(findValWithUnit(text, new RegExp(`\\bL\\s*=\\s*${NUM}`, "i"), [/m\b/i, /cm\b/i, /mm\b/i, /ft\b/i]));
  const t = toMeters(findValWithUnit(text, new RegExp(`\\bt\\s*=\\s*${NUM}`, "i"), [/m\b/i, /cm\b/i, /mm\b/i])); // thickness
  const D1 = toMeters(findValWithUnit(text, new RegExp(`\\bD1\\s*=\\s*${NUM}`, "i"), [/m\b/i, /cm\b/i, /mm\b/i, /ft\b/i]));
  const D2 = toMeters(findValWithUnit(text, new RegExp(`\\bD2\\s*=\\s*${NUM}`, "i"), [/m\b/i, /cm\b/i, /mm\b/i, /ft\b/i]));
  const r1 = toMeters(findValWithUnit(text, new RegExp(`\\br1\\s*=\\s*${NUM}`, "i"), [/m\b/i, /cm\b/i, /mm\b/i]));
  const r2 = toMeters(findValWithUnit(text, new RegExp(`\\br2\\s*=\\s*${NUM}`, "i"), [/m\b/i, /cm\b/i, /mm\b/i]));

  // properties
  const k  = toWPerM_K(findValWithUnit(text, new RegExp(`\\bk\\s*=\\s*${NUM}`, "i"), [/w\/m·?k\b/i]));
  const h  = toWPerM2_K(findValWithUnit(text, new RegExp(`\\bh\\s*=\\s*${NUM}`, "i"), [/w\/m\^?2·?k\b/i]));
  const hi = toWPerM2_K(findValWithUnit(text, new RegExp(`\\bh[iI]\\s*=\\s*${NUM}`, "i"), [/w\/m\^?2·?k\b/i]));
  const ho = toWPerM2_K(findValWithUnit(text, new RegExp(`\\bh[oO]\\s*=\\s*${NUM}`, "i"), [/w\/m\^?2·?k\b/i]));
  const eps = findNumber(lower, new RegExp(`\\b(?:ε|emissivity)\\s*=\\s*${NUM}`, "i"));
  const Q = toWatts(findValWithUnit(text, new RegExp(`\\bQ\\s*=\\s*${NUM}`, "i"), [/w\b/i, /kw\b/i]));

  /* ===== 1) Conduction (planar): q = k A ΔT / L ===== */
  if (/\bconduction\b|q\s*=\s*k\s*a\s*\*/i.test(lower) || /\bwall\b|slab|plate/i.test(lower)) {
    const Ause = A ?? areaFromD(D1 ?? null);
    const Luse = L ?? t ?? null;
    const dTuse = dT ?? ((T1 != null && T2 != null) ? Math.abs(T1 - T2) : null);

    if (k != null && Ause != null && Luse != null && dTuse != null && finalN != null) {
      const q = (k * Ause * dTuse) / Luse;
      const ok = relClose(q, finalN, 1e-5, 1e-6) || approxEqual(q, finalN, 1e-3);
      checks.push({ value: `q=${finalN}`, ok, lhs: q, rhs: finalN, reason: ok ? null : "q = kAΔT/L mismatch" } as any);
    }
  }

  /* ===== 2) Composite wall (series R): conv + cond(+cond...) + conv ===== */
  if (/composite\s*wall|thermal\s*resistance|series/i.test(lower) && finalN != null) {
    const Ai = A ?? areaFromD(D1 ?? null);
    if (Ai != null) {
      // gather multiple layers L1,k1 ; L2,k2 ; L3,k3...
      const Ls = Array.from(text.matchAll(new RegExp(`\\bL(\\d+)\\s*=\\s*${NUM}`, "gi")));
      const ks = Array.from(text.matchAll(new RegExp(`\\bk(\\d+)\\s*=\\s*${NUM}`, "gi")));
      const Lmap: Record<string, number> = {};
      const kmap: Record<string, number> = {};
      for (const m of Ls) Lmap[m[1]] = toMeters({ value: parseFloat(m[2]) })!;
      for (const m of ks) kmap[m[1]] = toWPerM_K({ value: parseFloat(m[2]) })!;
      let Rcond = 0;
      const idxs = new Set([...Object.keys(Lmap), ...Object.keys(kmap)]);
      for (const i of idxs) {
        const L_i = Lmap[i], k_i = kmap[i];
        if (Number.isFinite(L_i) && Number.isFinite(k_i) && k_i > 0) Rcond += (L_i / (k_i * Ai));
      }
      // single layer fallback
      if (Rcond === 0 && k != null && (L ?? t) != null) {
        Rcond = ( (L ?? t)! ) / (k * Ai);
      }

      // convection terms
      const Rconv_i = hi != null && hi > 0 ? 1 / (hi * Ai) : 0;
      const Rconv_o = ho != null && ho > 0 ? 1 / (ho * Ai) : 0;
      const Rtot = Rconv_i + Rcond + Rconv_o;

      const Tin  = T1 ?? Ts ?? null;
      const Tout = T2 ?? Tinf ?? null;
      const dTuse = (Tin != null && Tout != null) ? Math.abs(Tin - Tout) : dT;

      if (Rtot > 0 && dTuse != null) {
        const q = dTuse / Rtot;
        const ok = relClose(q, finalN, 1e-5, 1e-6) || approxEqual(q, finalN, 1e-3);
        checks.push({ value: `q=${finalN}`, ok, lhs: q, rhs: finalN, reason: ok ? null : "q = ΔT / (ΣR) mismatch" } as any);
      }
    }
  }

  /* ===== 3) Cylindrical conduction: R = ln(r2/r1) / (2π k L) ===== */
  if (/\bcylindrical|pipe|cylinder\b/i.test(lower) && k != null && r1 != null && r2 != null && L != null && finalN != null) {
    if (r2 > r1 && r1 > 0 && L > 0) {
      const R = Math.log(r2 / r1) / (2 * Math.PI * k * L);
      const dTuse = dT ?? ((T1 != null && T2 != null) ? Math.abs(T1 - T2) : null);
      if (dTuse != null) {
        const q = dTuse / R;
        const ok = relClose(q, finalN, 1e-5, 1e-6) || approxEqual(q, finalN, 1e-3);
        checks.push({ value: `q=${finalN}`, ok, lhs: q, rhs: finalN, reason: ok ? null : "Cylindrical conduction mismatch" } as any);
      }
    }
  }

  /* ===== 4) Convection: q = h A (Ts - T∞) ===== */
  if (/\bconvection\b|h\s*=\s*/i.test(lower) && h != null && A != null && Ts != null && Tinf != null && finalN != null) {
    const q = h * A * (Ts - Tinf);
    const ok = relClose(q, finalN, 1e-5, 1e-6) || approxEqual(q, finalN, 1e-3);
    checks.push({ value: `q=${finalN}`, ok, lhs: q, rhs: finalN, reason: ok ? null : "q = hA(Ts - T∞) mismatch" } as any);
  }

  /* ===== 5) Radiation: q = ε σ A (Ts^4 - Tsur^4) ===== */
  if (/\bradiation|stefan|emissiv/i.test(lower) && A != null && Ts != null && Tsur != null && finalN != null) {
    const epsUse = (eps != null ? Math.max(0, Math.min(1, eps)) : 1); // default blackbody if missing
    const q = epsUse * SIGMA * A * (Math.pow(Ts, 4) - Math.pow(Tsur, 4));
    const ok = relClose(q, finalN, 1e-4, 1e-6) || approxEqual(q, finalN, 1e-2);
    checks.push({ value: `q=${finalN}`, ok, lhs: q, rhs: finalN, reason: ok ? null : "radiation mismatch" } as any);
  }

  /* ===== 6) Fin (straight, constant cross-section, adiabatic tip) =====
     m = sqrt(h P / (k A_c))
     q_f = sqrt(h P k A_c) (T_b - T_inf) * tanh(m L)
  */
  if (/\bfin[s]?\b/i.test(lower) && finalN != null) {
    const hUse = h ?? toWPerM2_K(findValWithUnit(text, new RegExp(`\\bh\\s*=\\s*${NUM}`, "i"), [/w\/m\^?2·?k\b/i]));
    const kUse = k;
    const Lf = L ?? toMeters(findValWithUnit(text, new RegExp(`\\bL_f\\s*=\\s*${NUM}`, "i"), [/m\b/i, /cm\b/i, /mm\b/i]));
    const P = toMeters(findValWithUnit(text, new RegExp(`\\bP\\s*=\\s*${NUM}`, "i"), [/m\b/i])) ?? null;     // perimeter (m)
    const Ac = toAreaM2(findValWithUnit(text, new RegExp(`\\bA_c\\s*=\\s*${NUM}`, "i"), [/m\^?2\b/i])) ?? null; // cross-sec area
    const Tb = Ts ?? toKelvin(findValWithUnit(text, new RegExp(`\\bT_b\\s*=\\s*${NUM}`, "i"), [/k\b/i, /°c|c\b/i, /°f|f\b/i]));
    const T∞ = Tinf;

    if (hUse != null && kUse != null && Lf != null && P != null && Ac != null && Tb != null && T∞ != null) {
      const m = Math.sqrt((hUse * P) / (kUse * Ac));
      const qf = Math.sqrt(hUse * P * kUse * Ac) * (Tb - T∞) * Math.tanh(m * Lf);
      const ok = relClose(qf, finalN, 1e-4, 1e-6) || approxEqual(qf, finalN, 1e-2);
      checks.push({ value: `q_fin=${finalN}`, ok, lhs: qf, rhs: finalN, reason: ok ? null : "fin heat rate mismatch" } as any);
    }
  }

  /* ===== 7) If R_total is given: q = ΔT / R_total ===== */
  if (/\br_total|r\\s*=\s*|thermal\s*resistance\b/i.test(lower) && finalN != null) {
    const Rtot = findNumber(lower, new RegExp(`\\bR(?:_?total)?\\s*=\\s*${NUM}`, "i"));
    if (Rtot != null) {
      const dTuse = dT ?? ((T1 != null && T2 != null) ? Math.abs(T1 - T2) : (Ts != null && Tinf != null ? Math.abs(Ts - Tinf) : null));
      if (dTuse != null) {
        const q = dTuse / Rtot;
        const ok = relClose(q, finalN, 1e-5, 1e-6) || approxEqual(q, finalN, 1e-3);
        checks.push({ value: `q=${finalN}`, ok, lhs: q, rhs: finalN, reason: ok ? null : "q = ΔT/R_total mismatch" } as any);
      }
    } else {
      // maybe they want R_total and gave q
      if (Q != null) {
        const dTuse = dT ?? ((T1 != null && T2 != null) ? Math.abs(T1 - T2) : null);
        if (dTuse != null) {
          const Rcalc = dTuse / Q;
          const ok = relClose(Rcalc, finalN, 1e-5, 1e-6) || approxEqual(Rcalc, finalN, 1e-4);
          checks.push({ value: `R_total=${finalN}`, ok, lhs: Rcalc, rhs: finalN, reason: ok ? null : "R_total mismatch" } as any);
        }
      }
    }
  }

  /* ===== verdict ===== */
  if (!checks.length) return null;
  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "heat", method: "heat-transfer", allVerified, checks } as unknown as Verification;
}
