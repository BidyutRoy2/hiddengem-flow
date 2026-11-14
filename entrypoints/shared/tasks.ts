// HiddenGem Flow — Daily Tasks shared module (Phase 2).
//
// Split in two halves on purpose:
//  * PURE half (everything up to the "Storage" section): no `chrome` APIs,
//    no DOM, no Date.now() hidden inside the logic — all inputs are
//    parameters. Unit-testable in plain Node (see the /tmp smoke test).
//  * Storage half: thin wrappers around chrome.storage.local. Only the
//    dashboard, floating window and background import these.
//
// Privacy note: the only external request in Phase 2 is the best-effort
// favicon fetch (buildFaviconUrl, Google's s2 favicon service). It is made
// by the browser when an <img> loads, not by this code, and if it fails the
// UI falls back to a letter tile. No task data, no analytics, no telemetry
// is ever sent anywhere.

export interface Task {
  id: string;
  name: string;
  url: string;
  favicon?: string;
  pinned: boolean;
  createdAt: number;
  lastOpenedAt?: number;
}

export const TASKS_KEY = "hiddengemflow.tasks.v1";

/** Message types the background service worker understands (Phase 2). */
export const MSG_OPEN_URLS = "hiddengemflow:open-urls";
export const MSG_GET_ACTIVE_TAB = "hiddengemflow:get-active-tab";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a user-typed URL.
 * - Trims whitespace; adds `https://` when no scheme is present.
 * - Validates with the URL constructor; only http(s) is accepted.
 * - Returns the normalized href, or `null` when the input is not a
 *   usable http(s) URL (empty, bad syntax, or a non-http(s) scheme such
 *   as javascript:, chrome:, ftp:, data:).
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (/\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  return parsed.href;
}

/**
 * Best-effort favicon URL for a task URL (Google s2 favicon service).
 * Returns null when the URL has no usable host. Callers must treat a
 * failed load as normal and show the letter-tile fallback instead.
 */
export function buildFaviconUrl(taskUrl: string): string | null {
  let host: string;
  try {
    host = new URL(taskUrl).hostname;
  } catch {
    return null;
  }
  if (!host) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
}

/** First letter of a task name, for the letter-tile fallback. */
export function letterFor(name: string): string {
  const ch = (name ?? "").trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

function newId(): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // Fall through to the timestamp fallback.
  }
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * True when `url` (normalized) is already saved in `existing` —
 * optionally ignoring the task with `excludeId` (the task being
 * edited). Comparison is on the normalized URL, so "example.com" and
 * "https://example.com/" count as the same site. Pure.
 */
export function isDuplicateUrl(existing: Task[], rawUrl: string, excludeId?: string): boolean {
  const url = normalizeUrl(rawUrl);
  if (!url) return false;
  return (existing ?? []).some((t) => t.id !== excludeId && normalizeUrl(t.url) === url);
}

/**
 * Create a task. Throws an Error when the name is empty, the URL is
 * not a valid http(s) URL, or the URL is already saved in `existing`
 * ("This site is already saved."). `now` and `id` are parameters so
 * tests can pin them; callers normally omit both and pass the current
 * task list as `existing` (omit it only when there is no list yet).
 */
export function createTask(name: string, rawUrl: string, now: number = Date.now(), id: string = newId(), existing: Task[] = []): Task {
  const cleanName = (name ?? "").trim();
  if (!cleanName) throw new Error("Give the site a name.");
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error("That URL does not look valid — use an http(s) address, e.g. example.com or https://example.com.");
  if (isDuplicateUrl(existing, rawUrl)) throw new Error("This site is already saved.");
  return {
    id,
    name: cleanName,
    url,
    favicon: buildFaviconUrl(url) ?? undefined,
    pinned: false,
    createdAt: now,
  };
}

/** Pinned tasks first, then newest first (createdAt desc). Does not mutate. */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
}

/**
 * Update a task's name and/or URL. Throws on an empty name, an invalid
 * URL, or a URL that is already saved on ANOTHER task ("This site is
 * already saved." — the task being edited is excluded, so saving it
 * unchanged is fine). Returns a new array; the original is untouched.
 * Unknown id → the array is returned unchanged.
 */
export function updateTask(tasks: Task[], id: string, patch: { name?: string; url?: string }): Task[] {
  let nextName: string | undefined;
  let nextUrl: string | undefined;
  let nextFavicon: string | undefined;
  if (patch.name !== undefined) {
    nextName = patch.name.trim();
    if (!nextName) throw new Error("Give the site a name.");
  }
  if (patch.url !== undefined) {
    const normalized = normalizeUrl(patch.url);
    if (!normalized) throw new Error("That URL does not look valid — use an http(s) address.");
    if (isDuplicateUrl(tasks, patch.url, id)) throw new Error("This site is already saved.");
    nextUrl = normalized;
    nextFavicon = buildFaviconUrl(nextUrl) ?? undefined;
  }
  return tasks.map((t) => {
    if (t.id !== id) return t;
    return {
      ...t,
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(nextUrl !== undefined ? { url: nextUrl, favicon: nextFavicon } : {}),
    };
  });
}

/** Remove a task by id. Returns a new array. */
export function deleteTask(tasks: Task[], id: string): Task[] {
  return tasks.filter((t) => t.id !== id);
}

/** Toggle a task's pinned flag. Returns a new array. */
export function togglePin(tasks: Task[], id: string): Task[] {
  return tasks.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t));
}

/**
 * Case-insensitive substring search over name + URL. Empty query returns
 * the list unchanged (same order). Does not mutate.
 */
export function searchTasks(tasks: Task[], query: string): Task[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return [...tasks];
  return tasks.filter((t) => t.name.toLowerCase().includes(q) || t.url.toLowerCase().includes(q));
}

/**
 * Stamp lastOpenedAt (== `now`) on every task whose normalized URL
 * matches one of `urls`. Returns a new array.
 */
export function markOpened(tasks: Task[], urls: string[], now: number = Date.now()): Task[] {
  const wanted = new Set(urls.map((u) => normalizeUrl(u)).filter((u): u is string => u !== null));
  if (wanted.size === 0) return [...tasks];
  return tasks.map((t) => {
    const norm = normalizeUrl(t.url);
    return norm !== null && wanted.has(norm) ? { ...t, lastOpenedAt: now } : t;
  });
}

// ---------------------------------------------------------------------------
// Storage wrappers (chrome.storage.local only — not part of the pure half)
// ---------------------------------------------------------------------------

declare const chrome: any;

function storageAvailable(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome?.storage?.local;
  } catch {
    return false;
  }
}

/** Load all saved tasks; [] when nothing is saved or storage is unavailable. */
export async function loadTasks(): Promise<Task[]> {
  if (!storageAvailable()) return [];
  try {
    const data = await chrome.storage.local.get(TASKS_KEY);
    const raw = data?.[TASKS_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (t: unknown): t is Task =>
        !!t && typeof (t as Task).id === "string" && typeof (t as Task).name === "string" && typeof (t as Task).url === "string",
    );
  } catch {
    return [];
  }
}

/** Persist the whole task list (replaces the stored value). */
export async function saveTasks(tasks: Task[]): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [TASKS_KEY]: tasks });
}

/** What the background reports back after opening a list of URLs. */
export interface OpenUrlsResult {
  ok: boolean;
  /** Tabs actually opened. */
  opened: number;
  /** Valid URLs dropped by the per-batch cap (50 at a time). */
  skipped: number;
  /** URLs that were not valid http(s) addresses at all. */
  invalid: number;
}

/**
 * Ask the background to open `urls` (staggered, one tab at a time) and
 * stamp lastOpenedAt on the matching tasks. Resolves to the counts the
 * background reported ({ ok, opened, skipped, invalid }) — callers must
 * SHOW the result (see formatOpenResult) instead of treating a boolean
 * as enough. ok:false when the background did not answer at all.
 */
export async function openUrlsViaBackground(urls: string[]): Promise<OpenUrlsResult> {
  const failed: OpenUrlsResult = { ok: false, opened: 0, skipped: 0, invalid: 0 };
  if (urls.length === 0) return failed;
  try {
    const res = await chrome.runtime.sendMessage({ type: MSG_OPEN_URLS, urls });
    if (!res?.ok) return failed;
    return {
      ok: true,
      opened: typeof res.opened === "number" ? res.opened : 0,
      skipped: typeof res.skipped === "number" ? res.skipped : 0,
      invalid: typeof res.invalid === "number" ? res.invalid : 0,
    };
  } catch {
    return failed;
  }
}

/**
 * One honest line for an open result. Examples:
 *  - { opened: 3 } → "Opened 3 tabs."
 *  - { opened: 50, skipped: 10 } → "Opened 50 tabs. 10 skipped (50 open at a time)."
 *  - { opened: 2, invalid: 1 } → "Opened 2 tabs. 1 URL was not valid, so it was not opened."
 * Empty string when nothing opened and nothing was skipped or invalid
 * (nothing worth saying). Pure.
 */
export function formatOpenResult(result: OpenUrlsResult): string {
  const { opened, skipped, invalid } = result;
  if (opened === 0 && skipped === 0 && invalid === 0) return "";
  const parts: string[] = [];
  if (opened > 0) parts.push(`Opened ${opened} tab${opened === 1 ? "" : "s"}.`);
  if (skipped > 0) parts.push(`${skipped} skipped (50 open at a time).`);
  if (invalid > 0) parts.push(`${invalid} URL${invalid === 1 ? " was" : "s were"} not valid, so ${invalid === 1 ? "it was" : "they were"} not opened.`);
  return parts.join(" ");
}
