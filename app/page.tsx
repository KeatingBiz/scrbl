"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";

export default function Home() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const router = useRouter();

  function goProcess() {
    const f = fileRef.current?.files?.[0];
    if (!f) return alert("Take or choose a photo first.");
    const reader = new FileReader();
    reader.onload = () => {
      // Stash image in sessionStorage for the /process page
      sessionStorage.setItem("scrbl:lastImage", reader.result as string);
      router.push("/process");
    };
    reader.readAsDataURL(f);
  }

  return (
    <div className="min-h-screen flex flex-col items-center p-6 gap-6">
      <Logo />
      <div className="w-full max-w-md rounded-2xl p-4 bg-surface/60 border border-white/10">
        <label className="block text-sm text-neutral-300 mb-2">Take or choose a photo</label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="w-full text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const url = URL.createObjectURL(f);
            setPreview(url);
          }}
        />
        <button
          onClick={goProcess}
          className="w-full rounded-xl py-3 mt-4 bg-scrbl/20 text-scrbl font-semibold hover:bg-scrbl/30 transition"
        >
          Continue
        </button>
      </div>

      {preview && (
        <img src={preview} alt="preview" className="max-w-md w-full rounded-xl border border-white/10" />
      )}
    </div>
  );
}

