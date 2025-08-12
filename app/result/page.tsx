// app/result/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardUnderstanding, Step } from "@/lib/types";
import type { AppEvent } from "@/lib/calendar";
import { useEvents } from "@/app/hooks/useEvents";

/* ---------------- UI bits ---------------- */

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-1 rounded-full text-[11px] leading-none bg-white/5 border border-white/10">
      {children}
    </span>
  );
}

function StepCard({
  s,
  onOpen,
}: {
  s: Step;
  onOpen: (s: Step) => void;
}) {
  return (
    <button
      onClick={() => onOpen(s)}
      className="w-full text-left rounded-xl border border-white/10 bg-black/30 p-3 notebook hover:bg-white/5 transition"
    >
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-scrbl/20 text-white grid place-items-center text-xs font-bold">
          {s.n}
        </div>
        <div className="text-base font-semibold">{s.action || s.text}</div>
        <div className="ml-auto text-lg">{s.emoji ?? "✏️"}</div>
      </div>

      {(s.before || s.after) && (
        <div className="mt-2 flex items-center gap-2 text-base">
          {s.before && (
            <pre className="px-2 py-1 rounded bg-white/5 border border-white/10 whitespace-pre-wrap break-words">
              {s.before}
            </pre>
          )}
          <span className="shrink-0">→</span>
          {s.after && (
            <pre className="px-2 py-1 rounded bg-white/5 border border-white/10 whitespace-pre-wrap break-words">
              {s.after}
            </pre>
          )}
        </div>
      )}

      {s.text && (
        <div className="mt-2 text-base text-neutral-200 whitespace-pre-wrap break-words">
          {s.text}
        </div>
      )}
      {s.why && (
        <div className="mt-1 text-sm text-neutral-400 whitespace-pre-wrap break-words">
          Why: {s.why}
        </div>
      )}
      {s.tip && (
        <div className="mt-1 text-sm text-neutral-400 whitespace-pre-wrap break-words">
          Tip: {s.tip}
        </div>
      )}
    </button>
  );
}

function Notebook({
  steps,
  final,
  onOpenStep,
}: {
  steps?: Step[];
  final?: string | null;
  onOpenStep: (s: Step) => void;
}) {
  if (!steps?.length && !final) return null;
  return (
    <div className="mt-3 space-y-3">
      {steps?.map((s) => <StepCard key={s.n} s={s} onOpen={onOpenStep} />)}
      {final && (
        <div className="rounded-xl border border-scrbl/30 bg-scrbl/10 p-3">
          <div className="text-sm font-semibold">Final:</div>
          <div className="mt-1 text-lg break-words">✅ {final}</div>
        </div>
      )}
    </div>
  );
}

/** Fullscreen step viewer */
function StepViewer({
  step,
  onClose,
}: {
  step: Step | null;
  onClose: () => void;
}) {
  if (!step) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-black/95 p-4">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 border border-scrbl/50 text-white hover:bg-white/5"
            aria-label="Back"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              className="text-scrbl"
              aria-hidden="true"
            >
              <path
                d="M15 18l-6-6 6-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back
          </button>
          <div className="ml-2 text-lg font-semibold">Step {step.n}</div>
        </div>

        <div className="mt-4 space-y-3">
          {(step.before || step.after) && (
            <div className="flex items-start gap-3 text-lg flex-wrap">
              {step.before && (
                <pre className="px-3 py-2 rounded bg-white/5 border border-white/10 whitespace-pre-wrap break-words">
                  {step.before}
                </pre>
              )}
              {step.before && step.after && <span className="mt-2 shrink-0">→</span>}
              {step.after && (
                <pre className="px-3 py-2 rounded bg-white/5 border border-white/10 whitespace-pre-wrap break-words">
                  {step.after}
                </pre>
              )}
            </div>
          )}

          {step.action && (
            <div className="text-base text-neutral-300 whitespace-pre-wrap break-words">
              <span className="font-semibold">Do:</span> {step.action}
            </div>
          )}

          {step.text && (
            <div className="text-lg text-white whitespace-pre-wrap break-words">
              {step.text}
            </div>
          )}

          {step.why && (
            <div className="text-sm text-neutral-400 whitespace-pre-wrap break-words">
              <span className="font-semibold text-white/80">Why:</span> {step.why}
            </div>
          )}
          {step.tip && (
            <div className="text-sm text-neutral-400 whitespace-pre-wrap break-words">
              <span className="font-semibold text-white/80">Tip:</span> {step.tip}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------- Page --------------- */

type EventItem = NonNullable<BoardUnderstanding["events"]>[number];

export default function ResultPage() {
  const router = useRouter();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [result, setResult] = useState<BoardUnderstanding | null>(null);
  const [addedCount, setAddedCount] = useState<number>(0);
  const { upsertMany } = useEvents();

  // step viewer
  const [openStep, setOpenStep] = useState<Step | null>(null);

  useEffect(() => {
    const img = sessionStorage.getItem("scrbl:lastImage");
    const res = sessionStorage.getItem("scrbl:lastResult");
    if (!img || !res) {
      router.replace("/");
      return;
    }
    setDataUrl(img);
    setResult(JSON.parse(res) as BoardUnderstanding);
  }, [router]);

  // Save announcements locally (unchanged)
  useEffect(() => {
    if (!result || result.type !== "ANNOUNCEMENT") return;
    const evs = (result.events ?? []).filter(Boolean);
    if (!evs.length) return;

    const toAdd: Partial<AppEvent>[] = evs.map((e) => ({
      title: e.title,
      startISO: e.date_start_iso,
      endISO: e.date_end_iso ?? null,
      location: e.location ?? null,
      notes: result.raw_text || undefined,
      source: "board",
      notifyDaysBefore: 2,
    }));
    upsertMany(toAdd);
    setAddedCount(evs.length);
  }, [result, upsertMany]);

  const title = useMemo(() => {
    if (!result) return "";
    switch (result.type) {
      case "PROBLEM_UNSOLVED":
        return "Solved (Step-by-step)";
      case "PROBLEM_SOLVED":
        return result.answer_status === "mismatch"
          ? "Checked (Found an issue)"
          : "Explained (Step-by-step)";
      case "ANNOUNCEMENT":
        return "Event Detected";
      default:
        return "Couldn’t Classify";
    }
  }, [result]);

  async function addToCalendar(ev: EventItem) {
    const r = await fetch(`/api/calendar/ics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: ev.title,
        startISO: ev.date_start_iso,
        endISO: ev.date_end_iso ?? null,
        notes: result?.raw_text || "",
      }),
    });
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "event.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen flex flex-col items-center p-6 gap-6">
      <div className="w-full max-w-md">
        <div className="text-neutral-200 text-sm">Result</div>
        <h1 className="text-2xl font-bold">{title}</h1>

        <div className="mt-2 flex gap-2 flex-wrap">
          {result?.subject_guess ? <Chip>{result.subject_guess}</Chip> : null}
          {result?.type ? <Chip>{result.type.replace("_", " ")}</Chip> : null}
          {typeof result?.confidence === "number" && result.confidence < 0.7 && (
            <Chip>Confidence: {(result.confidence * 100).toFixed(0)}%</Chip>
          )}
        </div>

        {result?.type === "ANNOUNCEMENT" && addedCount > 0 && (
          <div className="mt-3 text-xs text-white">
            ✅ Saved {addedCount} event{addedCount > 1 ? "s" : ""}.{" "}
            <a href="/gallery" className="underline hover:no-underline">
              View in Classes
            </a>
          </div>
        )}
      </div>

      {dataUrl && (
        <img
          src={dataUrl}
          alt="capture"
          className="w-full max-w-md rounded-xl border border-white/10"
        />
      )}

      {result?.type === "PROBLEM_UNSOLVED" && (
        <div className="w-full max-w-md">
          <div className="text-sm text-neutral-300 whitespace-pre-wrap break-words">
            {result.question || "Problem"}
          </div>
          <Notebook
            steps={result.steps}
            final={result.final}
            onOpenStep={(s) => setOpenStep(s)}
          />
        </div>
      )}

      {result?.type === "PROBLEM_SOLVED" && (
        <div className="w-full max-w-md">
          <div className="text-sm text-neutral-300 whitespace-pre-wrap break-words">
            {result.question || "Problem"}
          </div>
          {result.given_answer && (
            <div className="mt-2 text-xs">
              <span className="px-2 py-1 rounded bg-white/5 border border-white/10">
                Board’s answer: {result.given_answer} ({result.answer_status})
              </span>
            </div>
          )}
          <Notebook
            steps={result.steps}
            final={result.final ?? result.given_answer ?? null}
            onOpenStep={(s) => setOpenStep(s)}
          />
        </div>
      )}

      {result?.type === "ANNOUNCEMENT" && (
        <div className="w-full max-w-md space-y-3">
          <div className="rounded-xl bg-black/30 border border-white/10 p-3">
            <div className="text-sm text-neutral-300 whitespace-pre-wrap break-words">
              {result.raw_text || "Announcement"}
            </div>
          </div>
          {(result?.events ?? []).map((ev, i) => (
            <div key={i} className="rounded-xl bg-black/30 border border-white/10 p-3">
              <div className="font-semibold">{ev.title}</div>
              <div className="text-xs text-neutral-400 mt-1">{ev.date_start_iso}</div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => addToCalendar(ev)}
                  className="btn-scrbl flex-1 rounded-xl py-2 font-semibold transition"
                >
                  Add to native (.ics)
                </button>
                <a
                  href="/gallery"
                  className="flex-1 text-center rounded-xl py-2 bg-white/5 text-white hover:bg-white/10 transition"
                >
                  View in Classes
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {result?.type === "UNKNOWN" && (
        <div className="w-full max-w-md text-neutral-400 text-sm">
          Couldn’t confidently classify that photo. Try a sharper shot or different angle.
        </div>
      )}

      <div className="w-full max-w-md">
        <button
          onClick={() => location.assign("/")}
          className="w-full rounded-xl py-3 mt-2 bg-white/5 text-white hover:bg-white/10 transition"
        >
          New Scrbl
        </button>
      </div>

      {/* Fullscreen step viewer */}
      <StepViewer step={openStep} onClose={() => setOpenStep(null)} />
    </div>
  );
}





