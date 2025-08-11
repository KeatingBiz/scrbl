import type { BoardUnderstanding, Verification } from "@/lib/types";
import { verifyAlgebra } from "./algebra";

export async function verifyBoard(result: BoardUnderstanding): Promise<Verification | null> {
  if (result.type?.startsWith("PROBLEM")) {
    // Heuristic: equation-like?
    const hasEq =
      !!result.steps?.some(s => (s.before || "").includes("=")) ||
      (result.question || result.raw_text || "").includes("=");

    if (hasEq) {
      return verifyAlgebra(result);
    }
    // TODO: add arithmetic/word-problem, physics, chemistry, stats verifiers here
  }
  return null; // announcements/unknown: nothing to verify (calendar will be added later)
}
