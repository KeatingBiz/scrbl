// lib/verify/chemistry.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import { gatherProblemText, parseNumber, approxEqual, relClose } from "./utils";

/* ------------------------- Formula parsing & molar mass ------------------------- */

type ElemCount = Record<string, number>;

const ATOMIC_MASS: Record<string, number> = {
  H: 1.0079, He: 4.0026,
  Li: 6.941, Be: 9.0122, B: 10.811, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.180,
  Na: 22.990, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948,
  K: 39.098, Ca: 40.078, Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845,
  Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ga: 69.723, Ge: 72.630, As: 74.922, Se: 78.971,
  Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224, Nb: 92.906, Mo: 95.95,
  Ag: 107.8682, Cd: 112.414, Sn: 118.710, Sb: 121.760, Te: 127.60, I: 126.904, Xe: 131.293,
  Cs: 132.905, Ba: 137.327, La: 138.905, Ce: 140.116, Pr: 140.908, Nd: 144.242, Sm: 150.36,
  W: 183.84, Pt: 195.084, Au: 196.967, Hg: 200.592, Pb: 207.2
};

function mergeCounts(a: ElemCount, b: ElemCount, mult = 1): ElemCount {
  const out: ElemCount = { ...a };
  for (const k of Object.keys(b)) out[k] = (out[k] || 0) + b[k] * mult;
  return out;
}

function parseFormula(formulaRaw: string): ElemCount {
  // remove states and spaces; handle hydrates A·xB
  const chunks = formulaRaw.replace(/\s+/g, "").split(/[·•.]/);
  let total: ElemCount = {};
  for (const chunk of chunks) {
    if (!chunk) continue;
    total = mergeCounts(total, parseFormulaChunk(chunk));
  }
  return total;
}

function parseFormulaChunk(formula: string): ElemCount {
  // recursive descent: elements (H, He), numbers, parentheses (), [], {}
  let i = 0;
  function parseGroup(): ElemCount {
    let counts: ElemCount = {};
    while (i < formula.length) {
      const ch = formula[i];
      if (ch === "(" || ch === "[" || ch === "{") {
        i++;
        const inner = parseGroup();
        // expect closing
        if (i < formula.length && (formula[i] === ")" || formula[i] === "]" || formula[i] === "}")) i++;
        const mult = readNumber() ?? 1;
        counts = mergeCounts(counts, inner, mult);
      } else if (ch === ")" || ch === "]" || ch === "}") {
        break;
      } else if (/[A-Z]/.test(ch)) {
        // element symbol
        let sym = ch;
        i++;
        if (i < formula.length && /[a-z]/.test(formula[i])) {
          sym += formula[i];
          i++;
        }
        const mult = readNumber() ?? 1;
        counts[sym] = (counts[sym] || 0) + mult;
      } else if (/\d/.test(ch)) {
        // leading coefficient for a group (rare in formula alone)
        const mult = readNumber() ?? 1;
        // apply to next group
        const next = parseGroup();
        counts = mergeCounts(counts, next, mult);
      } else {
        // unknown char, skip
        i++;
      }
    }
    return counts;
  }
  function readNumber(): number | null {
    const m = formula.slice(i).match(/^\d+/);
    if (!m) return null;
    i += m[0].length;
    return parseInt(m[0], 10);
  }
  return parseGroup();
}

function molarMass(formula: string): number | null {
  const counts = parseFormula(formula);
  let mm = 0;
  for (const [el, n] of Object.entries(counts)) {
    const w = ATOMIC_MASS[el];
    if (!w) return null; // unknown element symbol
    mm += w * n;
  }
  return mm;
}

/* ------------------------- Equation balancing ------------------------- */

type Equation = { left: string[]; right: string[] };

function sanitizeSpecies(s: string): string {
  return s.replace(/\((aq|s|l|g)\)/gi, "").trim();
}
function parseEquation(text: string): Equation | null {
  const arrow = text.match(/(->|=>|→|=)/);
  if (!arrow) return null;
  const [lhsRaw, rhsRaw] = text.split(arrow[0]);
  if (!lhsRaw || !rhsRaw) return null;
  const left = lhsRaw.split("+").map((s) => sanitizeSpecies(s));
  const right = rhsRaw.split("+").map((s) => sanitizeSpecies(s));
  if (!left.length || !right.length) return null;
  return { left, right };
}

function elementMatrix(eq: Equation): { elems: string[]; A: number[][] } {
  const species = [...eq.left, ...eq.right];
  const elemSet = new Set<string>();
  for (const comp of species) {
    const counts = parseFormula(comp);
    Object.keys(counts).forEach((e) => elemSet.add(e));
  }
  const elems = Array.from(elemSet);
  const A: number[][] = elems.map(() => Array(species.length).fill(0));
  for (let j = 0; j < species.length; j++) {
    const counts = parseFormula(species[j]);
    for (let i = 0; i < elems.length; i++) {
      const e = elems[i];
      const sign = j < eq.left.length ? 1 : -1;
      A[i][j] = (counts[e] || 0) * sign;
    }
  }
  return { elems, A };
}

function balanceEquation(eq: Equation): number[] | null {
  // Solve A x = 0 with integer x > 0.
  const { A } = elementMatrix(eq);
  const rows = A.length, cols = A[0]?.length || 0;
  if (!cols) return null;

  // Gaussian elimination to RREF
  const M = A.map((r) => r.slice());
  let r = 0, c = 0;
  const pivots: number[] = [];
  while (r < rows && c < cols) {
    // find pivot
    let piv = r;
    for (let i = r; i < rows; i++) if (Math.abs(M[i][c]) > Math.abs(M[piv][c])) piv = i;
    if (Math.abs(M[piv][c]) < 1e-12) { c++; continue; }
    // swap
    [M[r], M[piv]] = [M[piv], M[r]];
    const div = M[r][c];
    for (let j = c; j < cols; j++) M[r][j] /= div;
    for (let i = 0; i < rows; i++) if (i !== r) {
      const f = M[i][c];
      for (let j = c; j < cols; j++) M[i][j] -= f * M[r][j];
    }
    pivots.push(c);
    r++; c++;
  }

  // Choose last variable as free = 1, backsolve others
  const x = Array(cols).fill(0);
  const freeIdx = new Set<number>(Array.from({ length: cols }, (_, j) => j));
  pivots.forEach((p) => freeIdx.delete(p));
  // if no free var, pick the last one
  const fIdx = freeIdx.size ? Array.from(freeIdx)[0] : cols - 1;
  x[fIdx] = 1;

  // backsolve: for each pivot row r where pivot at col p, sum_{j>p} a_{rj} x_j + a_{rp} x_p = 0
  // Since row is reduced, a_{rp}=1, so x_p = - sum a_{rj} x_j
  for (let irow = 0; irow < rows; irow++) {
    const row = M[irow];
    const pcol = row.findIndex((v) => Math.abs(v - 1) < 1e-9);
    if (pcol === -1) continue;
    let sum = 0;
    for (let j = pcol + 1; j < cols; j++) sum += row[j] * x[j];
    x[pcol] = -sum;
  }

  // Scale to smallest integers
  const fracs = x.map((v) => {
    const s = v.toString();
    const m = s.match(/\.(\d+)?(?:e([+-]\d+))?$/i);
    if (!m) return { num: v, den: 1 };
    // convert to fraction by decimal digits
    const digits = (m[1] || "").length;
    const den = Math.pow(10, digits);
    const num = Math.round(v * den);
    return { num, den };
  });
  const lcm = (a: number, b: number) => (!a || !b) ? a || b : Math.abs(a * b) / gcd(a, b);
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
  const DEN = fracs.reduce((acc, f) => lcm(acc, f.den), 1) || 1;
  const coeffs = fracs.map((f) => Math.round((f.num * (DEN / f.den))));
  // make all positive
  const sign = coeffs.find((v) => v !== 0 && Math.sign(v)) || 1;
  const pos = coeffs.map((v) => Math.abs(v / sign));
  // reduce by GCD
  const g = pos.reduce((acc, v) => gcd(acc, Math.abs(v)), pos[0] || 1);
  return pos.map((v) => v / g);
}

/* ------------------------- Unit helpers ------------------------- */

function parseValWithUnit(text: string, label: RegExp, units: RegExp[]): { value: number; unit?: string } | null {
  // e.g., "P = 2 atm", "T=300K", "V = 10 L"
  const m = text.match(label);
  if (!m || !m[1]) return null;
  const value = parseNumber(m[1]);
  if (value == null) return null;
  // find unit near the label occurrence
  const after = text.slice((m.index || 0) + m[0].length);
  for (const u of units) {
    const mu = after.match(u);
    if (mu) return { value, unit: mu[0] };
  }
  return { value };
}

function toKelvin(t: number, unit?: string): number {
  if (!unit) return t; // assume already K
  if (/c/i.test(unit)) return t + 273.15;
  return t; // K assumed
}

/* ------------------------- Main verifier ------------------------- */

export function verifyChemistry(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.toLowerCase();
  const finalS = String(result.final ?? "");

  const looksChem = /\b(balance|stoichiometry|moles?|molarity|molar|dilution|percent\s*yield|pv\s*=\s*nr?t|ideal\s*gas|gas\s*law|limiting|excess)\b/i.test(
    text
  ) || /[A-Z][a-z]?\d?/.test(blob); // crude formula hint
  if (!looksChem) return null;

  const checks: Verification["checks"] = [];
  const finalN = parseNumber(finalS);

  /* ---------- 1) Balancing equations ---------- */
  const eqFromText = parseEquation(blob.replace(/⟶|⇒/g, "→"));
  if (eqFromText) {
    const coeffs = balanceEquation(eqFromText);
    if (coeffs) {
      // If user provided a balanced line in final, compare coefficients (up to scalar)
      const eqFinal = parseEquation(finalS.replace(/⟶|⇒/g, "→"));
      if (eqFinal && (eqFinal.left.length + eqFinal.right.length) === coeffs.length) {
        const species = [...eqFromText.left, ...eqFromText.right];
        const specFinal = [...eqFinal.left, ...eqFinal.right];
        const parseLeadingCoeff = (s: string) => {
          const m = s.match(/^(\d+)\s*/);
          return m ? parseInt(m[1], 10) : 1;
        };
        const userCoeffs = specFinal.map(parseLeadingCoeff);
        // Compare up to a constant factor
        const scale = userCoeffs.find((c) => c > 0) ? userCoeffs[0] / (coeffs[0] || 1) : 1;
        const same = userCoeffs.every((c, i) => approxEqual(c, coeffs[i] * scale, 1e-9));
        checks.push({ value: "balanced-equation", ok: same, reason: same ? null : "coefficients mismatch" } as any);
      } else {
        // At least assert we can balance what’s in the text
        checks.push({ value: "balance-feasible", ok: true } as any);
      }
    }
  }

  /* ---------- 2) Molarity (M = n / V) ---------- */
  if (/\bmolarity\b|\bM\s*=\s*/i.test(text)) {
    const n = parseNumber(blob.match(/\bn\s*=\s*([-\d.]+)/i)?.[1] || "");
    const V = parseNumber(blob.match(/\bV\s*=\s*([-\d.]+)/i)?.[1] || "");
    if (n != null && V != null && finalN != null) {
      const M = n / V; // V in liters expected
      const ok = relClose(M, finalN, 1e-6, 1e-6) || approxEqual(M, finalN, 1e-6);
      checks.push({ value: `M=${finalN}`, ok, lhs: M, rhs: finalN, reason: ok ? null : "M=n/V mismatch" } as any);
    }
  }

  /* ---------- 3) Dilution (C1 V1 = C2 V2) ---------- */
  if (/\bdilution\b|c1\s*v1\s*=\s*c2\s*v2/i.test(text)) {
    const C1 = parseNumber(blob.match(/\bC1\s*=\s*([-\d.]+)/i)?.[1] || "") ?? null;
    const V1 = parseNumber(blob.match(/\bV1\s*=\s*([-\d.]+)/i)?.[1] || "") ?? null;
    const C2 = parseNumber(blob.match(/\bC2\s*=\s*([-\d.]+)/i)?.[1] || "") ?? null;
    const V2 = parseNumber(blob.match(/\bV2\s*=\s*([-\d.]+)/i)?.[1] || "") ?? null;
    if (finalN != null) {
      // Try to compute whichever one is missing
      if (C1 != null && V1 != null && C2 != null && V2 == null) {
        const v2 = (C1 * V1) / C2;
        const ok = relClose(v2, finalN, 1e-6, 1e-6) || approxEqual(v2, finalN, 1e-6);
        checks.push({ value: `V2=${finalN}`, ok, lhs: v2, rhs: finalN, reason: ok ? null : "C1V1=C2V2 mismatch" } as any);
      } else if (C1 != null && V1 != null && V2 != null && C2 == null) {
        const c2 = (C1 * V1) / V2;
        const ok = relClose(c2, finalN, 1e-6, 1e-6) || approxEqual(c2, finalN, 1e-6);
        checks.push({ value: `C2=${finalN}`, ok, lhs: c2, rhs: finalN, reason: ok ? null : "C1V1=C2V2 mismatch" } as any);
      }
    }
  }

  /* ---------- 4) Ideal Gas Law (PV = nRT) ---------- */
  if (/\b(pv\s*=\s*nr?t|ideal\s*gas|gas\s*law)\b/i.test(text)) {
    // Parse values with units if present
    const P = parseValWithUnit(blob, /\bP\s*=\s*([-\d.]+)\s*/i, [/atm/i, /kpa/i, /pa\b/i]);
    const V = parseValWithUnit(blob, /\bV\s*=\s*([-\d.]+)\s*/i, [/\bL\b/i, /\bm\^?3\b/i]);
    const T = parseValWithUnit(blob, /\bT\s*=\s*([-\d.]+)\s*/i, [/\bK\b/i, /\bC\b/i]);
    const n = parseValWithUnit(blob, /\bn\s*=\s*([-\d.]+)\s*/i, [/\bmol\b/i]);

    // Decide R based on units (atm·L) or (Pa·m^3)
    const useAtm = (P?.unit && /atm/i.test(P.unit)) || (V?.unit && /L/i.test(V.unit));
    const R = useAtm ? 0.082057 : 8.314; // L·atm/(mol·K) or J/(mol·K)
    const Pv = P?.value, Vv = V?.value, Tv = T ? toKelvin(T.value, T.unit) : undefined, nv = n?.value;

    if (finalN != null) {
      // Try each unknown against final
      if (Pv != null && Vv != null && Tv != null && nv == null) {
        const ncalc = (Pv * (useAtm ? 1 : 1e3) * (useAtm ? 1 : Vv)) / (R * Tv); // crude: if P in kPa→Pa, V in m^3 ok
        const nfix = useAtm ? (Pv * Vv) / (R * Tv) : (Pv * Vv) / (R * Tv);
        const nVal = useAtm ? nfix : ncalc;
        const ok = relClose(nVal, finalN, 1e-3, 1e-6) || approxEqual(nVal, finalN, 1e-3);
        checks.push({ value: `n=${finalN}`, ok, lhs: nVal, rhs: finalN, reason: ok ? null : "PV=nRT mismatch for n" } as any);
      }
      if (nv != null && Vv != null && Tv != null && Pv == null) {
        const Pval = (nv * R * Tv) / Vv;
        const ok = relClose(Pval, finalN, 1e-3, 1e-6) || approxEqual(Pval, finalN, 1e-3);
        checks.push({ value: `P=${finalN}`, ok, lhs: Pval, rhs: finalN, reason: ok ? null : "PV=nRT mismatch for P" } as any);
      }
      if (Pv != null && nv != null && Tv != null && Vv == null) {
        const Vval = (nv * R * Tv) / Pv;
        const ok = relClose(Vval, finalN, 1e-3, 1e-6) || approxEqual(Vval, finalN, 1e-3);
        checks.push({ value: `V=${finalN}`, ok, lhs: Vval, rhs: finalN, reason: ok ? null : "PV=nRT mismatch for V" } as any);
      }
      if (Pv != null && Vv != null && nv != null && Tv == null) {
        const Tval = (Pv * Vv) / (nv * R);
        const ok = relClose(Tval, finalN, 1e-3, 1e-6) || approxEqual(Tval, finalN, 1e-3);
        checks.push({ value: `T=${finalN}`, ok, lhs: Tval, rhs: finalN, reason: ok ? null : "PV=nRT mismatch for T" } as any);
      }
    }
  }

  /* ---------- 5) Quick stoichiometry (mass ↔ moles for a single species) ---------- */
  if (/\bmoles?\b|grams?\b|molar\s*mass\b/i.test(text)) {
    // Try to grab a formula appearing near "of XXX"
    const ofM = blob.match(/of\s+([A-Z][A-Za-z0-9(){}\[\]·•.]*)/);
    const formula = ofM?.[1];
    if (formula && finalN != null) {
      const mm = molarMass(formula);
      if (mm != null) {
        // If text shows grams, compute moles; if shows moles, compute grams—compare with final
        const grams = parseNumber(blob.match(/\b([-\d.]+)\s*g\b/i)?.[1] || "");
        const moles = parseNumber(blob.match(/\b([-\d.]+)\s*mol\b/i)?.[1] || "");
        if (grams != null) {
          const ncalc = grams / mm;
          const ok = relClose(ncalc, finalN, 1e-4, 1e-6) || approxEqual(ncalc, finalN, 1e-4);
          checks.push({ value: `n=${finalN}`, ok, lhs: ncalc, rhs: finalN, reason: ok ? null : "moles mismatch (grams/mm)" } as any);
        } else if (moles != null) {
          const gcalc = moles * mm;
          const ok = relClose(gcalc, finalN, 1e-4, 1e-6) || approxEqual(gcalc, finalN, 1e-4);
          checks.push({ value: `g=${finalN}`, ok, lhs: gcalc, rhs: finalN, reason: ok ? null : "grams mismatch (moles*mm)" } as any);
        }
      }
    }
  }

  /* ---------- 6) Percent yield ---------- */
  if (/\bpercent\s*yield\b/i.test(text)) {
    const actual = parseNumber(blob.match(/\bactual\s*(yield)?\s*=?\s*([-\d.]+)/i)?.[2] || "");
    const theoretical = parseNumber(blob.match(/\btheoretical\s*(yield)?\s*=?\s*([-\d.]+)/i)?.[2] || "");
    if (actual != null && theoretical != null && finalN != null) {
      const pct = (actual / theoretical) * 100;
      const ok = relClose(pct, finalN, 1e-3, 1e-6) || approxEqual(pct, finalN, 1e-3);
      checks.push({ value: `percent_yield=${finalN}`, ok, lhs: pct, rhs: finalN, reason: ok ? null : "% yield mismatch" } as any);
    }
  }

  // If we found nothing conclusive, bail.
  if (!checks.length) return null;

  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "chemistry", method: "chemistry-stoich", allVerified, checks } as Verification;
}
