// lib/verify/calculus.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import { gatherProblemText, parseNumber, relClose, approxEqual } from "./utils";
import { Parser } from "expr-eval";

/* ------------------------- helpers ------------------------- */

const parser = new Parser();

function norm(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[$€£]/g, "")
    .replace(/(?<=\d),(?=\d{3}(\D|$))/g, "")
    .replace(/\u2212/g, "-") // unicode minus
    .replace(/[–—−]/g, "-")
    .replace(/[×·⋅]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/√/g, "sqrt")
    .replace(/\bln\b/gi, "log") // expr-eval uses log for natural log
    .replace(/[≈＝﹦]/g, "=")
    .replace(/π/g, "pi")
    .replace(/\s+/g, " ")
    .trim();
}

function safeEvalExpr(expr: string, scope: Record<string, number>): number | null {
  try {
    const v = parser.parse(norm(expr)).evaluate(scope);
    if (!Number.isFinite(v)) return null;
    return Number(v);
  } catch {
    return null;
  }
}

/** Simpson’s rule (even n) for ∫_a^b f(x) dx */
function integrateSimpson(expr: string, a: number, b: number): number | null {
  const n = 200; // even
  const h = (b - a) / n;
  const f = (x: number) => safeEvalExpr(expr, { x });
  let s = 0;
  const fa = f(a), fb = f(b);
  if (fa === null || fb === null) return null;
  s += fa + fb;
  for (let i = 1; i < n; i++) {
    const x = a + i * h;
    const fx = f(x);
    if (fx === null) return null;
    s += fx * (i % 2 === 0 ? 2 : 4);
  }
  return (h / 3) * s;
}

/** Central difference derivatives */
function numericDerivative(expr: string, x0: number): number | null {
  const h = Math.max(1e-5, Math.abs(x0) * 1e-5);
  const f1 = safeEvalExpr(expr, { x: x0 + h });
  const f2 = safeEvalExpr(expr, { x: x0 - h });
  if (f1 === null || f2 === null) return null;
  return (f1 - f2) / (2 * h);
}

function numericSecondDerivative(expr: string, x0: number): number | null {
  const h = Math.max(1e-4, Math.abs(x0) * 1e-4);
  const fph = safeEvalExpr(expr, { x: x0 + h });
  const fmh = safeEvalExpr(expr, { x: x0 - h });
  const f0  = safeEvalExpr(expr, { x: x0 });
  if (fph === null || fmh === null || f0 === null) return null;
  return (fph - 2 * f0 + fmh) / (h * h);
}

/* ------------------------- parsers ------------------------- */

type DerivProblem =
  | { kind: "expr-derivative"; fExpr: string; derivExpr?: string } // final is expression
  | { kind: "value-derivative"; fExpr: string; at: number };       // derivative at a point

function parseDerivativeProblem(text: string, finalS: string): DerivProblem | null {
  const t = norm(text);
  const fx = t.match(/\bf\s*\(\s*x\s*\)\s*=\s*([^;\n]+)/i)?.[1]?.trim();
  const dOf = t.match(/d\s*\/\s*dx\s*\(?\s*([^)]+?)\s*\)?/i)?.[1]?.trim();
  const fExpr = fx || dOf;
  if (!fExpr) return null;

  const atM =
    t.match(/\bat\s*x\s*=\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)/i) ||
    finalS.match(/\bat\s*x\s*=\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)/i);
  const at = atM ? parseFloat(atM[1]) : null;

  const finalLooksNumeric = parseNumber(finalS) != null && !/[a-df-z]/i.test(finalS.replace(/[eE][+-]?\d+/, "")); // ignore e in sci notation
  if (finalLooksNumeric && at != null) {
    return { kind: "value-derivative", fExpr, at };
  }

  const deriv = norm(finalS)
    .replace(/f'\s*\(\s*x\s*\)\s*=\s*/i, "")
    .replace(/dy\s*\/\s*dx\s*=\s*/i, "")
    .trim();
  const derivExpr = deriv && /[a-z]/i.test(deriv) ? deriv : undefined;
  return { kind: "expr-derivative", fExpr, derivExpr };
}

type IntegralProblem = { integrand: string; a: number; b: number } | null;

function parseDefIntegral(text: string): IntegralProblem {
  const t = norm(text);

  // ∫_a^b f(x) dx
  const m1 = t.match(/∫\s*([-\d\.]+)\s*\^\s*([-\d\.]+)\s*([^\n]*?)\s*d\s*x/i);
  if (m1) {
    const a = parseFloat(m1[1]), b = parseFloat(m1[2]);
    const integrand = m1[3].trim();
    if (Number.isFinite(a) && Number.isFinite(b) && integrand) return { integrand, a, b };
  }

  // "integral of ... from a to b"
  const m2 = t.match(/integral\s+of\s+(.+?)\s*(?:dx)?\s*from\s*(-?\d*\.?\d+)\s*to\s*(-?\d*\.?\d+)/i);
  if (m2) {
    const integrand = m2[1].trim();
    const a = parseFloat(m2[2]), b = parseFloat(m2[3]);
    if (Number.isFinite(a) && Number.isFinite(b) && integrand) return { integrand, a, b };
  }

  // "∫ f(x) dx from a to b"
  const m3 = t.match(/∫\s*([^\n]*?)\s*d\s*x\s*from\s*(-?\d*\.?\d+)\s*to\s*(-?\d*\.?\d+)/i);
  if (m3) {
    const integrand = m3[1].trim();
    const a = parseFloat(m3[2]), b = parseFloat(m3[3]);
    if (Number.isFinite(a) && Number.isFinite(b) && integrand) return { integrand, a, b };
  }

  return null;
}

type IndefIntegralProblem = { integrand: string } | null;

function parseIndefIntegral(text: string): IndefIntegralProblem {
  const t = norm(text);
  // match ∫ g(x) dx but not with bounds "a^b"
  const m = t.match(/∫(?!\s*[-\d\.]+\s*\^)\s*([^\n]+?)\s*d\s*x/i);
  if (m) {
    const integrand = m[1].trim();
    if (integrand) return { integrand };
  }
  // "indefinite integral of g(x)"
  const m2 = t.match(/indefinite\s+integral\s+of\s+(.+?)(?:\s*dx)?(?:$|\n)/i);
  if (m2) {
    const integrand = m2[1].trim();
    if (integrand) return { integrand };
  }
  return null;
}

type LimitProblem = { expr: string; a: number } | null;

function parseLimit(text: string): LimitProblem {
  const t = norm(text);
  // lim_{x→a} g(x)
  const m1 = t.match(/\blim\s*[_\s]*\{\s*x\s*[-→>\u2192]\s*([^\}]+)\s*\}\s*([^\n]+)/i);
  if (m1) {
    const a = parseFloat(m1[1]);
    const expr = m1[2].replace(/^of\s+/i, "").trim();
    if (Number.isFinite(a) && expr) return { expr, a };
  }
  // "limit as x -> a of g(x)"
  const m2 = t.match(/limit\s+as\s+x\s*(?:->|→)\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)\s+of\s+([^\n]+)/i);
  if (m2) {
    const a = parseFloat(m2[1]);
    const expr = m2[2].trim();
    if (Number.isFinite(a) && expr) return { expr, a };
  }
  return null;
}

/** extract candidate x-values from a final like "x=1 or 2", "x= { -1, 0, 2 }" */
function parseCandidateXs(finalS: string): number[] {
  const s = norm(finalS);
  const hits: number[] = [];
  // grab the part after "x = ..."
  const m = s.match(/x\s*=\s*([^\n;]+)/i);
  const seg = m ? m[1] : s;
  seg
    .replace(/[{}\(\)]/g, " ")
    .split(/\bor\b|,|and/gi)
    .map((t) => t.trim())
    .forEach((t) => {
      const n = parseNumber(t);
      if (n != null) hits.push(n);
    });
  // dedupe
  return Array.from(new Set(hits.filter((n) => Number.isFinite(n))));
}

/** try to extract an antiderivative F(x) expression from the final */
function parseAntiderivativeExprFromFinal(finalS: string): string | null {
  let e = norm(finalS);
  e = e.replace(/f\s*\(\s*x\s*\)\s*=\s*/i, "").replace(/y\s*=\s*/i, "");
  e = e.replace(/\+\s*c\b/gi, "").replace(/constant\s*of\s*integration/gi, "");
  // If there is an equals and a RHS, take RHS
  if (e.includes("=")) e = e.slice(e.indexOf("=") + 1).trim();
  // must reference x or a function to be meaningful
  if (!/[a-df-z]/i.test(e)) return null; // ignore numeric only (allow e in sci note)
  return e;
}

/* ------------------------- main verifier ------------------------- */

export function verifyCalculus(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const finalS = String(result.final ?? "");
  const text = (blob + "\n" + finalS).toLowerCase();

  const looksCalc = /\b(derivative|d\/dx|dy\/dx|integral|∫|limit|\blim\b|critical|maximum|minimum|max|min)\b/i.test(text);
  if (!looksCalc) return null;

  const checks: Verification["checks"] = [];

  /* --- 1) Definite integral check vs Simpson --- */
  const integ = parseDefIntegral(blob);
  if (integ) {
    const { integrand, a, b } = integ;
    const numeric = integrateSimpson(integrand, a, b);
    const reported = parseNumber(finalS);
    if (numeric !== null && reported != null) {
      const ok = relClose(numeric, reported, 2e-3, 1e-4) || approxEqual(numeric, reported, 1e-3);
      checks.push({
        value: `∫_${a}^${b} ${integrand} dx ≈ ${reported}`,
        ok,
        lhs: numeric,
        rhs: reported,
        reason: ok ? null : "definite integral mismatch",
      } as any);
    }
  }

  /* --- 2) Indefinite integral (antiderivative) check --- */
  const indef = parseIndefIntegral(blob);
  if (indef) {
    const Fexpr = parseAntiderivativeExprFromFinal(finalS);
    if (Fexpr) {
      // Differentiate reported F and compare to integrand at samples
      const samples = [-2, -1, -0.5, 0.5, 1, 2];
      let agree = 0, total = 0;
      for (const x of samples) {
        const dF = numericDerivative(Fexpr, x);
        const f = safeEvalExpr(indef.integrand, { x });
        if (dF === null || f === null) continue;
        total++;
        if (relClose(dF, f, 2e-2, 1e-4) || approxEqual(dF, f, 1e-3)) agree++;
      }
      if (total > 0) {
        const ok = agree / total >= 0.8;
        checks.push({
          value: `d/dx(F) matches integrand on ${agree}/${total} samples`,
          ok,
          reason: ok ? null : "antiderivative check failed",
        } as any);
      }
    }
  }

  /* --- 3) Derivative expression vs numeric sampling --- */
  const derivProb = parseDerivativeProblem(blob, finalS);
  if (derivProb?.kind === "expr-derivative" && derivProb.derivExpr) {
    const { fExpr, derivExpr } = derivProb;
    const samples = [-2, -1, -0.5, 0.5, 1, 2];
    let agree = 0, total = 0;
    for (const x of samples) {
      const num = numericDerivative(fExpr, x);
      const sym = safeEvalExpr(derivExpr, { x });
      if (num === null || sym === null) continue;
      total++;
      if (relClose(num, sym, 2e-2, 1e-4) || approxEqual(num, sym, 1e-3)) agree++;
    }
    if (total > 0) {
      const ok = agree / total >= 0.8;
      checks.push({
        value: `f'(x) expression matches numeric on ${agree}/${total} samples`,
        ok,
        reason: ok ? null : "derivative expression disagrees with numeric check",
      } as any);
    }
  }

  /* --- 4) Derivative value at a point --- */
  if (derivProb?.kind === "value-derivative") {
    const { fExpr, at } = derivProb;
    const num = numericDerivative(fExpr, at);
    const reported = parseNumber(finalS);
    if (num !== null && reported != null) {
      const ok = relClose(num, reported, 2e-2, 1e-4) || approxEqual(num, reported, 1e-3);
      checks.push({
        value: `f'(${at}) ≈ ${reported}`,
        ok,
        lhs: num,
        rhs: reported,
        reason: ok ? null : "derivative at point mismatch",
      } as any);
    }
  }

  /* --- 5) Limits (two-sided approach) --- */
  const lim = parseLimit(blob);
  if (lim) {
    const { expr, a } = lim;
    const reported = parseNumber(finalS);
    if (reported != null) {
      const hs = [1e-2, 5e-3, 1e-3];
      const vals: number[] = [];
      for (const h of hs) {
        const left = safeEvalExpr(expr, { x: a - h });
        const right = safeEvalExpr(expr, { x: a + h });
        if (left !== null) vals.push(left);
        if (right !== null) vals.push(right);
      }
      if (vals.length >= 2) {
        const est = vals.reduce((s, v) => s + v, 0) / vals.length;
        const ok = relClose(est, reported, 2e-2, 1e-4) || approxEqual(est, reported, 1e-3);
        checks.push({
          value: `lim_{x→${a}} ≈ ${reported}`,
          ok,
          lhs: est,
          rhs: reported,
          reason: ok ? null : "limit mismatch",
        } as any);
      }
    }
  }

  /* --- 6) Critical points (x* where f'(x*)≈0), optional classification --- */
  if (/\b(critical|maximum|minimum|max|min|optimi[sz]e)\b/i.test(text)) {
    // Try to recover f(x)
    const fx = norm(blob).match(/\bf\s*\(\s*x\s*\)\s*=\s*([^;\n]+)/i)?.[1]?.trim() ??
               norm(blob).match(/y\s*=\s*([^;\n]+)/i)?.[1]?.trim() ??
               null;
    if (fx) {
      const xs = parseCandidateXs(finalS);
      for (const xc of xs) {
        const fp = numericDerivative(fx, xc);
        if (fp === null) continue;
        const okStationary = Math.abs(fp) <= 1e-3;
        const check: any = {
          value: `critical x=${xc}`,
          ok: okStationary,
          lhs: fp,
          rhs: 0,
          reason: okStationary ? null : "f'(x*) not ~ 0",
        };

        // If the text mentions max/min, attempt classification
        if (/\bmaximum|max\b/i.test(text) || /\bminimum|min\b/i.test(text)) {
          const fpp = numericSecondDerivative(fx, xc);
          if (fpp !== null) {
            const wantMax = /\bmaximum|max\b/i.test(text);
            const wantMin = /\bminimum|min\b/i.test(text);
            if (wantMax) {
              check.classification = "max";
              check.classOk = fpp < -1e-6; // concave down
              if (!check.classOk) check.reason = (check.reason ? check.reason + "; " : "") + "f''(x*) not < 0";
            } else if (wantMin) {
              check.classification = "min";
              check.classOk = fpp > 1e-6; // concave up
              if (!check.classOk) check.reason = (check.reason ? check.reason + "; " : "") + "f''(x*) not > 0";
            }
          }
        }
        checks.push(check);
      }
    }
  }

  if (!checks.length) return null;
  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "calculus", method: "calculus", allVerified, checks } as Verification;
}
