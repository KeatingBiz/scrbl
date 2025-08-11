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

  // Handle "a or b" style quickly
  const parts: string[] = [];
  // expand ± if present
  if (rhs.includes("±")) {
    // try forms like "6 ± 2" or "6 ± sqrt(36)"
    const [baseS, deltaS] = rhs.split("±").map(t => t.trim());
    try {
      const p = new Parser();
      const base = p.parse(norm(baseS)).evaluate({});
      const delta = p.parse(norm(deltaS)).evaluate({});
      parts.push(String(base + delta), String(base - delta));
    } catch {
      // fall back to text split
    }
  }
  // split on "or" / commas
  rhs.split(/\bor\b|,|and/gi).forEach(t => {
    const str = t.trim();
    if (str) parts.push(str);
  });

  // De-dup & format like "x=VALUE"
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

  // parse candidate values from 'final'
  const candidates = valuesFromFinal(result.final, variable);
  if (candidates.length === 0) return null;

  const checks: Verification["checks"] = [];
  for (const c of candidates) {
    // c like "x=4" → value "4"
    const valStr = c.split("=")[1]?.trim() || "";
    const val = safeEval(valStr, {}) ?? Number.NaN;

    // domain guard: obvious x=0 with "/x" present
    if (val === 0 && /\/\s*0*\s*[*)]*\s*[a-z]*\b?x\b/i.test(lhsS + rhsS)) {
      checks.push({ value: c, ok: false, reason: "division by zero" });
      continue;
    }

    // evaluate both sides
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
