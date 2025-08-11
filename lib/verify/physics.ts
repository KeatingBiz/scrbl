import type { BoardUnderstanding, Verification } from "@/lib/types";
import { gatherProblemText, parseNumber, approxEqual } from "./utils";

type Known = Partial<{ u: number; v: number; a: number; t: number; s: number }>;

function extractKnowns(text: string): Known {
  const k: Known = {};
  const pairs: Array<[keyof Known, RegExp[]]> = [
    ["u", [/\bu\s*=\s*([-\d.]+)/i, /(initial\s*velocity|v0|u0)\s*=\s*([-\d.]+)/i]],
    ["v", [/\bv\s*=\s*([-\d.]+)/i, /(final\s*velocity|v1)\s*=\s*([-\d.]+)/i]],
    ["a", [/\ba\s*=\s*([-\d.]+)/i, /(acceleration)\s*=\s*([-\d.]+)/i]],
    ["t", [/\bt\s*=\s*([-\d.]+)/i, /(time)\s*=\s*([-\d.]+)/i]],
    ["s", [/\bs\s*=\s*([-\d.]+)/i, /(displacement|distance)\s*=\s*([-\d.]+)/i]]
  ];
  for (const [key, regs] of pairs) {
    for (const r of regs) {
      const m = r.exec(text);
      if (m && m[1]) { k[key] = parseFloat(m[1]); break; }
      if (m && m[2]) { k[key] = parseFloat(m[2]); break; }
    }
  }
  return k;
}

export function verifyPhysics(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps).toLowerCase();
  const looksKinematics = /(kinematics|uniform|constant\s*acceleration|v=u\+at|s=ut\+|v\^?2=u\^?2\+2as|\bu=|\bv=|\ba=|\bt=|\bs=)/.test(blob);
  if (!looksKinematics) return null;

  const known = extractKnowns(blob);
  const rep = parseNumber(result.final || "");
  if (rep == null) return null;

  // Try equations depending on what's known (compute whichever one the final seems to match)
  const checks: Verification["checks"] = [];

  // v = u + a t
  if (known.u != null && known.a != null && known.t != null) {
    const v = known.u + known.a * known.t;
    checks.push({ value: `v=${rep}`, ok: approxEqual(v, rep, 1e-3), lhs: v, rhs: rep, reason: approxEqual(v, rep, 1e-3) ? null : "v=u+at mismatch" });
  }

  // s = u t + 1/2 a t^2
  if (known.u != null && known.a != null && known.t != null) {
    const s = known.u * known.t + 0.5 * known.a * known.t * known.t;
    checks.push({ value: `s=${rep}`, ok: approxEqual(s, rep, 1e-2), lhs: s, rhs: rep, reason: approxEqual(s, rep, 1e-2) ? null : "s=ut+1/2at^2 mismatch" });
  }

  // v^2 = u^2 + 2 a s  → solve for v or s depending on rep
  if (known.u != null && known.a != null && known.s != null) {
    const v = Math.sqrt(Math.max(known.u ** 2 + 2 * known.a * known.s, 0));
    checks.push({ value: `v=${rep}`, ok: approxEqual(v, rep, 1e-3), lhs: v, rhs: rep, reason: approxEqual(v, rep, 1e-3) ? null : "v^2=u^2+2as mismatch" });
    const s = (rep ** 2 - known.u ** 2) / (2 * known.a);
    checks.push({ value: `s=${rep}`, ok: Number.isFinite(s), lhs: s, rhs: rep, reason: Number.isFinite(s) ? null : "invalid s" });
  }

  const any = checks.filter(c => c.ok).length > 0;
  if (!checks.length || !any) return null;

  const allVerified = checks.every(c => c.ok);
  return { subject: "physics", method: "physics-kinematics", allVerified, checks };
}

