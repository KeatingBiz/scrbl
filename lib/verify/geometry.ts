// lib/verify/geometry.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import { gatherProblemText, parseNumber, approxEqual, relClose } from "./utils";

const NUM = "(-?\\d*\\.?\\d+(?:e[+-]?\\d+)?)";

function parseAngleToRad(s: string): number | null {
  const m = s.match(new RegExp(`${NUM}\\s*(deg|°|degrees|rad)?`, "i"));
  if (!m) return null;
  const val = parseFloat(m[1]);
  const unit = (m[2] || "").toLowerCase();
  if (unit && /deg|°|degrees/.test(unit)) return (val * Math.PI) / 180;
  return val; // assume radians if unit omitted or "rad"
}

function findNum(text: string, ...labels: RegExp[]): number | null {
  for (const lab of labels) {
    const m = text.match(lab);
    if (m && m[1]) {
      const n = parseNumber(m[1]);
      if (n != null) return n;
    }
  }
  return null;
}

function findAngle(text: string, ...labels: RegExp[]): number | null {
  for (const lab of labels) {
    const m = text.match(lab);
    if (m && m[1]) {
      const a = parseAngleToRad(m[1]);
      if (a != null) return a;
    }
  }
  return null;
}

function parseFinalPair(finalS: string): { x: number; y: number } | null {
  const m = finalS.match(new RegExp("\\(\\s*" + NUM + "\\s*,\\s*" + NUM + "\\s*\\)", "i"));
  if (!m) return null;
  const x = parseFloat(m[1]);
  const y = parseFloat(m[2]);
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  return null;
}

function parseAllPoints(text: string): Array<{ x: number; y: number }> {
  const re = new RegExp("\\(\\s*" + NUM + "\\s*,\\s*" + NUM + "\\s*\\)", "gi");
  const pts: Array<{ x: number; y: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
  }
  return pts;
}

function shoelaceArea(pts: Array<{ x: number; y: number }>): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    s += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(s) / 2;
}

export function verifyGeometry(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.toLowerCase();
  const finalS = String(result.final ?? "");
  const finalN = parseNumber(finalS);
  const finalPair = parseFinalPair(finalS);

  const checks: Verification["checks"] = [];

  /* ---------------- Right triangle (Pythagorean) ---------------- */
  if (/\bright\b.*\btriangle\b/i.test(text) || /\ba\^?2\s*\+\s*b\^?2\s*=\s*c\^?2/i.test(text)) {
    const A = findNum(text, /\ba\s*=\s*([^\n,;]+)/i);
    const B = findNum(text, /\bb\s*=\s*([^\n,;]+)/i);
    const C = findNum(text, /\bc\s*=\s*([^\n,;]+)/i);

    if (finalN != null && ((A != null && B != null) || (A != null && C != null) || (B != null && C != null))) {
      let computed: number | null = null;
      if (A != null && B != null) computed = Math.sqrt(A ** 2 + B ** 2);
      else if (A != null && C != null) computed = Math.sqrt(Math.max(C ** 2 - A ** 2, 0));
      else if (B != null && C != null) computed = Math.sqrt(Math.max(C ** 2 - B ** 2, 0));
      if (computed != null) {
        const ok = approxEqual(computed, finalN, 1e-3) || relClose(computed, finalN, 1e-3, 1e-6);
        checks.push({ value: `side=${finalN}`, ok, lhs: computed, rhs: finalN, reason: ok ? null : "Pythagorean mismatch" } as any);
      }
    }

    // Basic trig with angle θ and one side (SOH-CAH-TOA)
    const theta = findAngle(text, /\b(?:θ|theta|angle)\s*=\s*([^\n,;]+)/i);
    const hyp = findNum(text, /\bhyp(?:otenuse)?\s*=\s*([^\n,;]+)/i);
    const opp = findNum(text, /\bopp(?:osite)?\s*=\s*([^\n,;]+)/i);
    const adj = findNum(text, /\badj(?:acent)?\s*=\s*([^\n,;]+)/i);
    if (theta != null && finalN != null) {
      if (hyp != null && /opp(osite)?|height|y[-\s]*leg/.test(text)) {
        const val = hyp * Math.sin(theta);
        const ok = relClose(val, finalN, 1e-3, 1e-6) || approxEqual(val, finalN, 1e-3);
        checks.push({ value: `opp=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "opp = hyp·sinθ mismatch" } as any);
      }
      if (hyp != null && /adj(acent)?|base|x[-\s]*leg/.test(text)) {
        const val = hyp * Math.cos(theta);
        const ok = relClose(val, finalN, 1e-3, 1e-6) || approxEqual(val, finalN, 1e-3);
        checks.push({ value: `adj=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "adj = hyp·cosθ mismatch" } as any);
      }
      if (adj != null && /opp(osite)?/.test(text)) {
        const val = adj * Math.tan(theta);
        const ok = relClose(val, finalN, 1e-3, 1e-6) || approxEqual(val, finalN, 1e-3);
        checks.push({ value: `opp=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "opp = adj·tanθ mismatch" } as any);
      }
      if (opp != null && /adj(acent)?|base/.test(text)) {
        const val = opp / Math.tan(theta);
        const ok = relClose(val, finalN, 1e-3, 1e-6) || approxEqual(val, finalN, 1e-3);
        checks.push({ value: `adj=${finalN}`, ok, lhs: val, rhs: finalN, reason: ok ? null : "adj = opp/tanθ mismatch" } as any);
      }
    }
  }

  /* ---------------- Rectangles ---------------- */
  if (/rectangle/i.test(text) && /(area|perimeter)/i.test(text)) {
    const L = findNum(text, /\b(?:l|length)\s*=\s*([^\n,;]+)/i);
    const W = findNum(text, /\b(?:w|width)\s*=\s*([^\n,;]+)/i);
    if (L != null && W != null && finalN != null) {
      if (/area/i.test(text)) {
        const a = L * W;
        const ok = relClose(a, finalN, 1e-6, 1e-6) || approxEqual(a, finalN, 1e-6);
        checks.push({ value: `area=${finalN}`, ok, lhs: a, rhs: finalN, reason: ok ? null : "area mismatch" } as any);
      }
      if (/(perimeter|circumference)/i.test(text)) {
        const p = 2 * (L + W);
        const ok = relClose(p, finalN, 1e-6, 1e-6) || approxEqual(p, finalN, 1e-6);
        checks.push({ value: `perimeter=${finalN}`, ok, lhs: p, rhs: finalN, reason: ok ? null : "perimeter mismatch" } as any);
      }
    }
  }

  /* ---------------- Triangles ---------------- */
  if (/triangle/i.test(text) && /area/i.test(text)) {
    const B = findNum(text, /\b(?:b|base)\s*=\s*([^\n,;]+)/i);
    const H = findNum(text, /\b(?:h|height)\s*=\s*([^\n,;]+)/i);
    if (B != null && H != null && finalN != null) {
      const a = 0.5 * B * H;
      const ok = relClose(a, finalN, 1e-6, 1e-6) || approxEqual(a, finalN, 1e-6);
      checks.push({ value: `area=${finalN}`, ok, lhs: a, rhs: finalN, reason: ok ? null : "triangle area mismatch" } as any);
    }
    // Heron's formula if three sides present
    const A = findNum(text, /\ba\s*=\s*([^\n,;]+)/i);
    const BB = findNum(text, /\bb\s*=\s*([^\n,;]+)/i);
    const C = findNum(text, /\bc\s*=\s*([^\n,;]+)/i);
    if (A != null && BB != null && C != null && finalN != null) {
      const s = (A + BB + C) / 2;
      const area2 = s * (s - A) * (s - BB) * (s - C);
      if (area2 >= 0) {
        const a = Math.sqrt(area2);
        const ok = relClose(a, finalN, 1e-6, 1e-6) || approxEqual(a, finalN, 1e-6);
        checks.push({ value: `area(Heron)=${finalN}`, ok, lhs: a, rhs: finalN, reason: ok ? null : "Heron mismatch" } as any);
      }
    }
  }

  /* ---------------- Circles & sectors ---------------- */
  if (/circle/i.test(text) && /(area|circumference|perimeter)/i.test(text)) {
    const r = findNum(text, /\b(?:r|radius)\s*=\s*([^\n,;]+)/i);
    if (r != null && finalN != null) {
      if (/area/i.test(text)) {
        const a = Math.PI * r * r;
        const ok = relClose(a, finalN, 1e-3, 1e-6) || approxEqual(a, finalN, 1e-3);
        checks.push({ value: `area=${finalN}`, ok, lhs: a, rhs: finalN, reason: ok ? null : "circle area mismatch" } as any);
      }
      if (/(circumference|perimeter)/i.test(text)) {
        const c = 2 * Math.PI * r;
        const ok = relClose(c, finalN, 1e-3, 1e-6) || approxEqual(c, finalN, 1e-3);
        checks.push({ value: `circumference=${finalN}`, ok, lhs: c, rhs: finalN, reason: ok ? null : "circumference mismatch" } as any);
      }
    }
  }

  // Sector (area and arc length): needs r and angle
  if (/(sector|arc)/i.test(text)) {
    const r = findNum(text, /\b(?:r|radius)\s*=\s*([^\n,;]+)/i);
    const theta = findAngle(text, /\b(?:θ|theta|angle)\s*=\s*([^\n,;]+)/i);
    if (r != null && theta != null && finalN != null) {
      if (/area/i.test(text)) {
        const a = 0.5 * r * r * theta; // theta in radians
        const ok = relClose(a, finalN, 1e-3, 1e-6) || approxEqual(a, finalN, 1e-3);
        checks.push({ value: `sector_area=${finalN}`, ok, lhs: a, rhs: finalN, reason: ok ? null : "sector area mismatch" } as any);
      }
      if (/(arc\s*length|length\s*of\s*arc)/i.test(text)) {
        const L = r * theta;
        const ok = relClose(L, finalN, 1e-3, 1e-6) || approxEqual(L, finalN, 1e-3);
        checks.push({ value: `arc_length=${finalN}`, ok, lhs: L, rhs: finalN, reason: ok ? null : "arc length mismatch" } as any);
      }
    }
  }

  /* ---------------- Coordinate geometry ---------------- */
  const pts = parseAllPoints(blob);
  if (pts.length >= 2) {
    const [p1, p2] = pts;
    if (/(distance|length)\b/i.test(text) && finalN != null) {
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const ok = relClose(d, finalN, 1e-6, 1e-6) || approxEqual(d, finalN, 1e-6);
      checks.push({ value: `distance=${finalN}`, ok, lhs: d, rhs: finalN, reason: ok ? null : "distance mismatch" } as any);
    }
    if (/\bslope\b/i.test(text) && finalN != null) {
      const dx = p2.x - p1.x;
      const m = dx === 0 ? NaN : (p2.y - p1.y) / dx;
      if (Number.isFinite(m)) {
        const ok = relClose(m, finalN, 1e-6, 1e-6) || approxEqual(m, finalN, 1e-6);
        checks.push({ value: `slope=${finalN}`, ok, lhs: m, rhs: finalN, reason: ok ? null : "slope mismatch" } as any);
      }
    }
    if (/\bmidpoint\b/i.test(text) && finalPair) {
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      const okx = relClose(mx, finalPair.x, 1e-6, 1e-6) || approxEqual(mx, finalPair.x, 1e-6);
      const oky = relClose(my, finalPair.y, 1e-6, 1e-6) || approxEqual(my, finalPair.y, 1e-6);
      checks.push({ value: `mid_x=${finalPair.x}`, ok: okx, lhs: mx, rhs: finalPair.x, reason: okx ? null : "midpoint x mismatch" } as any);
      checks.push({ value: `mid_y=${finalPair.y}`, ok: oky, lhs: my, rhs: finalPair.y, reason: oky ? null : "midpoint y mismatch" } as any);
    }
  }
  if (pts.length >= 3 && /polygon|triangle|quadrilateral|pentagon|hexagon|area\b/i.test(text) && finalN != null) {
    const area = shoelaceArea(pts);
    const ok = relClose(area, finalN, 1e-6, 1e-6) || approxEqual(area, finalN, 1e-6);
    checks.push({ value: `polygon_area=${finalN}`, ok, lhs: area, rhs: finalN, reason: ok ? null : "polygon area mismatch" } as any);
  }

  /* ---------------- 3D solids ---------------- */
  // Rectangular prism / box
  if (/(rectangular\s*prism|box|cuboid)/i.test(text)) {
    const L = findNum(text, /\b(?:l|length)\s*=\s*([^\n,;]+)/i);
    const W = findNum(text, /\b(?:w|width)\s*=\s*([^\n,;]+)/i);
    const H = findNum(text, /\b(?:h|height)\s*=\s*([^\n,;]+)/i);
    if (L != null && W != null && H != null && finalN != null) {
      if (/\bvolume\b/i.test(text)) {
        const V = L * W * H;
        const ok = relClose(V, finalN, 1e-6, 1e-6) || approxEqual(V, finalN, 1e-6);
        checks.push({ value: `volume=${finalN}`, ok, lhs: V, rhs: finalN, reason: ok ? null : "prism volume mismatch" } as any);
      }
      if (/\bsurface\s*area\b/i.test(text)) {
        const S = 2 * (L * W + L * H + W * H);
        const ok = relClose(S, finalN, 1e-6, 1e-6) || approxEqual(S, finalN, 1e-6);
        checks.push({ value: `surface=${finalN}`, ok, lhs: S, rhs: finalN, reason: ok ? null : "prism surface area mismatch" } as any);
      }
    }
  }

  // Cylinder
  if (/cylinder/i.test(text)) {
    const r = findNum(text, /\b(?:r|radius)\s*=\s*([^\n,;]+)/i);
    const h = findNum(text, /\b(?:h|height)\s*=\s*([^\n,;]+)/i);
    if (r != null && h != null && finalN != null) {
      if (/\bvolume\b/i.test(text)) {
        const V = Math.PI * r * r * h;
        const ok = relClose(V, finalN, 1e-3, 1e-6) || approxEqual(V, finalN, 1e-3);
        checks.push({ value: `volume=${finalN}`, ok, lhs: V, rhs: finalN, reason: ok ? null : "cylinder volume mismatch" } as any);
      }
      if (/\bsurface\s*area\b/i.test(text)) {
        const S = 2 * Math.PI * r * (r + h);
        const ok = relClose(S, finalN, 1e-3, 1e-6) || approxEqual(S, finalN, 1e-3);
        checks.push({ value: `surface=${finalN}`, ok, lhs: S, rhs: finalN, reason: ok ? null : "cylinder surface area mismatch" } as any);
      }
    }
  }

  // Cone
  if (/\bcone\b/i.test(text)) {
    const r = findNum(text, /\b(?:r|radius)\s*=\s*([^\n,;]+)/i);
    const h = findNum(text, /\b(?:h|height)\s*=\s*([^\n,;]+)/i);
    // optional slant height ℓ
    const l = findNum(text, /\b(?:l|slant)\s*=\s*([^\n,;]+)/i);
    if (r != null && h != null && finalN != null) {
      if (/\bvolume\b/i.test(text)) {
        const V = (Math.PI * r * r * h) / 3;
        const ok = relClose(V, finalN, 1e-3, 1e-6) || approxEqual(V, finalN, 1e-3);
        checks.push({ value: `volume=${finalN}`, ok, lhs: V, rhs: finalN, reason: ok ? null : "cone volume mismatch" } as any);
      }
      if (/\bsurface\s*area\b/i.test(text)) {
        const L = l != null ? l : Math.hypot(r, h);
        const S = Math.PI * r * (r + L);
        const ok = relClose(S, finalN, 1e-3, 1e-6) || approxEqual(S, finalN, 1e-3);
        checks.push({ value: `surface=${finalN}`, ok, lhs: S, rhs: finalN, reason: ok ? null : "cone surface area mismatch" } as any);
      }
    }
  }

  // Sphere
  if (/\bsphere\b/i.test(text)) {
    const r = findNum(text, /\b(?:r|radius)\s*=\s*([^\n,;]+)/i);
    if (r != null && finalN != null) {
      if (/\bvolume\b/i.test(text)) {
        const V = (4 / 3) * Math.PI * Math.pow(r, 3);
        const ok = relClose(V, finalN, 1e-3, 1e-6) || approxEqual(V, finalN, 1e-3);
        checks.push({ value: `volume=${finalN}`, ok, lhs: V, rhs: finalN, reason: ok ? null : "sphere volume mismatch" } as any);
      }
      if (/\bsurface\s*area\b/i.test(text)) {
        const S = 4 * Math.PI * r * r;
        const ok = relClose(S, finalN, 1e-3, 1e-6) || approxEqual(S, finalN, 1e-3);
        checks.push({ value: `surface=${finalN}`, ok, lhs: S, rhs: finalN, reason: ok ? null : "sphere surface area mismatch" } as any);
      }
    }
  }

  /* ---------------- Verdict ---------------- */
  if (!checks.length) return null;
  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "geometry", method: "geometry-identity", allVerified, checks };
}


