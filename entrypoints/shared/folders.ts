// HiddenGem Flow — folders / groups / tags + bulk actions + archive (v1.3, #9).
//
// A script belongs to at most ONE folder (or none = "Unsorted"), can
// carry up to 10 tags, and can be archived. Archived scripts do NOT
// run: the engine skips them at registration time (see engine.ts —
// registerEnabledScripts only registers enabled AND unarchived
// scripts), and the dashboard hides them in the Archived section
// until restored. Archiving is reversible — restore brings the script
// back exactly as it was (folder, tags, enabled flag kept).
//
// Folders/tags live on the script records themselves (folderId, tags,
// archived fields on Script) plus one small folder list
// (hiddengemflow.folders.v1). Both are backed up: FOLDERS_KEY is in
// BACKUP_DATA_KEYS (see shared/backup.ts), so folders survive a
// restore. The folder list is the only new storage key; the script
// fields travel with the scripts key they already live in.
//
// Same split as the other shared modules: PURE half first (no chrome
// APIs, no DOM, no hidden Date.now()), storage half after.
// Unit-testable in plain Node (see smoke-v13.ts).

import type { Script } from "./scripts";

export const FOLDERS_KEY = "hiddengemflow.folders.v1";

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

export const MAX_FOLDERS = 50;
export const MAX_TAGS_PER_SCRIPT = 10;
export const MAX_TAG_LENGTH = 20;

/** The folder filter value for "no folder" (Unsorted). */
export const UNSORTED_FOLDER_ID = "";
/** The folder filter value for the Archived section. */
export const ARCHIVED_FOLDER_ID = "__archived__";

function newId(prefix: string): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return `${prefix}-${c.randomUUID()}`;
  } catch {
    // Fall through to the timestamp fallback.
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Clean one folder name: trimmed, 1–40 chars. Throws on an empty name. */
export function cleanFolderName(name: string): string {
  const clean = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!clean) throw new Error("Give the folder a name.");
  if (clean.length > 40) throw new Error("Folder names are at most 40 characters.");
  return clean;
}

/** Clean one tag: trimmed, lowercased, 1–20 chars, no spaces/commas. Returns null when unusable. */
export function cleanTag(tag: string): string | null {
  const clean = String(tag ?? "").trim().toLowerCase().replace(/[\s,]+/g, "-");
  if (!clean || clean.length > MAX_TAG_LENGTH) return null;
  return clean;
}

/** Parse a free-text tag input ("a, b c") into deduped, cleaned tags (max 10). Pure. */
export function parseTags(input: string): string[] {
  const out: string[] = [];
  for (const part of String(input ?? "").split(/[,\s]+/)) {
    const tag = cleanTag(part);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS_PER_SCRIPT) break;
  }
  return out;
}

/** A folder record is usable when it has a string id and a non-empty name. */
export function validFolder(raw: unknown): raw is Folder {
  return isRecord(raw) && typeof raw.id === "string" && !!raw.id && typeof raw.name === "string" && !!raw.name.trim();
}

/** Clean a stored folder list: keep only usable folders, dedupe ids, cap at 50. Never throws. Pure. */
export function sanitizeFolders(raw: unknown): Folder[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Folder[] = [];
  for (const entry of raw) {
    if (!validFolder(entry)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push({ id: entry.id, name: String(entry.name).trim().slice(0, 40), createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0 });
    if (out.length >= MAX_FOLDERS) break;
  }
  return out;
}

/** Create a folder. Throws on an empty name, a duplicate name (case-insensitive) or the 50-folder cap. Pure. */
export function createFolder(folders: Folder[], name: string, now: number = Date.now(), id: string = newId("folder")): Folder[] {
  const clean = cleanFolderName(name);
  if (folders.some((f) => f.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error(`A folder named "${clean}" already exists.`);
  }
  if (folders.length >= MAX_FOLDERS) throw new Error(`At most ${MAX_FOLDERS} folders.`);
  return [...folders, { id, name: clean, createdAt: now }];
}

/** Rename a folder. Throws on an unknown id, an empty name, or a duplicate name. Pure. */
export function renameFolder(folders: Folder[], id: string, name: string): Folder[] {
  const clean = cleanFolderName(name);
  if (!folders.some((f) => f.id === id)) throw new Error("That folder does not exist.");
  if (folders.some((f) => f.id !== id && f.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error(`A folder named "${clean}" already exists.`);
  }
  return folders.map((f) => (f.id === id ? { ...f, name: clean } : f));
}

/**
 * Delete a folder. Scripts in it become Unsorted (their folderId is
 * cleared) — deleting a folder never deletes scripts. Returns the new
 * folder list AND the updated script list. Throws on an unknown id. Pure.
 */
export function deleteFolder(folders: Folder[], scripts: Script[], id: string): { folders: Folder[]; scripts: Script[] } {
  if (!folders.some((f) => f.id === id)) throw new Error("That folder does not exist.");
  return {
    folders: folders.filter((f) => f.id !== id),
    scripts: scripts.map((s) => (s.folderId === id ? { ...s, folderId: null } : s)),
  };
}

/** Move a script into a folder (or Unsorted with folderId null). Unknown script id → unchanged. Pure. */
export function moveScriptToFolder(scripts: Script[], scriptId: string, folderId: string | null): Script[] {
  return scripts.map((s) => (s.id === scriptId ? { ...s, folderId } : s));
}

/** Set a script's tags (cleaned, deduped, max 10). Unknown script id → unchanged. Pure. */
export function setScriptTags(scripts: Script[], scriptId: string, tags: string[]): Script[] {
  const clean: string[] = [];
  for (const t of tags) {
    const c = cleanTag(t);
    if (c && !clean.includes(c)) clean.push(c);
    if (clean.length >= MAX_TAGS_PER_SCRIPT) break;
  }
  return scripts.map((s) => (s.id === scriptId ? { ...s, tags: clean } : s));
}

/** Archive a script (it stops running until restored). Unknown id → unchanged. Pure. */
export function archiveScript(scripts: Script[], scriptId: string): Script[] {
  return scripts.map((s) => (s.id === scriptId ? { ...s, archived: true } : s));
}

/** Restore an archived script. Unknown id → unchanged. Pure. */
export function unarchiveScript(scripts: Script[], scriptId: string): Script[] {
  return scripts.map((s) => (s.id === scriptId ? { ...s, archived: false } : s));
}

/** Scripts that may run: enabled AND not archived. (The engine uses this at registration.) */
export function runnableScripts(scripts: Script[]): Script[] {
  return scripts.filter((s) => s.enabled && !s.archived);
}

/** Scripts in one folder (null = Unsorted), excluding archived ones. Pure. */
export function scriptsInFolder(scripts: Script[], folderId: string | null): Script[] {
  return scripts.filter((s) => !s.archived && (s.folderId ?? null) === folderId);
}

/** Archived scripts, newest first. Pure. */
export function archivedScripts(scripts: Script[]): Script[] {
  return scripts.filter((s) => s.archived).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** How many (unarchived) scripts each folder holds, plus the Unsorted count. Pure. */
export function folderCounts(folders: Folder[], scripts: Script[]): Record<string, number> {
  const counts: Record<string, number> = { [UNSORTED_FOLDER_ID]: 0 };
  for (const f of folders) counts[f.id] = 0;
  for (const s of scripts) {
    if (s.archived) continue;
    const key = s.folderId ?? null;
    if (key && key in counts) counts[key] += 1;
    else counts[UNSORTED_FOLDER_ID] += 1;
  }
  return counts;
}

export interface BulkResult {
  scripts: Script[];
  changed: number;
}

/** Bulk enable. Returns the new list + how many scripts actually changed. Pure. */
export function bulkEnable(scripts: Script[], ids: string[]): BulkResult {
  const set = new Set(ids);
  let changed = 0;
  const next = scripts.map((s) => {
    if (!set.has(s.id) || s.enabled) return s;
    changed += 1;
    return { ...s, enabled: true };
  });
  return { scripts: next, changed };
}

/** Bulk disable. Pure. */
export function bulkDisable(scripts: Script[], ids: string[]): BulkResult {
  const set = new Set(ids);
  let changed = 0;
  const next = scripts.map((s) => {
    if (!set.has(s.id) || !s.enabled) return s;
    changed += 1;
    return { ...s, enabled: false };
  });
  return { scripts: next, changed };
}

/** Bulk archive. Pure. */
export function bulkArchive(scripts: Script[], ids: string[]): BulkResult {
  const set = new Set(ids);
  let changed = 0;
  const next = scripts.map((s) => {
    if (!set.has(s.id) || s.archived) return s;
    changed += 1;
    return { ...s, archived: true };
  });
  return { scripts: next, changed };
}

/** Bulk delete. Returns the new list + how many were removed. Pure. */
export function bulkDelete(scripts: Script[], ids: string[]): BulkResult {
  const set = new Set(ids);
  const next = scripts.filter((s) => !set.has(s.id));
  return { scripts: next, changed: scripts.length - next.length };
}

/** Bulk export payload: the selected scripts as one JSON file body (same shape as the single-script backup). Pure. */
export function bulkExportJson(scripts: Script[], ids: string[]): string {
  const set = new Set(ids);
  const selected = scripts.filter((s) => set.has(s.id));
  return JSON.stringify({ app: "HiddenGem Flow", format: 1, exportedAt: new Date().toISOString(), scripts: selected }, null, 2);
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

/** Load the folder list; [] when nothing is saved or storage is unavailable. */
export async function loadFolders(): Promise<Folder[]> {
  if (!storageAvailable()) return [];
  try {
    const data = await chrome.storage.local.get(FOLDERS_KEY);
    return sanitizeFolders(data?.[FOLDERS_KEY]);
  } catch {
    return [];
  }
}

/** Persist the whole folder list (replaces the stored value). */
export async function saveFolders(folders: Folder[]): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [FOLDERS_KEY]: sanitizeFolders(folders) });
}
