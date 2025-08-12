// scripts/run_param_tests.ts
import { verifyBoard } from "../lib/verify";
import type { BoardUnderstanding, Verification } from "../lib/types";

/* ========= tiny helpers ========= */
const step = (before: string | null = null): any => ({
  n: 1, text: "", action: "", before, after: null, why: null, tip: null, emoji: null
});
const num = (k: string, d: number) => {
  const v = process.env[k]; const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : d;
};
const SUBJECT = (process.env.SUBJECT || "all").toLowerCase();

type Case = { subject: string; topic: string; name: string; expectPass: boolean; board: BoardUnderstanding };

/* ========= FINANCE helpers (to mirror your verifier math) ========= */
function f_npv(r: number, cfs: number[]) {
  return cfs.reduce((acc, cf, i) => acc + cf / Math.pow(1 + r, i), 0);
}
function f_irr(cfs: number[], guess = 0.1): number | null {
  let r = guess;
  for (let k = 0; k < 20; k++) {
    let f = 0, df = 0;
    for (let i = 0; i < cfs.length; i++) {
      const denom = Math.pow(1 + r, i);
      f += cfs[i] / denom;
      if (i > 0) df += -i * cfs[i] / (denom * (1 + r));
    }
    if (!Number.isFinite(f) || !Number.isFinite(df) || Math.abs(df) < 1e-12) break;
    const rNext = r - f / df;
    if (!Number.isFinite(rNext)) break;
    if (Math.abs(rNext - r) < 1e-10) return rNext;
    r = rNext;
  }
  // wide bisection
  let lo = -0.999, hi = 10;
  let flo = f_npv(lo, cfs), fhi = f_npv(hi, cfs);
  if (flo * fhi > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = f_npv(mid, cfs);
    if (Math.abs(fm) < 1e-10) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}
function f_pmt(r: number, n: number, pv: number) {
  if (Math.abs(r) < 1e-12) return -(pv / n);
  const k = Math.pow(1 + r, n);
  return -(r * pv * k) / (k - 1);
}
function f_cagr(pv: number, fv: number, years: number) {
  if (pv <= 0 || fv <= 0 || years <= 0) return null;
  return Math.pow(fv / pv, 1 / years) - 1;
}

/* ========= ENV counts (tune per topic) ========= */
// Finance
const FIN_NPV  = num("FIN_NPV",  200);
const FIN_IRR  = num("FIN_IRR",  200);
const FIN_PMT  = num("FIN_PMT",  200);
const FIN_CAGR = num("FIN_CAGR", 200);
// Accounting
const ACC_EQ   = num("ACC_EQ",   200);
const ACC_NET  = num("ACC_NET",  200);
const ACC_DEP  = num("ACC_DEP",  200);
// Algebra
const ALG_LINEAR = num("ALG_LINEAR", 200);
const ALG_QUAD   = num("ALG_QUAD",   200);
// Stats
const STATS_MEAN   = num("STATS_MEAN",   200);
const STATS_MEDIAN = num("STATS_MEDIAN", 200);
const STATS_VAR    = num("STATS_VAR",    200);
const STATS_STD    = num("STATS_STD",    200);

/* ========= Generators ========= */
// ---- Finance: NPV, IRR, PMT, CAGR ----
function genFinance(): Case[] {
  const out: Case[] = [];

  // NPV
  for (let i = 0; i < FIN_NPV; i++) {
    const r = [0.04, 0.06, 0.08, 0.10][Math.floor(Math.random() * 4)];
    const len = 4 + Math.floor(Math.random() * 3); // 4..6 CFs
    const cfs = Array.from({ length: len }, (_, k) =>
      k === 0 ? -(500 + Math.floor(Math.random() * 1500)) : Math.floor(Math.random() * 700)
    );
    const trueVal = f_npv(r, cfs);
    const reported = Math.random() < 0.15 ? trueVal + (Math.random() < 0.5 ? 50 : -50) : trueVal;
    const expectPass = Math.abs(reported - trueVal) < 1e-4;

    out.push({
      subject: "finance", topic: "npv", name: `npv_${i}`, expectPass,
      board: {
        type: "PROBLEM_SOLVED", subject_guess: "finance", confidence: 0.9,
        raw_text: `NPV problem: rate=${(r * 100).toFixed(2)}% cash flows: [${cfs.join(", ")}]`,
        question: "Compute NPV",
        steps: [step(null)],
        final: `npv=${reported}`,
        given_answer: null, answer_status: "matches", events: []
      }
    });
  }

  // IRR
  for (let i = 0; i < FIN_IRR; i++) {
    const len = 4 + Math.floor(Math.random() * 3); // 4..6
    const cfs = Array.from({ length: len }, (_, k) =>
      k === 0 ? -(500 + Math.floor(Math.random() * 1500)) : Math.floor(Math.random() * 700)
    );
    const trueIRR = f_irr(cfs);
    // If IRR fails (pathological case), skip and regenerate a simpler one
    if (trueIRR == null || !Number.isFinite(trueIRR)) { i--; continue; }
    const reported = Math.random() < 0.15 ? trueIRR + (Math.random() < 0.5 ? 0.02 : -0.02) : trueIRR;
    const expectPass = Math.abs(reported - trueIRR) < 1e-6;
    // final expects % or decimal; your verifier accepts either — use %
    out.push({
      subject: "finance", topic: "irr", name: `irr_${i}`, expectPass,
      board: {
        type: "PROBLEM_SOLVED", subject_guess: "finance", confidence: 0.9,
        raw_text: `IRR problem: cash flows: [${cfs.join(", ")}]`,
        question: "Find IRR",
        steps: [step(null)],
        final: `irr=${(reported * 100).toFixed(6)}%`,
        given_answer: null, answer_status: "matches", events: []
      }
    });
  }

  // PMT
  for (let i = 0; i < FIN_PMT; i++) {
    // Use monthly for variety
    const annual = [0.04, 0.06, 0.08][Math.floor(Math.random() * 3)];
    const r = annual / 12;
    const n = [12, 24, 36, 60][Math.floor(Math.random() * 4)];
    const pv = 1000 + Math.floor(Math.random() * 9000);
    const truePMT = f_pmt(r, n, pv);
    const reported = Math.random() < 0.15 ? truePMT + (Math.random() < 0.5 ? 10 : -10) : truePMT;
    const expectPass = Math.abs(reported - truePMT) < 1e-3;

    out.push({
      subject: "finance", topic: "pmt", name: `pmt_${i}`, expectPass,
      board: {
        type: "PROBLEM_SOLVED", subject_guess: "finance", confidence: 0.9,
        raw_text: `PMT problem: rate=${(annual * 100).toFixed(2)}% periods=${n} pv=${pv}`,
        question: "Compute monthly payment (PMT)",
        steps: [step(null)],
        final: `pmt=${reported}`,
        given_answer: null, answer_status: "matches", events: []
      }
    });
  }

  // CAGR
  for (let i = 0; i < FIN_CAGR; i++) {
    const pv = 100 + Math.floor(Math.random() * 900);
    const years = 1 + Math.floor(Math.random() * 9);
    const growth = 1 + [0.05, 0.1, 0.2][Math.floor(Math.random() * 3)];
    const fv = Math.round(pv * Math.pow(growth, years));
    const trueCAGR = f_cagr(pv, fv, years)!;
    const reported = Math.random() < 0.15 ? trueCAGR + (Math.random() < 0.5 ? 0.02 : -0.02) : trueCAGR;
    const expectPass = Math.abs(reported - trueCAGR) < 1e-6;

    out.push({
      subject: "finance", topic: "cagr", name: `cagr_${i}`, expectPass,
      board: {
        type: "PROBLEM_SOLVED", subject_guess: "finance", confidence: 0.9,
        raw_text: `CAGR problem: start=${pv} end=${fv} years=${years}`,
        question: "Find CAGR",
        steps: [step(null)],
        final: `cagr=${(reported * 100).toFixed(6)}%`,
        given_answer: null, answer_status: "matches", events: []
      }
    });
  }

  return out;
}

// ---- Accounting: A=L+E, Net income, Straight-line depreciation ----
function genAccounting(): Case[] {
  const out: Case[] = [];

  // Accounting equation: compute equity
  for (let i = 0; i < ACC_EQ; i++) {
    const L = 500 + Math.floor(Math.random() * 5000);
    const E = 200 + Math.floor(Math.random() * 4000);
    const A = L + E;
    const trueEquity = E;
    const reported = Math.random() < 0.15 ? trueEquity + (Math.random() < 0.5 ? 100 : -100) : trueEquity;
    const expectPass = Math.abs(reported - trueEquity) < 1e-6;

    out.push({
      subject: "accounting", topic: "accounting_equation", name: `eq_${i}`, expectPass,
      board: {
        type: "PROBLEM_SOLVED", subject_guess: "accounting", confidence: 0.9,
        raw_text: `Accounting equation: assets=${A} liabilities=${L} equity=?`,
        question: "Compute equity (A = L + E)",
        steps: [step(null)],
        final: `equity=${reported}`,
        given_answer: null, answer_status: "matches", events: []
      }
    });
  }

  // Net income = revenues - expenses
  for (let i = 0; i < ACC_NET; i++) {
    const rev = 1000 + Math.floor(Math.random() * 9000);
    const exp = 200 + Math.floor(Math.random() * 7000);
    const trueNI = rev - exp;
    const reported = Math.random() < 0.15 ? trueNI + (Math.random() < 0.5 ? 200 : -200) : trueNI;
    const expectPass = Math.abs(reported - trueNI) < 1e-6;

    out.push({
      subject: "accounting", topic: "net_income", name: `ni_${i}`, expectPass,
      board: {
        type: "PROBLEM_SOLVED", subject_guess: "accounting", confidence: 0.9,
        raw_text: `Net income problem: revenue=${rev} expenses=${exp}`,
        question: "Compute net income",
        steps: [step(null)],
        final: `net income=${reported}`,
        given_answer: null, answer_status: "matches", events: []
      }
    });
  }

  // Straight-line depreciation (annual)
  for (let i = 0; i < ACC_DEP; i++) {
    const cost = 2000 + Math.floor(Math.random() * 8000);
    const salvage = Math.floor(cost * 0.1);
    const life = 3 + Math.floor(Math.random() * 7); // 3..9 years
    const trueDep = (cost - salvage) / life;
    const reported = Math.random() < 0.15 ? trueDep + (Math.random() < 0.5 ? 50 : -50) : trueDep;
    const expectPass = Math.abs(reported - trueDep) < 1e-6;

    out.push({
      subject: "accounting", topic: "depreciation_sl", name: `dep_${i}`, expectPass,
      board: {
        type: "PROBLEM_SOLVED", subject_guess: "accounting", confidence: 0.9,
        raw_text: `Straight-line depreciation: cost=${cost} salvage=${salvage} life=${life} years`,
        question: "Annual depreciation (SL)",
        steps: [step(null)],
        final: `depreciation=${reported}`,
        given_answer: null, answer_status: "matches", events: []
      }
    });
  }

  return out;
}

// ---- Algebra: Linear, Quadratic ----
function genAlgebra(): Case[] {
  const out: Case[] = [];

  // linear
  for (let i = 0; i < ALG_LINEAR; i++) {
    const a = 1 + Math.floor(Math.random() * 9);
    const b = Math.floor(Math.random() * 21) - 10;
    const c = Math.floor(Math.random() * 21) - 10;
    const x = (c - b) / a;
    const reported = Math.random() < 0.15 ? x + (Math.random() < 0.5 ? 1 : -1) : x;
    const expectPass = Math.abs(reported - x) < 1e-6;

    out.push({
      subject: "algebra", topic: "linear", name: `lin_${i}`, expectPass,
      board: {
        type: "PROBLEM_SOLVED", subject_guess: "algebra", confidence: 0.9,
        raw_text: `Solve for x: ${a}x + ${b} = ${c}`,
        question: "Solve for x",
        steps: [step(`${a}x + ${b} = ${c}`)],
        final: `x=${reported}`,
        given_answer: null, answer_status: "matches", events: []
      }
    });
  }

  // quadratic (clean integer roots)
  for (let i = 0; i < ALG_QUAD; i++) {
    const r1 = Math.floor(Math.random() * 9) - 4;
    const r2 = Math.floor(Math.random() * 9) - 4;
    const p = -(r1 + r2);
    const q = r1 * r2;
    const answers = Math.random() < 0.15 ? [r1 + 1, r2] : [r1, r2];
    const expectPass = answers[0] === r1 && answers[1] === r2;

    out.push({
      subject: "algebra", topic: "quadratic", name: `quad_${i}`, expectPass,
      board: {
        type: "PROBLEM_SOLVED", subject_guess: "algebra", confidence: 0.9,
        raw_text: `Solve: x^2 + ${p}x + ${q} = 0`,
        question: "Find the roots",
        steps: [step(`x^2 + ${p}x + ${q} = 0`)],
        final: `x=${answers[0]} or x=${answers[1]}`,
        given_answer: null, answer_status: "matches", events: []
      }
    });
  }

  return out;
}

// ---- Stats: Mean, Median, Variance (pop), Std (pop) ----
function genStats(): Case[] {
  const out: Case[] = [];

  // mean
  for (let i = 0; i < STATS_MEAN; i++) {
    const n = 5 + Math.floor(Math.random() * 6);
    const data = Array.from({ length: n }, () => Math.round((Math.random() * 30 - 15) * 10) / 10);
    const mean = data.reduce((s, v) => s + v, 0) / n;
    const reported = Math.random() < 0.15 ? mean + 1 : mean;
    const expectPass = Math.abs(reported - mean) < 1e-6;

    out.push({
      subject: "stats", topic: "mean", name: `mean_${i}`, expectPass,
      board: {
        type: "PROBLEM_SOLVED", subject_guess: "stats", confidence: 0.9,
        raw_text: `numbers: [${data.join(", ")}]`,
        question: "Compute the mean",
        steps: [step(null)],
        final: `mean=${reported}`,
        given_answer: null, answer_status: "matches", events: []
      }
    });
  }

  // median
  for (let i = 0; i < STATS_MEDIAN; i++) {
    const n = 5 + Math.floor(Math.random() * 6);
    const data = Array.from({ length: n }, () => Math.round((Math.random() * 30 - 15) * 10) / 10);
    const a = [...data].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    const trueMed = a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    const reported = Math.random() < 0.15 ? trueMed + 1 : trueMed;
    const expectPass = Math.abs(reported - trueMed) < 1e-6;

    out.push({
      subject: "stats", topic: "median", name: `median_${i}`, expectPass,
      board: {
        type: "PROBLEM_SOLVED", subject_guess: "stats", confidence: 0.9,
        raw_text: `data: [${data.join(", ")}]`,
        question: "Find the median",
        steps: [step(null)],
        final: `median=${reported}`,
        given_answer: null, answer_status: "matches", events: []
      }
    });
  }

  // variance (population)
  for (let i = 0; i < STATS_VAR; i++) {
    const n = 6 + Math.floor(Math.random() * 6);
    const data = Array.from({ length: n }, () => Math.round((Math.random() * 30 - 15) * 10) / 10);
    const mean = data.reduce((s, v) => s + v, 0) / n;
    const varPop = data.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const reported = Math.random() < 0.15 ? varPop + 1 : varPop;
    const expectPass = Math.abs(reported - varPop) < 1e-6;

    out.push({
      subject: "stats", topic: "variance", name: `var_${i}`, expectPass,
      board: {
        type: "PROBLEM_SOLVED", subject_guess: "stats", confidence: 0.9,
        raw_text: `numbers: [${data.join(", ")}]`,
        question: "Compute the variance",
        steps: [step(null)],
        final: `variance=${reported}`,
        given_answer: null, answer_status: "matches", events: []
      }
    });
  }

  // std (population)
  for (let i = 0; i < STATS_STD; i++) {
    const n = 6 + Math.floor(Math.random() * 6);
    const data = Array.from({ length: n }, () => Math.round((Math.random() * 30 - 15) * 10) / 10);
    const mean = data.reduce((s, v) => s + v, 0) / n;
    const varPop = data.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stdPop = Math.sqrt(varPop);
    const reported = Math.random() < 0.15 ? stdPop + 1 : stdPop;
    const expectPass = Math.abs(reported - stdPop) < 1e-6;

    out.push({
      subject: "stats", topic: "std", name: `std_${i}`, expectPass,
      board: {
        type: "PROBLEM_SOLVED", subject_guess: "stats", confidence: 0.9,
        raw_text: `data: [${data.join(", ")}]`,
        question: "Compute the standard deviation",
        steps: [step(null)],
        final: `std=${reported}`,
        given_answer: null, answer_status: "matches", events: []
      }
    });
  }

  return out;
}

/* ========= Runner ========= */
async function main() {
  let cases: Case[] = [];
  const want = (s: string) => SUBJECT === "all" || SUBJECT === s;

  if (want("finance"))    cases = cases.concat(genFinance());
  if (want("accounting")) cases = cases.concat(genAccounting());
  if (want("algebra"))    cases = cases.concat(genAlgebra());
  if (want("stats"))      cases = cases.concat(genStats());

  const bySubj: Record<string, { total: number; ok: number; bad: number }> = {};
  const byTopic: Record<string, { total: number; ok: number; bad: number }> = {};
  let total = 0, okAll = 0, badAll = 0;

  for (const k of cases) {
    total++;
    bySubj[k.subject] ??= { total: 0, ok: 0, bad: 0 };
    byTopic[`${k.subject}:${k.topic}`] ??= { total: 0, ok: 0, bad: 0 };
    bySubj[k.subject].total++; byTopic[`${k.subject}:${k.topic}`].total++;

    let v: Verification | null = null;
    try {
      v = await verifyBoard(k.board);
    } catch {
      badAll++; bySubj[k.subject].bad++; byTopic[`${k.subject}:${k.topic}`].bad++;
      continue;
    }
    const gotPass = !!v?.allVerified;
    const ok = gotPass === k.expectPass;
    if (ok) { okAll++; bySubj[k.subject].ok++; byTopic[`${k.subject}:${k.topic}`].ok++; }
    else    { badAll++; bySubj[k.subject].bad++; byTopic[`${k.subject}:${k.topic}`].bad++; }
  }

  console.log("\n=== Verifier Parametric Tests ===");
  for (const [s, r] of Object.entries(bySubj)) {
    console.log(`  ${s.padEnd(11)} total=${String(r.total).padStart(4)}  ok=${String(r.ok).padStart(4)}  bad=${String(r.bad).padStart(4)}`);
  }
  console.log("— by topic —");
  for (const [t, r] of Object.entries(byTopic)) {
    console.log(`  ${t.padEnd(20)} total=${String(r.total).padStart(4)}  ok=${String(r.ok).padStart(4)}  bad=${String(r.bad).padStart(4)}`);
  }
  console.log("---------------------------------");
  console.log(`  overall         total=${total}  ok=${okAll}  bad=${badAll}\n`);

  process.exit(badAll === 0 ? 0 : 1);
}

main();

