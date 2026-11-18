// HiddenGem Flow — Store collections / subscriptions (v1.5+, #19).
//
// Follow a collection (a list of store scripts — e.g. "YouTube power
// pack", "Trading helpers"), and search the store across the index.
// Installing stays one-by-one with preview + Confirm (never bulk
// auto-install): following a collection only records the follow, and
// each script inside it is still installed from the Script Store tab
// exactly as before.
//
// Collections are BUILT-IN definitions (name + the store script names
// they list). They resolve against the fetched store index at
// runtime: a name that is not in the store yet is shown as "not in
// the store yet", never invented as a script.

import type { StoreIndex, StoreScript } from "./store";
import { searchStoreScripts } from "./store";

export const COLLECTIONS_FOLLOW_KEY = "hiddengemflow.collections.followed.v1";

export interface StoreCollection {
  id: string;
  name: string;
  description: string;
  /** Store script names, in order. Resolved live against the store index. */
  scriptNames: string[];
}

export const BUILTIN_COLLECTIONS: StoreCollection[] = [
  {
    id: "youtube-power-pack",
    name: "YouTube power pack",
    description: "Helpers for watching and working with YouTube.",
    scriptNames: ["Universal DOM Diagnostic"],
  },
  {
    id: "trading-helpers",
    name: "Trading helpers",
    description: "Scripts for trading pages and exchange dashboards.",
    scriptNames: ["Titan Exchange Auto Trader Pro by HiddenGem", "Universal DOM Diagnostic"],
  },
  {
    id: "diagnostics-kit",
    name: "Diagnostics kit",
    description: "Find out what a page is really doing.",
    scriptNames: ["Universal DOM Diagnostic", "9Chain Virtual Node Auto"],
  },
];

export interface ResolvedCollection {
  collection: StoreCollection;
  /** Scripts found in the store index, in collection order. */
  found: StoreScript[];
  /** Names in the collection that are not in the store index (yet). */
  missing: string[];
  followed: boolean;
}

/** Resolve collections against a store index (or null when the store was never loaded). Pure. */
export function resolveCollections(index: StoreIndex | null, followedIds: string[]): ResolvedCollection[] {
  const scripts = index?.scripts ?? [];
  return BUILTIN_COLLECTIONS.map((collection) => {
    const found: StoreScript[] = [];
    const missing: string[] = [];
    for (const name of collection.scriptNames) {
      const hit = scripts.find((s) => s.name === name);
      if (hit) found.push(hit);
      else missing.push(name);
    }
    return { collection, found, missing, followed: followedIds.includes(collection.id) };
  });
}

/** Toggle a follow (pure list op — the dashboard persists it). Pure. */
export function toggleCollectionFollow(followed: string[], id: string): string[] {
  if (!BUILTIN_COLLECTIONS.some((c) => c.id === id)) return followed;
  return followed.includes(id) ? followed.filter((x) => x !== id) : [...followed, id];
}

/** Clean a stored followed list (unknown ids dropped). Pure. */
export function sanitizeFollowed(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(BUILTIN_COLLECTIONS.map((c) => c.id));
  return raw.filter((x): x is string => typeof x === "string" && known.has(x));
}

/** Store search across the index (thin wrapper over the store's own search, so the Dossier tab has one call). Pure. */
export function searchStore(index: StoreIndex | null, query: string): StoreScript[] {
  if (!index) return [];
  return searchStoreScripts(index.scripts, query);
}

declare const chrome: any;

export async function loadFollowedCollections(): Promise<string[]> {
  try {
    if (typeof chrome === "undefined" || !chrome?.storage?.local) return [];
    const data = await chrome.storage.local.get(COLLECTIONS_FOLLOW_KEY);
    return sanitizeFollowed(data?.[COLLECTIONS_FOLLOW_KEY]);
  } catch {
    return [];
  }
}

export async function saveFollowedCollections(followed: string[]): Promise<void> {
  try {
    if (typeof chrome === "undefined" || !chrome?.storage?.local) return;
    await chrome.storage.local.set({ [COLLECTIONS_FOLLOW_KEY]: sanitizeFollowed(followed) });
  } catch {
    // Non-fatal.
  }
}
