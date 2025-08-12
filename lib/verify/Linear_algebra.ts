// lib/verify/linear_algebra.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import { gatherProblemText, parseNumber, approxEqual, relClose } from "./utils";

/* ===================== Tiny matrix utilities ===================== */
type Mat = number[][];
type Vec = number[];

const EPS = 1e-9;

const isFiniteNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function clone(A: Mat): Mat { return A.map(r => r.slice()); }
function shape(A: Mat): [number, number] { return [A.length, A[0]?.length ?? 0]; }

function mmul(A: Mat, B: Mat): Mat {
  const [m, n] = shape(A); const [n2, p] = shape(B);
  if (n !== n2) throw new Error("mmul dims");
  const C: Mat = Array.from({ length: m }, () => Array(p).fill(0));
  for (let i = 0; i < m; i++) for (let k = 0; k < n; k++) {
    const aik = A[i][k]; if (!Number.isFinite(aik)) continue;
    for (let j = 0; j < p; j++) C[i][j] += aik * B[k][j];
  }
  return C;
}
function mv(A: Mat, v: Vec): Vec {
  const [m, n] = shape(A); if (n !== v.length) throw new Error("mv dims");
  const y = Array(m).fill(0);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) y[i] += A[i][j] * v[j];
  return y;
}
function eye(n: number): Mat { return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))); }
function transpose(A: Mat): Mat { const [m, n] = shape(A); return Array.from({ length: n }, (_, j) => Array.from({ length: m }, (_, i) => A[i][j])); }
function absMax(A: Mat): number { let m = 0; for (const r of A) for (const x of r) m = Math.max(m, Math.abs(x)); return m; }

function nearlyEqual(a: number, b: number, tolAbs = 1e-6, tolRel = 1e-6) {
  return relClose(a, b, tolRel, tolAbs) || approxEqual(a, b, tolAbs);
}
function vectorClose(a: Vec, b: Vec, tolAbs = 1e-6, tolRel = 1e-6) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!nearlyEqual(a[i], b[i], tolAbs, tolRel)) return false;
  return true;
}
function matrixClose(A: Mat, B: Mat, tolAbs = 1e-6, tolRel = 1e-6) {
  const [m, n] = shape(A); const [m2, n2] = shape(B);
  if (m !== m2 || n !== n2) return false;
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
    if (!nearlyEqual(A[i][j], B[i][j], tolAbs, tolRel)) return false;
  }
  return true;
}

/* -------- Determinant via Gaussian elimination with partial pivot -------- */
function determinant(Ain: Mat): number {
  const A = clone(Ain);
  const [n, m] = shape(A);
  if (n !== m) return NaN;
  let det = 1;
  for (let i = 0; i < n; i++) {
    // pivot
    let piv = i, val = Math.abs(A[i][i]);
    for (let r = i + 1; r < n; r++) {
      const v = Math.abs(A[r][i]);
      if (v > val) { val = v; piv = r; }
    }
    if (val < EPS) return 0;
    if (piv !== i) { [A[i], A[piv]] = [A[piv], A[i]]; det *= -1; }
    det *= A[i][i];
    const inv = 1 / A[i][i];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] * inv;
      if (Math.abs(f) < EPS) continue;
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
    }
  }
  return det;
}

/* -------- RREF + rank + solve -------- */
function rref(Ain: Mat, tol = 1e-10): Mat {
  const A = clone(Ain);
  let lead = 0;
  const rowCount = A.length, colCount = A[0]?.length ?? 0;
  for (let r = 0; r < rowCount; r++) {
    if (lead >= colCount) return A;
    let i = r;
    while (i < rowCount && Math.abs(A[i][lead]) < tol) i++;
    if (i === rowCount) { lead++; r--; continue; }
    [A[i], A[r]] = [A[r], A[i]];
    const div = A[r][lead];
    for (let j = 0; j < colCount; j++) A[r][j] /= div;
    for (let i2 = 0; i2 < rowCount; i2++) if (i2 !== r) {
      const f = A[i2][lead];
      if (Math.abs(f) > tol) for (let j = 0; j < colCount; j++) A[i2][j] -= f * A[r][j];
    }
    lead++;
  }
  return A;
}
function rank(A: Mat, tol = 1e-10): number {
  const R = rref(A, tol);
  let r = 0;
  for (const row of R) if (row.some(x => Math.abs(x) > tol)) r++;
  return r;
}
function solveLinear(A: Mat, b: Vec): Vec | null {
  const n = A.length, m = A[0]?.length ?? 0;
  if (n !== m || b.length !== n) return null;
  // Augmented
  const M: Mat = A.map((row, i) => row.concat([b[i]]));
  // Elimination with partial pivot
  for (let i = 0; i < n; i++) {
    // pivot
    let piv = i, val = Math.abs(M[i][i]);
    for (let r = i + 1; r < n; r++) {
      const v = Math.abs(M[r][i]);
      if (v > val) { val = v; piv = r; }
    }
    if (val < EPS) return null; // singular
    if (piv !== i) [M[i], M[piv]] = [M[piv], M[i]];
    // normalize
    const inv = 1 / M[i][i];
    for (let j = i; j <= n; j++) M[i][j] *= inv;
    // eliminate
    for (let r = 0; r < n; r++) if (r !== i) {
      const f = M[r][i];
      if (Math.abs(f) < EPS) continue;
      for (let j = i; j <= n; j++) M[r][j] -= f * M[i][j];
    }
  }
  return M.map(row => row[n]);
}
function inverse(A: Mat): Mat | null {
  const n = A.length, m = A[0]?.length ?? 0;
  if (n !== m) return null;
  const M: Mat = A.map((row, i) => row.concat(eye(n)[i]));
  // Gauss-Jordan
  for (let i = 0; i < n; i++) {
    // pivot
    let piv = i, val = Math.abs(M[i][i]);
    for (let r = i + 1; r < n; r++) {
      const v = Math.abs(M[r][i]);
      if (v > val) { val = v; piv = r; }
    }
    if (val < EPS) return null;
    if (piv !== i) [M[i], M[piv]] = [M[piv], M[i]];
    // normalize
    const inv = 1 / M[i][i];
    for (let j = 0; j < 2 * n; j++) M[i][j] *= inv;
    // eliminate
    for (let r = 0; r < n; r++) if (r !== i) {
      const f = M[r][i];
      if (Math.abs(f) < EPS) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[i][j];
    }
  }
  // right half
  return M.map(row => row.slice(n));
}

/* -------- 2×2 eigenvalues -------- */
function eigenvals2(A: Mat): number[] | null {
  const [n, m] = shape(A);
  if (n !== 2 || m !== 2) return null;
  const tr = A[0][0] + A[1][1];
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const disc = tr * tr - 4 * det;
  if (disc < -1e-10) return null; // complex; skip
  const s = Math.sqrt(Math.max(0, disc));
  return [(tr + s) / 2, (tr - s) / 2];
}

/* ===================== Parsing matrices/vectors ===================== */
function parseNumberList(s: string): number[] {
  const matches = s.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi) || [];
  return matches.map(Number).filter(isFiniteNum);
}
function parseVector(text: string): Vec | null {
  // Match [1 2 3], <1,2,3>, (1,2,3)
  const m = text.match(/[\[\(<]\s*([^\]\)>]+)\s*[\]\)>]/);
  if (!m) return null;
  const nums = parseNumberList(m[1]);
  return nums.length > 0 ? nums : null;
}
function parseMatrix(text: string): Mat | null {
  // Try [[a,b];[c,d]] or [a b; c d] or rows split by newline/semicolon
  const m = text.match(/\[\s*([\s\S]*?)\s*\]/);
  if (!m) return null;
  const inside = m[1].trim();
  // Split rows by ; or newline
  const rows = inside
    .split(/;|\n/).map(r => r.trim()).filter(Boolean);
  const mat: Mat = rows.map(r => {
    // split by spaces or commas
    const nums = parseNumberList(r);
    return nums;
  });
  if (mat.length === 0) return null;
  const n = mat[0].length;
  if (!mat.every(r => r.length === n)) return null;
  return mat;
}

function findLabeledMatrix(blob: string, label: string): Mat | null {
  // e.g., A = [ ... ]
  const re = new RegExp(`${label}\\s*=\\s*(\\[[\\s\\S]*?\\])`, "i");
  const m = blob.match(re);
  if (m && m[1]) return parseMatrix(m[1]);
  return null;
}
function findAnyMatrices(blob: string): Mat[] {
  const mats: Mat[] = [];
  const re = /\[[^\[\]]*?(?:\[[\s\S]*?\][^\[\]]*?)*\]/g; // grab bracketed chunks
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null) {
    const A = parseMatrix(m[0]);
    if (A && A.length > 1 && (A[0]?.length ?? 0) > 0) mats.push(A);
  }
  return mats;
}
function findAnyVectors(blob: string): Vec[] {
  const vs: Vec[] = [];
  const re = /[\[\(<][^\]\)>]+[\]\)>]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null) {
    const v = parseVector(m[0]);
    if (v && v.length >= 1) vs.push(v);
  }
  return vs;
}
function parseFinalVectorOrNumber(finalS: string): { vec?: Vec, num?: number, mat?: Mat } {
  const mat = parseMatrix(finalS);
  if (mat) return { mat };
  const vec = parseVector(finalS);
  if (vec) return { vec };
  const num = parseNumber(finalS) ?? undefined;
  return { num };
}

/* =============================== main =============================== */
export function verifyLinearAlgebra(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.replace(/[–—−]/g, "-");
  const lower = text.toLowerCase();
  const finalS = String(result.final ?? "");
  const { vec: finalVec, num: finalNum, mat: finalMat } = parseFinalVectorOrNumber(finalS);

  const looksLA =
    /\b(matrix|matrices|det|determinant|inverse|rank|eigenvalue|eigenvector|eigs?|ax\s*=\s*b|linear\s*system|dot\s*product|cross\s*product|projection|norm)\b/.test(lower) ||
    /\|\s*A\s*\||A\s*=\s*\[|x\s*=\s*\[|\bRREF\b|\brow[-\s]*reduced\b/i.test(text);
  if (!looksLA) return null;

  const checks: Verification["checks"] = [];

  /* ---------- Determinant ---------- */
  if (/\bdet|determinant|\|\s*A\s*\|/.test(lower) && finalNum != null) {
    let A = findLabeledMatrix(text, "A");
    if (!A) {
      const mats = findAnyMatrices(text);
      A = mats.find(M => { const [m, n] = shape(M); return m === n && m >= 2; }) || null;
    }
    if (A) {
      const val = determinant(A);
      if (Number.isFinite(val)) {
        const ok = nearlyEqual(val, finalNum, 1e-8, 1e-8);
        checks.push({ value: `det=${finalNum}`, ok, lhs: val, rhs: finalNum, reason: ok ? null : "determinant mismatch" } as any);
      }
    }
  }

  /* ---------- Rank ---------- */
  if (/\brank\b/.test(lower) && finalNum != null) {
    let A = findLabeledMatrix(text, "A");
    if (!A) {
      const mats = findAnyMatrices(text);
      A = mats[0] || null;
    }
    if (A) {
      const val = rank(A, Math.max(1e-10, absMax(A) * 1e-12));
      const ok = nearlyEqual(val, finalNum, 1e-8, 1e-8);
      checks.push({ value: `rank=${finalNum}`, ok, lhs: val, rhs: finalNum, reason: ok ? null : "rank mismatch" } as any);
    }
  }

  /* ---------- Solve Ax=b ---------- */
  if (/\bax\s*=\s*b\b|\bsolve\b|\bsolution\b/.test(lower) && finalVec) {
    let A = findLabeledMatrix(text, "A");
    let b: Vec | null = null;
    // Try b vector after "b="
    const bm = text.match(/\bb\s*=\s*([\[\(<][^\]\)>]+[\]\)>])/i);
    if (bm && bm[1]) b = parseVector(bm[1]);
    // Fallback: first square matrix is A, next vector is b
    if (!A) {
      const mats = findAnyMatrices(text);
      A = mats.find(M => shape(M)[0] === shape(M)[1]) || null;
    }
    if (!b) {
      const vs = findAnyVectors(text);
      b = vs.find(v => v.length === (A ? shape(A)[0] : v.length)) || null;
    }
    if (A && b && b.length === shape(A)[0]) {
      const x = solveLinear(A, b);
      if (x) {
        const ok = vectorClose(x, finalVec, 1e-6, 1e-6);
        checks.push({ value: `x≈${JSON.stringify(finalVec)}`, ok, lhs: x[0], rhs: finalVec[0], reason: ok ? null : "Ax=b solution mismatch" } as any);
      }
    }
  }

  /* ---------- Inverse A^{-1} ---------- */
  if (/\binverse\b|A\^?-?1\b/.test(lower) && finalMat) {
    let A = findLabeledMatrix(text, "A");
    if (!A) {
      // Choose a square matrix different in size from final to avoid picking the inverse itself
      const mats = findAnyMatrices(text);
      A = mats.find(M => { const [m, n] = shape(M); return m === n && !(finalMat && shape(finalMat)[0] === m); }) || null;
    }
    if (A) {
      const Ainvs = inverse(A);
      if (Ainvs) {
        const ok = matrixClose(Ainvs, finalMat, 1e-6, 1e-6);
        checks.push({ value: `A^{-1}≈final`, ok, lhs: Ainvs[0]?.[0], rhs: finalMat[0]?.[0], reason: ok ? null : "inverse mismatch" } as any);
      }
    }
  }

  /* ---------- Eigenvalues (2×2) ---------- */
  if (/\beigenvalue|eigenpair|eigs?\b/.test(lower) && finalVec) {
    let A = findLabeledMatrix(text, "A");
    if (!A) {
      const mats = findAnyMatrices(text);
      A = mats.find(M => { const [m, n] = shape(M); return m === 2 && n === 2; }) || null;
    }
    if (A && shape(A)[0] === 2 && shape(A)[1] === 2) {
      const eigs = eigenvals2(A);
      if (eigs) {
        // Compare as sets (order-insensitive) vs the numbers present in final vector
        const target = finalVec.slice();
        if (target.length >= 1 && target.length <= 2) {
          const matched =
            target.length === 1
              ? (nearlyEqual(target[0], eigs[0], 1e-6, 1e-6) || nearlyEqual(target[0], eigs[1], 1e-6, 1e-6))
              : ( (nearlyEqual(target[0], eigs[0],1e-6,1e-6) && nearlyEqual(target[1], eigs[1],1e-6,1e-6)) ||
                  (nearlyEqual(target[0], eigs[1],1e-6,1e-6) && nearlyEqual(target[1], eigs[0],1e-6,1e-6)) );
          checks.push({ value: `eig≈${JSON.stringify(target)}`, ok: matched, lhs: eigs[0], rhs: target[0], reason: matched ? null : "eigenvalues mismatch (2x2)" } as any);
        }
      }
    }
  }

  /* ---------- Vector: dot, cross, norm, projection ---------- */
  // dot
  if (/\bdot\s*product|a\.\s*b|a\s*·\s*b|\b(a|u)\s*·\s*(b|v)\b/i.test(lower) && finalNum != null) {
    const vs = findAnyVectors(text);
    if (vs.length >= 2 && vs[0].length === vs[1].length) {
      const val = vs[0].reduce((s, _, i) => s + vs[0][i] * vs[1][i], 0);
      const ok = nearlyEqual(val, finalNum, 1e-8, 1e-8);
      checks.push({ value: `dot=${finalNum}`, ok, lhs: val, rhs: finalNum, reason: ok ? null : "dot product mismatch" } as any);
    }
  }
  // cross (3D)
  if (/\bcross\s*product|a\s*×\s*b|a\s*x\s*b\b/i.test(lower) && finalVec) {
    const vs = findAnyVectors(text);
    if (vs.length >= 2 && vs[0].length === 3 && vs[1].length === 3) {
      const [a, b] = vs as [Vec, Vec];
      const val: Vec = [
        a[1]*b[2]-a[2]*b[1],
        a[2]*b[0]-a[0]*b[2],
        a[0]*b[1]-a[1]*b[0],
      ];
      const ok = vectorClose(val, finalVec, 1e-6, 1e-6);
      checks.push({ value: `cross≈${JSON.stringify(finalVec)}`, ok, lhs: val[0], rhs: finalVec[0], reason: ok ? null : "cross product mismatch" } as any);
    }
  }
  // norm
  if (/\bnorm\b|\|\s*\w+\s*\|/.test(lower) && finalNum != null) {
    const v = findAnyVectors(text)[0];
    if (v) {
      const val = Math.hypot(...v);
      const ok = nearlyEqual(val, finalNum, 1e-8, 1e-8);
      checks.push({ value: `||v||=${finalNum}`, ok, lhs: val, rhs: finalNum, reason: ok ? null : "norm mismatch" } as any);
    }
  }
  // projection of a onto b
  if (/\bprojection|proj\s*of\s*a\s*onto\s*b|proj_b\(a\)|proj\s*\w+\s*\(\s*\w+\s*\)/i.test(lower) && finalVec) {
    const vs = findAnyVectors(text);
    if (vs.length >= 2 && vs[0].length === vs[1].length) {
      const [a, b] = vs as [Vec, Vec];
      const bb = b.reduce((s, x) => s + x*x, 0);
      if (bb > EPS) {
        const aDotb = a.reduce((s, _, i) => s + a[i]*b[i], 0);
        const scalar = aDotb / bb;
        const val = b.map(x => scalar * x);
        const ok = vectorClose(val, finalVec, 1e-6, 1e-6);
        checks.push({ value: `proj≈${JSON.stringify(finalVec)}`, ok, lhs: val[0], rhs: finalVec[0], reason: ok ? null : "projection mismatch" } as any);
      }
    }
  }

  /* ---------- Verdict ---------- */
  if (!checks.length) return null;
  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "linear-algebra", method: "linear-algebra", allVerified, checks } as unknown as Verification;
}
