// lib/verify/utils.ts
import { Step } from "@/lib/types";

export const TOL = 1e-6;

export const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

export function normText(s: string): string {
  return s
    .normalize("NFKC")
    // strip currency symbols
    .replace(/[$€£]/g, "")
    // remove thousands separators (keep decimals)
    .replace(/(?<=\d),(?=\d{3}(\D|$))/g, "")
    // unicode/typography fixes
    .replace(/\u2212/g, "-") // unicode minus
    .replace(/[–—−]/g, "-")
    .replace(/[×·⋅]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/√/g, "sqrt")
    .replace(/°/g, " deg ")
    .replace(/π/g, "pi")
    .replace(/µ/g, "u")
    .replace(/[≈＝﹦]/g, "=")
    // whitespace normalization
    .replace(/\s+/g, " ")
    .trim();
}

export function gatherProblemText(
  question?: string | null,
  raw?: string | null,
  steps?: Step[]
): string {
  const stepPieces = (steps ?? []).flatMap((s) => [
    s.before,
    s.after,
    s.text,
    s.action,
  ]);
  const all = [question, raw, ...stepPieces].filter(isNonEmptyString);
  const normalized = all.map(normText);
  return normalized.join("\n");
}

export function parseNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/i);
  return m ? parseFloat(m[0]) : null;
}

export function parsePercentOrNumber(
  s: string | null | undefined
): number | null {
  if (!s) return null;
  const pct = s.match(/-?\d*\.?\d+\s*%/);
  if (pct) return parseFloat(pct[0]) / 100;
  const n = s.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/i);
  return n ? parseFloat(n[0]) : null;
}

export function extractNumberList(text: string): number[] {
  const t = normText(text);
  const bracket = t.match(/\[(.*?)\]/);
  let segment = bracket?.[1] ?? t;
  const colon = t.match(
    /(?:numbers?|data|values?|cash\s*flows?|cf)\s*[:\-]\s*([^\n]+)/i
  );
  if (colon?.[1]) segment = colon[1];
  const nums =
    (segment.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi) || []).map((n) =>
      parseFloat(n)
    );
  return nums.filter((n) => Number.isFinite(n));
}

export function approxEqual(a: number, b: number, tol = TOL): boolean {
  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a - b) <= tol
  );
}

// Relative + absolute tolerance: more stable across scales
export function relClose(
  a: number,
  b: number,
  rel = 1e-6,
  abs = 1e-9
): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const diff = Math.abs(a - b);
  return diff <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
}

// Count total regex/string hits for rudimentary subject scoring
export function countOccurrences(
  blob: string,
  patterns: (RegExp | string)[]
): number {
  let score = 0;
  for (const p of patterns) {
    if (typeof p === "string") {
      const m = blob.match(new RegExp(p, "g"));
      if (m) score += m.length;
    } else {
      const flags = p.flags?.includes("g") ? p : new RegExp(p, p.flags + "g");
      const m = blob.match(flags);
      if (m) score += m.length;
    }
  }
  return score;
}


