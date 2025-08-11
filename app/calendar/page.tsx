// app/calendar/page.tsx
"use client";
import { useEvents } from "@/app/hooks/useEvents";
import { AppEvent } from "@/lib/calendar";
import { useMemo } from "react";

function fmt(dt: string) {
  const d = new Date(dt);
  return d.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="w-full max-w-md">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      {children}
    </section>
  );
}

export default function CalendarPage() {
  const { events, remove, update } = useEvents();

  const grouped = useMemo(() => {
    const map = new Map<string, AppEvent[]>();
    for (const e of events) {
      const k = new Date(e.startISO).toISOString().slice(0, 10); // yyyy-mm-dd
      const arr = map.get(k) || [];
      arr.push(e);
      map.set(k, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  return (
    <div className="min-h-screen p-6 flex flex-col items-center gap-6">
      <div className="w-full max-w-md">
        <div className="text-neutral-200 text-sm">Your</div>
        <h1 className="text-2xl font-bold">Calendar</h1>
      </div>

      {grouped.length === 0 && (
        <div className="w-full max-w-md text-neutral-400 text-sm">
          No events yet. Capture a board with “Test Friday” or “Homework due” to auto-add here.
        </div>
      )}

      {grouped.map(([day, list]) => (
        <Section key={day} title={new Date(day).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}>
          <div className="space-y-3">
            {list.map((e) => (
              <div key={e.id} className="rounded-xl bg-black/30 border border-white/10 p-3">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold flex-1">{e.title}</div>
                  <span className="px-2 py-1 rounded-full text-[11px] bg-white/5 border border-white/10">
                    {e.source}
                  </span>
                </div>
                <div className="text-xs text-neutral-400 mt-1">{fmt(e.startISO)}</div>
                {e.location && <div className="text-xs text-neutral-400 mt-1">📍 {e.location}</div>}
                {e.notes && <div className="text-xs text-neutral-400 mt-1 whitespace-pre-wrap">{e.notes}</div>}

                <div className="mt-3 flex items-center gap-2">
                  <label className="text-xs text-neutral-300">Notify:</label>
                  <select
                    className="text-xs bg-white/5 border border-white/10 rounded px-2 py-1"
                    value={e.notifyDaysBefore}
                    onChange={(ev) => update(e.id, { notifyDaysBefore: Number(ev.target.value) as 0 | 1 | 2 })}
                  >
                    <option value={0}>Off</option>
                    <option value={1}>1 day before</option>
                    <option value={2}>2 days before</option>
                  </select>

                  <a
                    href={`/api/calendar/ics?title=${encodeURIComponent(e.title)}&startISO=${encodeURIComponent(e.startISO)}&endISO=${encodeURIComponent(e.endISO || "")}&notes=${encodeURIComponent(e.notes || "")}`}
                    className="ml-auto text-xs underline hover:no-underline"
                  >
                    Add .ics
                  </a>
                  <button
                    onClick={() => remove(e.id)}
                    className="text-xs text-red-400 hover:text-red-300"
                    title="Delete"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      ))}

      <div className="w-full max-w-md">
        <a href="/" className="w-full block text-center rounded-xl py-3 mt-2 bg-white/5 text-white hover:bg-white/10 transition">
          Capture Another
        </a>
      </div>
    </div>
  );
}
