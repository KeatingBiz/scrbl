// app/gallery/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Folder = { id: string; name: string };

const FOLDERS_KEY = "scrbl:folders:v2";
const RECENTS_ID = "recents";

function loadFolders(): Folder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Folder[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveFolders(folders: Folder[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

function chipClasses(active = false) {
  return [
    "px-3 py-1.5 rounded-full text-sm whitespace-nowrap border transition",
    active
      ? "border-scrbl text-scrbl bg-scrbl/10"
      : "border-scrbl/40 text-scrbl hover:bg-scrbl/10"
  ].join(" ");
}

export default function GalleryPage() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [active, setActive] = useState<string>(RECENTS_ID);

  // seed folders (keep Recents implicit so it’s always first)
  useEffect(() => {
    const existing = loadFolders();
    setFolders(existing);
  }, []);

  function addClassFolder() {
    const name = (prompt("Class name (e.g., Finance 331)") || "").trim();
    if (!name) return;
    // avoid dupes by name (case-insensitive)
    const exists = folders.some((f) => f.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      alert("You already have a folder with that name.");
      return;
    }
    const id = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    const next = [...folders, { id, name }];
    setFolders(next);
    saveFolders(next);
    setActive(id);
  }

  // For now, Recents just shows the last captured image (visual only).
  const recentThumb = useMemo(() => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem("scrbl:lastImage");
  }, []);

  const title = useMemo(() => {
    if (active === RECENTS_ID) return "Recents";
    const f = folders.find((x) => x.id === active);
    return f?.name || "Folder";
  }, [active, folders]);

  return (
    <div className="min-h-screen p-6 flex flex-col items-center gap-6">
      {/* Page header */}
      <div className="w-full max-w-md">
        <div className="text-neutral-200 text-sm">Your</div>
        <h1 className="text-2xl font-bold">Gallery</h1>
      </div>

      {/* Folder chips */}
      <div className="w-full max-w-md overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2">
          <button
            className={chipClasses(active === RECENTS_ID)}
            onClick={() => setActive(RECENTS_ID)}
          >
            Recents
          </button>

          {folders.map((f) => (
            <button
              key={f.id}
              className={chipClasses(active === f.id)}
              onClick={() => setActive(f.id)}
              title={f.name}
            >
              {f.name}
            </button>
          ))}

          <button className={chipClasses(false)} onClick={addClassFolder}>
            + Add Class
          </button>
        </div>
      </div>

      {/* Active folder content */}
      <section className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-scrbl/30 text-scrbl">
            {active === RECENTS_ID ? (recentThumb ? 1 : 0) : 0} item
            {active === RECENTS_ID ? (recentThumb && 1 === 1 ? "" : "s") : ""}
          </span>
        </div>

        {/* Recents grid (visual only for now) */}
        {active === RECENTS_ID ? (
          recentThumb ? (
            <div className="grid grid-cols-3 gap-2">
              <Link href="/result" className="block group">
                <div className="aspect-square overflow-hidden rounded-lg border border-white/10 bg-black/30">
                  <img
                    src={recentThumb}
                    alt="recent scrbl"
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition"
                  />
                </div>
                <div className="mt-1 text-xs text-neutral-400">Latest snap</div>
              </Link>
              {/* As we add more captures later, we’ll map them here */}
            </div>
          ) : (
            <div className="text-xs text-neutral-500 border border-dashed border-white/10 rounded-xl p-6 text-center">
              No recent snaps yet. Your next capture will appear here.
            </div>
          )
        ) : (
          // Class folders (empty visual shell for now)
          <div className="text-xs text-neutral-500 border border-dashed border-white/10 rounded-xl p-6 text-center">
            Nothing in this class yet. After your next scrbl, you’ll be able to add it here.
          </div>
        )}
      </section>

      {/* Back to capture */}
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="w-full block text-center rounded-xl py-3 mt-2 bg-white/5 text-white hover:bg-white/10 transition"
        >
          New Scrbl
        </Link>
      </div>
    </div>
  );
}

