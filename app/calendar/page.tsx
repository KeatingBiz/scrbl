// app/calendar/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useEvents } from "@/app/hooks/useEvents";
import type { AppEvent } from "@/lib/calendar";

/* ===== date utils (local, DST-safe) ===== */
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];
const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

/** local YYYY-MM-DD */
function ymdLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** build a Date in local time from "YYYY-MM-DD" */
function dateFromYMD(ymd: string) {
  const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** 6x7 grid (Sun start) for the visible month */
function monthMatrix(view: Date) {
  const first = startOfMonth(view);
  const startOffset = first.getDay(); // 0..6 Sun..Sat
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startOffset);

  const cells: { date: Date; inMonth: boolean; isToday: boolean }[] = [];
  const today = new Date();
  const todayY = today.getFullYear(), todayM = today.getMonth(), todayD = today.getDate();

  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const inMonth = d.getMonth() === view.getMonth();
    const isToday = d.getFullYear() === todayY && d.getMonth() === todayM && d.getDate() === todayD;
    cells.push({ date: d, inMonth, isToday });
  }
  return cells;
}

/* ===== UI helpers ===== */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="w-full max-w-md">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      {children}
    </section>
  );
}

export default function CalendarPage() {
  const { events } = useEvents();

  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState<Date>(startOfMonth(today));
  const [selectedYMD, setSelectedYMD] = useState<string>(ymdLocal(today));

  const cells = useMemo(() => monthMatrix(view), [view]);

  // group events by local YMD
  const eventsByDay = useMemo(() => {
    const map = new Map<string, AppEvent[]>();
    for (const e of events) {
      const d = new Date(e.startISO);
      const key = ymdLocal(d);
      const list = map.get(key) || [];
      list.push(e);
      map.set(key, list);
    }
    return map;
  }, [events]);

  const selectedEvents = eventsByDay.get(selectedYMD) || [];

  return (
    <div className="min-h-screen p-6 flex flex-col items-center gap-6">
      {/* Header */}
      <div className="w-full max-w-md">
        <div className="text-neutral-200 text-sm">Your</div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            {MONTHS[view.getMonth()]} {view.getFullYear()}
          </h1>
          <div className="flex items-center gap-2">
            <button
              aria-label="Previous month"
              onClick={() => setView(addMonths(view, -1))}
              className="rounded-lg px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10"
            >
              ‹
            </button>
            <button
              aria-label="Next month"
              onClick={() => setView(addMonths(view, 1))}
              className="rounded-lg px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {/* Month grid */}
      <Section title="Calendar">
        <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-2 mb-2">
            {WEEKDAYS.map((w) => (
              <div key={w} className="text-center text-[11px] text-neutral-400">{w}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-2">
            {cells.map(({ date, inMonth, isToday }) => {
              const ymd = ymdLocal(date);
              const isSelected = selectedYMD === ymd;
              const dayEvents = eventsByDay.get(ymd) || [];
              return (
                <button
                  key={date.toDateString()}
                  onClick={() => {
                    setSelectedYMD(ymd);
                    if (!inMonth) setView(startOfMonth(date)); // navigate when tapping spillover days
                  }}
                  className={[
                    "relative aspect-square rounded-xl border text-sm flex flex-col items-center justify-start p-1",
                    inMonth ? "border-scrbl/40" : "border-scrbl/15 opacity-70",
                    isSelected ? "bg-scrbl/20 border-scrbl" : "",
                    !isSelected && isToday ? "ring-1 ring-scrbl/50" : "",
                    "hover:bg-white/5 transition"
                  ].join(" ")}
                >
                  <div className="w-full flex items-center justify-between">
                    <div className="text-white">{date.getDate()}</div>
                    {dayEvents.length > 0 && (
                      <div className="flex -space-x-1">
                        {Array.from({ length: Math.min(dayEvents.length, 3) }).map((_, i) => (
                          <span
                            key={i}
                            className="inline-block w-1.5 h-1.5 rounded-full bg-scrbl/80"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  {dayEvents.length > 0 && (
                    <div className="mt-1 w-full text-[10px] text-white/90 line-clamp-2 text-left">
                      {dayEvents[0].title}
                      {dayEvents.length > 1 ? ` +${dayEvents.length - 1} more` : ""}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      {/* Day details */}
      <Section
        title={dateFromYMD(selectedYMD).toLocaleDateString([], {
          weekday: "long",
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      >
        {selectedEvents.length === 0 ? (
          <div className="text-xs text-neutral-500 border border-dashed border-white/10 rounded-xl p-6 text-center">
            No items on this day yet.
          </div>
        ) : (
          <div className="space-y-3">
            {selectedEvents.map((e) => (
              <div key={e.id} className="rounded-xl bg-black/30 border border-white/10 p-3">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold flex-1">{e.title}</div>
                  <span className="px-2 py-1 rounded-full text-[11px] bg-white/5 border border-white/10">
                    {e.source}
                  </span>
                </div>
                <div className="text-xs text-neutral-400 mt-1">
                  {new Date(e.startISO).toLocaleString([], { hour: "2-digit", minute: "2-digit" })}
                  {e.location ? ` • ${e.location}` : ""}
                </div>
                {e.notes && (
                  <div className="text-xs text-neutral-400 mt-1 whitespace-pre-wrap">{e.notes}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="w-full max-w-md">
        <a
          href="/"
          className="w-full block text-center rounded-xl py-3 mt-2 bg-white/5 text-white hover:bg-white/10 transition"
        >
          New Scrbl
        </a>
      </div>
    </div>
  );
}


