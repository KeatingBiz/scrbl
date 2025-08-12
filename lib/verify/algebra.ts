// lib/verify/algebra.ts
import { Parser } from "expr-eval";
import type { BoardUnderstanding, Verification } from "@/lib/types";

/** ---------- Text normalization ---------- */
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
    .replace(/[≈＝﹦]/g, "=")
    .replace(/π/g, "pi")
    .replace(/\s+/g, " ")
    .trim();
}

/** ---------- Tolerance helpers ---------- */
function relClose(a: number, b: number, rel = 1e-6, abs = 1e-9): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const diff = Math.abs(a - b);
  return diff <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
}

/** ---------- Safe eval ---------- */
const parser = new Parser();

function safeEval(expr: string, vars: Record<string, number>): number | null {
  try {
    const v = parser.parse(norm(expr)).evaluate(vars);
    if (!Number.isFinite(v)) return null;
    return Number(v);
  } catch {
    return null;
  }
}

/** ---------- Extract equation text from steps/question ---------- */
function extractEquationFromSteps(
  steps?: { before?: string | null; after?: string | null }[],
  question?: string | null,
  raw?: string | null
): string | null {
  if (steps) {
    for (const st of steps) {
      if (st?.before && st.before.includes("=")) return st.before;
      if (st?.after && st.after.includes("=")) return st.after;
    }
  }
  if (question && question.includes("=")) return question;
  if (raw && raw.includes("=")) return raw;
  return null;
}

/** ---------- Variable discovery using parser ---------- */
function detectVariables(lhs: string, rhs: string): string[] {
  const lvars = new Set(parser.parse(norm(lhs)).variables());
  const rvars = new Set(parser.parse(norm(rhs)).variables());
  const all = new Set<string>([...Array.from(lvars), ...Array.from(rvars)]);
  // Keep simple single-letter variables first (x,y,z), then others
  const letters = Array.from(all).filter((v) => /^[a-zA-Z]$/.test(v));
  const others = Array.from(all).filter((v) => !/^[a-zA-Z]$/.test(v));
  const ordered = [...letters, ...others].map((v) => v.toLowerCase());
  // Prefer x then y if present
  ordered.sort((a, b) => {
    const p = ["x", "y", "z"];
    const ia = p.indexOf(a);
    const ib = p.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 9 : ia) - (ib === -1 ? 9 : ib);
    return a.localeCompare(b);
  });
  return Array.from(new Set(ordered));
}

/** ---------- Parse candidates from final ---------- */
/**
 * Supports:
 *  - "x=4", "x = 4 or 9", "x = 2, 3"
 *  - "x = 3 ± 2" → [5, 1]
 *  - "(x,y) = (1, 2)" or "x=1, y=2"
 * Returns a list of assignment maps: [{x:1}, {x:9}] or [{x:1,y:2}]
 */
function candidatesFromFinal(finalVal: string | null | undefined, vars: string[]): Record<string, number>[] {
  if (!finalVal || vars.length === 0) return [];
  const final = norm(String(finalVal));

  const out: Record<string, number>[] = [];

  // Handle vector form: (x,y)=(1,2)
  const vec = final.match(/\(\s*([a-z](?:\s*,\s*[a-z])*)\s*\)\s*=\s*\(\s*([^)]+)\)/i);
  if (vec) {
    const vnames = vec[1].split(",").map((s) => s.trim().toLowerCase());
    const vvals = vec[2].split(",").map((s) => s.trim());
    if (vnames.length === vvals.length && vnames.every((v) => vars.includes(v))) {
      const asg: Record<string, number> = {};
      for (let i = 0; i < vnames.length; i++) {
        const n = safeEval(vvals[i], {});
        if (n === null) return out;
        asg[vnames[i]] = n;
      }
      out.push(asg);
      return out;
    }
  }

  // Collect "x=…", "y=…" pairs (tolerate commas/ors)
  const pairRe = /([a-z])\s*=\s*([^,;|]+)(?=,|;|\bor\b|\band\b|$)/gi;
  let m: RegExpExecArray | null;
  const foundPairs: Record<string, string[]> = {};
  while ((m = pairRe.exec(final)) !== null) {
    const v = m[1].toLowerCase();
    if (!vars.includes(v)) continue;
    const raw = m[2].trim();
    // expand "a ± b"
    if (raw.includes("±")) {
      const [baseS, deltaS] = raw.split("±").map((t) => t.trim());
      const base = safeEval(baseS, {});
      const delta = safeEval(deltaS, {});
      if (base !== null && delta !== null) {
        (foundPairs[v] ??= []).push(String(base + delta), String(base - delta));
        continue;
      }
    }
    // split on or/and/commas inside the value
    const parts = raw.split(/\bor\b|,|and/gi).map((t) => t.trim()).filter(Boolean);
    (foundPairs[v] ??= []).push(...parts);
  }

  // If we captured explicit pairs that cover all vars, create combinations
  const keys = Object.keys(foundPairs);
  if (keys.length > 0) {
    // If only a subset present (e.g., x=..., but y is not mentioned), we still yield partial and let eval fail if needed
    function* product(i: number, acc: Record<string, number>) {
      if (i >= keys.length) {
        yield acc;
        return;
      }
      const k = keys[i];
      for (const valS of foundPairs[k]) {
        const n = safeEval(valS, {});
        if (n === null) continue;
        yield* product(i + 1, { ...acc, [k]: n });
      }
    }
    for (const a of product(0, {})) out.push(a);
  }

  // Fallback: single-variable extraction "x=..." formats when only one var exists
  if (out.length === 0 && vars.length === 1) {
    const v = vars[0];
    let rhs = final.includes("=") ? final.slice(final.indexOf("=") + 1) : final;
    // expand ±
    if (rhs.includes("±")) {
      const [baseS, deltaS] = rhs.split("±").map((t) => t.trim());
      const base = safeEval(baseS, {});
      const delta = safeEval(deltaS, {});
      if (base !== null && delta !== null) {
        out.push({ [v]: base + delta }, { [v]: base - delta });
      }
    }
    // split on or/commas
    for (const part of rhs.split(/\bor\b|,|and/gi).map((t) => t.trim()).filter(Boolean)) {
      const n = safeEval(part, {});
      if (n !== null) out.push({ [v]: n });
    }
  }

  // Deduplicate
  const uniq = new Map<string, Record<string, number>>();
  for (const asg of out) {
    const key = vars.map((v) => `${v}:${asg[v] ?? "?"}`).join("|");
    if (!uniq.has(key)) uniq.set(key, asg);
  }
  return Array.from(uniq.values());
}

/** ---------- Domain checks on substituted expressions ---------- */
type DomainIssue = { kind: "division-by-zero" | "sqrt-domain" | "log-domain"; where: "lhs" | "rhs"; piece?: string };

function domainIssues(expr: string, vars: Record<string, number>, side: "lhs" | "rhs"): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const s = norm(expr);

  // sqrt(...)
  const sqrtRe = /sqrt\s*\(\s*([^)]+)\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = sqrtRe.exec(s)) !== null) {
    const arg = m[1];
    const val = safeEval(arg, vars);
    if (val === null || val < -1e-12) issues.push({ kind: "sqrt-domain", where: side, piece: arg });
  }

  // log(...) / ln(...)
  const logRe = /\b(?:log|ln)\s*\(\s*([^)]+)\s*\)/gi;
  while ((m = logRe.exec(s)) !== null) {
    const arg = m[1];
    const val = safeEval(arg, vars);
    if (val === null || val <= 0) issues.push({ kind: "log-domain", where: side, piece: arg });
  }

  // crude denominator check: "/( … )" or "/x"
  const denomRe = /\/\s*(\([^()]*\)|[a-z][a-z0-9_]*)/gi;
  while ((m = denomRe.exec(s)) !== null) {
    const d = m[1];
    const val = safeEval(d, vars);
    if (val === null || Math.abs(val) < 1e-12) issues.push({ kind: "division-by-zero", where: side, piece: d });
  }

  return issues;
}

/** ---------- Main ---------- */
export function verifyAlgebra(result: BoardUnderstanding): Verification | null {
  const eqRaw =
    extractEquationFromSteps(result.steps as any, result.question, result.raw_text) || "";
  if (!eqRaw.includes("=")) return null;

  const equation = norm(eqRaw);
  const [lhsS, rhsS] = equation.split("=");
  if (!lhsS || !rhsS) return null;

  const vars = detectVariables(lhsS, rhsS);
  if (vars.length === 0) vars.push("x"); // fallback

  // Candidates from final
  const cand = candidatesFromFinal((result as any).final ?? null, vars);
  if (cand.length === 0) return null;

  const checks: Verification["checks"] = [];

  for (const asg of cand) {
    // Render a friendly "x=1, y=2" label
    const label = vars.map((v) => `${v}=${asg[v] !== undefined ? asg[v] : "?"}`).join(", ");

    // Domain guards before evaluating both sides
    const domL = domainIssues(lhsS, asg, "lhs");
    const domR = domainIssues(rhsS, asg, "rhs");
    const dom = [...domL, ...domR];
    if (dom.length) {
      checks.push({
        value: label,
        ok: false,
        reason: dom.map((d) => `${d.where}:${d.kind}${d.piece ? `(${d.piece})` : ""}`).join(", "),
      } as any);
      continue;
    }

    const L = safeEval(lhsS, asg);
    const R = safeEval(rhsS, asg);

    if (L === null || R === null) {
      checks.push({ value: label, ok: false, reason: "invalid expression", lhs: L ?? undefined, rhs: R ?? undefined } as any);
      continue;
    }

    const ok = relClose(L, R, 1e-6, 1e-9);
    checks.push({ value: label, ok, lhs: L, rhs: R, reason: ok ? null : "residual not zero" } as any);
  }

  const allVerified = checks.length > 0 && checks.every((c: any) => c.ok === true);

  return {
    subject: "algebra",
    method: "algebra-substitution+domain",
    allVerified,
    checks,
  } as Verification;
}



