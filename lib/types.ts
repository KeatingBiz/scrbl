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

export type Verification = {
  subject: string | null;                  // e.g., "algebra"
  method: "algebra-substitution" | "none";
  allVerified: boolean;
  checks: Array<{
    value: string;                         // "x=4"
    ok: boolean;
    lhs?: number;
    rhs?: number;
    reason?: string | null;                // e.g., "division by zero"
  }>;
};

export type BoardUnderstanding = {
  type: BoardType;
  subject_guess?: string | null;
  confidence: number;
  raw_text?: string | null;

  // Problems
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

  // Announcements
  events?: Array<{
    title: string;
    date_start_iso: string;
    date_end_iso?: string | null;
    location?: string | null;
    notes?: string | null;
  }>;

  // Server-added (silent) verification
  verification?: Verification;
};

