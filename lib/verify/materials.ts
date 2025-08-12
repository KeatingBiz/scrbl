// lib/verify/materials.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import {
  gatherProblemText,
  parseNumber,
  parsePercentOrNumber,
  approxEqual,
  relClose,
} from "./utils";

const NUM = "(-?\\d*\\.?\\d+(?:e[+-]?\\d+)?)";

function findNum(text: string, ...labels: RegExp[]): number | null {
  for (const lab of labels) {
    const m = text.match(lab);
    if (m && m[1] != null) {
      const n = parseNumber(m[1]);
      if (n != null) return n;
    }
  }
  return null;
}
function findPct(text: string, ...labels: RegExp[]): number | null {
  for (const lab of labels) {
    const m = text.match(lab);
    if (m && m[1] != null) {
      const n = parsePercentOrNumber(m[1]);
      if (n != null) return n;
    }
  }
  return null;
}

// Shape helpers for bending/torsion
function rectI(b: number, h: number) { return (b * Math.pow(h, 3)) / 12; }
function circI(d: number) { return (Math.PI * Math.pow(d, 4)) / 64; }
function circJ_solid(d: number) { return (Math.PI * Math.pow(d, 4)) / 32; }

export function verifyMaterials(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.toLowerCase();
  const finalS = String(result.final ?? "");
  const finalN = parseNumber(finalS);
  const finalPct = parsePercentOrNumber(finalS);

  const looksMoM =
    /\b(stress|strain|young|modulus|elastic\s*modulus|poisson|bending|moment\s*of\s*inertia|torsion|shear\s*stress|angle\s*of\s*twist|deflection|elongation|thermal\s*(expansion|stress)|axial)\b/.test(
      text
    );
  if (!looksMoM) return null;

  const checks: Verification["checks"] = [];

  /* ========================= 1) Basic σ, ε, Hooke ========================= */
  // Inputs
  const F = findNum(text, new RegExp(`\\bF\\s*=\\s*${NUM}`, "i"));
  const A = findNum(text, new RegExp(`\\bA\\s*=\\s*${NUM}`, "i"));
  const L = findNum(text, new RegExp(`\\bL\\s*=\\s*${NUM}`, "i"));
  const dL = findNum(text, new RegExp(`\\b(?:ΔL|dL|elongation|deflection)\\s*=\\s*${NUM}`, "i"));
  const sigma = findNum(text, new RegExp(`\\b(?:σ|sigma)\\s*=\\s*${NUM}`, "i"));
  const eps = findPct(text, new RegExp(`\\b(?:ε|epsilon)\\s*=\\s*${NUM}%?`, "i")) ??
              findPct(text, new RegExp(`\\bstrain\\s*=\\s*${NUM}%?`, "i"));
  const E = findNum(text, new RegExp(`\\bE\\s*=\\s*${NUM}`, "i")) ??
            findNum(text, new RegExp(`\\bYoung'?s?\\s*modulus\\s*=\\s*${NUM}`, "i"));

  // σ = F/A
  if (F != null && A != null && finalN != null && /\bstress\b|σ|sigma/.test(text)) {
    const calc = F / A;
    const ok = relClose(calc, finalN, 1e-6, 1e-6) || approxEqual(calc, finalN, 1e-6);
    checks.push({ value: `σ=${finalN}`, ok, lhs: calc, rhs: finalN, reason: ok ? null : "σ=F/A mismatch" } as any);
  }

  // ε = ΔL / L
  if (dL != null && L != null && (finalPct != null || finalN != null) && /\bstrain\b|ε|epsilon/.test(text)) {
    const calc = dL / L;
    const target = finalPct ?? finalN!;
    const ok = relClose(calc, target, 1e-6, 1e-6) || approxEqual(calc, target, 1e-6);
    checks.push({ value: `ε=${target}`, ok, lhs: calc, rhs: target, reason: ok ? null : "ε=ΔL/L mismatch" } as any);
  }

  // Hooke: E = σ / ε  OR σ = E ε  OR ε = σ / E
  if (E != null && (sigma != null || eps != null) && (finalN != null || finalPct != null)) {
    if (sigma != null && finalPct != null && /\bstrain\b|ε|epsilon/.test(text)) {
      const calc = sigma / E;
      const ok = relClose(calc, finalPct, 1e-6, 1e-6) || approxEqual(calc, finalPct, 1e-6);
      checks.push({ value: `ε=${finalPct}`, ok, lhs: calc, rhs: finalPct, reason: ok ? null : "ε=σ/E mismatch" } as any);
    } else if (eps != null && finalN != null && /\bstress\b|σ|sigma/.test(text)) {
      const calc = E * eps;
      const ok = relClose(calc, finalN, 1e-6, 1e-6) || approxEqual(calc, finalN, 1e-6);
      checks.push({ value: `σ=${finalN}`, ok, lhs: calc, rhs: finalN, reason: ok ? null : "σ=Eε mismatch" } as any);
    } else if (sigma != null && eps != null && finalN != null && /\bmodulus|young/.test(text)) {
      const calc = sigma / eps;
      const ok = relClose(calc, finalN, 1e-6, 1e-6) || approxEqual(calc, finalN, 1e-6);
      checks.push({ value: `E=${finalN}`, ok, lhs: calc, rhs: finalN, reason: ok ? null : "E=σ/ε mismatch" } as any);
    }
  }

  /* ========================= 2) Axial deformation ΔL ========================= */
  if (F != null && L != null && A != null && E != null && finalN != null && /\b(ΔL|elongation|deflection)\b/i.test(text)) {
    const calc = (F * L) / (A * E);
    const ok = relClose(calc, finalN, 1e-6, 1e-6) || approxEqual(calc, finalN, 1e-6);
    checks.push({ value: `ΔL=${finalN}`, ok, lhs: calc, rhs: finalN, reason: ok ? null : "ΔL=FL/(AE) mismatch" } as any);
  }

  /* ========================= 3) Poisson’s ratio ========================= */
  const nu = findNum(text, new RegExp(`\\b(?:ν|nu|poisson'?s?\\s*ratio)\\s*=\\s*${NUM}`, "i"));
  const d0 = findNum(text, new RegExp(`\\b(?:d|diameter)\\s*=\\s*${NUM}`, "i"));
  if (nu != null && (eps != null || sigma != null && E != null)) {
    const epsL = eps ?? (sigma! / E!);
    // lateral strain
    const epsT = -nu * epsL;
    if ((/\blateral\s*strain\b/i.test(text) || /ε_t\b/i.test(text)) && (finalPct != null || finalN != null)) {
      const target = finalPct ?? finalN!;
      const ok = relClose(epsT, target, 1e-6, 1e-6) || approxEqual(epsT, target, 1e-6);
      checks.push({ value: `ε_t=${target}`, ok, lhs: epsT, rhs: target, reason: ok ? null : "ε_t = -ν ε_l mismatch" } as any);
    }
    // diameter change
    if (d0 != null && finalN != null && /\bdiameter\b|\bΔd\b/i.test(text)) {
      const dd = d0 * epsT;
      const ok = relClose(dd, finalN, 1e-6, 1e-6) || approxEqual(dd, finalN, 1e-6);
      checks.push({ value: `Δd=${finalN}`, ok, lhs: dd, rhs: finalN, reason: ok ? null : "Δd = d0 ε_t mismatch" } as any);
    }
  }

  /* ========================= 4) Thermal expansion / stress ========================= */
  const alpha = findNum(text, new RegExp(`\\b(?:alpha|α)\\s*=\\s*${NUM}`, "i")) ??
                findNum(text, new RegExp(`\\bcoefficient\\s*of\\s*thermal\\s*expansion\\s*=\\s*${NUM}`, "i"));
  const dT = findNum(text, new RegExp(`\\b(?:ΔT|dT|temperature\\s*change)\\s*=\\s*${NUM}`, "i"));
  if (alpha != null && L != null && dT != null && finalN != null && /\b(ΔL|elongation|thermal\s*expansion)\b/i.test(text)) {
    const calc = alpha * L * dT;
    const ok = relClose(calc, finalN, 1e-6, 1e-6) || approxEqual(calc, finalN, 1e-6);
    checks.push({ value: `ΔL=${finalN}`, ok, lhs: calc, rhs: finalN, reason: ok ? null : "ΔL = α L ΔT mismatch" } as any);
  }
  // Thermal stress if constrained: σ = E α ΔT
  if (alpha != null && dT != null && E != null && finalN != null && /\b(constrained|thermal\s*stress)\b/i.test(text)) {
    const calc = E * alpha * dT;
    const ok = relClose(calc, finalN, 1e-6, 1e-6) || approxEqual(calc, finalN, 1e-6);
    checks.push({ value: `σ_th=${finalN}`, ok, lhs: calc, rhs: finalN, reason: ok ? null : "σ = E α ΔT mismatch" } as any);
  }

  /* ========================= 5) Bending stress σ = M c / I ========================= */
  const M = findNum(text, new RegExp(`\\bM\\s*=\\s*${NUM}`, "i")) ??
            findNum(text, new RegExp(`\\bbending\\s*moment\\s*=\\s*${NUM}`, "i"));
  const I = findNum(text, new RegExp(`\\bI\\s*=\\s*${NUM}`, "i")) ??
            findNum(text, new RegExp(`\\bmoment\\s*of\\s*inertia\\s*=\\s*${NUM}`, "i"));
  const c = findNum(text, new RegExp(`\\bc\\s*=\\s*${NUM}`, "i")) ??
            findNum(text, new RegExp(`\\bdistance\\s*to\\s*outer\\s*fiber\\s*=\\s*${NUM}`, "i")) ??
            (findNum(text, new RegExp(`\\bh\\s*=\\s*${NUM}`, "i")) ? (findNum(text, new RegExp(`\\bh\\s*=\\s*${NUM}`, "i"))! / 2) : null);
  const bRect = findNum(text, new RegExp(`\\b(b|width)\\s*=\\s*${NUM}`, "i"));
  const hRect = findNum(text, new RegExp(`\\b(h|height)\\s*=\\s*${NUM}`, "i"));
  const dCirc = findNum(text, new RegExp(`\\b(d|diameter)\\s*=\\s*${NUM}`, "i"));

  if (M != null && finalN != null && /\bbending\b|\\bsigma\\b/.test(text)) {
    let Iuse = I ?? null;
    let cuse = c ?? null;

    // Infer I and c from shapes if not given
    if (Iuse == null && bRect != null && hRect != null) {
      Iuse = rectI(bRect, hRect);
      if (cuse == null) cuse = hRect / 2;
    } else if (Iuse == null && dCirc != null) {
      Iuse = circI(dCirc);
      if (cuse == null) cuse = dCirc / 2;
    }

    if (Iuse != null && cuse != null) {
      const sigmaB = (M * cuse) / Iuse;
      const ok = relClose(sigmaB, finalN, 1e-6, 1e-6) || approxEqual(sigmaB, finalN, 1e-6);
      checks.push({ value: `σ_b=${finalN}`, ok, lhs: sigmaB, rhs: finalN, reason: ok ? null : "σ = M c / I mismatch" } as any);
    }
  }

  /* ========================= 6) Torsion: τ = T r / J;  φ = T L / (J G) ========================= */
  const T = findNum(text, new RegExp(`\\bT\\s*=\\s*${NUM}`, "i")) ?? findNum(text, new RegExp(`\\btorque\\s*=\\s*${NUM}`, "i"));
  const r = findNum(text, new RegExp(`\\br\\s*=\\s*${NUM}`, "i"));
  const J = findNum(text, new RegExp(`\\bJ\\s*=\\s*${NUM}`, "i")) ?? findNum(text, new RegExp(`\\bpolar\\s*moment\\s*J\\s*=\\s*${NUM}`, "i"));
  const G = findNum(text, new RegExp(`\\bG\\s*=\\s*${NUM}`, "i")) ?? findNum(text, new RegExp(`\\bshear\\s*modulus\\s*=\\s*${NUM}`, "i"));

  // Shear stress in solid round if d given and J/r missing
  if (T != null && finalN != null && /\b(torsion|shear\s*stress|τ)\b/i.test(text)) {
    if ((J != null && r != null)) {
      const tau = (T * r) / J;
      const ok = relClose(tau, finalN, 1e-6, 1e-6) || approxEqual(tau, finalN, 1e-6);
      checks.push({ value: `τ=${finalN}`, ok, lhs: tau, rhs: finalN, reason: ok ? null : "τ = T r / J mismatch" } as any);
    } else if (dCirc != null) {
      // τ_max = 16 T / (π d^3)
      const tau = (16 * T) / (Math.PI * Math.pow(dCirc, 3));
      const ok = relClose(tau, finalN, 1e-6, 1e-6) || approxEqual(tau, finalN, 1e-6);
      checks.push({ value: `τ_max=${finalN}`, ok, lhs: tau, rhs: finalN, reason: ok ? null : "τ_max solid round mismatch" } as any);
    }
  }

  // Angle of twist
  if (T != null && L != null && G != null && finalN != null && /\bangle\s*of\s*twist|twist|φ\b/i.test(text)) {
    let Juse = J ?? null;
    if (Juse == null && dCirc != null) Juse = circJ_solid(dCirc);
    if (Juse != null) {
      const phi = (T * L) / (Juse * G); // radians
      const ok = relClose(phi, finalN, 1e-6, 1e-6) || approxEqual(phi, finalN, 1e-6);
      checks.push({ value: `φ=${finalN}`, ok, lhs: phi, rhs: finalN, reason: ok ? null : "φ = T L / (J G) mismatch" } as any);
    }
  }

  /* ========================= 7) Beam shear (rectangular) =========================
     τ_max ≈ (3/2) * V / (b h) for a rectangular cross-section
  ================================================================================ */
  const V = findNum(text, new RegExp(`\\bV\\s*=\\s*${NUM}`, "i")) ?? findNum(text, new RegExp(`\\bshear\\s*force\\s*=\\s*${NUM}`, "i"));
  if (/\bshear\s*stress\b|τ\b/i.test(text) && V != null && bRect != null && hRect != null && finalN != null) {
    const tauMax = (1.5 * V) / (bRect * hRect);
    const ok = relClose(tauMax, finalN, 1e-6, 1e-6) || approxEqual(tauMax, finalN, 1e-6);
    checks.push({ value: `τ_max=${finalN}`, ok, lhs: tauMax, rhs: finalN, reason: ok ? null : "τ_max ≈ 1.5 V/(b h) mismatch" } as any);
  }

  /* ========================= verdict ========================= */
  if (!checks.length) return null;
  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "materials", method: "materials-mechanics", allVerified, checks } as unknown as Verification;
}
