export type BoardType =
  | "PROBLEM_UNSOLVED"
  | "PROBLEM_SOLVED"
  | "ANNOUNCEMENT"
  | "UNKNOWN";

export type Step = {
  n: number;
  text: string;                // plain, simple instruction
  action: string | null;       // e.g., "Multiply both sides by 4"
  before: string | null;       // "x/4 + 8/x = 3"
  after: string | null;        // "x^2 + 32 = 12x"
  why: string | null;          // 1-liner reason
  tip: string | null;          // extra hint
  emoji: string | null;        // small vibe marker, e.g., "🧮"
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
};

