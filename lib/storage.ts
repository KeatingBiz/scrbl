// lib/storage.ts
import type { BoardUnderstanding } from "@/lib/types";

export type Folder = { id: string; name: string };
export type SavedItem = {
  id: string;
  createdAt: string;      // ISO
  imageDataUrl: string;   // data URL
  result: BoardUnderstanding;
  folderId?: string | null;
};

const K_FOLDERS = "scrbl:folders:v2";
const K_ITEMS = "scrbl:items:v1";

function safeParse<T>(raw: string | null, fallback: T): T {
  try { return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function save<T>(key: string, val: T) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(val));
}

export function getFolders(): Folder[] {
  if (typeof window === "undefined") return [];
  return safeParse(localStorage.getItem(K_FOLDERS), []);
}
export function addFolder(name: string): Folder {
  const folders = getFolders();
  const id = (crypto as any)?.randomUUID?.() || Math.random().toString(36).slice(2);
  const f: Folder = { id, name };
  save(K_FOLDERS, [...folders, f]);
  return f;
}

export function getItems(): SavedItem[] {
  if (typeof window === "undefined") return [];
  return safeParse(localStorage.getItem(K_ITEMS), []);
}
export function addItem(partial: Omit<SavedItem, "id" | "createdAt">): SavedItem {
  const items = getItems();
  const id = (crypto as any)?.randomUUID?.() || Math.random().toString(36).slice(2);
  const item: SavedItem = { id, createdAt: new Date().toISOString(), ...partial };
  save(K_ITEMS, [item, ...items]); // newest first
  return item;
}
export function assignItemToFolder(itemId: string, folderId: string | null) {
  const items = getItems();
  const next = items.map(it => it.id === itemId ? { ...it, folderId } : it);
  save(K_ITEMS, next);
}
export function getItemsForFolder(folderId?: string | null): SavedItem[] {
  const items = getItems();
  if (!folderId) return items; // Recents = all items, newest first
  return items.filter(it => it.folderId === folderId);
}
