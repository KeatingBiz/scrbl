// app/page.tsx
"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";

export default function Home() {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);

  async function handleFile(file: File) {
    setErr(null);
    setBusy(true);
    try {
      // Show preview on /result
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((res, rej) => {
        reader.onload = () => res(String(reader.result));
        reader.onerror = () => rej(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      sessionStorage.setItem("scrbl:lastImage", dataUrl);

      // Send to classifier
      const fd = new FormData();
      fd.append("image", file);
      const r = await fetch("/api/classify", { method: "POST", body: fd });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(text || `HTTP ${r.status}`);
      }
      const json = await r.json();
      sessionStorage.setItem("scrbl:lastResult", JSON.stringify(json));

      router.push("/result");
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
      setBusy(false);
    } finally {
      // reset inputs
      if (cameraRef.current) cameraRef.current.value = "";
      if (libraryRef.current) libraryRef.current.value = "";
      setChooserOpen(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="min-h-[calc(100vh-12rem)] flex flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center text-center gap-6">
        {/* Hero logo + note */}
        <Logo size="lg" href={null} />
        <p className="text-sm text-neutral-300 max-w-xs">
          Snap a photo of the board to get a simple, step-by-step explanation. Make sure the writing is clear.
        </p>

        {/* Big camera button */}
        <div className="mt-2 w-full max-w-sm flex flex-col items-center">
          <button
            disabled={busy}
            onClick={() => setChooserOpen(true)}
            className={[
              "relative grid place-items-center",
              "w-40 h-40 rounded-full border-2",
              "border-scrbl text-white hover:bg-white/5",
              "transition",
              busy ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
            ].join(" ")}
            aria-label="Capture or choose a photo"
          >
            {/* Camera icon */}
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
            <div className="absolute bottom-3 text-xs text-neutral-300">
              {busy ? "Analyzing…" : "Tap to capture"}
            </div>
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

      {/* Action sheet (gallery vs camera) */}
      {chooserOpen && !busy && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setChooserOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/85 p-4">
            <div className="text-sm font-semibold mb-3">Choose source</div>
            <div className="flex flex-col gap-2">
              <button
                className="btn-scrbl rounded-xl py-3 font-semibold"
                onClick={() => cameraRef.current?.click()}
              >
                Take Photo
              </button>
              <button
                className="btn-scrbl rounded-xl py-3 font-semibold"
                onClick={() => libraryRef.current?.click()}
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
    </div>
  );
}

