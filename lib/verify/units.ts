// lib/verify/units.ts
import type {
  BoardUnderstanding,
  Verification as TypesVerification,
  VerificationMethod,
} from "@/lib/types";

/**
 * Make our exported Verification type EXACTLY the same as the project's canonical type.
 * This ensures imports from "@/lib/verify/units" and "@/lib/types" are assignable to each other.
 */
export type Verification = TypesVerification;

/**
 * Temporary stub implementation.
 * - Returns a valid Verification object that satisfies the project's type expectations.
 * - Uses literal casts pulled from the canonical type to avoid union-type mismatches.
 */
export function verifyBoard(_result: BoardUnderstanding): Verification {
  return {
    subject: "answer" as Verification["subject"],     // use a valid subject literal from your union
    method: "stub" as VerificationMethod,             // cast to the project's VerificationMethod union
    checks: [] as Verification["checks"],             // empty list of checks is fine as a stub
    allVerified: true,                                // choose true/false as you prefer for default behavior
  };
}
