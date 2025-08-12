// lib/verify/units.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import { gatherProblemText, parseNumber, approxEqual, relClose } from "./utils";

/* ========= dimension vector =========
   Base dims: M (mass), L (length), T (time), I (current), Th (temperature)
*/
type Dim = { M: number; L: number; T: number; I: number; Th: number };
type UnitInfo = { dim: Dim; factor: number }; // SI factor

const Z = (M=0,L=0,T=0,I=0,Th=0): Dim => ({M,L,T,I,Th});
const add = (a: Dim, b: Dim): Dim => ({ M:a.M+b.M, L:a.L+b.L, T:a.T+b.T, I:a.I+b.I, Th:a.Th+b.Th });
const mulDim = (a: Dim, k: number): Dim => ({ M:a.M*k, L:a.L*k, T:a.T*k, I:a.I*k, Th:a.Th*k });
const sameDim = (a: Dim, b: Dim): boolean =>
  a.M===b.M && a.L===b.L && a.T===b.T && a.I===b.I && a.Th===b.Th;

const ONE: UnitInfo = { dim: Z(), factor: 1 };

/* ========= unit tables ========= */
// base/derived SI
const U: Record<string, UnitInfo> = {
  // base
  kg: { dim: Z(1,0,0,0,0), factor: 1 },
  g:  { dim: Z(1,0,0,0,0), factor: 1e-3 },
  s:  { dim: Z(0,0,1,0,0), factor: 1 },
  min:{ dim: Z(0,0,1,0,0), factor: 60 },
  h:  { dim: Z(0,0,1,0,0), factor: 3600 },
  A:  { dim: Z(0,0,0,1,0), factor: 1 },
  K:  { dim: Z(0,0,0,0,1), factor: 1 },
  "°C":{ dim: Z(0,0,0,0,1), factor: 1 }, // NOTE: affine offset ignored; used only for dimensional checks
  "°F":{ dim: Z(0,0,0,0,1), factor: 5/9 }, // Δ°F → K; absolute needs care (we flag if used with T^4)
  m:  { dim: Z(0,1,0,0,0), factor: 1 },
  cm: { dim: Z(0,1,0,0,0), factor: 1e-2 },
  mm: { dim: Z(0,1,0,0,0), factor: 1e-3 },
  km: { dim: Z(0,1,0,0,0), factor: 1e3 },
  L:  { dim: Z(0,3,0,0,0), factor: 1e-3 }, // 1 L = 1e-3 m^3

  // imperial common
  in: { dim: Z(0,1,0,0,0), factor: 0.0254 },
  ft: { dim: Z(0,1,0,0,0), factor: 0.3048 },
  yd: { dim: Z(0,1,0,0,0), factor: 0.9144 },
  mi: { dim: Z(0,1,0,0,0), factor: 1609.344 },
  lb: { dim: Z(1,0,0,0,0), factor: 0.45359237 },   // pound-mass
  slug:{ dim: Z(1,0,0,0,0), factor: 14.59390294 },

  // derived mech/thermo
  N:  { dim: Z(1,1,-2,0,0), factor: 1 },                 // kg·m/s^2
  Pa: { dim: Z(1,-1,-2,0,0), factor: 1 },                // N/m^2
  bar:{ dim: Z(1,-1,-2,0,0), factor: 1e5 },
  atm:{ dim: Z(1,-1,-2,0,0), factor: 101325 },
  psi:{ dim: Z(1,-1,-2,0,0), factor: 6894.757293168 },   // N/m^2
  J:  { dim: Z(1,2,-2,0,0), factor: 1 },                 // N·m
  W:  { dim: Z(1,2,-3,0,0), factor: 1 },                 // J/s
  Hz: { dim: Z(0,0,-1,0,0), factor: 1 },                 // 1/s

  // electromagnetics
  C:  { dim: Z(0,0,1,1,0), factor: 1 },                  // A·s
  V:  { dim: Z(1,2,-3,-1,0), factor: 1 },                // W/A
  ohm:{ dim: Z(1,2,-3,-2,0), factor: 1 },                // V/A
  "Ω":{ dim: Z(1,2,-3,-2,0), factor: 1 },
  F:  { dim: Z(-1,-2,4,2,0), factor: 1 },                // C/V
  H:  { dim: Z(1,2,-2,-2,0), factor: 1 },                // V·s/A

  // helpful aliases
  "degC": { dim: Z(0,0,0,0,1), factor: 1 },
  "degF": { dim: Z(0,0,0,0,1), factor: 5/9 },
};

/* SI prefixes */
const PF: Record<string, number> = {
  G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 1e1,
  d: 1e-1, c: 1e-2, m: 1e-3, u: 1e-6, µ: 1e-6, μ: 1e-6, n: 1e-9, p: 1e-12,
};

/* Parse a unit token like "kPa", "mm", "uF", "m", "s", "ohm", "Ω" */
function parseAtomicUnit(tok: string): UnitInfo | null {
  if (!tok) return null;
  if (U[tok]) return U[tok];

  // Try (prefix + base) if base exists
  // Try longest base match
  const bases = Object.keys(U).sort((a, b) => b.length - a.length);
  for (const base of bases) {
    if (tok.endsWith(base)) {
      const pref = tok.slice(0, tok.length - base.length);
      if (pref === "") continue;
      if (PF[pref] != null) {
        const inner = U[base];
        return { dim: inner.dim, factor: inner.factor * PF[pref] };
      }
    }
  }
  return null;
}

/* Parse compound unit expressions like "W/m^2·K", "m/s^2", "N·m", "kPa" */
function parseUnitExpr(exprRaw: string): UnitInfo {
  if (!exprRaw) return ONE;
  let expr = exprRaw.trim()
    .replace(/·|⋅|×/g, "*")
    .replace(/per/gi, "/")
    .replace(/\s+/g, "")
    .replace(/degC/gi, "°C")
    .replace(/degF/gi, "°F");

  // Split by first "/" → numerator / (all denominators as product)
  const parts = expr.split("/");
  const num = parts.shift() ?? "";
  const den = parts.join("*");

  function parseProduct(prod: string): UnitInfo {
    if (!prod) return ONE;
    // tokens are sequences of letters/symbols possibly with ^exp or trailing digits as exponent
    const re = /([A-Za-z°Ωµμu]+)(\^-?\d+|[-]?\d+)?/g;
    let info: UnitInfo = { ...ONE };
    let m: RegExpExecArray | null;
    while ((m = re.exec(prod)) !== null) {
      const sym = m[1];
      const expStr = m[2] ?? "";
      const exp = expStr.startsWith("^") ? parseInt(expStr.slice(1), 10) : (expStr ? parseInt(expStr, 10) : 1);
      const unit = parseAtomicUnit(sym);
      if (!unit || !Number.isFinite(exp)) continue;
      info.factor *= Math.pow(unit.factor, exp);
      info.dim = add(info.dim, mulDim(unit.dim, exp));
    }
    return info;
  }

  const In = parseProduct(num);
  const Id = parseProduct(den);
  // divide: multiply by inverse
  return {
    factor: In.factor / (Id.factor || 1),
    dim: add(In.dim, mulDim(Id.dim, -1)),
  };
}

/* Extract a clean "unit expression" snippet from a text side (keep only known tokens and separators) */
const UNIT_TOKEN = /([A-Za-z°Ωµμu]+(\^-?\d+|[-]?\d+)?|\/|\*|·|⋅|×)/g;
function extractUnitExprFromSide(sideRaw: string): string {
  const pieces = sideRaw.match(UNIT_TOKEN) || [];
  return pieces.join("").replace(/·|⋅|×/g, "*");
}

/* Quick scan for a quantity like "123 W/m^2K" in a string (for final answers) */
const QUANTITY_RE = new RegExp(
  String.raw`(-?\d*\.?\d+(?:e[+-]?\d+)?)(?:\s*)([A-Za-z°Ωµμu][A-Za-z0-9°Ωµμu\*\./\^]*)?`
);

/* Expected dimension by context keywords */
type Expected = { label: string; dim: Dim };

function expectedDimsForContext(lower: string): Expected[] {
  const out: Expected[] = [];
  const push = (label: string, dim: Dim) => out.push({ label, dim });

  if (/\b(force|weight)\b/.test(lower)) push("force", Z(1,1,-2,0,0));
  if (/\b(pressure|stress)\b/.test(lower)) push("pressure/stress", Z(1,-1,-2,0,0));
  if (/\b(energy|work|heat(?!\s*flux)|enthalpy)\b/.test(lower)) push("energy", Z(1,2,-2,0,0));
  if (/\b(power|rate|heat\s*rate)\b/.test(lower)) push("power", Z(1,2,-3,0,0));
  if (/\b(voltage|emf|potential)\b/.test(lower)) push("voltage", Z(1,2,-3,-1,0));
  if (/\b(current|amperage)\b/.test(lower)) push("current", Z(0,0,0,1,0));
  if (/\b(resistance|ohmic)\b/.test(lower)) push("resistance", Z(1,2,-3,-2,0));
  if (/\b(capacitance)\b/.test(lower)) push("capacitance", Z(-1,-2,4,2,0));
  if (/\b(inductance)\b/.test(lower)) push("inductance", Z(1,2,-2,-2,0));
  if (/\b(frequency|angular\s*frequency)\b/.test(lower)) push("frequency", Z(0,0,-1,0,0));
  if (/\b(speed|velocity)\b/.test(lower)) push("velocity", Z(0,1,-1,0,0));
  if (/\b(acceleration)\b/.test(lower)) push("acceleration", Z(0,1,-2,0,0));
  if (/\b(area)\b/.test(lower)) push("area", Z(0,2,0,0,0));
  if (/\b(volume|volumetric)\b/.test(lower)) push("volume", Z(0,3,0,0,0));
  if (/\b(density|mass\s*density)\b/.test(lower)) push("density", Z(1,-3,0,0,0));
  if (/\b(flow\s*rate|discharge)\b/.test(lower)) push("flow rate", Z(0,3,-1,0,0));
  if (/\b(temperature\s*difference|delta\s*T|ΔT)\b/.test(lower)) push("temperature diff", Z(0,0,0,0,1));
  if (/\b(modulus|young|shear|bulk)\b/.test(lower)) push("modulus", Z(1,-1,-2,0,0)); // Pa
  if (/\b(heat\s*flux|q''|q\W*\W)\b/.test(lower)) push("heat flux", Z(1,0,-3,0,0)); // W/m^2
  return out;
}

/* µF vs mF heuristic & Kelvin absolute-temp heuristic */
function findWarnings(text: string, lower: string): { label: string; ok: boolean; reason: string }[] {
  const notes: { label: string; ok: boolean; reason: string }[] = [];

  const mFhits = text.match(/(\d+(?:\.\d+)?)\s*mF\b/g);
  const uFhits = text.match(/(\d+(?:\.\d+)?)\s*(?:µF|μF|uF)\b/g);
  if (mFhits && !uFhits) {
    notes.push({
      label: "capacitor-unit",
      ok: true,
      reason: "Saw 'mF' (millifarad). Many problems use µF; confirm you didn't mean µF (microfarad).",
    });
  }

  if (/\bradiation|stefan|emissiv|T\^?4\b/i.test(lower) && /°C|degC|°F|degF/.test(text)) {
    notes.push({
      label: "absolute-temperature",
      ok: false,
      reason: "Absolute temperature in radiation/Stefan–Boltzmann should be in Kelvin (K), not °C/°F.",
    });
  }

  return notes;
}

/* =============================== main =============================== */
export function verifyUnits(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.replace(/[–—−]/g, "-");
  const lower = text.toLowerCase();
  const finalS = String(result.final ?? "");

  // Trigger only if units/keywords appear
  const looksUnits =
    /[A-Za-z°Ωµμu]\s*(?:\/|\*|·|⋅|\^|\d)|\b(N|Pa|J|W|V|A|F|H|Hz|ohm|Ω|kPa|MPa|psi|atm|bar|m\/s|m\^2|m\^3|°C|°F|K)\b/i.test(text) ||
    /\b(force|pressure|energy|power|voltage|current|resistance|capacitance|inductance|frequency|speed|velocity|acceleration|area|volume|density|flow\s*rate|modulus|heat\s*flux)\b/i.test(lower);
  if (!looksUnits) return null;

  const checks: Verification["checks"] = [];

  /* ---------- 1) Final answer unit vs expected dimension ---------- */
  const qMatch = QUANTITY_RE.exec(finalS);
  if (qMatch && qMatch[2]) {
    const unitExpr = qMatch[2].trim();
    const parsed = parseUnitExpr(unitExpr);
    const expects = expectedDimsForContext(lower);
    if (expects.length) {
      // ok if ANY expected dim matches
      const match = expects.some(e => sameDim(e.dim, parsed.dim));
      checks.push({
        value: `unit(${unitExpr})`,
        ok: match,
        lhs: NaN,
        rhs: NaN,
        reason: match ? null : `Final unit '${unitExpr}' not consistent with expected dimension (${expects.map(e=>e.label).join(", ")})`,
      } as any);
    }
  }

  /* ---------- 2) Equation-side dimensional checks ---------- */
  const lines = text.split(/\n+/).filter(l => l.includes("="));
  let eqChecked = 0;
  for (const ln of lines) {
    if (eqChecked >= 4) break; // keep it light
    // Only consider lines that contain recognizable unit tokens
    if (!/[A-Za-z°Ωµμu]/.test(ln)) continue;
    const [lhsRaw, rhsRaw] = ln.split("=");
    if (!rhsRaw) continue;
    const lhsExpr = extractUnitExprFromSide(lhsRaw);
    const rhsExpr = extractUnitExprFromSide(rhsRaw);
    if (!/[A-Za-z°Ωµμu]/.test(lhsExpr) || !/[A-Za-z°Ωµμu]/.test(rhsExpr)) continue;

    const L = parseUnitExpr(lhsExpr);
    const R = parseUnitExpr(rhsExpr);
    const ok = sameDim(L.dim, R.dim);
    checks.push({
      value: `dim(LHS)=dim(RHS)`,
      ok,
      lhs: NaN,
      rhs: NaN,
      reason: ok ? null : `Dimensional mismatch in "${ln.trim()}": LHS ${JSON.stringify(L.dim)} vs RHS ${JSON.stringify(R.dim)}`,
    } as any);
    eqChecked++;
  }

  /* ---------- 3) Heuristic warnings ---------- */
  for (const note of findWarnings(text, lower)) {
    checks.push({ value: note.label, ok: note.ok, reason: note.reason } as any);
  }

  if (!checks.length) return null;
  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "units", method: "units-dimensions", allVerified, checks } as unknown as Verification;
}
