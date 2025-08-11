import { Step } from "@/lib/types";

export const TOL = 1e-6;

export function normText(s: string): string {
  return (s || "")
    .replace(/[–—−]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/√/g, "sqrt")
    .replace(/[≈＝＝]/g, "=")
    .replace(/\s+/g, " ")
    .trim();
}

export function gatherProblemText(question?: string | null, raw?: string | null, steps?: Step[]): string {
  return [question, raw, ...(steps || []).map(s => [s.before, s.after, s.text, s.action].filter(Boolean).join(" "))]
    .filter(Boolean)
    .map(normText)
    .join("\n");
}

export function parseNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/i);
  return m ? parseFloat(m[0]) : null;
}

export function parsePercentOrNumber(s: string | null | undefined): number | null {
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
  const colon = t.match(/(?:numbers?|data|values?|cash\s*flows?|cf)\s*[:\-]\s*([^\n]+)/i);
  if (colon?.[1]) segment = colon[1];
  const nums = (segment.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi) || []).map(parseFloat);
  return nums.filter(n => Number.isFinite(n));
}

export function approxEqual(a: number, b: number, tol = TOL): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
}
