"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardUnderstanding, Step } from "@/lib/types";

type EventItem = NonNullable<BoardUnderstanding["events"]>[number];

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-1 rounded-full text-[11px] leading-none bg-white/5 border border-white/10">
      {children}
    </span>
  );
}

function StepCard({ s }: { s: Step }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3 notebook">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-scrbl/20 text-scrbl grid place-items-center font-bold">{s.n}</div>
        <div className="text-sm font-semibold">{s.action || s.text}</div>
        <div className="ml-auto text-lg">{s.emoji ?? "✏️"}</div>
      </div>

      {s.before || s.after ? (
        <div className="mt-2 flex items-center gap-2 text-sm overflow-x-auto">
          {s.before && <pre className="px-2 py-1 rounded bg-white/5 border border-white/10">{s.before}</pre>}
          <span className="shrink-0">→</span>
          {s.after && <pre className="px-2 py-1 rounded bg-white/5 border border-white/10">{s.after}</pre>}
        </div>
      ) : null}

      <div className="mt-2 text-sm text-neutral-200">{s.text}</div>
      {s.why && <div className="mt-1 text-xs text-neutral-400">Why: {s.why}</div>}
      {s.tip && <div className="mt-1 text-xs text-neutral-400">Tip: {s.tip}</div>}
    </div>
  );
}

function Notebook({ steps, final }: { steps?: Step[]; final?: string | null }) {
  if (!steps?.length && !final) return null;
  return (
    <div className="mt-3 space-y-3">
      {steps?.map((s) => <StepCard key={s.n} s={s} />)}
      {final && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
          <div className="text-sm font-semibold">Final:</div>
          <div className="mt-1 text-base">✅ {final}</div>
        </div>
      )}
    </div>
  );
}

export default function ResultPage() {
  const router = useRouter();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [result, setResult] = useState<BoardUnderstanding | null>(null);

  useEffect(() => {
    const img = sessionStorage.getItem("scrbl:lastImage");
    const res = sessionStorage.getItem("scrbl:lastResult");
    if (!img || !res) { router.replace("/"); return; }
    setDataUrl(img);
    setResult(JSON.parse(res) as BoardUnderstanding);
  }, [router]);

  const title = useMemo(() => {
    if (!result) return "";
    switch (result.type) {
      case "PROBLEM_UNSOLVED": return "Solved (Step-by-step)";
      case "PROBLEM_SOLVED": return result.answer_status === "mismatch" ? "Checked (Found an issue)" : "Explained (Step-by-step)";
      case "ANNOUNCEMENT": return "Event Detected";
      default: return "Couldn’t Classify";
    }
  }, [result]);

  async function addToCalendar(ev: EventItem) {
    const r = await fetch("/api/calendar/ics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: ev.title,
        startISO: ev.date_start_iso,
        endISO: ev.date_end_iso ?? null,
        notes: result?.raw_text || ""
      })
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
          {/* Hide confidence unless < 70% */}
          {typeof result?.confidence === "number" && result.confidence < 0.7 && (
            <Chip>Confidence: {(result.confidence * 100).toFixed(0)}%</Chip>
          )}
        </div>
      </div>

      {dataUrl && (
        <img src={dataUrl} alt="capture" className="w-full max-w-md rounded-xl border border-white/10" />
      )}

      {result?.type === "PROBLEM_UNSOLVED" && (
        <div className="w-full max-w-md">
          <div className="text-sm text-neutral-300">{result.question || "Problem"}</div>
          <Notebook steps={result.steps} final={result.final} />
        </div>
      )}

      {result?.type === "PROBLEM_SOLVED" && (
        <div className="w-full max-w-md">
          <div className="text-sm text-neutral-300">{result.question || "Problem"}</div>
          {result.given_answer && (
            <div className="mt-2 text-xs">
              <span className="px-2 py-1 rounded bg-white/5 border border-white/10">
                Board’s answer: {result.given_answer} ({result.answer_status})
              </span>
            </div>
          )}
          <Notebook steps={result.steps} final={result.final ?? result.given_answer ?? null} />
        </div>
      )}

      {result?.type === "ANNOUNCEMENT" && (
        <div className="w-full max-w-md space-y-3">
          <div className="rounded-xl bg-black/30 border border-white/10 p-3">
            <div className="text-sm text-neutral-300 whitespace-pre-wrap">{result.raw_text || "Announcement"}</div>
          </div>
          {(result?.events ?? []).map((ev: EventItem, i: number) => (
            <div key={i} className="rounded-xl bg-black/30 border border-white/10 p-3">
              <div className="font-semibold">{ev.title}</div>
              <div className="text-xs text-neutral-400 mt-1">{ev.date_start_iso}</div>
              <button
                onClick={() => addToCalendar(ev)}
                className="mt-3 w-full rounded-xl py-2 bg-scrbl/20 text-scrbl font-semibold hover:bg-scrbl/30 transition"
              >
                Add to Calendar (+ 2-day alert)
              </button>
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
          New Capture
        </button>
      </div>
    </div>
  );
}

