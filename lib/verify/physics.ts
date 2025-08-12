// lib/verify/physics.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import { gatherProblemText, parseNumber, approxEqual, relClose } from "./utils";

/**
 * What this verifier covers (numeric checks):
 * - Kinematics (constant acceleration): v = u + a t, s = u t + 1/2 a t^2, v^2 = u^2 + 2 a s
 * - Projectile motion (level ground): time of flight T, range R, max height H
 * - Newton's 2nd law: F = m a, weight W = m g, friction F_f = μ N
 * - Work/Energy/Power: W = F d cosθ, ΔK = W_net, KE = 1/2 m v^2, PE = m g h, P = W/t or F v
 * - Momentum & 1D elastic collisions: p = m v, v1', v2' formulas
 * - Circular motion: a_c = v^2/r = ω^2 r, F_c = m a_c, T = 2π r / v = 2π/ω
 * - Springs (Hooke’s law): F = k x, PE_spring = 1/2 k x^2
 *
 * It pulls "known" values from the problem text (question/raw/steps) and compares a numeric final
 * to whichever derived quantity fits. We keep strict runtime budget and only run cheap checks.
 */

type Known = Partial<{
  // common kinematics
  u: number; v: number; a: number; t: number; s: number;
  // alt symbols
  v0: number; v1: number; v2: number;
  // general
  m: number; F: number; d: number; h: number; g: number; r: number; T: number; omega: number;
  theta: number; // radians
  mu: number;    // coefficient of friction
  // springs
  k: number; x: number;
  // collisions
  m1: number; m2: number; v1i: number; v2i: number; v1f: number; v2f: number;
}>;

const NUM = "(-?\\d*\\.?\\d+(?:e[+-]?\\d+)?)";

// parse degrees → radians if unit present
function parseAngleToRad(s: string): number | null {
  const m = s.match(new RegExp(`${NUM}\\s*(deg|°|degrees|rad)?`, "i"));
  if (!m) return null;
  const val = parseFloat(m[1]);
  const unit = (m[2] || "").toLowerCase();
  if (unit && /deg|°|degrees/.test(unit)) return (val * Math.PI) / 180;
  return val;
}

function firstNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(new RegExp(NUM, "i"));
  return m ? parseFloat(m[0]) : null;
}

function pick(text: string, regs: RegExp[], angle = false): number | undefined {
  for (const r of regs) {
    const m = r.exec(text);
    if (!m) continue;
    if (angle) {
      const a = parseAngleToRad(m[1]);
      if (a != null) return a;
    } else {
      const n = firstNumber(m[1]);
      if (n != null) return n;
    }
  }
  return undefined;
}

function extractKnowns(textRaw: string): Known {
  const text = textRaw.toLowerCase();

  // helpful defaults
  const k: Known = {};

  // Kinematics symbols and synonyms
  k.u = pick(text, [/\bu\s*=\s*([^,\n;]+)/i, /\b(v0|u0|initial\s*velocity)\s*=\s*([^,\n;]+)/i]) ?? k.u;
  k.v = pick(text, [/\bv\s*=\s*([^,\n;]+)/i, /\b(final\s*velocity|v1)\s*=\s*([^,\n;]+)/i]) ?? k.v;
  k.a = pick(text, [/\ba\s*=\s*([^,\n;]+)/i, /\bacceleration\s*=\s*([^,\n;]+)/i]) ?? k.a;
  k.t = pick(text, [/\bt\s*=\s*([^,\n;]+)/i, /\btime\s*=\s*([^,\n;]+)/i]) ?? k.t;
  k.s = pick(text, [/\bs\s*=\s*([^,\n;]+)/i, /\b(displacement|distance)\s*=\s*([^,\n;]+)/i]) ?? k.s;

  // General mechanics
  k.m = pick(text, [/\bm\s*=\s*([^,\n;]+)/i, /\bmass\s*=\s*([^,\n;]+)/i]) ?? k.m;
  k.F = pick(text, [/\bF\s*=\s*([^,\n;]+)/i, /\bforce\s*=\s*([^,\n;]+)/i]) ?? k.F;
  k.d = pick(text, [/\bd\s*=\s*([^,\n;]+)/i, /\bdistance\s*=\s*([^,\n;]+)/i]) ?? k.d;
  k.h = pick(text, [/\bh\s*=\s*([^,\n;]+)/i, /\bheight\s*=\s*([^,\n;]+)/i]) ?? k.h;
  k.r = pick(text, [/\br\s*=\s*([^,\n;]+)/i, /\bradius\s*=\s*([^,\n;]+)/i]) ?? k.r;
  k.T = pick(text, [/\bT\s*=\s*([^,\n;]+)/, /\bperiod\s*=\s*([^,\n;]+)/i]) ?? k.T;
  k.omega = pick(text, [/(?:\bomega|ω|angular\s*velocity)\s*=\s*([^,\n;]+)/i]) ?? k.omega;

  // Gravity and friction
  k.g = pick(text, [/\bg\s*=\s*([^,\n;]+)/i, /\b(gravity|gravitational\s*acceleration)\s*=\s*([^,\n;]+)/i]) ?? k.g;
  k.mu = pick(text, [/(?:μ|mu|coefficient\s*of\s*friction)\s*=\s*([^,\n;]+)/i]) ?? k.mu;

  // Angles
  const thetaVal = pick(text, [/(?:θ|theta|angle)\s*=\s*([^,\n;]+)/i], true);
  if (thetaVal != null) k.theta = thetaVal;

  // Springs
  k.k = pick(text, [/\bk\s*=\s*([^,\n;]+)/i, /\bspring\s*constant\s*=\s*([^,\n;]+)/i]) ?? k.k;
  k.x = pick(text, [/\bx\s*=\s*([^,\n;]+)/i, /\b(extension|compression)\s*=\s*([^,\n;]+)/i]) ?? k.x;

  // Collisions (1D)
  k.m1 = pick(text, [/\bm1\s*=\s*([^,\n;]+)/i]) ?? k.m1;
  k.m2 = pick(text, [/\bm2\s*=\s*([^,\n;]+)/i]) ?? k.m2;
  k.v1i = pick(text, [/\bv1i?\s*=\s*([^,\n;]+)/i, /\binitial\s*velocity\s*1\s*=\s*([^,\n;]+)/i]) ?? k.v1i;
  k.v2i = pick(text, [/\bv2i?\s*=\s*([^,\n;]+)/i, /\binitial\s*velocity\s*2\s*=\s*([^,\n;]+)/i]) ?? k.v2i;
  k.v1f = pick(text, [/\bv1f\s*=\s*([^,\n;]+)/i, /\bfinal\s*velocity\s*1\s*=\s*([^,\n;]+)/i]) ?? k.v1f;
  k.v2f = pick(text, [/\bv2f\s*=\s*([^,\n;]+)/i, /\bfinal\s*velocity\s*2\s*=\s*([^,\n;]+)/i]) ?? k.v2f;

  // Aliases
  if (k.v0 != null && k.u == null) k.u = k.v0;

  return k;
}

function cosSafe(thetaRad?: number): number | null {
  if (thetaRad == null || !Number.isFinite(thetaRad)) return null;
  return Math.cos(thetaRad);
}

export function verifyPhysics(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.toLowerCase();
  const finalS = String(result.final ?? "");

  // Expand the matcher beyond pure kinematics so this plugin runs for common physics tasks.
  const looksPhysics = /\b(kinematics|acceleration|displacement|velocity|projectile|range|height|force|mass|energy|work|power|momentum|collision|elastic|radius|centripetal|period|omega|spring|hooke|friction|coefficient)\b/.test(
    text
  ) || /\b(u|v|a|t|s|m|f|r|g|k|x|μ|theta|θ)\s*=/.test(text);
  if (!looksPhysics) return null;

  const known = extractKnowns(text);
  const rep = parseNumber(finalS);
  if (rep == null) return null;

  const g = Number.isFinite(known.g!) ? (known.g as number) : 9.8; // default Earth gravity

  const checks: Verification["checks"] = [];

  /* -------------------- Kinematics (constant a) -------------------- */
  if (known.u != null && known.a != null && known.t != null) {
    const v = known.u + known.a * known.t;
    const ok = approxEqual(v, rep, 1e-3) || relClose(v, rep, 1e-3, 1e-6);
    checks.push({ value: `v=${rep}`, ok, lhs: v, rhs: rep, reason: ok ? null : "v=u+at mismatch" });
  }

  if (known.u != null && known.a != null && known.t != null) {
    const s = known.u * known.t + 0.5 * known.a * known.t * known.t;
    const ok = approxEqual(s, rep, 1e-2) || relClose(s, rep, 1e-3, 1e-6);
    checks.push({ value: `s=${rep}`, ok, lhs: s, rhs: rep, reason: ok ? null : "s=ut+1/2at^2 mismatch" });
  }

  if (known.u != null && known.a != null && known.s != null) {
    const vv = known.u ** 2 + 2 * known.a * known.s;
    const v = vv >= 0 ? Math.sqrt(vv) : NaN;
    if (Number.isFinite(v)) {
      const ok = approxEqual(v, rep, 1e-3) || relClose(v, rep, 1e-3, 1e-6);
      checks.push({ value: `v=${rep}`, ok, lhs: v, rhs: rep, reason: ok ? null : "v^2=u^2+2as mismatch" });
    }
  }

  /* -------------------- Projectile motion (level ground) -------------------- */
  // Use u (or v) as initial speed and theta as launch angle; assume flat launch/landing and g>0.
  const v0 = known.u ?? known.v0 ?? known.v;
  if (v0 != null && known.theta != null) {
    const sin = Math.sin(known.theta);
    const cos = Math.cos(known.theta);
    const T = (2 * v0 * sin) / g;                          // time of flight
    const R = (v0 * v0 * Math.sin(2 * known.theta)) / g;   // range
    const H = (v0 * v0 * sin * sin) / (2 * g);             // max height
    const okT = relClose(T, rep, 2e-2, 1e-4) || approxEqual(T, rep, 1e-3);
    const okR = relClose(R, rep, 2e-2, 1e-4) || approxEqual(R, rep, 1e-3);
    const okH = relClose(H, rep, 2e-2, 1e-4) || approxEqual(H, rep, 1e-3);
    checks.push({ value: `T=${rep}`, ok: okT, lhs: T, rhs: rep, reason: okT ? null : "projectile T mismatch" });
    checks.push({ value: `R=${rep}`, ok: okR, lhs: R, rhs: rep, reason: okR ? null : "projectile R mismatch" });
    checks.push({ value: `H=${rep}`, ok: okH, lhs: H, rhs: rep, reason: okH ? null : "projectile H mismatch" });
  }

  /* -------------------- Newton's laws / friction -------------------- */
  if (known.m != null && known.a != null) {
    const F = known.m * known.a;
    const ok = relClose(F, rep, 2e-3, 1e-6) || approxEqual(F, rep, 1e-3);
    checks.push({ value: `F=${rep}`, ok, lhs: F, rhs: rep, reason: ok ? null : "F=ma mismatch" });
  }

  if (known.m != null) {
    const W = known.m * g;
    const ok = relClose(W, rep, 2e-3, 1e-6) || approxEqual(W, rep, 1e-3);
    checks.push({ value: `weight=${rep}`, ok, lhs: W, rhs: rep, reason: ok ? null : "W=mg mismatch" });
  }

  if (known.mu != null && known.m != null) {
    const N = known.m * g;
    const Ff = known.mu * N;
    const ok = relClose(Ff, rep, 2e-2, 1e-4) || approxEqual(Ff, rep, 1e-3);
    checks.push({ value: `friction=${rep}`, ok, lhs: Ff, rhs: rep, reason: ok ? null : "F_f=μN mismatch" });
  }

  /* -------------------- Work / Energy / Power -------------------- */
  // Work: W = F d cosθ (θ optional → cosθ=1)
  if (known.F != null && known.d != null) {
    const c = cosSafe(known.theta) ?? 1;
    const W = known.F * known.d * c;
    const ok = relClose(W, rep, 2e-2, 1e-4) || approxEqual(W, rep, 1e-3);
    checks.push({ value: `W=${rep}`, ok, lhs: W, rhs: rep, reason: ok ? null : "W=F d cosθ mismatch" });
  }

  // KE and PE
  if (known.m != null && (known.v != null || known.u != null)) {
    const vuse = (known.v ?? known.u)!;
    const KE = 0.5 * known.m * vuse * vuse;
    const ok = relClose(KE, rep, 2e-2, 1e-4) || approxEqual(KE, rep, 1e-3);
    checks.push({ value: `KE=${rep}`, ok, lhs: KE, rhs: rep, reason: ok ? null : "KE=1/2 m v^2 mismatch" });
  }
  if (known.m != null && known.h != null) {
    const PE = known.m * g * known.h;
    const ok = relClose(PE, rep, 2e-2, 1e-4) || approxEqual(PE, rep, 1e-3);
    checks.push({ value: `PE=${rep}`, ok, lhs: PE, rhs: rep, reason: ok ? null : "PE=mgh mismatch" });
  }

  // Power: P = W/t or P = F v
  if (known.F != null && (known.v != null || known.u != null)) {
    const vuse = (known.v ?? known.u)!;
    const P = known.F * vuse;
    const ok = relClose(P, rep, 2e-2, 1e-4) || approxEqual(P, rep, 1e-3);
    checks.push({ value: `P=${rep}`, ok, lhs: P, rhs: rep, reason: ok ? null : "P=Fv mismatch" });
  }
  if (known.d != null && known.F != null && known.t != null) {
    const c = cosSafe(known.theta) ?? 1;
    const W = known.F * known.d * c;
    const P = W / known.t;
    const ok = relClose(P, rep, 2e-2, 1e-4) || approxEqual(P, rep, 1e-3);
    checks.push({ value: `P=${rep}`, ok, lhs: P, rhs: rep, reason: ok ? null : "P=W/t mismatch" });
  }

  // Work–energy theorem ΔK = W_net (if u and v present plus F·d)
  if (known.m != null && known.u != null && known.v != null && known.F != null && known.d != null) {
    const c = cosSafe(known.theta) ?? 1;
    const Wnet = known.F * known.d * c;
    const dK = 0.5 * known.m * (known.v ** 2 - known.u ** 2);
    const ok = relClose(dK, Wnet, 3e-2, 1e-4) || approxEqual(dK, Wnet, 1e-2);
    checks.push({ value: `ΔK≈W_net`, ok, lhs: dK, rhs: Wnet, reason: ok ? null : "ΔK != W_net" });
  }

  /* -------------------- Momentum & 1D elastic collisions -------------------- */
  // Single object momentum
  if (known.m != null && (known.v != null || known.u != null)) {
    const vuse = (known.v ?? known.u)!;
    const p = known.m * vuse;
    const ok = relClose(p, rep, 2e-2, 1e-4) || approxEqual(p, rep, 1e-3);
    checks.push({ value: `p=${rep}`, ok, lhs: p, rhs: rep, reason: ok ? null : "p=mv mismatch" });
  }

  // Two-body elastic collision (1D, head-on)
  if (known.m1 != null && known.m2 != null && known.v1i != null && known.v2i != null) {
    const m1 = known.m1!, m2 = known.m2!, v1i = known.v1i!, v2i = known.v2i!;
    const v1f = ((m1 - m2) / (m1 + m2)) * v1i + (2 * m2 / (m1 + m2)) * v2i;
    const v2f = (2 * m1 / (m1 + m2)) * v1i + ((m2 - m1) / (m1 + m2)) * v2i;
    const ok1 = relClose(v1f, rep, 2e-2, 1e-4) || approxEqual(v1f, rep, 1e-3);
    const ok2 = relClose(v2f, rep, 2e-2, 1e-4) || approxEqual(v2f, rep, 1e-3);
    checks.push({ value: `v1'=${rep}`, ok: ok1, lhs: v1f, rhs: rep, reason: ok1 ? null : "elastic v1' mismatch" });
    checks.push({ value: `v2'=${rep}`, ok: ok2, lhs: v2f, rhs: rep, reason: ok2 ? null : "elastic v2' mismatch" });
  }

  /* -------------------- Circular motion -------------------- */
  if ((known.v != null && known.r != null) || (known.omega != null && known.r != null)) {
    const ac_vr = known.v != null && known.r != null ? (known.v ** 2) / known.r : null;
    const ac_om = known.omega != null && known.r != null ? (known.omega ** 2) * known.r : null;
    const ac = ac_vr ?? ac_om!;
    if (ac != null && Number.isFinite(ac)) {
      const okAc = relClose(ac, rep, 2e-2, 1e-4) || approxEqual(ac, rep, 1e-3);
      checks.push({ value: `a_c=${rep}`, ok: okAc, lhs: ac, rhs: rep, reason: okAc ? null : "a_c mismatch" });
      if (known.m != null) {
        const Fc = known.m * ac;
        const okFc = relClose(Fc, rep, 2e-2, 1e-4) || approxEqual(Fc, rep, 1e-3);
        checks.push({ value: `F_c=${rep}`, ok: okFc, lhs: Fc, rhs: rep, reason: okFc ? null : "F_c=ma_c mismatch" });
      }
    }
  }
  if (known.r != null && (known.v != null || known.T != null || known.omega != null)) {
    const vFromT = known.T != null ? (2 * Math.PI * known.r) / known.T : null;
    const TfromV = known.v != null ? (2 * Math.PI * known.r) / known.v : null;
    const oFromT = known.T != null ? (2 * Math.PI) / known.T : null;
    const TfromOm = known.omega != null ? (2 * Math.PI) / known.omega : null;

    for (const [label, lhs] of [
      ["v_circ", vFromT],
      ["T", TfromV],
      ["ω", oFromT],
      ["T", TfromOm],
    ] as const) {
      if (lhs != null && Number.isFinite(lhs)) {
        const ok = relClose(lhs, rep, 2e-2, 1e-4) || approxEqual(lhs, rep, 1e-3);
        checks.push({ value: `${label}=${rep}`, ok, lhs, rhs: rep, reason: ok ? null : `${label} mismatch` });
      }
    }
  }

  /* -------------------- Springs (Hooke) -------------------- */
  if (known.k != null && known.x != null) {
    const Fspring = known.k * known.x;
    const okF = relClose(Fspring, rep, 2e-2, 1e-4) || approxEqual(Fspring, rep, 1e-3);
    checks.push({ value: `F=kx=${rep}`, ok: okF, lhs: Fspring, rhs: rep, reason: okF ? null : "F=kx mismatch" });

    const U = 0.5 * known.k * known.x * known.x;
    const okU = relClose(U, rep, 2e-2, 1e-4) || approxEqual(U, rep, 1e-3);
    checks.push({ value: `U_spring=${rep}`, ok: okU, lhs: U, rhs: rep, reason: okU ? null : "U=1/2 k x^2 mismatch" });
  }

  /* -------------------- Sanity / ranges -------------------- */
  // non-negative mass, time; |mu| >= 0
  if (known.m != null) checks.push({ value: "m>=0", ok: known.m >= 0, reason: known.m >= 0 ? null : "negative mass" });
  if (known.t != null) checks.push({ value: "t>=0", ok: known.t >= 0, reason: known.t >= 0 ? null : "negative time" });
  if (known.mu != null) checks.push({ value: "μ>=0", ok: known.mu >= 0, reason: known.mu >= 0 ? null : "negative μ" });

  /* -------------------- verdict -------------------- */
  const any = checks.some((c) => c.ok);
  if (!checks.length || !any) return null;

  const allVerified = checks.every((c) => c.ok);
  return { subject: "physics", method: "physics-kinematics", allVerified, checks };
}


