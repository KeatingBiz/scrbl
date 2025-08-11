"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardUnderstanding } from "@/lib/types";

export default function ProcessPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dataUrl = sessionStorage.getItem("scrbl:lastImage");
    if (!dataUrl) { router.replace("/"); return; }

    (async () => {
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const fd = new FormData();
        fd.append("image", new File([blob], "capture.jpg", { type: blob.type || "image/jpeg" }));
        const r = await fetch("/api/classify", { method: "POST", body: fd });
        if (!r.ok) throw new Error(await r.text());
        const json = (await r.json()) as BoardUnderstanding;
        sessionStorage.setItem("scrbl:lastResult", JSON.stringify(json));
        router.replace("/result");
      } catch (e: any) {
        setError(e?.message || "Failed");
      }
    })();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl p-6 bg-surface/60 border border-white/10 text-center">
        <div className="animate-pulse text-neutral-300">Analyzing board…</div>
        {error && <div className="text-red-400 mt-4 text-sm">{error}</div>}
      </div>
    </div>
  );
}

