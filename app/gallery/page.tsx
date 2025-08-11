// app/gallery/page.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Folder = { id: string; title: string; itemUrls: string[] };

// local store key for titles (visual only for now)
const KEY = "scrbl:folders:v1";

function load(): Folder[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Folder[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch { return []; }
}
function save(folders: Folder[]) {
  localStorage.setItem(KEY, JSON.stringify(folders));
}

export default function GalleryPage() {
  // seed with one folder; we’ll drop the last captured image in “Recents” as a preview
  const [folders, setFolders] = useState<Folder[]>([]);

  useEffect(() => {
    const existing = load();
    if (existing.length) { setFolders(existing); return; }

    const lastImg = sessionStorage.getItem("scrbl:lastImage");
    const seed: Folder[] = [{
      id: crypto?.randomUUID?.() || Math.random().toString(36).slice(2),
      title: "Recents",
      itemUrls: lastImg ? [lastImg] : []
    }];
    setFolders(seed);
    save(seed);
  }, []);

  function rename(id: string, title: string) {
    setFolders(prev => {
      const next = prev.map(f => f.id === id ? { ...f, title } : f);
      save(next);
      return next;
    });
  }

  const flatCount = useMemo(() => folders.reduce((n, f) => n + f.itemUrls.length, 0), [folders]);

  return (
    <div className="min-h-screen p-6 flex flex-col items-center gap-6">
      <div className="w-full max-w-md">
        <div className="text-neutral-200 text-sm">Your</div>
        <h1 className="text-2xl font-bold">Gallery</h1>
        <div className="text-xs text-neutral-400 mt-1">{flatCount} item{flatCount === 1 ? "" : "s"}</div>
      </div>

      {folders.map(folder => (
        <section key={folder.id} className="w-full max-w-md">
          <div className="flex items-center gap-2 mb-2">
            <input
              value={folder.title}
              onChange={e => rename(folder.id, e.target.value)}
              className="bg-transparent border border-white/10 rounded px-2 py-1 text-sm w-full"
            />
          </div>

          {folder.itemUrls.length === 0 ? (
            <div className="text-xs text-neutral-500 border border-dashed border-white/10 rounded-xl p-6 text-center">
              No items yet. Your snaps will appear here soon.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {folder.itemUrls.map((url, i) => (
                <Link key={i} href="/result" className="block group">
                  <div className="aspect-square overflow-hidden rounded-lg border border-white/10 bg-black/30">
                    <img src={url} alt="" className="w-full h-full object-cover group-hover:scale-[1.02] transition" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      ))}

      <div className="w-full max-w-md">
        <Link href="/" className="w-full block text-center rounded-xl py-3 mt-2 bg-white/5 text-white hover:bg-white/10 transition">
          New Scrbl
        </Link>
      </div>
    </div>
  );
}
