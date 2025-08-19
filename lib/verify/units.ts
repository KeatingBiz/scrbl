// lib/verify/units.ts
import type { BoardUnderstanding } from "@/lib/types";

/**
 * The outcome of verifying a model's understanding of the board.
 * Expand this later as you add real checks.
 */
export type VerifyOutcome =
  | { status: "ok" }
  | { status: "mismatch"; reason?: string }
  | { status: "skipped" };

/**
 * Temporary stub: keep the build green without changing behavior.
 * Wire in real logic when you're ready.
 */
export function verifyBoard(_result: BoardUnderstanding): VerifyOutcome {
  return { status: "skipped" };
}
