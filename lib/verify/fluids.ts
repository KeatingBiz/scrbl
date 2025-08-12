// lib/verify/fluids.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import { gatherProblemText, parseNumber, approxEqual, relClose } from "./utils";

type Val = { value: number; unit?: string };

const NUM = "(-?\\d*\\.?\\d+(?:e[+-]?\\d+)?)";
const gDefault = 9.81;

/* ---------------- Unit helpers ---------------- */

function toPa(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u) return x.value;
  if (/\bpa\b/.test(u)) return x.value;
  if (/\bkpa\b/.test(u)) return x.value * 1e3;
  if (/\bmpa\b/.test(u)) return x.value * 1e6;
  if (/\batm\b/.test(u)) return x.value * 101325;
  if (/\bbar\b/.test(u)) return x.value * 1e5;
  return x.value; // fallback: assume Pa
}
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
  if (!u || /\bm\^?2\b/.test(u)) return x.value;
  if (/\bcm\^?2\b/.test(u)) return x.value / 1e4;
  if (/\bmm\^?2\b/.test(u)) return x.value / 1e6;
  return x.value;
}
function toVelocity(x: Val | null): number | null {
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /\bm\/s\b/.test(u)) return x.value;
  if (/\bcm\/s\b/.test(u)) return x.value / 100;
  if (/\bmm\/s\b/.test(u)) return x.value / 1000;
  if (/\bft\/s\b/.test(u)) return x.value * 0.3048;
  return x.value;
}
function toFlowQ(x: Val | null): number | null {
  // Return m^3/s
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /\bm\^?3\/s\b/.test(u)) return x.value;
  if (/\bl\/s\b/.test(u)) return x.value * 1e-3;
  if (/\bl\/min\b/.test(u)) return (x.value * 1e-3) / 60;
  if (/\bgpm\b/.test(u)) return (x.value * 3.78541e-3) / 60; // US gpm
  return x.value;
}
function toDensity(x: Val | null): number | null {
  // Return kg/m^3
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /\bkg\/m\^?3\b/.test(u)) return x.value;
  if (/\bg\/cm\^?3\b/.test(u)) return x.value * 1000;
  return x.value;
}
function toDynViscosity(x: Val | null): number | null {
  // Return Pa·s (μ)
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /pa·?s/.test(u)) return x.value;
  if (/\bcp\b/.test(u)) return x.value * 1e-3; // 1 cP = 1e-3 Pa·s
  return x.value;
}
function toKinViscosity(x: Val | null): number | null {
  // Return m^2/s (ν)
  if (!x) return null;
  const u = (x.unit || "").toLowerCase();
  if (!u || /\bm\^?2\/s\b/.test(u)) return x.value;
  if (/\bcst\b/.test(u)) return x.value * 1e-6; // 1 cSt = 1e-6 m^2/s
  return x.value;
}

/* ---------------- Parsing helpers ---------------- */

function findValWithUnit(text: string, label: RegExp, unitHints: RegExp[]): Val | null {
  const m = text.match(label);
  if (!m || !m[1]) return null;
  const value = parseNumber(m[1]);
  if (value == null) return null;
  const start = m.index ?? 0;
  const window = text.slice(start, Math.min(text.length, start + 40));
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

function areaFromD(d: number | null): number | null {
  if (d == null) return null;
  return Math.PI * (d * d) / 4;
}

/* ---------------- Main verifier ---------------- */

export function verifyFluids(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.replace(/[–—−]/g, "-");
  const lower = text.toLowerCase();
  const finalS = String(result.final ?? "");
  const finalN = parseNumber(finalS);

  const looksFluids =
    /\b(hydrostatic|bernoulli|continuity|flow\s*rate|reynolds|darcy|head\s*loss|torricelli|buoyancy|archimedes|pressure\s*drop|manometer)\b/.test(lower) ||
    /\bP1\b|\bP2\b|\bQ\s*=\b|\bA1\b|\bA2\b|\bv1\b|\bv2\b|\bρ\b|\brho\b/i.test(text);
  if (!looksFluids) return null;

  const checks: Verification["checks"] = [];

  /* ---------- Common inputs ---------- */
  const gVal = findNumber(lower, new RegExp(`\\bg\\s*=\\s*${NUM}`, "i")) ?? gDefault;

  // Pressures
  const P1 = toPa(findValWithUnit(text, new RegExp(`\\bP1\\s*=\\s*${NUM}`, "i"), [/pa\b/i, /kpa\b/i, /mpa\b/i, /atm\b/i, /bar\b/i]));
  const P2 = toPa(findValWithUnit(text, new RegExp(`\\bP2\\s*=\\s*${NUM}`, "i"), [/pa\b/i, /kpa\b/i, /mpa\b/i, /atm\b/i, /bar\b/i]));
  const P = toPa(findValWithUnit(text, new RegExp(`\\bP\\s*=\\s*${NUM}`, "i"), [/pa\b/i, /kpa\b/i, /mpa\b/i, /atm\b/i, /bar\b/i]));

  // Densities & viscosities
  const rho = toDensity(findValWithUnit(text, new RegExp(`\\b(?:ρ|rho)\\s*=\\s*${NUM}`, "i"), [/kg\/m\^?3\b/i, /g\/cm\^?3\b/i]));
  const mu = toDynViscosity(findValWithUnit(text, new RegExp(`\\b(?:μ|mu)\\s*=\\s*${NUM}`, "i"), [/pa·?s\b/i, /\bcp\b/i]));
  const nu = toKinViscosity(findValWithUnit(text, new RegExp(`\\b(?:ν|nu)\\s*=\\s*${NUM}`, "i"), [/m\^?2\/s\b/i, /\bcst\b/i]));

  // Geometry / speeds / flows
  const D1 = toMeters(findValWithUnit(text, new RegExp(`\\bD1\\s*=\\s*${NUM}`, "i"), [/m\b/i, /cm\b/i, /mm\b/i, /ft\b/i]));
  const D2 = toMeters(findValWithUnit(text, new RegExp(`\\bD2\\s*=\\s*${NUM}`, "i"), [/m\b/i, /cm\b/i, /mm\b/i, /ft\b/i]));
  const A1 = toAreaM2(findValWithUnit(text, new RegExp(`\\bA1\\s*=\\s*${NUM}`, "i"), [/m\^?2\b/i, /cm\^?2\b/i, /mm\^?2\b/i]));
  const A2 = toAreaM2(findValWithUnit(text, new RegExp(`\\bA2\\s*=\\s*${NUM}`, "i"), [/m\^?2\b/i, /cm\^?2\b/i, /mm\^?2\b/i]));
  const v1 = toVelocity(findValWithUnit(text, new RegExp(`\\bv1\\s*=\\s*${NUM}`, "i"), [/m\/s\b/i, /cm\/s\b/i, /mm\/s\b/i, /ft\/s\b/i]));
  const v2 = toVelocity(findValWithUnit(text, new RegExp(`\\bv2\\s*=\\s*${NUM}`, "i"), [/m\/s\b/i, /cm\/s\b/i, /mm\/s\b/i, /ft\/s\b/i]));
  const Q = toFlowQ(findValWithUnit(text, new RegExp(`\\bQ\\s*=\\s*${NUM}`, "i"), [/m\^?3\/s\b/i, /l\/s\b/i, /l\/min\b/i, /\bgpm\b/i]));

  const z1 = toMeters(findValWithUnit(text, new RegExp(`\\bz1\\s*=\\s*${NUM}`, "i"), [/m\b/i, /ft\b/i]));
  const z2 = toMeters(findValWithUnit(text, new RegExp(`\\bz2\\s*=\\s*${NUM}`, "i"), [/m\b/i, /ft\b/i]));
  const h = toMeters(findValWithUnit(text, new RegExp(`\\bh\\s*=\\s*${NUM}`, "i"), [/m\b/i, /cm\b/i, /mm\b/i, /ft\b/i])) ??
            toMeters(findValWithUnit(text, new RegExp(`\\bdepth\\s*=\\s*${NUM}`, "i"), [/m\b/i, /cm\b/i, /mm\b/i, /ft\b/i]));

  /* ---------- 1) Hydrostatics: P = ρ g h (or ΔP) ---------- */
  if (/\bhydrostatic|manometer|depth\b/i.test(lower) && rho != null && h != null && finalN != null) {
    const dP = rho * gVal * h;
    const ok = relClose(dP, finalN, 1e-5, 1e-6) || approxEqual(dP, finalN, 1e-3);
    checks.push({ value: `ΔP=${finalN}`, ok, lhs: dP, rhs: finalN, reason: ok ? null : "ΔP=ρgh mismatch" } as any);
  }

  /* ---------- 2) Continuity: A1 v1 = A2 v2 ; Q = A v ---------- */
  if (/\bcontinuity\b|\\bq\s*=|flow\s*rate/i.test(lower)) {
    const A1u = A1 ?? areaFromD(D1 ?? null);
    const A2u = A2 ?? areaFromD(D2 ?? null);

    if (A1u != null && v1 != null && finalN != null && /\bq\b|flow\s*rate/i.test(lower)) {
      const q = A1u * v1;
      const ok = relClose(q, finalN, 1e-5, 1e-6) || approxEqual(q, finalN, 1e-5);
      checks.push({ value: `Q=${finalN}`, ok, lhs: q, rhs: finalN, reason: ok ? null : "Q=Av mismatch (sec 1)" } as any);
    } else if (A2u != null && v2 != null && finalN != null && /\bq\b|flow\s*rate/i.test(lower)) {
      const q = A2u * v2;
      const ok = relClose(q, finalN, 1e-5, 1e-6) || approxEqual(q, finalN, 1e-5);
      checks.push({ value: `Q=${finalN}`, ok, lhs: q, rhs: finalN, reason: ok ? null : "Q=Av mismatch (sec 2)" } as any);
    }

    if (A1u != null && v1 != null && A2u != null && finalN != null && /\bv2\b/.test(lower)) {
      const v2calc = (A1u * v1) / A2u;
      const ok = relClose(v2calc, finalN, 1e-5, 1e-6) || approxEqual(v2calc, finalN, 1e-5);
      checks.push({ value: `v2=${finalN}`, ok, lhs: v2calc, rhs: finalN, reason: ok ? null : "continuity v2 mismatch" } as any);
    }
    if (A1u != null && v2 != null && A2u != null && finalN != null && /\bv1\b/.test(lower)) {
      const v1calc = (A2u * v2) / A1u;
      const ok = relClose(v1calc, finalN, 1e-5, 1e-6) || approxEqual(v1calc, finalN, 1e-5);
      checks.push({ value: `v1=${finalN}`, ok, lhs: v1calc, rhs: finalN, reason: ok ? null : "continuity v1 mismatch" } as any);
    }
    if (Q != null && A1u != null && finalN != null && /\bv1\b/.test(lower)) {
      const v1calc = Q / A1u;
      const ok = relClose(v1calc, finalN, 1e-5, 1e-6) || approxEqual(v1calc, finalN, 1e-5);
      checks.push({ value: `v1=${finalN}`, ok, lhs: v1calc, rhs: finalN, reason: ok ? null : "v=Q/A mismatch (v1)" } as any);
    }
    if (Q != null && A2u != null && finalN != null && /\bv2\b/.test(lower)) {
      const v2calc = Q / A2u;
      const ok = relClose(v2calc, finalN, 1e-5, 1e-6) || approxEqual(v2calc, finalN, 1e-5);
      checks.push({ value: `v2=${finalN}`, ok, lhs: v2calc, rhs: finalN, reason: ok ? null : "v=Q/A mismatch (v2)" } as any);
    }
  }

  /* ---------- 3) Bernoulli between sections 1 and 2 ---------- */
  if (/\bbernoulli\b/i.test(lower) && rho != null && finalN != null) {
    const z1u = z1 ?? 0, z2u = z2 ?? 0;
    const v1u = v1 ?? 0, v2u = v2 ?? null;
    const P1u = P1 ?? P ?? null;

    // Total head at 1
    if (P1u != null) {
      const H1 = (P1u / rho) + gVal * z1u + 0.5 * v1u * v1u;
      // Solve for unknown P2 or v2 or z2
      if (z2u != null) {
        if (v2u != null && P2 == null && /\bp2\b/.test(lower)) {
          const P2calc = rho * (H1 - gVal * z2u - 0.5 * v2u * v2u);
          const ok = relClose(P2calc, finalN, 1e-4, 1e-6) || approxEqual(P2calc, finalN, 1e-3);
          checks.push({ value: `P2=${finalN}`, ok, lhs: P2calc, rhs: finalN, reason: ok ? null : "Bernoulli P2 mismatch" } as any);
        }
        if (P2 != null && v2u == null && /\bv2\b/.test(lower)) {
          const inside = (H1 - (P2 / rho) - gVal * z2u) * 2;
          const v2calc = inside > 0 ? Math.sqrt(inside) : 0;
          const ok = relClose(v2calc, finalN, 1e-4, 1e-6) || approxEqual(v2calc, finalN, 1e-3);
          checks.push({ value: `v2=${finalN}`, ok, lhs: v2calc, rhs: finalN, reason: ok ? null : "Bernoulli v2 mismatch" } as any);
        }
        if (P2 != null && v2u != null && z2 == null && /\bz2\b/.test(lower)) {
          const z2calc = (H1 - (P2 / rho) - 0.5 * v2u * v2u) / gVal;
          const ok = relClose(z2calc, finalN, 1e-4, 1e-6) || approxEqual(z2calc, finalN, 1e-3);
          checks.push({ value: `z2=${finalN}`, ok, lhs: z2calc, rhs: finalN, reason: ok ? null : "Bernoulli z2 mismatch" } as any);
        }
      }
    }
  }

  /* ---------- 4) Torricelli: v = sqrt(2 g h) ---------- */
  if (/\btorricelli\b|orifice|tank\b/i.test(lower) && h != null && finalN != null) {
    const v = Math.sqrt(Math.max(0, 2 * gVal * h));
    const ok = relClose(v, finalN, 1e-5, 1e-6) || approxEqual(v, finalN, 1e-4);
    checks.push({ value: `v=${finalN}`, ok, lhs: v, rhs: finalN, reason: ok ? null : "Torricelli mismatch" } as any);
  }

  /* ---------- 5) Reynolds number ---------- */
  if (/\breynolds\b|\bre\b/i.test(lower) && finalN != null) {
    const D = D1 ?? D2 ?? toMeters(findValWithUnit(text, new RegExp(`\\bD\\s*=\\s*${NUM}`, "i"), [/m\b/i, /cm\b/i, /mm\b/i, /ft\b/i]));
    const vU = v1 ?? v2 ?? toVelocity(findValWithUnit(text, new RegExp(`\\bv\\s*=\\s*${NUM}`, "i"), [/m\/s\b/i, /cm\/s\b/i, /mm\/s\b/i, /ft\/s\b/i]));
    let Re: number | null = null;
    if (D != null && vU != null) {
      if (nu != null) Re = (vU * D) / nu;
      else if (rho != null && mu != null) Re = (rho * vU * D) / mu;
    }
    if (Re != null) {
      const ok = relClose(Re, finalN, 1e-5, 1e-6) || approxEqual(Re, finalN, 1e-3);
      checks.push({ value: `Re=${finalN}`, ok, lhs: Re, rhs: finalN, reason: ok ? null : "Reynolds mismatch" } as any);
    }
  }

  /* ---------- 6) Darcy head loss & ΔP ---------- */
  if (/\bdarcy\b|head\s*loss|h_f\b/i.test(lower) && finalN != null) {
    const f = findNumber(lower, new RegExp(`\\bf\\s*=\\s*${NUM}`, "i"));
    const L = toMeters(findValWithUnit(text, new RegExp(`\\bL\\s*=\\s*${NUM}`, "i"), [/m\b/i, /ft\b/i]));
    const D = D1 ?? D2 ?? toMeters(findValWithUnit(text, new RegExp(`\\bD\\s*=\\s*${NUM}`, "i"), [/m\b/i, /cm\b/i, /mm\b/i, /ft\b/i]));
    const vU = v1 ?? v2 ?? toVelocity(findValWithUnit(text, new RegExp(`\\bv\\s*=\\s*${NUM}`, "i"), [/m\/s\b/i, /cm\/s\b/i, /mm\/s\b/i, /ft\/s\b/i]));
    if (f != null && L != null && D != null && vU != null) {
      const hf = f * (L / D) * (vU * vU) / (2 * gVal);
      if (/\bh_f\b|head\s*loss/i.test(lower)) {
        const ok = relClose(hf, finalN, 1e-5, 1e-6) || approxEqual(hf, finalN, 1e-4);
        checks.push({ value: `h_f=${finalN}`, ok, lhs: hf, rhs: finalN, reason: ok ? null : "Darcy h_f mismatch" } as any);
      } else if (rho != null) {
        const dP = rho * gVal * hf;
        const ok = relClose(dP, finalN, 1e-4, 1e-6) || approxEqual(dP, finalN, 1e-3);
        checks.push({ value: `ΔP=${finalN}`, ok, lhs: dP, rhs: finalN, reason: ok ? null : "ΔP = ρ g h_f mismatch" } as any);
      }
    }
  }

  /* ---------- 7) Buoyancy ---------- */
  if (/\bbuoyanc|archimedes\b/i.test(lower) && finalN != null) {
    const rfluid = toDensity(findValWithUnit(text, new RegExp(`\\b(?:ρ_f|rho_f|rho\\s*fluid|fluid\\s*density)\\s*=\\s*${NUM}`, "i"), [/kg\/m\^?3\b/i, /g\/cm\^?3\b/i])) ?? rho;
    const Vdisp = toFlowQ(findValWithUnit(text, new RegExp(`\\bV\\s*=\\s*${NUM}`, "i"), [/m\^?3\b/i, /l\b/i])) // if V mislabeled with volume units; fallback
                  ?? (findNumber(lower, new RegExp(`\\bV\\s*=\\s*${NUM}`, "i"))); // as plain number if unit omitted
    if (rfluid != null && Vdisp != null) {
      const Fb = rfluid * gVal * (typeof Vdisp === "number" ? Vdisp : Number(Vdisp));
      const ok = relClose(Fb, finalN, 1e-4, 1e-6) || approxEqual(Fb, finalN, 1e-3);
      checks.push({ value: `F_b=${finalN}`, ok, lhs: Fb, rhs: finalN, reason: ok ? null : "Buoyancy mismatch" } as any);
    }
  }

  /* ---------- Verdict ---------- */
  if (!checks.length) return null;
  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "fluids", method: "fluids-basics", allVerified, checks } as unknown as Verification;
}
