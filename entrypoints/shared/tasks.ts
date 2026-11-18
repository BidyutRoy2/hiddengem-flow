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

import { sanitizeReminder, type TaskReminder } from "./reminders";

export interface Task {
  id: string;
  name: string;
  url: string;
  favicon?: string;
  pinned: boolean;
  createdAt: number;
  lastOpenedAt?: number;
  /** v1.4 (#5): optional due-time reminder ("HH:MM" + repeat days). */
  reminder?: TaskReminder;
  /** v1.4 (#16): a checklist tick completes the task. */
  completed?: boolean;
  completedAt?: number;
}

/** Clean one stored task: reminder must be a valid "HH:MM" or it is dropped; completed is a boolean. Pure. */
export function sanitizeTask(raw: unknown): Task | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const t = raw as Task;
  if (typeof t.id !== "string" || typeof t.name !== "string" || typeof t.url !== "string") return null;
  const clean: Task = {
    id: t.id,
    name: t.name,
    url: t.url,
    ...(typeof t.favicon === "string" ? { favicon: t.favicon } : {}),
    pinned: t.pinned === true,
    createdAt: typeof t.createdAt === "number" && Number.isFinite(t.createdAt) ? t.createdAt : 0,
    ...(typeof t.lastOpenedAt === "number" && Number.isFinite(t.lastOpenedAt) ? { lastOpenedAt: t.lastOpenedAt } : {}),
  };
  const reminder = sanitizeReminder((t as { reminder?: unknown }).reminder);
  if (reminder) clean.reminder = reminder;
  if (t.completed === true) {
    clean.completed = true;
    if (typeof t.completedAt === "number" && Number.isFinite(t.completedAt)) clean.completedAt = t.completedAt;
  }
  return clean;
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
export function createTask(name: string, rawUrl: string, now: number = Date.now(), id: string = newId(), existing: Task[] = [], extra?: { reminder?: TaskReminder; completed?: boolean }): Task {
  const cleanName = (name ?? "").trim();
  if (!cleanName) throw new Error("Give the site a name.");
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error("That URL does not look valid — use an http(s) address, e.g. example.com or https://example.com.");
  if (isDuplicateUrl(existing, rawUrl)) throw new Error("This site is already saved.");
  const reminder = extra?.reminder ? sanitizeReminder(extra.reminder) : null;
  return {
    id,
    name: cleanName,
    url,
    favicon: buildFaviconUrl(url) ?? undefined,
    pinned: false,
    createdAt: now,
    ...(reminder ? { reminder } : {}),
    ...(extra?.completed === true ? { completed: true, completedAt: now } : {}),
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
export function updateTask(tasks: Task[], id: string, patch: { name?: string; url?: string; reminder?: TaskReminder | null; completed?: boolean }): Task[] {
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
  // v1.4: reminder is set with a valid { time, days } or cleared with
  // null; an invalid reminder value is refused, not silently dropped.
  let nextReminder: TaskReminder | null | undefined;
  if (patch.reminder !== undefined) {
    if (patch.reminder === null) nextReminder = null;
    else {
      const clean = sanitizeReminder(patch.reminder);
      if (!clean) throw new Error("That reminder time is not valid — use HH:MM, e.g. 09:00.");
      nextReminder = clean;
    }
  }
  return tasks.map((t) => {
    if (t.id !== id) return t;
    const next: Task = {
      ...t,
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(nextUrl !== undefined ? { url: nextUrl, favicon: nextFavicon } : {}),
      ...(nextReminder !== undefined ? (nextReminder === null ? { reminder: undefined } : { reminder: nextReminder }) : {}),
      ...(patch.completed !== undefined
        ? patch.completed
          ? { completed: true, completedAt: Date.now() }
          : { completed: undefined, completedAt: undefined }
        : {}),
    };
    // Drop keys set to undefined so stored tasks stay clean.
    if (next.reminder === undefined) delete next.reminder;
    if (next.completed === undefined) {
      delete next.completed;
      delete next.completedAt;
    }
    return next;
  });
}

/** Mark a task completed (a checklist tick does this). Unknown id → unchanged. Pure. */
export function markTaskCompleted(tasks: Task[], id: string, now: number = Date.now()): Task[] {
  return tasks.map((t) => (t.id === id && t.completed !== true ? { ...t, completed: true, completedAt: now } : t));
}

/** Toggle a task's completed flag. Unknown id → unchanged. Pure. */
export function toggleTaskCompleted(tasks: Task[], id: string, now: number = Date.now()): Task[] {
  return tasks.map((t) => {
    if (t.id !== id) return t;
    if (t.completed === true) {
      const next = { ...t };
      delete next.completed;
      delete next.completedAt;
      return next;
    }
    return { ...t, completed: true, completedAt: now };
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

/** Load all saved tasks; [] when nothing is saved or storage is unavailable. Stored tasks are sanitized (v1.4: a bad reminder is dropped, never trusted). */
export async function loadTasks(): Promise<Task[]> {
  if (!storageAvailable()) return [];
  try {
    const data = await chrome.storage.local.get(TASKS_KEY);
    const raw = data?.[TASKS_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.map((t: unknown) => sanitizeTask(t)).filter((t): t is Task => t !== null);
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

// ---------------------------------------------------------------------------
// Tasks backup: export / import (one JSON file, dashboard only)
// ---------------------------------------------------------------------------

export const TASKS_BACKUP_APP = "hiddengem-flow";
export const TASKS_BACKUP_TYPE = "tasks";
export const TASKS_BACKUP_VERSION = 1;
/** A backup never carries more than this many tasks. */
export const TASKS_BACKUP_MAX_TASKS = 500;

export interface TasksBackupEntry {
  name: string;
  url: string;
  pinned: boolean;
  createdAt: number;
  lastOpenedAt?: number;
  /** v1.4: the task's reminder, when set (old backups have none). */
  reminder?: TaskReminder;
  /** v1.4: completed tasks stay completed after an import. */
  completed?: boolean;
  completedAt?: number;
}

export interface TasksBackup {
  app: "hiddengem-flow";
  type: "tasks";
  version: 1;
  exportedAt: string;
  tasks: TasksBackupEntry[];
}

/**
 * Build the backup file content for `tasks`, in the order the list
 * shows them (sortTasks: pinned first, then newest). The backup is a
 * faithful copy: ids and favicons are left out (ids are regenerated
 * on import, favicons are re-derived from the URL), everything else
 * (name, URL, pin, createdAt, lastOpenedAt) is kept verbatim, so
 * importing it into an empty profile reproduces the same list. Pure.
 */
export function buildTasksBackup(tasks: Task[], exportedAt: string = new Date().toISOString()): TasksBackup {
  return {
    app: TASKS_BACKUP_APP,
    type: TASKS_BACKUP_TYPE,
    version: TASKS_BACKUP_VERSION,
    exportedAt,
    tasks: sortTasks(tasks).map((t) => ({
      name: t.name,
      url: t.url,
      pinned: t.pinned,
      createdAt: t.createdAt,
      ...(typeof t.lastOpenedAt === "number" ? { lastOpenedAt: t.lastOpenedAt } : {}),
      ...(t.reminder ? { reminder: t.reminder } : {}),
      ...(t.completed === true ? { completed: true, ...(typeof t.completedAt === "number" ? { completedAt: t.completedAt } : {}) } : {}),
    })),
  };
}

export type TasksBackupParseResult = { ok: true; tasks: TasksBackupEntry[] } | { ok: false; error: string };

/**
 * Validate a parsed backup file. Strict on identity (the app + type
 * markers, tasks is an array, version is 1 when present) and on every
 * entry (non-empty name, valid http(s) URL); lenient on timestamps (a
 * missing or non-numeric createdAt falls back to `now`, a bad
 * lastOpenedAt is dropped) and on pinned (anything non-true is
 * false). A file whose entries are only partly usable is refused as
 * a whole — merging half a backup would silently lose sites, so the
 * user fixes the file first. Pure.
 */
export function parseTasksBackup(parsed: unknown, now: number = Date.now()): TasksBackupParseResult {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "That file is not a HiddenGem Flow tasks backup — nothing was imported." };
  }
  const p = parsed as { app?: unknown; type?: unknown; version?: unknown; tasks?: unknown };
  if (p.app !== TASKS_BACKUP_APP || p.type !== TASKS_BACKUP_TYPE) {
    return { ok: false, error: "That file is not a HiddenGem Flow tasks backup — nothing was imported." };
  }
  if (p.version !== undefined && p.version !== TASKS_BACKUP_VERSION) {
    return { ok: false, error: "That file is not a HiddenGem Flow tasks backup — nothing was imported." };
  }
  if (!Array.isArray(p.tasks)) {
    return { ok: false, error: "That file is not a HiddenGem Flow tasks backup — nothing was imported." };
  }
  if (p.tasks.length > TASKS_BACKUP_MAX_TASKS) {
    return { ok: false, error: `That backup has more than ${TASKS_BACKUP_MAX_TASKS} tasks — nothing was imported.` };
  }
  const entries: TasksBackupEntry[] = [];
  let usable = 0;
  for (const raw of p.tasks) {
    const obj = raw !== null && typeof raw === "object" ? (raw as { name?: unknown; url?: unknown; pinned?: unknown; createdAt?: unknown; lastOpenedAt?: unknown; reminder?: unknown; completed?: unknown; completedAt?: unknown }) : null;
    const name = obj ? String(obj.name ?? "").trim() : "";
    const url = obj ? normalizeUrl(String(obj.url ?? "")) : null;
    if (!name || !url) continue;
    usable++;
    const createdAtRaw = obj?.createdAt;
    const lastOpenedRaw = obj?.lastOpenedAt;
    const reminder = sanitizeReminder(obj?.reminder);
    const completedRaw = obj?.completed;
    const completedAtRaw = obj?.completedAt;
    entries.push({
      name,
      url,
      pinned: obj?.pinned === true,
      createdAt: typeof createdAtRaw === "number" && Number.isFinite(createdAtRaw) ? createdAtRaw : now,
      ...(typeof lastOpenedRaw === "number" && Number.isFinite(lastOpenedRaw) ? { lastOpenedAt: lastOpenedRaw } : {}),
      ...(reminder ? { reminder } : {}),
      ...(completedRaw === true ? { completed: true, ...(typeof completedAtRaw === "number" && Number.isFinite(completedAtRaw) ? { completedAt: completedAtRaw } : {}) } : {}),
    });
  }
  if (usable !== p.tasks.length) {
    return { ok: false, error: `The backup has ${p.tasks.length} tasks, but only ${usable} are usable — nothing was imported. Check the file before importing.` };
  }
  return { ok: true, tasks: entries };
}

export interface TasksBackupMergeResult {
  tasks: Task[];
  imported: number;
  skipped: number;
}

/**
 * Merge backup entries into `existing` — never replaces. An entry
 * whose normalized URL is already saved (the same duplicate rule as
 * createTask) is skipped; every other entry is appended with a fresh
 * id, keeping its name, URL, pin and timestamps from the backup, and
 * the merged list is returned in display order (sortTasks). Pure.
 */
export function mergeTasksBackup(existing: Task[], incoming: TasksBackupEntry[]): TasksBackupMergeResult {
  const merged = [...existing];
  let imported = 0;
  let skipped = 0;
  for (const entry of incoming) {
    if (isDuplicateUrl(merged, entry.url)) {
      skipped++;
      continue;
    }
    merged.push({
      id: newId(),
      name: entry.name,
      url: entry.url,
      favicon: buildFaviconUrl(entry.url) ?? undefined,
      pinned: entry.pinned,
      createdAt: entry.createdAt,
      ...(typeof entry.lastOpenedAt === "number" ? { lastOpenedAt: entry.lastOpenedAt } : {}),
      ...(entry.reminder ? { reminder: entry.reminder } : {}),
      ...(entry.completed === true ? { completed: true, ...(typeof entry.completedAt === "number" ? { completedAt: entry.completedAt } : {}) } : {}),
    });
    imported++;
  }
  return { tasks: sortTasks(merged), imported, skipped };
}

/**
 * One honest line for an import result. Examples:
 *  - (5 imported, 1 skipped, 6 total) → "Imported 5 tasks. 1 skipped — already saved."
 *  - (0 imported, 3 skipped, 3 total) → "Imported 0 tasks — all 3 were already saved."
 *  - (0 imported, 0 skipped, 0 total) → "Imported 0 tasks — the backup was empty."
 *  - (5 imported, 0 skipped, 5 total) → "Imported 5 tasks."
 * Pure.
 */
export function formatImportResult(imported: number, skipped: number, total: number): string {
  if (total === 0) return "Imported 0 tasks — the backup was empty.";
  if (imported === 0) return `Imported 0 tasks — all ${skipped} were already saved.`;
  if (skipped === 0) return `Imported ${imported} task${imported === 1 ? "" : "s"}.`;
  return `Imported ${imported} task${imported === 1 ? "" : "s"}. ${skipped} skipped — already saved.`;
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
