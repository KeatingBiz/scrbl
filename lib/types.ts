export type BoardType =
  | "PROBLEM_UNSOLVED"
  | "PROBLEM_SOLVED"
  | "ANNOUNCEMENT"
  | "UNKNOWN";

export type Step = {
  n: number;
  text: string;
  action: string | null;
  before: string | null;
  after: string | null;
  why: string | null;
  tip: string | null;
  emoji: string | null;
};

export type VerificationMethod =
  | "algebra-substitution"
  | "stats-recompute"
  | "geometry-identity"
  | "physics-kinematics"
  | "finance-tvm"
  | "calculus-numeric"
  | "chemistry-balance"
  | "none";

export type Verification = {
  subject: string | null;             // e.g., "algebra", "stats"
  method: VerificationMethod;
  allVerified: boolean;
  checks: Array<{
    value: string;                    // e.g., "x=4", "mean=6.25"
    ok: boolean;
    lhs?: number;                     // recomputed
    rhs?: number;                     // reported final
    reason?: string | null;
  }>;
};

export type BoardUnderstanding = {
  type: BoardType;
  subject_guess?: string | null;
  confidence: number;
  raw_text?: string | null;

  // Problems:
  question?: string | null;
  given_answer?: string | null;
  steps?: Step[];
  final?: string | null;
  answer_status?:
    | "matches"
    | "mismatch"
    | "no_answer_on_board"
    | "not_applicable"
    | null;

  // Announcements:
  events?: Array<{
    title: string;
    date_start_iso: string;
    date_end_iso?: string | null;
    location?: string | null;
    notes?: string | null;
  }>;

  // Server-added (silent) verification:
  verification?: Verification;
};



