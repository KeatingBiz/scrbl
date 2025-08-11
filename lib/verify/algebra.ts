import { Parser } from "expr-eval";
import type { BoardUnderstanding, Verification } from "@/lib/types";

// Normalize math text to simple ASCII the parser understands
function norm(s: string): string {
  return s
    .replace(/[≈＝＝]/g, "=")
    .replace(/[÷]/g, "/")
    .replace(/[×·]/g, "*")
    .replace(/[–—−]/g, "-")
    .replace(/√/g, "sqrt")
    .replace(/\s+/g, " ")
    .trim();
}

function parseVariable(s: string): string | null {
  // Favor x, then y; else first single-letter variable
  const vars = Array.from(new Set((s.match(/[a-wyzA-WYZ]\b/g) || []).map(v => v.toLowerCase())));
  if (vars.includes("x")) return "x";
  if (vars.includes("y")) return "y";
  return vars[0] || null;
}

function extractEquationFromSteps(steps?: { before: string | null }[]): string | null {
  if (!steps) return null;
  for (const st of steps) {
    if (st?.before && st.before.includes("=")) return st.before;
  }
  return null;
}

function valuesFromFinal(final?: string | null, variable = "x"): string[] {
  if (!final) return [];
  let rhs = final;
  const eqIdx = final.indexOf("=");
  if (eqIdx >= 0) rhs = final.slice(eqIdx + 1);

  const parts: string[] = [];

  // Handle "±" if present (best-effort numeric eval)
  if (rhs.includes("±")) {
    const [baseS, deltaS] = rhs.split("±").map(t => t.trim());
    try {
      const p = new Parser();
      const base = p.parse(norm(baseS)).evaluate({});
      const delta = p.parse(norm(deltaS)).evaluate({});
      parts.push(String(base + delta), String(base - delta));
    } catch {
      // fall through; we'll also split below
    }
  }

  // Split on "or", "and", or commas
  rhs.split(/\bor\b|,|and/gi).forEach(t => {
    const str = t.trim();
    if (str) parts.push(str);
  });

  const uniq = Array.from(new Set(parts.map(s => s.trim()).filter(Boolean)));
  return uniq.map(v => `${variable}=${v}`);
}

function safeEval(expr: string, vars: Record<string, number>): number | null {
  try {
    const val = new Parser().parse(norm(expr)).evaluate(vars);
    if (!Number.isFinite(val)) return null;
    return Number(val);
  } catch {
    return null;
  }
}

export function verifyAlgebra(result: BoardUnderstanding): Verification | null {
  const eq = extractEquationFromSteps(result.steps) || result.question || result.raw_text || "";
  if (!eq.includes("=")) return null;

  const equation = norm(eq);
  const variable = parseVariable(equation) || "x";

  const [lhsS, rhsS] = equation.split("=");
  if (!lhsS || !rhsS) return null;

  // Parse candidate values from 'final'
  const candidates = valuesFromFinal(result.final, variable);
  if (candidates.length === 0) return null;

  // Precompute a compact expression string for quick domain checks (e.g., "/x")
  const exprCompact = (lhsS + rhsS).replace(/\s+|\(|\)/g, "").toLowerCase();

  const checks: Verification["checks"] = [];
  for (const c of candidates) {
    // c like "x=4" → value "4"
    const valStr = c.split("=")[1]?.trim() || "";
    const val = safeEval(valStr, {}) ?? Number.NaN;

    // Simple division-by-zero guard: if value is 0 and "/x" (or "/y", etc.) appears
    if (val === 0 && exprCompact.includes(`/${variable.toLowerCase()}`)) {
      checks.push({ value: c, ok: false, reason: "division by zero" });
      continue;
    }

    // Evaluate both sides numerically
    const vars: Record<string, number> = { [variable]: val };
    const L = safeEval(lhsS, vars);
    const R = safeEval(rhsS, vars);

    if (L === null || R === null) {
      checks.push({ value: c, ok: false, reason: "invalid expression" });
      continue;
    }

    const ok = Math.abs(L - R) <= 1e-6;
    checks.push({ value: c, ok, lhs: L, rhs: R, reason: ok ? null : "residual not zero" });
  }

  const allVerified = checks.length > 0 && checks.every(ch => ch.ok === true);

  return {
    subject: "algebra",
    method: "algebra-substitution",
    allVerified,
    checks
  };
}


