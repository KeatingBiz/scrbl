// app/page.tsx
"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";

export default function Home() {
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
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
      if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
      const json = await r.json();
      sessionStorage.setItem("scrbl:lastResult", JSON.stringify(json));

      router.push("/result");
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
      setBusy(false);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="min-h-[calc(100vh-12rem)] flex flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center text-center gap-4">
        <Logo size="lg" href={null} />
        <p className="text-sm text-neutral-300 max-w-xs">
          Snap a photo of the board to get a simple, step-by-step explanation. Make sure the writing is clear.
        </p>

        <div className="mt-2 w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-left text-sm font-medium mb-2">Take a picture</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex-1 rounded-xl py-3 bg-scrbl/20 text-scrbl font-semibold hover:bg-scrbl/30 transition disabled:opacity-60"
            >
              {busy ? "Analyzing…" : "Open Camera / Upload"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*;capture=camera"
              className="hidden"
              onChange={onPick}
            />
          </div>
          {err && <div className="mt-3 text-xs text-red-400">{err}</div>}
        </div>
      </div>
    </div>
  );
}



