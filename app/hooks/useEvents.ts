// app/hooks/useEvents.ts
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppEvent, normalizeEvent, isSameEvent } from "@/lib/calendar";

const KEY = "scrbl:events";

function load(): AppEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as AppEvent[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function save(events: AppEvent[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(events));
}

export function useEvents() {
  const [events, setEvents] = useState<AppEvent[]>([]);

  useEffect(() => { setEvents(load()); }, []);

  const upsertMany = useCallback((incoming: Partial<AppEvent>[]) => {
    setEvents(prev => {
      const next = [...prev];
      for (const p of incoming) {
        const e = normalizeEvent(p);
        const i = next.findIndex(x => isSameEvent(x, e));
        if (i >= 0) {
          // merge, keep existing id/createdAt/source unless incoming overrides
          next[i] = { ...next[i], ...e, id: next[i].id, createdAt: next[i].createdAt, source: next[i].source };
        } else {
          next.push(e);
        }
      }
      save(next);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setEvents(prev => {
      const next = prev.filter(e => e.id !== id);
      save(next);
      return next;
    });
  }, []);

  const update = useCallback((id: string, patch: Partial<AppEvent>) => {
    setEvents(prev => {
      const next = prev.map(e => (e.id === id ? { ...e, ...patch } : e));
      save(next);
      return next;
    });
  }, []);

  const sorted = useMemo(
    () => [...events].sort((a, b) => +new Date(a.startISO) - +new Date(b.startISO)),
    [events]
  );

  return { events: sorted, upsertMany, remove, update };
}
