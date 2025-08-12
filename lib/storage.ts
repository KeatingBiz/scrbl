// lib/storage.ts
import type { BoardUnderstanding } from "@/lib/types";

export type Folder = { id: string; name: string };
export type SavedItem = {
  id: string;
  createdAt: string;     // ISO
  thumbDataUrl: string;  // compressed thumbnail
  result: BoardUnderstanding;
  folderId?: string | null;
};

const K_FOLDERS = "scrbl:folders:v2";
const K_ITEMS   = "scrbl:items:v2"; // new version (thumb-only)

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
  const id = (crypto as any)?.randomUUID?.() || Math.random().toString(36).slice(2);
  const f: Folder = { id, name };
  const next = [...getFolders(), f];
  save(K_FOLDERS, next);
  return f;
}

export function getItems(): SavedItem[] {
  if (typeof window === "undefined") return [];
  return safeParse(localStorage.getItem(K_ITEMS), []);
}

function trySaveItems(items: SavedItem[]): boolean {
  try {
    localStorage.setItem(K_ITEMS, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

/** Add item with eviction on quota errors */
export function addItem(partial: Omit<SavedItem, "id" | "createdAt">): SavedItem {
  const id = (crypto as any)?.randomUUID?.() || Math.random().toString(36).slice(2);
  const item: SavedItem = { id, createdAt: new Date().toISOString(), ...partial };
  const items = getItems();

  // Try save with newest first
  let candidate = [item, ...items];
  if (trySaveItems(candidate)) return item;

  // Evict from the end until it fits
  while (candidate.length > 1) {
    candidate.pop();
    if (trySaveItems(candidate)) return item;
  }

  // Last-ditch: keep only this item
  if (trySaveItems([item])) return item;

  // Give up: don't crash the app
  throw new Error("Storage quota exceeded");
}

export function assignItemToFolder(itemId: string, folderId: string | null) {
  const items = getItems();
  const next = items.map(it => it.id === itemId ? { ...it, folderId } : it);
  save(K_ITEMS, next);
}

export function getItemsForFolder(folderId?: string | null): SavedItem[] {
  const items = getItems();
  if (!folderId) return items; // Recents = all items
  return items.filter(it => it.folderId === folderId);
}

