import type { BoardUnderstanding, Verification } from "@/lib/types";
import { verifyAlgebra } from "./algebra";
import { verifyStatsMean } from "./stats";
import { verifyGeometry } from "./geometry";
import { verifyCalculus } from "./calculus";
import { verifyPhysics } from "./physics";
import { verifyChemistry } from "./chemistry";
import { verifyFinance } from "./finance";

export async function verifyBoard(result: BoardUnderstanding): Promise<Verification | null> {
  // 1) Algebra: equation-like problems
  const looksEquation =
    !!result.steps?.some(s => (s.before || "").includes("=") || (s.after || "").includes("=")) ||
    (result.question || result.raw_text || "").includes("=");

  if (looksEquation) {
    const v = verifyAlgebra(result);
    if (v) return v;
  }

  // 2) Stats: mean/average recomputation
  const vStats = verifyStatsMean(result);
  if (vStats) return vStats;

  // 3) Other subjects (stubs for now; they will return null until implemented)
  const tryRest: Array<Verification | null> = [
    verifyGeometry(result),
    verifyCalculus(result),
    verifyPhysics(result),
    verifyChemistry(result),
    verifyFinance(result)
  ];
  for (const v of tryRest) {
    if (v) return v;
  }

  // No verifier applied
  return null;
}

