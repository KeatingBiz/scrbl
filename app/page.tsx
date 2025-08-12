// app/page.tsx
"use client";
import { useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import type { BoardUnderstanding, Step } from "@/lib/types";
import { getFolders, addItem, assignItemToFolder, type Folder } from "@/lib/storage";
import { fileToDataURL, makeThumbnail } from "@/lib/image";

function StepCardMini({ s }: { s: Step }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-scrbl/20 text-white grid place-items-center text-xs font-bold">
          {s.n}
        </div>
        <div className="text-sm font-semibold">{s.action || s.text}</div>
      </div>

      {(s.before || s.after) && (
        <div className="mt-2 flex items-center gap-2 text-sm">
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
        <div className="mt-2 text-sm text-neutral-200 whitespace-pre-wrap break-words">
          {s.text}
        </div>
      )}
      {s.why && (
        <div className="mt-1 text-xs text-neutral-400 whitespace-pre-wrap break-words">
          Why: {s.why}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);

  // Loading overlay while analyzing
  const [analyzing, setAnalyzing] = useState(false);

  // Result modal
  const [resultOpen, setResultOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<BoardUnderstanding | null>(null);
  const [savedItemId, setSavedItemId] = useState<string | null>(null);

  // class select
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");

  const headline = useMemo(() => {
    if (!previewResult) return "";
    switch (previewResult.type) {
      case "PROBLEM_UNSOLVED":
        return "Solved (Step-by-step)";
      case "PROBLEM_SOLVED":
        return previewResult.answer_status === "mismatch"
          ? "Checked (Found an issue)"
          : "Explained (Step-by-step)";
      case "ANNOUNCEMENT":
        return "Event Detected";
      default:
        return "Analyzed";
    }
  }, [previewResult]);

  async function handleFile(file: File) {
    setErr(null);
    setBusy(true);
    setAnalyzing(true);
    try {
      // 1) read full for /result page
      const fullDataUrl = await fileToDataURL(file);
      // 2) make small thumbnail for storage
      let thumb = await makeThumbnail(fullDataUrl, 640, 0.8);

      // 3) classify (show analyzing overlay)
      const fd = new FormData();
      fd.append("image", file);
      const r = await fetch("/api/classify", { method: "POST", body: fd });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(text || `HTTP ${r.status}`);
      }
      const json = (await r.json()) as BoardUnderstanding;

      // 4) save to Recents (thumb only) — with quota fallback
      try {
        const saved = addItem({ thumbDataUrl: thumb, result: json, folderId: null });
        setSavedItemId(saved.id);
      } catch {
        try {
          thumb = await makeThumbnail(fullDataUrl, 480, 0.6);
          const saved = addItem({ thumbDataUrl: thumb, result: json, folderId: null });
          setSavedItemId(saved.id);
        } catch (e2: any) {
          console.error("Saving failed:", e2);
          setSavedItemId(null);
        }
      }

      // 5) open modal with result + image, prime /result page
      setPreviewUrl(fullDataUrl);
      setPreviewResult(json);
      setFolders(getFolders());
      setSelectedFolderId("");
      setResultOpen(true);
      sessionStorage.setItem("scrbl:lastImage", fullDataUrl);
      sessionStorage.setItem("scrbl:lastResult", JSON.stringify(json));
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally {
      setAnalyzing(false);
      setBusy(false);
      cameraRef.current && (cameraRef.current.value = "");
      libraryRef.current && (libraryRef.current.value = "");
      setChooserOpen(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="min-h-[calc(100vh-12rem)] flex flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center text-center gap-7">
        {/* Hero logo */}
        <Logo size="lg" href={null} />

        {/* Headline */}
        <div className="max-w-sm">
          <div className="flex items-center justify-center gap-2 text-white font-extrabold text-xl sm:text-2xl leading-tight tracking-tight">
            <span>Snap the lecture whiteboard</span>
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              className="shrink-0 text-scrbl"
              aria-hidden="true"
            >
              <path
                d="M5 12h12M13 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Solve, Explain, or Schedule</span>
          </div>
        </div>

        {/* Big camera button */}
        <div className="mt-1 w-full max-w-sm flex flex-col items-center">
          <button
            disabled={busy}
            onClick={() => setChooserOpen(true)}
            className={[
              "relative grid place-items-center",
              "w-40 h-40 rounded-full border-2",
              "border-scrbl text-white hover:bg-white/5",
              "transition",
              !busy ? "camera-pulse" : "",
              busy ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
            ].join(" ")}
            aria-label="Capture or choose a photo"
          >
            <svg
              viewBox="0 0 24 24"
              width="64"
              height="64"
              className="text-scrbl"
              aria-hidden="true"
            >
              <path
                d="M4 8h3l1.2-2.4A2 2 0 0 1 10 4h4a2 2 0 0 1 1.8 1.1L17 6h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle
                cx="12"
                cy="13"
                r="4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
              />
            </svg>
          </button>

          {err && <div className="mt-3 text-xs text-red-400">{err}</div>}
        </div>
      </div>

      {/* Hidden inputs */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPick}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPick}
      />

      {/* Source chooser */}
      {chooserOpen && !busy && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setChooserOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/85 p-4">
            <div className="flex flex-col gap-2">
              <button
                className="btn-scrbl rounded-xl py-3 font-semibold"
                onClick={() => {
                  setChooserOpen(false);
                  setTimeout(() => cameraRef.current?.click(), 0);
                }}
              >
                Take Photo
              </button>
              <button
                className="btn-scrbl rounded-xl py-3 font-semibold"
                onClick={() => {
                  setChooserOpen(false);
                  setTimeout(() => libraryRef.current?.click(), 0);
                }}
              >
                Choose from Library
              </button>
              <button
                className="rounded-xl py-3 font-semibold bg-white/5 hover:bg-white/10 transition"
                onClick={() => setChooserOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Analyzing overlay */}
      {analyzing && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-6">
          <div className="w-full max-w-xs rounded-2xl border border-white/10 bg-black/90 p-4 text-center">
            <div className="mx-auto mb-3 h-8 w-8 rounded-full border-2 border-scrbl border-t-transparent animate-spin" />
            <div className="text-sm font-semibold">Analyzing board…</div>
            <div className="mt-1 text-xs text-neutral-400">
              Finding steps, answers, and dates
            </div>
          </div>
        </div>
      )}

      {/* RESULT MODAL */}
      {resultOpen && previewResult && previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setResultOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/90 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{headline}</h2>
              <button
                onClick={() => setResultOpen(false)}
                className="rounded-lg px-2 py-1 bg-white/5 hover:bg-white/10 text-sm"
              >
                ×
              </button>
            </div>

            {/* More readable layout: 1 col on mobile, 2 cols on md+ with wider step area */}
            <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr,1.2fr] gap-3">
              <div className="rounded-xl overflow-hidden border border-white/10 bg-black/30">
                <img
                  src={previewUrl}
                  alt="capture"
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {previewResult.type !== "ANNOUNCEMENT" ? (
                  <>
                    {previewResult.final && (
                      <div className="rounded-lg border border-scrbl/30 bg-scrbl/10 p-3">
                        <div className="text-sm font-semibold">Final:</div>
                        <div className="text-base mt-1 break-words">
                          ✅ {previewResult.final}
                        </div>
                      </div>
                    )}

                    {(previewResult.steps || [])
                      .slice(0, 5)
                      .map((s) => (
                        <StepCardMini key={s.n} s={s} />
                      ))}
                  </>
                ) : (
                  <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm whitespace-pre-wrap break-words">
                    {previewResult.raw_text || "Announcement"}
                  </div>
                )}
              </div>
            </div>

            {/* Add to class controls */}
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <select
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
                className="flex-1 rounded-xl bg-black/30 border border-scrbl/50 text-white px-3 py-2 outline-none"
              >
                <option value="">Select class…</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>

              <button
                className="btn-scrbl rounded-xl px-4 py-2 font-semibold"
                onClick={() => {
                  if (!savedItemId) return;
                  if (!selectedFolderId) {
                    alert("Pick a class first.");
                    return;
                  }
                  assignItemToFolder(savedItemId, selectedFolderId);
                  setResultOpen(false);
                }}
              >
                Add to class
              </button>

              <button
                className="rounded-xl px-4 py-2 font-semibold bg-white/5 hover:bg-white/10 transition"
                onClick={() => setResultOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


