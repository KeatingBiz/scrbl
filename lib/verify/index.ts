import type { BoardUnderstanding, Verification } from "@/lib/types";
import { verifyAlgebra } from "./algebra";
import { verifyStats } from "./stats";
import { verifyGeometry } from "./geometry";
import { verifyCalculus } from "./calculus";
import { verifyPhysics } from "./physics";
import { verifyChemistry } from "./chemistry";
import { verifyFinance } from "./finance";
import { gatherProblemText } from "./utils";

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
      (blob.includes("=") || (r.steps || []).some(s => (s.before || "").includes("=") || (s.after || "").includes("="))),
    run: verifyAlgebra
  },
  {
    name: "stats",
    matches: (_r, blob) => /\b(mean|average|median|variance|std|standard deviation|sd)\b/i.test(blob),
    run: verifyStats
  },
  {
    name: "geometry",
    matches: (_r, blob) => /\btriangle|rectangle|circle|hypotenuse|pythagorean|perimeter|area\b/i.test(blob),
    run: verifyGeometry
  },
  {
    name: "physics",
    matches: (_r, blob) => /\bkinematics|acceleration|displacement|v=u\+at|s=ut\+|v\^?2=u\^?2\+2as|\bu=|\bv=|\ba=|\bt=|\bs=\b/i.test(blob),
    run: verifyPhysics
  },
  {
    name: "finance",
    matches: (_r, blob) => /\bnpv\b|\birr\b|\bpmt\b|net present value|internal rate of return|compound annual growth rate|cagr/i.test(blob),
    run: verifyFinance
  },
  {
    name: "calculus",
    matches: (_r, blob) => /\bderivative|integral|limit|d\/dx|∫|lim\b/i.test(blob),
    run: verifyCalculus
  },
  {
    name: "chemistry",
    matches: (_r, blob) => /\bH2O|NaCl|balance|stoichiometry|moles|molarity|dilution|gas law|PV=nRT\b/i.test(blob),
    run: verifyChemistry
  }
];

export async function verifyBoard(result: BoardUnderstanding): Promise<Verification | null> {
  if (!result || !result.type || !result.type.startsWith("PROBLEM")) return null;
  const blob = gatherProblemText(result.question, result.raw_text, result.steps).toLowerCase();

  for (const p of plugins) {
    try {
      if (p.matches(result, blob)) {
        const v = p.run(result);
        if (v) return v;
      }
    } catch {
      // plugin failed; move on
    }
  }

  return null;
}


