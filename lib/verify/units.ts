// lib/verify/units.ts
import type { BoardUnderstanding } from "@/lib/types";

/** One individual check result (expand later as needed) */
export type VerificationCheck = {
  name: string;        // e.g. "answer-equals", "step-count"
  ok: boolean;         // did this check pass?
  detail?: string;     // optional human-readable detail
};

/** The verification object used across the app/scripts */
export type Verification = {
  subject: "answer" | "steps" | "general";
  method: string;                 // e.g. "heuristic-v1", "stub"
  checks: VerificationCheck[];    // list of per-check results
  allVerified: boolean;           // convenience aggregate flag
};

/** Back-compat alias (some files may refer to VerifyOutcome) */
export type VerifyOutcome = Verification;

/**
 * TEMP STUB:
 * Return a verification object that always passes.
 * (You can swap logic later to actually compare result.final, steps, etc.)
 */
export function verifyBoard(_result: BoardUnderstanding): Verification {
  return {
    subject: "answer",
    method: "stub",
    checks: [],
    allVerified: true,
  };
}
