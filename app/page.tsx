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
      // preview for result page
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((res, rej) => {
        reader.onload = () => res(String(reader.result));
        reader.onerror = () => rej(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      sessionStorage.setItem("scrbl:lastImage", dataUrl);

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
        {/* Hero logo */}
        <Logo size="lg" href={null} />

        {/* Bold tagline with brand arrow */}
        <div className="max-w-sm">
          <div className="flex items-center justify-center gap-2 text-white font-semibold text-base sm:text-lg tracking-tight">
            <span>Snap a photo of the whiteboard</span>
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
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
            <span>Receive step-by-step analysis</span>
          </div>
          <p className="mt-2 text-sm text-neutral-300">
            Make sure the writing is clear and in frame.
          </p>
        </div>

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


