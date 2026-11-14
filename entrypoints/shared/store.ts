// HiddenGem Flow — Official Store shared module (Phase 4).
//
// Split in two halves on purpose (same pattern as shared/tasks.ts and
// shared/scripts.ts):
//  * PURE half (everything up to the "Storage / network" section): no
//    `chrome` APIs, no DOM, no fetch, no Date.now() hidden inside the
//    logic — all inputs are parameters. Unit-testable in plain Node (see
//    the /tmp smoke test).
//  * Storage/network half: thin wrappers around chrome.storage.local and
//    fetch. Only the dashboard and the floating window import these.
//
// THE STORE REPO MAY NOT EXIST YET. Every fetch path treats that as a
// normal, honest outcome: fetchStoreIndex() falls back jsDelivr → raw
// GitHub → last good cached copy, and only when none of those exist
// does it return ok:false. Callers must show the "not published yet"
// message and the GitHub link — never crash, never show fake scripts.
//
// Fetch policy (privacy + honesty):
//  * The store index is fetched ONLY when the user clicks "Load store"
//    in the dashboard Script Store tab — never on dashboard open, never
//    on floating-window open. The floating window reads the CACHED
//    index only (loadStoreCache), so opening a page never phones home.
//  * A script's code is fetched ONLY when the user opens its detail
//    view (fetchStoreCode), and installing still needs a separate,
//    explicit Confirm Install click.
//  * Nothing is ever auto-installed, and auto-upgrade (per installed
//    store script, default OFF) only ever OFFERS a new version —
//    version diff + scan + Confirm — never applies one silently.

import { urlMatches } from "./scripts";

declare const chrome: any;

export const STORE_REPO_URL = "https://github.com/BidyutRoy2/hiddengem-flow-store";
export const STORE_INDEX_JSDELIVR =
  "https://cdn.jsdelivr.net/gh/BidyutRoy2/hiddengem-flow-store@main/index.json";
export const STORE_INDEX_RAW =
  "https://raw.githubusercontent.com/BidyutRoy2/hiddengem-flow-store/main/index.json";

export const STORE_CACHE_KEY = "hiddengemflow.store.cache.v1";
export const BRIDGE_DISMISSED_KEY = "hiddengemflow.bridge.dismissed.v1";

/** Exact banner wording for the Smart Notification Bridge (Phase 4).
 * The tab was renamed "Find Script" → "Script Store" in the dev build
 * 2026-11-15, so the sentence names the new tab (only the tab name
 * changed — the wording is otherwise the same as approved). */
export const BRIDGE_MESSAGE =
  "This site already has an official script — add it in one click from Script Store.";

export interface StoreScript {
  name: string;
  version: string;
  author: string;
  description: string;
  matches: string[];
  codeUrl?: string;
  /** Inline code, when the index carries the script itself instead of a URL. */
  code?: string;
  updateURL?: string;
  downloadURL?: string;
  /** ISO date string; "" when the index gives none (sorts as unknown). */
  updatedAt: string;
  /** ISO date string; "" when the index gives none. Never invented by the extension. */
  publishedAt: string;
  homepage?: string;
}

export interface StoreIndex {
  version?: string;
  updatedAt?: string;
  scripts: StoreScript[];
}

export type StoreSource = "jsdelivr" | "raw" | "cached" | "none";

export interface StoreFetchResult {
  ok: boolean;
  source: StoreSource;
  index?: StoreIndex;
  /** Entries dropped by validation (missing name, version, or code). */
  skipped: number;
  /** Human-readable failure reason, present only when ok is false. */
  error?: string;
  /** When source is "cached": when the cached copy was fetched. */
  cachedAt?: number;
  /** Extra context for the caller (e.g. why a cached copy is shown). */
  note?: string;
}

export interface StoreCache {
  index: StoreIndex;
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Normalize one raw store entry into a StoreScript, or null when the
 * entry is unusable: it needs a name, a version, and code (a valid
 * http(s) codeUrl, or inline code). Missing optional fields fall back
 * to "" / [] — they never make an entry invalid.
 */
export function normalizeStoreScript(entry: unknown): StoreScript | null {
  if (!isPlainObject(entry)) return null;
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  const version = typeof entry.version === "string" ? entry.version.trim() : "";
  const codeUrl = typeof entry.codeUrl === "string" ? entry.codeUrl.trim() : "";
  const code = typeof entry.code === "string" ? entry.code : "";
  if (!name || !version) return null;
  if (!code.trim() && !isHttpUrl(codeUrl)) return null;
  const matches = Array.isArray(entry.matches)
    ? entry.matches.filter((m): m is string => typeof m === "string" && !!m.trim())
    : [];
  return {
    name,
    version,
    author: typeof entry.author === "string" ? entry.author : "",
    description: typeof entry.description === "string" ? entry.description : "",
    matches,
    ...(isHttpUrl(codeUrl) ? { codeUrl } : {}),
    ...(code ? { code } : {}),
    ...(typeof entry.updateURL === "string" && entry.updateURL.trim() ? { updateURL: entry.updateURL.trim() } : {}),
    ...(typeof entry.downloadURL === "string" && entry.downloadURL.trim() ? { downloadURL: entry.downloadURL.trim() } : {}),
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
    publishedAt: typeof entry.publishedAt === "string" ? entry.publishedAt : "",
    ...(typeof entry.homepage === "string" && entry.homepage.trim() ? { homepage: entry.homepage.trim() } : {}),
  };
}

/**
 * Validate a parsed store index. Returns the normalized index, or
 * index:null when the shape is wrong (not an object, or no scripts
 * array). Unusable entries are skipped and counted — one bad entry
 * never kills the whole index.
 */
export function validateStoreIndex(raw: unknown): { index: StoreIndex | null; skipped: number } {
  if (!isPlainObject(raw)) return { index: null, skipped: 0 };
  if (!Array.isArray(raw.scripts)) return { index: null, skipped: 0 };
  const scripts: StoreScript[] = [];
  let skipped = 0;
  for (const entry of raw.scripts) {
    const script = normalizeStoreScript(entry);
    if (script) scripts.push(script);
    else skipped += 1;
  }
  return {
    index: {
      ...(typeof raw.version === "string" ? { version: raw.version } : {}),
      ...(typeof raw.updatedAt === "string" ? { updatedAt: raw.updatedAt } : {}),
      scripts,
    },
    skipped,
  };
}

/** Milliseconds since epoch for a script's updatedAt; 0 when missing/unparseable. */
export function storeUpdatedTime(script: StoreScript): number {
  const t = Date.parse(script.updatedAt ?? "");
  return Number.isNaN(t) ? 0 : t;
}

/** Milliseconds since epoch for a script's publishedAt; 0 when missing/unparseable. */
export function storePublishedTime(script: StoreScript): number {
  const t = Date.parse(script.publishedAt ?? "");
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Short readable date, e.g. "15 Nov 2026". "" when the value is missing
 * or not a date — callers show "Date not listed" for that case and never
 * invent a date. Parsed from the YYYY-MM-DD part by hand (no Date
 * object) so a date-only value never shifts a day across timezones.
 */
export function formatStoreDateShort(iso: string): string {
  if (typeof iso !== "string") return "";
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${day} ${months[month - 1]} ${year}`;
}

/**
 * Sort for the Script Store listing. "published" = Latest (published
 * date desc), "updated" = Recently updated (updated date desc),
 * "name" = Name A–Z. Entries with no date sort last in both date
 * modes. Does not mutate.
 */
export function sortStoreScriptsBy(
  list: StoreScript[],
  mode: "published" | "updated" | "name",
): StoreScript[] {
  return [...list].sort((a, b) => {
    if (mode === "name") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    const ta = mode === "published" ? storePublishedTime(a) : storeUpdatedTime(a);
    const tb = mode === "published" ? storePublishedTime(b) : storeUpdatedTime(b);
    if (tb !== ta) return tb - ta;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** Sort by updatedAt: 'latest' = newest first, 'oldest' = oldest first. Does not mutate. */
export function sortStoreScripts(list: StoreScript[], order: "latest" | "oldest"): StoreScript[] {
  return [...list].sort((a, b) =>
    order === "latest" ? storeUpdatedTime(b) - storeUpdatedTime(a) : storeUpdatedTime(a) - storeUpdatedTime(b),
  );
}

/**
 * Case-insensitive substring search over name + description + author +
 * match patterns. Empty query returns the list unchanged (same order).
 * Does not mutate.
 */
export function searchStoreScripts(list: StoreScript[], query: string): StoreScript[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return [...list];
  return list.filter((s) =>
    [s.name, s.description, s.author, ...s.matches].join(" ").toLowerCase().includes(q),
  );
}

/** Store scripts whose match patterns match `url` (reuses urlMatches — never duplicated). */
export function findStoreScriptsForUrl(scripts: StoreScript[], url: string): StoreScript[] {
  return scripts.filter((s) => urlMatches(url, s.matches));
}

/** Hostname of a URL, or null when the URL does not parse / has no host. */
export function hostnameOf(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return host || null;
  } catch {
    return null;
  }
}

// --- Bridge dismissal (pure record helpers) ---
// The dismissed store is a plain object: hostname → timestamp when the
// user dismissed the bridge banner for that site. It survives reloads
// (chrome.storage.local) and is keyed by hostname only — dismissing the
// banner on example.com never hides it on another site.

/** True when the bridge banner was dismissed for this hostname. */
export function isBridgeDismissed(dismissed: Record<string, number>, hostname: string): boolean {
  if (!hostname || !dismissed || typeof dismissed !== "object") return false;
  return Object.prototype.hasOwnProperty.call(dismissed, hostname);
}

/** Return a new dismissed record with `hostname` dismissed at `now`. Does not mutate. */
export function dismissBridge(
  dismissed: Record<string, number>,
  hostname: string,
  now: number = Date.now(),
): Record<string, number> {
  if (!hostname) return { ...(dismissed ?? {}) };
  return { ...(dismissed ?? {}), [hostname]: now };
}

// ---------------------------------------------------------------------------
// Storage / network (chrome.storage.local + fetch — not part of the pure half)
// ---------------------------------------------------------------------------

function storageAvailable(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome?.storage?.local;
  } catch {
    return false;
  }
}

/** Load the last good cached store index, or null when there is none. */
export async function loadStoreCache(): Promise<StoreCache | null> {
  if (!storageAvailable()) return null;
  try {
    const data = await chrome.storage.local.get(STORE_CACHE_KEY);
    const raw = data?.[STORE_CACHE_KEY];
    if (!isPlainObject(raw) || typeof raw.fetchedAt !== "number") return null;
    const { index } = validateStoreIndex(raw.index);
    if (!index) return null;
    return { index, fetchedAt: raw.fetchedAt };
  } catch {
    return null;
  }
}

/** Persist a fetched index as the last good copy. */
export async function saveStoreCache(cache: StoreCache): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [STORE_CACHE_KEY]: cache });
}

/** Load the bridge-dismissed record (hostname → timestamp); {} when none. */
export async function loadBridgeDismissed(): Promise<Record<string, number>> {
  if (!storageAvailable()) return {};
  try {
    const data = await chrome.storage.local.get(BRIDGE_DISMISSED_KEY);
    const raw = data?.[BRIDGE_DISMISSED_KEY];
    if (!isPlainObject(raw)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "number") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist the bridge-dismissed record. */
export async function saveBridgeDismissed(dismissed: Record<string, number>): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [BRIDGE_DISMISSED_KEY]: dismissed });
}

/** Dismiss the bridge banner for one hostname (load → add → save). */
export async function dismissBridgeForHostname(hostname: string): Promise<void> {
  const dismissed = await loadBridgeDismissed();
  await saveBridgeDismissed(dismissBridge(dismissed, hostname));
}

async function fetchIndexFrom(
  url: string,
): Promise<{ index: StoreIndex | null; skipped: number; error?: string }> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    return { index: null, skipped: 0, error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { index: null, skipped: 0, error: `The store answered ${res.status}.` };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { index: null, skipped: 0, error: "The store index is not valid JSON." };
  }
  const { index, skipped } = validateStoreIndex(json);
  if (!index) return { index: null, skipped, error: "The store index has no scripts list." };
  return { index, skipped };
}

/**
 * Fetch the store index: jsDelivr first, raw.githubusercontent on any
 * failure (network error, non-2xx, bad JSON, bad shape). A successful
 * fetch is cached as the last good copy. When both sources fail but a
 * cache exists, the cached list is returned with source "cached" and
 * the live error in `note` — the caller labels it "cached from
 * <date>" honestly. Only when nothing is reachable at all does this
 * return ok:false (the store repo may not exist yet).
 */
export async function fetchStoreIndex(): Promise<StoreFetchResult> {
  const jsdelivr = await fetchIndexFrom(STORE_INDEX_JSDELIVR);
  if (jsdelivr.index) {
    const fetchedAt = Date.now();
    await saveStoreCache({ index: jsdelivr.index, fetchedAt });
    return { ok: true, source: "jsdelivr", index: jsdelivr.index, skipped: jsdelivr.skipped };
  }
  const raw = await fetchIndexFrom(STORE_INDEX_RAW);
  if (raw.index) {
    const fetchedAt = Date.now();
    await saveStoreCache({ index: raw.index, fetchedAt });
    return { ok: true, source: "raw", index: raw.index, skipped: raw.skipped };
  }
  const cache = await loadStoreCache();
  if (cache) {
    return {
      ok: true,
      source: "cached",
      index: cache.index,
      skipped: 0,
      cachedAt: cache.fetchedAt,
      note: `Live fetch failed (${jsdelivr.error ?? raw.error ?? "network error"}). Showing the last saved copy instead.`,
    };
  }
  return {
    ok: false,
    source: "none",
    skipped: 0,
    error: jsdelivr.error ?? raw.error ?? "Could not reach the store.",
  };
}

/**
 * Fetch a store script's code — only when the user opens its detail
 * view. Inline code (index carries `code`) is returned without a
 * network request. Otherwise the codeUrl is fetched once; any failure
 * is returned as an error for the caller to show honestly.
 */
export async function fetchStoreCode(script: StoreScript): Promise<{ ok: boolean; code?: string; error?: string }> {
  if (script.code && script.code.trim()) return { ok: true, code: script.code };
  if (!script.codeUrl) return { ok: false, error: "This store entry has no code to fetch." };
  let url: URL;
  try {
    url = new URL(script.codeUrl);
  } catch {
    return { ok: false, error: "The code URL is not valid." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http(s) code URLs can be fetched." };
  }
  try {
    const res = await fetch(url.href);
    if (!res.ok) return { ok: false, error: `The server answered ${res.status}.` };
    const code = await res.text();
    if (!code.trim()) return { ok: false, error: "The code file is empty." };
    return { ok: true, code };
  } catch (err) {
    return { ok: false, error: `Could not fetch the code: ${err instanceof Error ? err.message : String(err)}` };
  }
}
