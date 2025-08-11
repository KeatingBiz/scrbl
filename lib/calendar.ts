// lib/calendar.ts
export type AppEvent = {
  id: string;
  title: string;
  startISO: string;
  endISO?: string | null;
  location?: string | null;
  notes?: string | null;
  source: "board" | "manual";
  createdAt: string;          // ISO
  notifyDaysBefore: 0 | 1 | 2;
};

export function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "evt_" + Math.random().toString(36).slice(2);
}

// Simple duplicate check: same title & same start
export function isSameEvent(a: Pick<AppEvent, "title" | "startISO">, b: Pick<AppEvent, "title" | "startISO">) {
  return a.title.trim().toLowerCase() === b.title.trim().toLowerCase()
    && new Date(a.startISO).toISOString() === new Date(b.startISO).toISOString();
}

export function normalizeEvent(partial: Partial<AppEvent>): AppEvent {
  return {
    id: partial.id || makeId(),
    title: (partial.title || "Untitled").trim(),
    startISO: partial.startISO || new Date().toISOString(),
    endISO: partial.endISO ?? null,
    location: partial.location ?? null,
    notes: partial.notes ?? null,
    source: partial.source || "board",
    createdAt: partial.createdAt || new Date().toISOString(),
    notifyDaysBefore: (partial.notifyDaysBefore ?? 2) as 0 | 1 | 2,
  };
}
