export type BoardType = "PROBLEM_UNSOLVED" | "PROBLEM_SOLVED" | "ANNOUNCEMENT" | "UNKNOWN";

export type BoardUnderstanding = {
  type: BoardType;
  subject_guess?: string;            // e.g., Algebra, Physics, History
  confidence: number;                // 0..1
  raw_text?: string;                 // OCR-ish capture of key text seen
  // For problems:
  question?: string;
  given_answer?: string | null;      // if the board already shows an answer
  steps?: { n: number; text: string }[];
  final?: string | null;             // solved final answer (if applicable)
  answer_status?: "matches" | "mismatch" | "no_answer_on_board" | "not_applicable";
  // For announcements:
  events?: Array<{
    title: string;                   // "Test: Chapter 5"
    date_start_iso: string;          // e.g., "2025-08-15T09:00:00-05:00"
    date_end_iso?: string | null;
    location?: string | null;
    notes?: string | null;
  }>;
};
