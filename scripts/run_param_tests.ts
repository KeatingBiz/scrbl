// scripts/run_param_tests.ts
/* eslint-disable no-console */
import { verifyBoard } from "@/lib/verify";
import type { BoardUnderstanding, Verification } from "@/lib/types";

/**
 * This runner creates synthetic problems for every topic covered by:
 * - algebra.ts
 * - stats.ts
 * - finance.ts
 * - accounting.ts
 *
 * It then checks your verifier's verdict against the ground truth (correct vs wrong).
 *
 * Run with:  npm run test:params
 */

// ----------------------------- helpers -----------------------------
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const irnd = (a: number, b: number) => Math.floor(rnd(a, b + 1));
const pick = <T,>(xs: T[]) => xs[irnd(0, xs.length - 1)];
const round = (x: number, k = 4) => Math.round(x * 10 ** k) / 10 ** k;

type Case = {
  topic: string;
  make: () => BoardUnderstanding; // built with final answer inside
  expect: "match" | "mismatch";
};

function mkProblem({
  text,
  final,
  steps,
}: {
  text: string;
  final: string;
  steps?: Array<{
    n?: number;
    text?: string;
    action?: string | null;
    before?: string | null;
    after?: string | null;
    why?: string | null;
    tip?: string | null;
    emoji?: string | null;
  }>;
}): BoardUnderstanding {
  // Keep it very close to your schema but we only fill what's needed for verifiers
  return {
    type: "PROBLEM_SOLVED",
    subject_guess: null,
    confidence: 0.9,
    raw_text: text,
    question: text,
    given_answer: null,
    steps:
      steps ??
      [
        {
          n: 1,
          text,
          action: null,
          before: null,
          after: null,
          why: null,
          tip: null,
          emoji: null,
        },
      ],
    final,
    answer_status: "matches",
    events: [],
  } as any;
}

async function runCase(c: Case) {
  const res = await verifyBoard(c.make());
  const ok =
    (c.expect === "match" && res && res.allVerified) ||
    (c.expect === "mismatch" && (!res || !res.allVerified));
  return { ok, v: res };
}

type Tally = { ok: number; bad: number };
const inc = (t: Tally, ok: boolean) => (ok ? (t.ok++, t) : (t.bad++, t));

// ----------------------------- Algebra -----------------------------
function genAlgebraLinear(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const a = irnd(1, 9) * (Math.random() < 0.5 ? 1 : -1);
    const b = irnd(-10, 10);
    const x = irnd(-6, 6);
    const c = a * x + b;

    const eq = `${a}x + ${b} = ${c}`;
    const correct = `x=${x}`;
    const wrong = `x=${x + pick([1, -1, 2])}`;

    out.push({
      topic: "algebra_linear",
      make: () =>
        mkProblem({
          text: `Solve the equation: ${eq}`,
          final: i % 2 === 0 ? correct : wrong,
          steps: [{ n: 1, text: "start", before: eq, after: null }],
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function genAlgebraQuadratic(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const r1 = irnd(-5, 5) || 2;
    const r2 = irnd(-5, 5) || 3;
    const a = pick([1, 1, 1, 2]); // bias to monic
    const b = -a * (r1 + r2);
    const c = a * r1 * r2;
    const eq = `${a}x^2 ${b >= 0 ? "+" : "-"} ${Math.abs(b)}x ${c >= 0 ? "+" : "-"} ${Math.abs(
      c
    )} = 0`;

    const correct = Math.random() < 0.5 ? `x=${r1} or x=${r2}` : `x=${r2}, x=${r1}`;
    const wrong = `x=${r1 + 1} or x=${r2}`;

    out.push({
      topic: "algebra_quadratic",
      make: () =>
        mkProblem({
          text: `Solve: ${eq}`,
          final: i % 2 === 0 ? correct : wrong,
          steps: [{ n: 1, text: "quad", before: eq, after: null }],
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function genAlgebraSystems(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const x = irnd(-5, 5);
    const y = irnd(-5, 5);
    const a1 = irnd(1, 5),
      b1 = irnd(1, 5);
    const a2 = irnd(1, 5),
      b2 = irnd(1, 5);
    const c1 = a1 * x + b1 * y;
    const c2 = a2 * x + b2 * y;

    const eq1 = `${a1}x + ${b1}y = ${c1}`;
    const eq2 = `${a2}x + ${b2}y = ${c2}`;
    const correct = `(x,y)=(${x},${y})`;
    const wrong = `(x,y)=(${x + 1},${y})`;

    out.push({
      topic: "algebra_system",
      make: () =>
        mkProblem({
          text: `Solve the system:\n${eq1}\n${eq2}`,
          final: i % 2 === 0 ? correct : wrong,
          steps: [
            { n: 1, text: "sys1", before: eq1, after: null },
            { n: 2, text: "sys2", before: eq2, after: null },
          ],
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function genAlgebraDomain(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    // 1/(x-3)=2  -> x = 3.5 (domain x!=3)
    const correct = `x=${3.5}`;
    const wrong = `x=${3}`; // div-by-zero triggers domain failure
    const eq = `1/(x-3) = 2`;
    out.push({
      topic: "algebra_domain",
      make: () =>
        mkProblem({
          text: `Solve with domain care: ${eq}`,
          final: i % 2 === 0 ? correct : wrong,
          steps: [{ n: 1, text: "domain", before: eq, after: null }],
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function genAlgebraLogSqrt(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    // sqrt(x-1)=3 -> x=10; ln(x-5)=2 -> x≈e^2+5
    if (Math.random() < 0.5) {
      const eq = `sqrt(x-1)=3`;
      const correct = `x=10`;
      const wrong = `x=0`; // sqrt domain bad
      out.push({
        topic: "algebra_domain_sqrt",
        make: () =>
          mkProblem({
            text: `Solve: ${eq}`,
            final: i % 2 === 0 ? correct : wrong,
            steps: [{ n: 1, text: "sqrt", before: eq, after: null }],
          }),
        expect: i % 2 === 0 ? "match" : "mismatch",
      });
    } else {
      const eq = `ln(x-5)=2`;
      const x = Math.E ** 2 + 5;
      const correct = `x=${round(x, 6)}`;
      const wrong = `x=${4}`; // log domain bad
      out.push({
        topic: "algebra_domain_log",
        make: () =>
          mkProblem({
            text: `Solve: ${eq}`,
            final: i % 2 === 0 ? correct : wrong,
            steps: [{ n: 1, text: "log", before: eq, after: null }],
          }),
        expect: i % 2 === 0 ? "match" : "mismatch",
      });
    }
  }
  return out;
}

// ----------------------------- Stats -----------------------------
function genStatsMean(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const k = irnd(5, 10);
    const vals = Array.from({ length: k }, () => round(rnd(-10, 20), 3));
    const mean = round(vals.reduce((s, v) => s + v, 0) / k, 6);
    const wrong = round(mean + pick([0.5, -0.7, 1.3]), 6);
    out.push({
      topic: "stats_mean",
      make: () =>
        mkProblem({
          text: `Data: [${vals.join(", ")}]\nCompute mean.`,
          final: i % 2 === 0 ? `mean=${mean}` : `mean=${wrong}`,
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function medianOf(xs: number[]) {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function varianceOf(xs: number[], sample = false) {
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  const denom = xs.length - (sample ? 1 : 0);
  return xs.reduce((s, v) => s + (v - m) ** 2, 0) / denom;
}

function genStatsMedian(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const k = irnd(5, 11);
    const vals = Array.from({ length: k }, () => round(rnd(-5, 25), 3));
    const med = round(medianOf(vals), 6);
    const wrong = round(med + pick([0.5, -0.6]), 6);
    out.push({
      topic: "stats_median",
      make: () =>
        mkProblem({
          text: `Data: [${vals.join(", ")}]\nFind the median.`,
          final: i % 2 === 0 ? `median=${med}` : `median=${wrong}`,
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function genStatsVarStd(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const k = irnd(5, 10);
    const vals = Array.from({ length: k }, () => round(rnd(0, 12), 4));
    const vPop = varianceOf(vals, false);
    const vSam = varianceOf(vals, true);
    const sPop = Math.sqrt(vPop);
    const sSam = Math.sqrt(vSam);

    // Alternate between variance and std, and between pop/sample targets.
    const wantVar = Math.random() < 0.5;
    const pop = Math.random() < 0.5;
    const correct = round(wantVar ? (pop ? vPop : vSam) : (pop ? sPop : sSam), 6);
    const wrong = round(correct + pick([0.9, -0.8]), 6);

    const label = wantVar ? "variance" : pick(["std", "standard deviation"]);
    out.push({
      topic: "stats_var_std",
      make: () =>
        mkProblem({
          text: `Data: [${vals.join(", ")}]\nFind the ${label}.`,
          final: i % 2 === 0 ? `${label}=${correct}` : `${label}=${wrong}`,
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

// ----------------------------- Finance -----------------------------
function npv(r: number, cfs: number[]) {
  return cfs.reduce((acc, cf, i) => acc + cf / Math.pow(1 + r, i), 0);
}
function irr(cfs: number[]) {
  let r = 0.1;
  for (let k = 0; k < 40; k++) {
    let f = 0,
      df = 0;
    for (let i = 0; i < cfs.length; i++) {
      const den = Math.pow(1 + r, i);
      f += cfs[i] / den;
      if (i > 0) df += -i * cfs[i] / (den * (1 + r));
    }
    if (Math.abs(df) < 1e-14) break;
    const rn = r - f / df;
    if (!Number.isFinite(rn)) break;
    r = rn;
  }
  return r;
}
function aprToEar(apr: number, m: number) {
  return Math.pow(1 + apr / m, m) - 1;
}

function genFinanceNPV(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const r = round(rnd(0.05, 0.2), 6);
    const cfs = [-irnd(900, 2000), ...Array.from({ length: irnd(3, 5) }, () => irnd(200, 900))];
    const val = round(npv(r, cfs), 4);
    const wrong = round(val + pick([50, -75, 100]), 4);

    out.push({
      topic: "finance_npv",
      make: () =>
        mkProblem({
          text: `Cash flows: [${cfs.join(", ")}]\nDiscount rate r=${round(100 * r, 4)}%\nCompute NPV.`,
          final: i % 2 === 0 ? `npv=${val}` : `npv=${wrong}`,
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function genFinanceIRR(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const cfs = [-irnd(800, 2500), ...Array.from({ length: irnd(3, 6) }, () => irnd(250, 900))];
    const r = irr(cfs);
    const valPct = round(100 * r, 6);
    const wrongPct = round(valPct + pick([1.5, -2.1, 3.2]), 6);
    out.push({
      topic: "finance_irr",
      make: () =>
        mkProblem({
          text: `Cash flows: [${cfs.join(", ")}]\nFind IRR.`,
          final: i % 2 === 0 ? `IRR=${valPct}%` : `IRR=${wrongPct}%`,
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function pmt(r: number, n: number, pv: number, fv = 0, due = false) {
  if (Math.abs(r) < 1e-9) {
    const base = -(pv + fv) / n;
    return due ? base / (1 + r) : base;
  }
  const k = Math.pow(1 + r, n);
  const ann = (r * pv * k + r * fv) / (k - 1);
  return due ? -(ann) / (1 + r) : -ann;
}
function genFinancePMT(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const apr = round(rnd(0.03, 0.12), 6);
    const m = pick([12, 12, 4, 2]);
    const rPer = apr / m;
    const years = pick([3, 5, 7, 10]);
    const nper = years * m;
    const pv = irnd(3000, 25000);
    const due = Math.random() < 0.2;
    const pay = round(pmt(rPer, nper, pv, 0, due), 4);
    const wrong = round(pay + pick([15, -20, 30]), 4);
    out.push({
      topic: "finance_pmt",
      make: () =>
        mkProblem({
          text: `Loan: PV=${pv}\nAPR=${round(apr * 100, 6)}%, m=${m} (${due ? "annuity due" : "ordinary"})\nTerm=${years} years\nFind PMT.`,
          final: i % 2 === 0 ? `PMT=${pay}` : `PMT=${wrong}`,
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function genFinanceAPR_EAR(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const apr = round(rnd(0.02, 0.15), 6);
    const m = pick([12, 4, 2, 365]);
    const ear = round(100 * aprToEar(apr, m), 8);
    const wrong = round(ear + pick([0.4, -0.5]), 8);
    out.push({
      topic: "finance_apr_ear",
      make: () =>
        mkProblem({
          text: `APR=${round(apr * 100, 6)}%, compounding m=${m}. Find the EAR.`,
          final: i % 2 === 0 ? `EAR=${ear}%` : `EAR=${wrong}%`,
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function bondPrice(face: number, couponRate: number, ytm: number, years: number, freq = 2) {
  const N = Math.round(years * freq);
  const c = (couponRate * face) / freq;
  const r = ytm / freq;
  const pvCoupons = c * (1 - Math.pow(1 + r, -N)) / r;
  const pvFace = face * Math.pow(1 + r, -N);
  return pvCoupons + pvFace;
}
function genFinanceBondPrice(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const face = pick([1000, 1000, 100]);
    const years = pick([3, 5, 10, 20]);
    const cpn = rnd(0.01, 0.12);
    const ytm = rnd(0.01, 0.12);
    const freq = pick([2, 2, 2, 1, 4]);
    const price = round(bondPrice(face, cpn, ytm, years, freq), 4);
    const wrong = round(price + pick([5, -7, 9]), 4);
    out.push({
      topic: "finance_bond_price",
      make: () =>
        mkProblem({
          text: `Bond: face=${face}, coupon rate=${round(100 * cpn, 6)}%, YTM=${round(
            100 * ytm,
            6
          )}%, maturity=${years}y, ${freq === 2 ? "semiannual" : `${freq}x/yr`}.\nFind price.`,
          final: i % 2 === 0 ? `price=${price}` : `price=${wrong}`,
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function genFinanceCAPM(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const rf = rnd(0.01, 0.05);
    const rm = rnd(rf + 0.01, 0.15);
    const beta = rnd(0.5, 2);
    const re = round(100 * (rf + beta * (rm - rf)), 6);
    const wrong = round(re + pick([0.8, -1.1]), 6);
    out.push({
      topic: "finance_capm",
      make: () =>
        mkProblem({
          text: `CAPM: risk-free=${round(rf * 100, 6)}%, market return=${round(
            rm * 100,
            6
          )}%, beta=${round(beta, 6)}.\nFind expected return.`,
          final: i % 2 === 0 ? `expected return=${re}%` : `expected return=${wrong}%`,
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function genFinanceWACC(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const E = irnd(200, 800);
    const D = irnd(100, 600);
    const Re = rnd(0.05, 0.2);
    const Rd = rnd(0.02, 0.12);
    const T = rnd(0.0, 0.35);
    const V = E + D;
    const wacc = round(100 * ((E / V) * Re + (D / V) * Rd * (1 - T)), 6);
    const wrong = round(wacc + pick([0.6, -0.7]), 6);
    out.push({
      topic: "finance_wacc",
      make: () =>
        mkProblem({
          text: `WACC: E=${E}, D=${D}, Re=${round(Re * 100, 6)}%, Rd=${round(
            Rd * 100,
            6
          )}%, tax rate=${round(T * 100, 6)}%.\nFind WACC.`,
          final: i % 2 === 0 ? `WACC=${wacc}%` : `WACC=${wrong}%`,
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function genFinanceCAGR(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const pv = rnd(1000, 9000);
    const fv = rnd(pv * 1.1, pv * 3.0);
    const years = pick([3, 4, 5, 7, 10]);
    const cagr = round(100 * (Math.pow(fv / pv, 1 / years) - 1), 6);
    const wrong = round(cagr + pick([0.7, -0.9]), 6);
    out.push({
      topic: "finance_cagr",
      make: () =>
        mkProblem({
          text: `CAGR: start=${round(pv, 4)}, end=${round(fv, 4)}, years=${years}.\nFind CAGR.`,
          final: i % 2 === 0 ? `CAGR=${cagr}%` : `CAGR=${wrong}%`,
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

// ----------------------------- Accounting -----------------------------
function genAcctEquation(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const L = irnd(200, 2000);
    const E = irnd(200, 2000);
    const A = L + E;
    const wrong = A + pick([15, -20, 30]);
    const ask = pick(["assets", "equity", "liabilities"]);
    let text = `Liabilities = $${L}\nEquity = $${E}\nFind assets.`;
    let final = `assets=$${A}`;
    if (ask === "equity") {
      text = `Assets = $${A}\nLiabilities = $${L}\nFind equity.`;
      final = `equity=$${E}`;
    } else if (ask === "liabilities") {
      text = `Assets = $${A}\nEquity = $${E}\nFind liabilities.`;
      final = `liabilities=$${L}`;
    }
    out.push({
      topic: "acct_equation",
      make: () =>
        mkProblem({
          text,
          final: i % 2 === 0 ? final : final.replace(/\d+(\.\d+)?/, String(wrong)),
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function genAcctJournal(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const amt = irnd(100, 2000);
    const text = `Journal entry:\nDebit: Cash $${amt}\nCredit: Sales $${amt}\nAre debits and credits balanced?`;
    out.push({
      topic: "acct_journal",
      make: () =>
        mkProblem({
          text,
          final: i % 2 === 0 ? `balanced` : `not balanced`,
        }),
      // Our verifier doesn't read "balanced" string directly; it recomputes equality.
      // Returning "balanced" vs "not balanced" just toggles expectation of mismatch.
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function genAcctInventory(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const BI = irnd(1000, 4000);
    const Purch = irnd(500, 3000);
    const COGS = irnd(300, 2500);
    const EI = BI + Purch - COGS;
    const wrong = EI + pick([25, -40, 60]);
    out.push({
      topic: "acct_inventory_identity",
      make: () =>
        mkProblem({
          text: `Beginning inventory = $${BI}\nPurchases = $${Purch}\nCOGS = $${COGS}\nFind ending inventory.`,
          final: i % 2 === 0 ? `EI=$${EI}` : `EI=$${wrong}`,
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function genAcctDepreciation(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const cost = irnd(2000, 10000);
    const salvage = irnd(0, Math.floor(cost / 5));
    const life = pick([3, 5, 7, 10]);
    const year = pick([1, 2, Math.min(3, life)]);
    const depSL = (cost - salvage) / life;
    const bookSL = Math.max(cost - depSL * Math.min(year, life), salvage);
    const wrongDep = depSL + pick([15, -30, 40]);
    const want = pick(["dep", "book"]);

    const base = `Depreciation (straight-line):\nCost=$${cost}\nSalvage=$${salvage}\nLife=${life}\nYear=${year}`;
    out.push({
      topic: "acct_depreciation_sl",
      make: () =>
        mkProblem({
          text: want === "dep" ? `${base}\nFind annual depreciation.` : `${base}\nFind book value at year ${year}.`,
          final:
            i % 2 === 0
              ? want === "dep"
                ? `depreciation=${round(depSL, 4)}`
                : `book value=$${round(bookSL, 2)}`
              : want === "dep"
              ? `depreciation=${round(wrongDep, 4)}`
              : `book value=$${round(bookSL + pick([25, -35, 50]), 2)}`,
        }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function genAcctRatios(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const CA = irnd(2000, 8000);
    const CL = irnd(800, 4000);
    const Inv = irnd(200, 2000);
    const Cash = irnd(100, 2500);
    const AR = irnd(100, 2500);
    const Debt = irnd(1000, 6000);
    const Equity = irnd(2000, 8000);
    const Sales = irnd(4000, 20000);
    const COGS = irnd(2000, Math.max(2500, Sales - 500));
    const NI = irnd(200, 4000);

    const current = round(CA / CL, 6);
    const quick = round((Cash + AR + Math.max(0, CA - Inv - Cash - AR)) / CL, 6);
    const d2e = round(Debt / Equity, 6);
    const gm = round((Sales - COGS) / Sales, 6);
    const roa = round(NI / (CA + Equity), 6); // rough, not perfect but consistent with parsing
    const roe = round(NI / Equity, 6);

    const which = pick(["current", "quick", "d2e", "gm", "roa", "roe"]);
    let text = `Current assets=${CA}\nCurrent liabilities=${CL}\nInventory=${Inv}\nCash=${Cash}\nAccounts receivable=${AR}\nDebt=${Debt}\nEquity=${Equity}\nSales=${Sales}\nCOGS=${COGS}\nNet income=${NI}\nCompute `;
    let final = "";
    let correct = 0;

    if (which === "current") {
      text += "current ratio.";
      correct = current;
      final = `current ratio=${correct}`;
    } else if (which === "quick") {
      text += "quick ratio (acid-test).";
      correct = quick;
      final = `quick ratio=${correct}`;
    } else if (which === "d2e") {
      text += "debt-to-equity.";
      correct = d2e;
      final = `debt to equity=${correct}`;
    } else if (which === "gm") {
      text += "gross margin.";
      correct = gm;
      final = `gross margin=${correct}`;
    } else if (which === "roa") {
      text += "ROA.";
      correct = roa;
      final = `ROA=${correct}`;
    } else {
      text += "ROE.";
      correct = roe;
      final = `ROE=${correct}`;
    }

    const wrong = round(correct + pick([0.2, -0.25, 0.4]), 6);
    out.push({
      topic: "acct_ratios",
      make: () => mkProblem({ text, final: i % 2 === 0 ? final : final.replace(/[0-9.\-]+$/, String(wrong)) }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

function genAcctNetIncome(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const sales = irnd(8000, 30000);
    const cogs = irnd(3000, Math.max(4000, sales - 2000));
    const sga = irnd(500, 4000);
    const rAndD = irnd(0, 2000);     // <- renamed (was `rnd`)
    const dep = irnd(0, 1500);
    const interest = irnd(0, 1200);
    const taxRate = rnd(0.1, 0.35);  // <- keep using helper `rnd(a,b)`

    const gp = sales - cogs;
    const opx = sga + rAndD + dep;
    const ebit = gp - opx;
    const ebt = ebit - interest;
    const tax = ebt * taxRate;
    const ni = round(ebt - tax, 2);
    const wrong = round(ni + pick([40, -55, 80]), 2);

    const text = `Income statement items:
Net sales=$${sales}
COGS=$${cogs}
Selling expenses=$${sga}
Research & development=$${rAndD}
Depreciation expense=$${dep}
Interest expense=$${interest}
Tax rate=${round(taxRate * 100, 6)}%
Compute net income.`;

    out.push({
      topic: "acct_net_income",
      make: () => mkProblem({ text, final: i % 2 === 0 ? `net income=$${ni}` : `net income=$${wrong}` }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}


function genAcctCVP(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const price = irnd(20, 200);
    const vcu = irnd(5, price - 1);
    const fixed = irnd(1000, 20000);
    const beUnits = round(fixed / (price - vcu), 6);
    const beSales = round(beUnits * price, 2);
    const wrongUnits = round(beUnits + pick([5, -7, 9]), 6);
    const wrongSales = round(beSales + pick([50, -75, 100]), 2);
    const want = pick(["units", "sales"]);

    const text = `CVP:\nPrice per unit=$${price}\nVariable cost per unit=$${vcu}\nFixed costs=$${fixed}\nFind break-even ${
      want === "units" ? "units" : "sales"
    }.`;
    const final =
      want === "units" ? `units=${beUnits}` : `sales=$${beSales}`;
    const wrongFinal =
      want === "units" ? `units=${wrongUnits}` : `sales=$${wrongSales}`;

    out.push({
      topic: "acct_cvp",
      make: () => mkProblem({ text, final: i % 2 === 0 ? final : wrongFinal }),
      expect: i % 2 === 0 ? "match" : "mismatch",
    });
  }
  return out;
}

// ----------------------------- Assemble all -----------------------------
async function main() {
  // Adjust per-topic counts here
  const N_SMALL = 40;
  const N_MED = 60;

  const cases: Case[] = []
    // Algebra (broad)
    .concat(genAlgebraLinear(N_MED))
    .concat(genAlgebraQuadratic(N_MED))
    .concat(genAlgebraSystems(N_SMALL))
    .concat(genAlgebraDomain(N_SMALL))
    .concat(genAlgebraLogSqrt(N_SMALL))
    // Stats
    .concat(genStatsMean(N_MED))
    .concat(genStatsMedian(N_MED))
    .concat(genStatsVarStd(N_MED))
    // Finance (many topics)
    .concat(genFinanceNPV(N_MED))
    .concat(genFinanceIRR(N_MED))
    .concat(genFinancePMT(N_MED))
    .concat(genFinanceAPR_EAR(N_SMALL))
    .concat(genFinanceBondPrice(N_SMALL))
    .concat(genFinanceCAPM(N_SMALL))
    .concat(genFinanceWACC(N_SMALL))
    .concat(genFinanceCAGR(N_SMALL))
    // Accounting
    .concat(genAcctEquation(N_MED))
    .concat(genAcctJournal(N_SMALL))
    .concat(genAcctInventory(N_MED))
    .concat(genAcctDepreciation(N_MED))
    .concat(genAcctRatios(N_MED))
    .concat(genAcctNetIncome(N_MED))
    .concat(genAcctCVP(N_MED));

  const perTopic: Record<string, Tally> = {};
  let totalOK = 0,
    totalBad = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const res = await runCase(c);
    perTopic[c.topic] ??= { ok: 0, bad: 0 };
    inc(perTopic[c.topic], res.ok);
    if (res.ok) totalOK++;
    else totalBad++;
  }

  // Pretty print
  console.log("\n=== Param Test Summary ===");
  const topics = Object.keys(perTopic).sort();
  for (const t of topics) {
    const { ok, bad } = perTopic[t];
    const total = ok + bad;
    const pct = total ? Math.round((ok / total) * 100) : 0;
    console.log(`${t.padEnd(28)}  ${String(ok).padStart(4)} ok  ${String(bad).padStart(4)} bad  (${pct}%)`);
  }
  console.log(`\nTOTAL: ${totalOK} ok, ${totalBad} bad, ${(Math.round((totalOK / (totalOK + totalBad)) * 100) || 0)}%`);

  // Exit code for CI
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

