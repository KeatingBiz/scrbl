import type { BoardUnderstanding, Verification } from "@/lib/types";

export function verifyChemistry(_result: BoardUnderstanding): Verification | null {
  // TODO: equation balance (atom/charge count), stoichiometry recompute
  return null;
}
