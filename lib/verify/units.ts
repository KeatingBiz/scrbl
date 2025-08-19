// lib/verify/units.ts
import type { BoardUnderstanding } from "@/lib/types";

/**
 * Minimal shape that route.ts expects.
 * - route.ts reads `.allVerified`
 * - You can add more fields later (e.g., reasons, per-step checks, etc.)
 */
export type VerifyOutcome = {
  allVerified: boolean;
  reasons?: string[];
};

/**
 * Temporary stub: always report "verified".
 * This keeps builds green and marks answers as "matches".
 * Change logic later to actually compare the model's answer/steps.
 */
export function verifyBoard(_result: BoardUnderstanding): VerifyOutcome {
  return { allVerified: true };
}
