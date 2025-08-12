// app/gallery/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { getFolders, addFolder, getItemsForFolder, getItems, type Folder, type SavedItem } from "@/lib/storage";

function chipClasses(active = false) {
  return [
    "inline-flex w-full h-9 items-center justify-center",
    "px-3 rounded-full text-sm border transition",
    "text-white",
    active ? "border-scrbl bg-white/5" : "border-scrbl/50 hover:bg-white/5",
    "truncate"
  ].join(" ");
}

export default function ClassesPage() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [active, setActive] = useState<string>("recents");

  useEffect(() => { setFolders(getFolders()); }, []);

  function addClassFolder() {
    const name = (prompt("Class name (e.g., Finance 331)") || "").trim();
    if (!name) return;
    if (folders.some(f => f.name.toLowerCase() === name.toLowerCase())) {
      alert("You already have a folder with that name.");
      return;
    }
    const f = addFolder(name);
    const next = [...folders, f];
    setFolders(next); setActive(f.id);
  }

  const isRecents = active === "recents";
  const items: SavedItem[] = useMemo(() => {
    return isRecents ? getItems() : getItemsForFolder(active);
  }, [active, isRecents]);

  const title = isRecents ? "Recents" : (folders.find(x => x.id === active)?.name || "Class");
  const itemCount = items.length;

  function openItem(it: SavedItem) {
    sessionStorage.setItem("scrbl:lastImage", it.thumbDataUrl);              // small but fine for preview
    sessionStorage.setItem("scrbl:lastResult", JSON.stringify(it.result));
    location.assign("/result");
  }

  return (
    <div className="min-h-screen p-6 flex flex-col items-center gap-6">
      <div className="w/full max-w-md">
        <div className="text-neutral-200 text-sm">Your</div>
        <h1 className="text-2xl font-bold">Classes</h1>
      </div>

      <div className="w-full max-w-md">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
          <button className={chipClasses(isRecents)} onClick={() => setActive("recents")} title="Recents">Recents</button>
          {folders.map(f => (
            <button key={f.id} className={chipClasses(active === f.id)} onClick={() => setActive(f.id)} title={f.name}>
              {f.name}
            </button>
          ))}
          <button className={chipClasses(false)} onClick={addClassFolder} title="Add Class">+ Add Class</button>
        </div>
      </div>

      <section className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-scrbl/30 text-white">
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
        </div>

        {itemCount === 0 ? (
          <div className="text-xs text-neutral-500 border border-dashed border-white/10 rounded-xl p-6 text-center">
            {isRecents ? "No snaps yet. Your next capture will appear here." : "Nothing in this class yet. Add from the result popup."}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {items.map(it => (
              <button key={it.id} onClick={() => openItem(it)} className="group block text-left">
                <div className="aspect-square overflow-hidden rounded-lg border border-white/10 bg-black/30">
                  <img src={it.thumbDataUrl} alt="" className="w-full h-full object-cover group-hover:scale-[1.02] transition" />
                </div>
                <div className="mt-1 text-[10px] text-neutral-400 truncate">
                  {new Date(it.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

