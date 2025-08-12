// lib/verify/statics.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import { gatherProblemText, parseNumber, approxEqual, relClose } from "./utils";

const NUM = "(-?\\d*\\.?\\d+(?:e[+-]?\\d+)?)";

function parseAngleToRad(s: string): number | null {
  const m = s.match(new RegExp(`${NUM}\\s*(deg|°|degrees|rad)?`, "i"));
  if (!m) return null;
  const val = parseFloat(m[1]);
  const unit = (m[2] || "").toLowerCase();
  if (unit && /deg|°|degrees/.test(unit)) return (val * Math.PI) / 180;
  return val; // assume radians if unit omitted
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

type ForcePolar = { F: number; thetaRad: number };  // magnitude/angle (from +x axis, CCW)
type ForceXY = { Fx: number; Fy: number };

// Parse forces like "F=100 N at 30°" or "F1=200, θ1=45deg"
function parsePolarForces(blob: string): ForcePolar[] {
  const res: ForcePolar[] = [];
  // Patterns like: F=..., angle=...  OR  F1=..., theta1=...
  const re = new RegExp(`\\bF\\w*\\s*=\\s*${NUM}[^\\n]*?(?:θ|theta|angle)\\w*\\s*=\\s*${NUM}[^\\n]*`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null) {
    const seg = m[0];
    const fm = seg.match(new RegExp(`\\bF\\w*\\s*=\\s*${NUM}`, "i"));
    const am = seg.match(new RegExp(`\\b(?:θ|theta|angle)\\w*\\s*=\\s*${NUM}\\s*(deg|°|degrees|rad)?`, "i"));
    const F = fm ? parseNumber(fm[0]) : null;
    const a = am ? parseAngleToRad(am[0]) : null;
    if (F != null && a != null) res.push({ F, thetaRad: a });
  }
  return res;
}

// Parse many Fx / Fy entries like "F1x=..., F1y=..., Fx=..., Fy=..."
function parseComponentForces(blob: string): ForceXY[] {
  const out: ForceXY[] = [];
  // Try paired lines e.g., F1x=..., F1y=...
  const re = new RegExp(`\\bF\\w*?x\\s*=\\s*${NUM}[^\\n]*\\bF\\w*?y\\s*=\\s*${NUM}`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null) {
    const seg = m[0];
    const mx = seg.match(new RegExp(`\\bF\\w*?x\\s*=\\s*${NUM}`, "i"));
    const my = seg.match(new RegExp(`\\bF\\w*?y\\s*=\\s*${NUM}`, "i"));
    const Fx = mx ? parseNumber(mx[0]) : null;
    const Fy = my ? parseNumber(my[0]) : null;
    if (Fx != null && Fy != null) out.push({ Fx, Fy });
  }
  // Also accept lone Fx or Fy lists; we’ll sum separately
  const singleFx = Array.from(blob.matchAll(new RegExp(`\\bF\\w*?x\\s*=\\s*${NUM}`, "gi"))).map(m => parseNumber(m[0])!).filter(v => v!=null) as number[];
  const singleFy = Array.from(blob.matchAll(new RegExp(`\\bF\\w*?y\\s*=\\s*${NUM}`, "gi"))).map(m => parseNumber(m[0])!).filter(v => v!=null) as number[];
  // If we found some singles but not pairs, aggregate them
  if (out.length === 0 && (singleFx.length || singleFy.length)) {
    const Fx = singleFx.reduce((s, v) => s + v, 0);
    const Fy = singleFy.reduce((s, v) => s + v, 0);
    if (Number.isFinite(Fx) || Number.isFinite(Fy)) out.push({ Fx: Fx || 0, Fy: Fy || 0 });
  }
  return out;
}

export function verifyStatics(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.toLowerCase();
  const finalS = String(result.final ?? "");
  const finalN = parseNumber(finalS);

  const looksStatics =
    /\b(Σf|sum\s*of\s*forces|resultant\s*force|equilibrium|free\s*body|fbd|moment|torque|Σm|reaction|support|friction|mu|μ|normal\s*force|pin|roller|simply\s*supported)\b/i
      .test(text);
  if (!looksStatics) return null;

  const checks: Verification["checks"] = [];

  /* ---------------- Force balance from components and polar ---------------- */
  // Gather component forces
  const comp = parseComponentForces(blob); // array of {Fx,Fy}
  let sumFx = 0, sumFy = 0;
  for (const f of comp) { sumFx += f.Fx; sumFy += f.Fy; }

  // Gather polar forces and convert to components (angles measured from +x, CCW)
  const pol = parsePolarForces(blob);
  for (const p of pol) {
    sumFx += p.F * Math.cos(p.thetaRad);
    sumFy += p.F * Math.sin(p.thetaRad);
  }

  if ((comp.length > 0 || pol.length > 0) && finalN != null) {
    // If they’re reporting the magnitude of the resultant |R| or “net force”
    if (/\b(resultant|net)\s*force\b|\b\|?r\|\b/i.test(text)) {
      const R = Math.hypot(sumFx, sumFy);
      const ok = relClose(R, finalN, 1e-4, 1e-6) || approxEqual(R, finalN, 1e-4);
      checks.push({ value: `|R|=${finalN}`, ok, lhs: R, rhs: finalN, reason: ok ? null : "resultant mismatch" } as any);
    }
    // If they claim equilibrium, resultant should be ~0
    if (/\bequilibrium\b|\\?Σf\s*=\s*0/i.test(text)) {
      const R = Math.hypot(sumFx, sumFy);
      const ok = R <= 1e-3; // tolerant
      checks.push({ value: "ΣF≈0", ok, lhs: R, rhs: 0, reason: ok ? null : "not in equilibrium (ΣF≠0)" } as any);
    }
  }

  /* ---------------- Moments / torque ---------------- */
  // Simple M = F d (perpendicular) or r F sinθ
  if (/\bmoment\b|\btorque\b|\\?Σm\b/i.test(text)) {
    const F = findNum(text, new RegExp(`\\bF\\s*=\\s*${NUM}`, "i"));
    const d = findNum(text, new RegExp(`\\b(d|r)\\s*=\\s*${NUM}`, "i"));
    const ang = findNum(text, new RegExp(`\\b(angle|θ|theta)\\s*=\\s*${NUM}`, "i"));
    if (finalN != null && F != null && (d != null || ang != null)) {
      const theta = ang != null ? parseAngleToRad(String(ang)) : null;
      const M = (theta != null) ? (F * (d ?? 1) * Math.sin(theta)) : (F * (d ?? 0));
      const ok = relClose(M, finalN, 1e-4, 1e-6) || approxEqual(M, finalN, 1e-4);
      checks.push({ value: `M=${finalN}`, ok, lhs: M, rhs: finalN, reason: ok ? null : "moment mismatch" } as any);
    }
  }

  /* ---------------- Weight W = m g ---------------- */
  if (/\bweight\b|w\s*=\s*m\s*g/i.test(text)) {
    const m = findNum(text, new RegExp(`\\bm\\s*=\\s*${NUM}`, "i"));
    const g = findNum(text, new RegExp(`\\bg\\s*=\\s*${NUM}`, "i")) ?? 9.81;
    if (m != null && finalN != null) {
      const W = m * g;
      const ok = relClose(W, finalN, 1e-4, 1e-6) || approxEqual(W, finalN, 1e-4);
      checks.push({ value: `W=${finalN}`, ok, lhs: W, rhs: finalN, reason: ok ? null : "W=mg mismatch" } as any);
    }
  }

  /* ---------------- Friction: F ≤ μ N; required friction ---------------- */
  if (/\bfriction\b|\\?μ|mu\b/i.test(text)) {
    const mu = findNum(text, new RegExp(`(?:μ|mu)\\s*=\\s*${NUM}`, "i"));
    const N = findNum(text, new RegExp(`\\bN\\s*=\\s*${NUM}`, "i"));
    const Freq = findNum(text, new RegExp(`\\bF\\s*(?:req|required)?\\s*=\\s*${NUM}`, "i"));
    if (mu != null && N != null && finalN != null) {
      const Fmax = mu * N;
      // If the final looks like a max friction or a check that “will it slip?”
      if (/\bmax|limit|threshold/i.test(text)) {
        const ok = relClose(Fmax, finalN, 1e-4, 1e-6) || approxEqual(Fmax, finalN, 1e-4);
        checks.push({ value: `F_max=${finalN}`, ok, lhs: Fmax, rhs: finalN, reason: ok ? null : "μN mismatch" } as any);
      } else if (Freq != null) {
        const ok = Freq <= Fmax + 1e-6;
        checks.push({ value: `no-slip?`, ok, lhs: Freq, rhs: Fmax, reason: ok ? null : "required friction exceeds μN" } as any);
      }
    }
  }

  /* ---------------- Simple beam: single point load on simply supported span ----------------
     Assumes:
       - Span L
       - Point load W at distance a from A (or at x, with 0≤x≤L)
       - Reactions RA at A (pin) and RB at B (roller)
     Then: RB = W * a / L;  RA = W - RB
  ---------------------------------------------------------------------- */
  if (/simply\s*supported|pin\b.*roller\b|reactions?\b/i.test(text)) {
    const L = findNum(text, new RegExp(`\\bL\\s*=\\s*${NUM}`, "i"));
    // Accept "at x=..." or "a=..." from A
    const a = findNum(text, new RegExp(`\\ba\\s*=\\s*${NUM}`, "i")) ??
              findNum(text, new RegExp(`\\bx\\s*=\\s*${NUM}`, "i"));
    const W = findNum(text, new RegExp(`\\bW\\s*=\\s*${NUM}`, "i")) ??
              findNum(text, new RegExp(`\\bP\\s*=\\s*${NUM}`, "i"));
    if (L != null && a != null && W != null && finalN != null && L > 0 && a >= 0 && a <= L) {
      const RB = W * (a / L);
      const RA = W - RB;
      // Try to detect which reaction they’re asking for; else try both
      const wantRB = /\bR?B\b|reaction\s*at\s*B/i.test(text);
      const wantRA = /\bR?A\b|reaction\s*at\s*A/i.test(text);
      if (wantRB) {
        const ok = relClose(RB, finalN, 1e-4, 1e-6) || approxEqual(RB, finalN, 1e-4);
        checks.push({ value: `RB=${finalN}`, ok, lhs: RB, rhs: finalN, reason: ok ? null : "RB mismatch" } as any);
      } else if (wantRA) {
        const ok = relClose(RA, finalN, 1e-4, 1e-6) || approxEqual(RA, finalN, 1e-4);
        checks.push({ value: `RA=${finalN}`, ok, lhs: RA, rhs: finalN, reason: ok ? null : "RA mismatch" } as any);
      } else {
        // Unknown which one — accept if matches either
        const ok = relClose(RA, finalN, 1e-4, 1e-6) || approxEqual(RA, finalN, 1e-4) ||
                   relClose(RB, finalN, 1e-4, 1e-6) || approxEqual(RB, finalN, 1e-4);
        checks.push({ value: `RA/RB=${finalN}`, ok, lhs: RA, rhs: finalN, reason: ok ? null : "reaction mismatch" } as any);
      }
    }
  }

  /* ---------------- Verdict ---------------- */
  if (!checks.length) return null;
  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "statics", method: "statics-2d", allVerified, checks } as unknown as Verification;
}
