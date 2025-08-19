// components/views/ScrblView.tsx
"use client";
import { useRef, useState, useMemo } from "react";
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

export default function ScrblView() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const [resultOpen, setResultOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<BoardUnderstanding | null>(null);
  const [savedItemId, setSavedItemId] = useState<string | null>(null);

  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");

  const headline = useMemo(() => {
    if (!previewResult) return "";
    switch (previewResult.type) {
      case "PROBLEM_UNSOLVED": return "Solved (Step-by-step)";
      case "PROBLEM_SOLVED": return previewResult.answer_status === "mismatch" ? "Checked (Found an issue)" : "Explained (Step-by-step)";
      case "ANNOUNCEMENT": return "Event Detected";
      default: return "Analyzed";
    }
  }, [previewResult]);

  async function handleFile(file: File) {
    setErr(null);
    setBusy(true);
    setAnalyzing(true);
    try {
      const fullDataUrl = await fileToDataURL(file);
      let thumb = await makeThumbnail(fullDataUrl, 640, 0.8);

      const fd = new FormData();
      fd.append("image", file);
      const r = await fetch("/api/classify", { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.text().catch(() => "")) || `HTTP ${r.status}`);
      const json = (await r.json()) as BoardUnderstanding;

      try {
        const saved = addItem({ thumbDataUrl: thumb, result: json, folderId: null });
        setSavedItemId(saved.id);
      } catch {
        try {
          thumb = await makeThumbnail(fullDataUrl, 480, 0.6);
          const saved = addItem({ thumbDataUrl: thumb, result: json, folderId: null });
          setSavedItemId(saved.id);
        } catch {}
      }

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
    <div className="relative isolate min-h-[calc(100vh-12rem)] flex flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center text-center gap-7">
        {/* Hero text */}
        <div className="max-w-sm">
          <h1 className="text-white font-extrabold text-2xl sm:text-3xl leading-tight tracking-wide">
            Snap <span aria-hidden="true">→</span> Solve <span aria-hidden="true">→</span> Save
          </h1>
        </div>

        {/* Camera button */}
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
            <svg viewBox="0 0 24 24" width="64" height="64" className="text-scrbl" aria-hidden="true">
              <path d="M4 8h3l1.2-2.4A2 2 0 0 1 10 4h4a2 2 0 0 1 1.8 1.1L17 6h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="12" cy="13" r="4" fill="none" stroke="currentColor" strokeWidth="1.75"/>
            </svg>
          </button>
          {err && <div className="mt-3 text-xs text-red-400">{err}</div>}
        </div>
      </div>

      {/* Hidden inputs */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
      <input ref={libraryRef} type="file" accept="image/*" className="hidden" onChange={onPick} />

      {/* Overlays & Modals (unchanged) */}
      {/* ... keep rest of code exactly as before ... */}
    </div>
  );
}
