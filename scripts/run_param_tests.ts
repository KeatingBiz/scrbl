// scripts/run_param_tests.ts
import { verifyBoard } from "../lib/verify";
import type { BoardUnderstanding, Verification } from "../lib/types";

/** ==== Helpers to build minimal BoardUnderstanding ==== */
const step = (before: string | null = null): any => ({
  n: 1, text: "", action: "", before, after: null, why: null, tip: null, emoji: null
});

type Case = { subject: string; name: string; expectPass: boolean; board: BoardUnderstanding };

function push<T>(arr: T[], ...items: T[]) { items.forEach(i => arr.push(i)); }

/** ==== Generators (fast, no files, all in-memory) ==== */
// Algebra: ax + b = c  and simple quadratics x^2 + px + q = 0
function genAlgebra(count = 150): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < count; i++) {
    const a = 1 + Math.floor(Math.random() * 9);
    const b = Math.floor(Math.random() * 21) - 10;
    const c = Math.floor(Math.random() * 21) - 10;
    const x = (c - b) / a;
    const reported = Math.random() < 0.15 ? x + (Math.random() < 0.5 ? 1 : -1) : x;
    const expectPass = Math.abs(reported - x) < 1e-6;

    out.push({
      subject: "algebra",
      name: `lin_${i}`,
      expectPass,
      board: {
        type: "PROBLEM_SOLVED",
        subject_guess: "algebra",
        confidence: 0.9,
        raw_text: `Solve for x: ${a}x + ${b} = ${c}`,
        question: "Solve for x",
        steps: [step(`${a}x + ${b} = ${c}`)],
        final: `x=${reported}`,
        given_answer: null,
        answer_status: "matches",
        events: []
      }
    });
  }

  for (let i = 0; i < count; i++) {
    const r1 = Math.floor(Math.random() * 9) - 4;
    const r2 = Math.floor(Math.random() * 9) - 4;
    const p = -(r1 + r2);
    const q = r1 * r2;
    const answers = Math.random() < 0.15 ? [r1 + 1, r2] : [r1, r2];
    const expectPass = answers[0] === r1 && answers[1] === r2;

    out.push({
      subject: "algebra",
      name: `quad_${i}`,
      expectPass,
      board: {
        type: "PROBLEM_SOLVED",
        subject_guess: "algebra",
        confidence: 0.9,
        raw_text: `Solve: x^2 + ${p}x + ${q} = 0`,
        question: "Find the roots",
        steps: [step(`x^2 + ${p}x + ${q} = 0`)],
        final: `x=${answers[0]} or x=${answers[1]}`,
        given_answer: null,
        answer_status: "matches",
        events: []
      }
    });
  }
  return out;
}

// Stats: mean and std (plugin accepts pop/sample either way)
function genStats(count = 150): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < count; i++) {
    const n = 5 + Math.floor(Math.random() * 6);
    const data = Array.from({ length: n }, () => Math.round((Math.random() * 20 - 10) * 10) / 10);
    const mean = data.reduce((s, v) => s + v, 0) / n;
    const reported = Math.random() < 0.15 ? mean + 1 : mean;
    const expectPass = Math.abs(reported - mean) < 1e-6;

    out.push({
      subject: "stats",
      name: `mean_${i}`,
      expectPass,
      board: {
        type: "PROBLEM_SOLVED",
        subject_guess: "stats",
        confidence: 0.9,
        raw_text: `numbers: [${data.join(", ")}]`,
        question: "Compute the mean",
        steps: [step(null)],
        final: `mean=${reported}`,
        given_answer: null,
        answer_status: "matches",
        events: []
      }
    });
  }

  for (let i = 0; i < count; i++) {
    const n = 6 + Math.floor(Math.random() * 6);
    const data = Array.from({ length: n }, () => Math.round((Math.random() * 20 - 10) * 10) / 10);
    const m = data.reduce((s, v) => s + v, 0) / n;
    const variancePop = data.reduce((s, v) => s + (v - m) ** 2, 0) / n;
    const stdPop = Math.sqrt(variancePop);
    const reported = Math.random() < 0.15 ? stdPop + 0.5 : stdPop;
    const expectPass = Math.abs(reported - stdPop) < 1e-6;

    out.push({
      subject: "stats",
      name: `std_${i}`,
      expectPass,
      board: {
        type: "PROBLEM_SOLVED",
        subject_guess: "stats",
        confidence: 0.9,
        raw_text: `data: [${data.join(", ")}]`,
        question: "Compute the standard deviation",
        steps: [step(null)],
        final: `std=${reported}`,
        given_answer: null,
        answer_status: "matches",
        events: []
      }
    });
  }
  return out;
}

// Finance: NPV (kept simple/robust)
function genFinance(count = 150): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < count; i++) {
    const r = [0.05, 0.08, 0.1][Math.floor(Math.random() * 3)];
    const cfs = Array.from({ length: 5 }, (_, k) => (k === 0 ? -1000 : Math.round(Math.random() * 500)));
    const npv = cfs.reduce((acc, cf, k) => acc + cf / Math.pow(1 + r, k), 0);
    const reported = Math.random() < 0.15 ? npv + 50 : npv;
    const expectPass = Math.abs(reported - npv) < 1e-4;

    out.push({
      subject: "finance",
      name: `npv_${i}`,
      expectPass,
      board: {
        type: "PROBLEM_SOLVED",
        subject_guess: "finance",
        confidence: 0.9,
        raw_text: `rate=${(r * 100).toFixed(1)}% cash flows: [${cfs.join(", ")}]`,
        question: "Compute NPV",
        steps: [step(null)],
        final: `npv=${reported}`,
        given_answer: null,
        answer_status: "matches",
        events: []
      }
    });
  }
  return out;
}

// Physics: v = u + a t
function genPhysics(count = 150): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < count; i++) {
    const u = Math.round(Math.random() * 10);
    const a = Math.round((Math.random() * 4 + 1) * 10) / 10;
    const t = Math.round((Math.random() * 4 + 1) * 10) / 10;
    const v = u + a * t;
    const reported = Math.random() < 0.15 ? v + 0.5 : v;
    const expectPass = Math.abs(reported - v) < 1e-3;

    out.push({
      subject: "physics",
      name: `v_eq_${i}`,
      expectPass,
      board: {
        type: "PROBLEM_SOLVED",
        subject_guess: "physics",
        confidence: 0.9,
        raw_text: `u=${u}  a=${a}  t=${t}`,
        question: "Find v using v = u + at",
        steps: [step("v = u + a t")],
        final: `v=${reported}`,
        given_answer: null,
        answer_status: "matches",
        events: []
      }
    });
  }
  return out;
}

/** ==== Runner: sequential loop, prints summary ==== */
async function main() {
  // Adjust counts here if you want more/less per subject:
  const cases: Case[] = []
    .concat(genAlgebra(150))
    .concat(genStats(150))
    .concat(genFinance(150))
    .concat(genPhysics(150));

  const bySubj: Record<string, { total: number; passed: number; failed: number }> = {};
  let total = 0, okAll = 0, failAll = 0;

  for (const k of cases) {
    total++;
    bySubj[k.subject] ??= { total: 0, passed: 0, failed: 0 };
    bySubj[k.subject].total++;

    let v: Verification | null = null;
    try {
      v = await verifyBoard(k.board);
    } catch (e: any) {
      failAll++; bySubj[k.subject].failed++;
      // Uncomment to see specific errors:
      // console.log(`❌ ${k.subject}/${k.name} — verifier threw: ${e?.message}`);
      continue;
    }

    const gotPass = !!v?.allVerified;
    const ok = gotPass === k.expectPass;
    if (ok) {
      okAll++; bySubj[k.subject].passed++;
    } else {
      failAll++; bySubj[k.subject].failed++;
      // Uncomment for detailed mismatches:
      // console.log(`❌ ${k.subject}/${k.name} — expected ${k.expectPass} got ${gotPass}`);
    }
  }

  console.log("\n=== Verifier Parametric Tests ===");
  for (const [s, r] of Object.entries(bySubj)) {
    console.log(`  ${s.padEnd(8)}  total=${r.total.toString().padStart(4)}  ok=${r.passed.toString().padStart(4)}  bad=${r.failed.toString().padStart(4)}`);
  }
  console.log(`---------------------------------`);
  console.log(`  overall   total=${total}  ok=${okAll}  bad=${failAll}\n`);

  process.exit(failAll === 0 ? 0 : 1);
}

main();
