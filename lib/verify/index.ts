// lib/verify/index.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import { verifyAlgebra } from "./algebra";
import { verifyStats } from "./stats";
import { verifyGeometry } from "./geometry";
import { verifyCalculus } from "./calculus";
import { verifyPhysics } from "./physics";
import { verifyChemistry } from "./chemistry";
import { verifyFinance } from "./finance";
import { gatherProblemText, countOccurrences } from "./utils";

type Plugin = {
  name: string;
  matches: (r: BoardUnderstanding, blob: string) => boolean;
  run: (r: BoardUnderstanding) => Verification | null;
};

const plugins: Plugin[] = [
  {
    name: "algebra",
    matches: (r, blob) =>
      r.type?.startsWith("PROBLEM") === true &&
      (blob.includes("=") ||
        (r.steps || []).some(
          (s) =>
            (s.before || "").includes("=") ||
            (s.after || "").includes("=")
        )),
    run: verifyAlgebra,
  },
  {
    name: "stats",
    matches: (_r, blob) =>
      /\b(mean|average|median|variance|std|standard deviation|sd)\b/i.test(
        blob
      ),
    run: verifyStats,
  },
  {
    name: "geometry",
    matches: (_r, blob) =>
      /\b(triangle|rectangle|circle|hypotenuse|pythagorean|perimeter|area)\b/i.test(
        blob
      ),
    run: verifyGeometry,
  },
  {
    name: "physics",
    matches: (_r, blob) =>
      /\b(kinematics|acceleration|displacement)\b/i.test(blob) ||
      /(v=u\+at|s=ut\+|v\^?2=u\^?2\+2as|\bu=|\bv=|\ba=|\bt=|\bs=)/i.test(
        blob
      ),
    run: verifyPhysics,
  },
  {
    name: "finance",
    matches: (_r, blob) =>
      /\b(npv|irr|pmt|net present value|internal rate of return|compound annual growth rate|cagr)\b/i.test(
        blob
      ),
    run: verifyFinance,
  },
  {
    name: "calculus",
    matches: (_r, blob) =>
      /\b(derivative|integral|limit|d\/dx)\b|[∫]|(?:\blim\b)/i.test(blob),
    run: verifyCalculus,
  },
  {
    name: "chemistry",
    matches: (_r, blob) =>
      /\b(H2O|NaCl|balance|stoichiometry|moles|molarity|dilution|PV\s*=\s*nRT|gas law)\b/i.test(
        blob
      ),
    run: verifyChemistry,
  },
];

export async function verifyBoard(
  result: BoardUnderstanding
): Promise<Verification | null> {
  if (!result || !result.type || !result.type.startsWith("PROBLEM"))
    return null;

  const blob = gatherProblemText(
    result.question,
    result.raw_text,
    result.steps
  ).toLowerCase();

  // Rank candidates by keyword density so the best subject runs first.
  const scored = plugins
    .map((p) => {
      const score =
        p.name === "calculus"
          ? countOccurrences(blob, [
              /∫/g,
              /\bd\/dx\b/g,
              /\blim\b/g,
              /\bdy\/dx\b/g,
            ])
          : p.name === "stats"
          ? countOccurrences(blob, [
              /\b(mean|median|mode|variance|std|standard deviation|sd)\b/g,
              /\b(p-?value|confidence interval|z|t|chi-?square|χ2?)\b/g,
            ])
          : p.name === "geometry"
          ? countOccurrences(blob, [
              /\b(triangle|rectangle|circle|radius|diameter|hypotenuse|perimeter|area)\b/g,
              /\bpi|π\b/g,
            ])
          : p.name === "physics"
          ? countOccurrences(blob, [
              /\b(kinematics|acceleration|displacement|force|mass|energy|momentum)\b/g,
              /\b(m\/s|kg|n|j)\b/g,
            ])
          : p.name === "finance"
          ? countOccurrences(blob, [
              /\b(npv|irr|cash\s*flows?|discount\s*rate|apr|apy|annuity|pmt|coupon|bond)\b/g,
            ])
          : p.name === "chemistry"
          ? countOccurrences(blob, [
              /\b(mol(es)?|molarity|stoichiometry|balance|limiting reagent|ph|poh)\b/g,
              /\bpv\s*=\s*nrt\b/g,
            ])
          : // algebra fallback
            countOccurrences(blob, [
              /[=]/g,
              /\bsolve\b/g,
              /\bx\b/g,
              /\by\b/g,
              /\^2\b/g,
            ]);

      return { plugin: p, score, matches: p.matches(result, blob) };
    })
    .filter((x) => x.matches && x.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const { plugin } of scored) {
    try {
      const v = await Promise.resolve(plugin.run(result));
      if (v) return v;
    } catch {
      /* try next */
    }
  }

  // Fallback to original order if scoring produced nothing useful.
  for (const p of plugins) {
    try {
      if (p.matches(result, blob)) {
        const v = p.run(result);
        if (v) return v;
      }
    } catch {
      /* continue */
    }
  }
  return null;
}




