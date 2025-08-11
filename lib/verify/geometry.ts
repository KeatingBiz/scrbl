import type { BoardUnderstanding, Verification } from "@/lib/types";
import { gatherProblemText, parseNumber, approxEqual } from "./utils";

export function verifyGeometry(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps).toLowerCase();

  // Right triangle (Pythagorean)
  if (/\bright\b.*\btriangle\b/.test(blob) || /\ba\^?2\s*\+\s*b\^?2\s*=\s*c\^?2/.test(blob)) {
    // Try to parse sides a,b,c from final/steps
    const a = /a\s*=\s*([-\d.]+)/i.exec(blob)?.[1];
    const b = /b\s*=\s*([-\d.]+)/i.exec(blob)?.[1];
    const c = /c\s*=\s*([-\d.]+)/i.exec(blob)?.[1];

    const A = a ? parseFloat(a) : null;
    const B = b ? parseFloat(b) : null;
    const C = c ? parseFloat(c) : null;

    const rep = parseNumber(result.final || "");
    if (rep == null) return null;

    // If two of A,B,C known, compute the third
    let computed: number | null = null;
    if (A != null && B != null) computed = Math.sqrt(A ** 2 + B ** 2);
    else if (A != null && C != null) computed = Math.sqrt(Math.max(C ** 2 - A ** 2, 0));
    else if (B != null && C != null) computed = Math.sqrt(Math.max(C ** 2 - B ** 2, 0));
    else return null;

    const ok = approxEqual(computed, rep, 1e-3);
    return {
      subject: "geometry",
      method: "geometry-identity",
      allVerified: ok,
      checks: [{ value: `side=${rep}`, ok, lhs: computed, rhs: rep, reason: ok ? null : "Pythagorean mismatch" }]
    };
  }

  // Rectangle area/perimeter
  if (/rectangle/.test(blob) && /(area|perimeter)/.test(blob)) {
    const L = /(?:l|length)\s*=\s*([-\d.]+)/i.exec(blob)?.[1];
    const W = /(?:w|width)\s*=\s*([-\d.]+)/i.exec(blob)?.[1];
    if (!L || !W) return null;
    const l = parseFloat(L), w = parseFloat(W);
    const rep = parseNumber(result.final || "");
    if (rep == null) return null;

    if (/area/.test(blob)) {
      const a = l * w;
      const ok = approxEqual(a, rep, 1e-6);
      return { subject: "geometry", method: "geometry-identity", allVerified: ok, checks: [{ value: `area=${rep}`, ok, lhs: a, rhs: rep, reason: ok ? null : "area mismatch" }] };
    } else {
      const p = 2 * (l + w);
      const ok = approxEqual(p, rep, 1e-6);
      return { subject: "geometry", method: "geometry-identity", allVerified: ok, checks: [{ value: `perimeter=${rep}`, ok, lhs: p, rhs: rep, reason: ok ? null : "perimeter mismatch" }] };
    }
  }

  // Triangle area (0.5*b*h)
  if (/triangle/.test(blob) && /area/.test(blob)) {
    const B = /(?:b|base)\s*=\s*([-\d.]+)/i.exec(blob)?.[1];
    const H = /(?:h|height)\s*=\s*([-\d.]+)/i.exec(blob)?.[1];
    if (!B || !H) return null;
    const b = parseFloat(B), h = parseFloat(H);
    const rep = parseNumber(result.final || "");
    if (rep == null) return null;
    const a = 0.5 * b * h;
    const ok = approxEqual(a, rep, 1e-6);
    return { subject: "geometry", method: "geometry-identity", allVerified: ok, checks: [{ value: `area=${rep}`, ok, lhs: a, rhs: rep, reason: ok ? null : "area mismatch" }] };
  }

  // Circle area/circumference
  if (/circle/.test(blob) && /(area|circumference|perimeter)/.test(blob)) {
    const R = /(?:r|radius)\s*=\s*([-\d.]+)/i.exec(blob)?.[1];
    if (!R) return null;
    const r = parseFloat(R);
    const rep = parseNumber(result.final || "");
    if (rep == null) return null;

    if (/area/.test(blob)) {
      const a = Math.PI * r * r;
      const ok = approxEqual(a, rep, 1e-3);
      return { subject: "geometry", method: "geometry-identity", allVerified: ok, checks: [{ value: `area=${rep}`, ok, lhs: a, rhs: rep, reason: ok ? null : "area mismatch" }] };
    } else {
      const c = 2 * Math.PI * r;
      const ok = approxEqual(c, rep, 1e-3);
      return { subject: "geometry", method: "geometry-identity", allVerified: ok, checks: [{ value: `circumference=${rep}`, ok, lhs: c, rhs: rep, reason: ok ? null : "circumference mismatch" }] };
    }
  }

  return null;
}

