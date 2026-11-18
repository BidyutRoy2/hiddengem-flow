// HiddenGem Flow — automatic versioned local backup + one-click restore (v1.2.0).
//
// WHY THIS EXISTS: data loss is the #1 complaint about userscript
// managers and tab savers everywhere (a browser "repair" wiping
// scripts, a bad update corrupting storage). Everything this extension
// stores lives in chrome.storage.local, so a versioned snapshot of
// that same storage — tasks, scripts, notes, float layout, window
// mode — is the cheapest honest safety net: no server, no sync, no
// account, nothing leaves the browser.
//
// RULES (the design the user approved):
//  * At most 3 snapshots, newest first. A snapshot is taken (a) on
//    storage changes of the backed-up keys, debounced, only when
//    auto-backup is ON, and (b) once before an extension update
//    (onInstalled with a previousVersion). A snapshot whose data is
//    identical to the newest one is skipped — no duplicate entries.
//  * RESTORE NEVER DELETES CURRENT DATA: restoring first saves the
//    current state as a snapshot, then writes the snapshot's data
//    back. The restore itself goes through the background (one
//    message), so the snapshot-first step and the write cannot be
//    separated by a caller.
//  * Export is one JSON file ({ app, type: "backup", version: 1,
//    exportedAt, data }) — the same strict-parse rule as the tasks
//    backup (A-07): a file whose entries are only partly usable is
//    refused as a whole, never merged halfway.
//  * Restore REPLACES the current data (tasks, scripts, notes,
//    layout, mode) with the snapshot's — after the snapshot-first
//    save above, so the old state is always one click away.
//
// Same split as shared/tasks.ts: PURE half first (no chrome APIs, no
// DOM, no hidden Date.now()), storage half after. Unit-testable in
// plain Node (see the smoke test).

import { FLOAT_LAYOUT_KEY, loadFloatLayout, sanitizeFloatLayout, saveFloatLayout, type FloatLayout } from "./float-layout";
import { FLOWS_KEY, loadFlows, sanitizeFlows, saveFlows, validFlow, type Flow } from "./flows";
import { FOLDERS_KEY, loadFolders, sanitizeFolders, saveFolders, validFolder, type Folder } from "./folders";
import { NOTES_KEY, loadNotes, saveNotes, type Note } from "./notes";
import { REMINDERS_KEY, defaultRemindersSettings, loadRemindersSettings, sanitizeRemindersSettings, saveRemindersSettings, type RemindersSettings } from "./reminders";
import { COLLECTIONS_FOLLOW_KEY, loadFollowedCollections, sanitizeFollowed, saveFollowedCollections } from "./collections";
import { SESSIONS_KEY, loadSessions, sanitizeSessions, saveSessions, validSession, type Session } from "./sessions";
import { SMART_OPEN_KEY, defaultSmartOpenSettings, loadSmartOpenSettings, sanitizeSmartOpenSettings, saveSmartOpenSettings, type SmartOpenSettings } from "./smart-open";
import { SNOOZE_KEY, loadSnoozes, sanitizeSnoozes, saveSnoozes, type Snooze } from "./snooze";
import { USERSTYLES_KEY, loadUserStyles, sanitizeUserStyles, saveUserStyles, validUserStyle, type UserStyle } from "./userstyles";
import { SCRIPTS_KEY, loadScripts, saveScripts, type Script } from "./scripts";
import { TASKS_KEY, loadTasks, saveTasks, type Task } from "./tasks";
import { WINDOW_MODE_KEY, loadWindowMode, sanitizeWindowMode, saveWindowMode, type WindowMode } from "./window-mode";
import { SCHEDULES_KEY, loadSchedules, sanitizeSchedules, saveSchedules, type ScheduleEntry } from "./schedules";
import { SYNC_KEY, loadSyncSettings, sanitizeSyncSettings, saveSyncSettings, type SyncSettings } from "./sync";
import { AI_KEY, loadAiSettings, sanitizeAiSettings, saveAiSettings, type AiSettings } from "./ai-author";

export const BACKUP_KEY = "hiddengemflow.backup.v1";
/** Snapshots kept, newest first. */
export const BACKUP_MAX_SNAPSHOTS = 3;
export const BACKUP_APP = "hiddengem-flow";
export const BACKUP_TYPE = "backup";
export const BACKUP_VERSION = 1;

/** Ask the background to restore `data` (snapshot-first, then write). */
export const MSG_RESTORE_BACKUP = "hiddengemflow:restore-backup";

/** Everything a snapshot carries — the whole local state that matters. */
export interface BackupData {
  tasks: Task[];
  scripts: Script[];
  notes: Note[];
  layout: FloatLayout;
  mode: WindowMode;
  /** v1.3 (#9): script folders. Scripts carry their own folderId/tags/archived inside the scripts list. */
  folders: Folder[];
  /** v1.4 (#6): Flows. Optional in old backups (pre-v1.4 snapshots have none). */
  flows: Flow[];
  /** v1.4 (#5): routines settings (daily nudge + scheduled Open All). Optional in old backups. */
  reminders: RemindersSettings;
  /** v1.5+ (#14): saved sessions. Optional in old backups. */
  sessions: Session[];
  /** v1.5+ (#11): per-site userstyles. Optional in old backups. */
  userstyles: UserStyle[];
  /** v1.5+ (#21): snoozed tasks. Optional in old backups. */
  snoozes: Snooze[];
  /** v1.5+ (#19): followed store collections (ids only). Optional in old backups. */
  followedCollections: string[];
  /** v1.5+ (#15): Smart Open All settings. Optional in old backups. */
  smartOpen: SmartOpenSettings;
  /** Later (#13): per-script schedules (opt-in per script). Optional in old backups. */
  schedules: Record<string, ScheduleEntry>;
  /** Later (#20): sync settings WITHOUT tokens — tokens live under a separate key that is never backed up. Optional in old backups. */
  sync: SyncSettings;
  /** Later (#24): AI authoring settings WITHOUT the API key — the key lives under a separate key that is never backed up. Optional in old backups. */
  ai: AiSettings;
}

export interface BackupSnapshot {
  id: string;
  createdAt: number;
  data: BackupData;
}

export interface BackupState {
  /** Auto-backup on storage change. Default true. */
  auto: boolean;
  /** Newest first, at most BACKUP_MAX_SNAPSHOTS. */
  snapshots: BackupSnapshot[];
}

export function defaultBackupState(): BackupState {
  return { auto: true, snapshots: [] };
}

function newSnapshotId(): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // Fall through to the timestamp fallback.
  }
  return `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** "Today, 04:05" / "Yesterday, 04:02" / "14 Nov, 04:01" (local time). Pure. */
export function formatBackupTime(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const dayStart = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((dayStart(n) - dayStart(d)) / 86400000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (diffDays === 0) return `Today, ${hh}:${mm}`;
  if (diffDays === 1) return `Yesterday, ${hh}:${mm}`;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${hh}:${mm}`;
}

/** The header chip / footer line: "✓ Backup today, 04:05 · 3 snapshots" — real values only, never invented. Pure. */
export function formatBackupChip(state: BackupState | null, now: number = Date.now()): string {
  if (!state || state.snapshots.length === 0) {
    return state && state.auto === false ? "Auto-backup is off — no snapshots yet" : "No backup yet — auto-backup is on";
  }
  const latest = state.snapshots[0];
  const when = formatBackupTime(latest.createdAt, now);
  const count = state.snapshots.length;
  return `✓ Backup ${when.toLowerCase()} · ${count} snapshot${count === 1 ? "" : "s"}`;
}

/** The label a snapshot row shows ("Today, 04:05"). Pure. */
export function snapshotLabel(snapshot: BackupSnapshot, now: number = Date.now()): string {
  return formatBackupTime(snapshot.createdAt, now);
}

function validTask(raw: unknown): raw is Task {
  return isRecord(raw) && typeof raw.id === "string" && typeof raw.name === "string" && typeof raw.url === "string";
}

function validScript(raw: unknown): raw is Script {
  return (
    isRecord(raw) &&
    typeof raw.id === "string" &&
    typeof raw.name === "string" &&
    typeof raw.code === "string" &&
    Array.isArray(raw.matches)
  );
}

function validNote(raw: unknown): raw is Note {
  return isRecord(raw) && typeof raw.id === "string" && typeof raw.title === "string" && typeof raw.body === "string";
}

/**
 * Clean a stored (or hand-edited) backup state: auto is true unless
 * explicitly false; snapshots are newest-first, capped at 3, each
 * with a usable id/timestamp and a data object whose collections
 * keep only usable entries (a snapshot with no usable data at all is
 * dropped). Never throws; a completely unusable value becomes the
 * default. Pure.
 */
export function sanitizeBackupState(raw: unknown): BackupState {
  const fallback = defaultBackupState();
  if (!isRecord(raw)) return fallback;
  const auto = raw.auto === false ? false : true;
  const snapshots: BackupSnapshot[] = [];
  if (Array.isArray(raw.snapshots)) {
    for (const entry of raw.snapshots) {
      if (!isRecord(entry)) continue;
      const createdAt = typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt) ? entry.createdAt : 0;
      if (createdAt <= 0) continue;
      const data = sanitizeBackupData(entry.data);
      if (!data) continue;
      snapshots.push({
        id: typeof entry.id === "string" && entry.id ? entry.id : newSnapshotId(),
        createdAt,
        data,
      });
    }
  }
  snapshots.sort((a, b) => b.createdAt - a.createdAt);
  return { auto, snapshots: snapshots.slice(0, BACKUP_MAX_SNAPSHOTS) };
}

/**
 * Clean backup data: tasks/scripts/notes keep only usable entries
 * (same shape rules as their loaders), layout is sanitized, mode
 * falls back to "floating". Returns null when the value is not an
 * object at all. Pure.
 */
export function sanitizeBackupData(raw: unknown): BackupData | null {
  if (!isRecord(raw)) return null;
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).filter(validTask) as Task[];
  const scripts = (Array.isArray(raw.scripts) ? raw.scripts : []).filter(validScript) as Script[];
  const notes = (Array.isArray(raw.notes) ? raw.notes : []).filter(validNote) as Note[];
  return {
    tasks,
    scripts,
    notes,
    layout: sanitizeFloatLayout(raw.layout),
    mode: sanitizeWindowMode(raw.mode),
    // v1.3: folders are optional in old backups (pre-v1.3 snapshots
    // have none) — sanitizeFolders([]) is [] either way.
    folders: sanitizeFolders(raw.folders),
    // v1.4: Flows and routines settings are optional in old backups
    // the same way — missing means "none yet" / the default.
    flows: sanitizeFlows(raw.flows),
    reminders: sanitizeRemindersSettings(raw.reminders),
    // v1.5+: sessions, userstyles, snoozes, followed collections and
    // smart-open settings are optional in old backups the same way —
    // missing means "none yet" / the default. (v2.0.3: the v1.5+
    // new-tab opt-in is GONE — a v2.0.2 backup's `newtab` key is
    // simply ignored here, never read and never written back.)
    sessions: sanitizeSessions(raw.sessions),
    userstyles: sanitizeUserStyles(raw.userstyles),
    snoozes: sanitizeSnoozes(raw.snoozes),
    followedCollections: sanitizeFollowed(raw.followedCollections),
    smartOpen: sanitizeSmartOpenSettings(raw.smartOpen),
    // Later: schedules + sync/AI settings are optional in old
    // backups the same way — missing means "none yet" / the default.
    // TOKENS ARE NEVER HERE: the sync tokens key and the AI key key
    // are not in BACKUP_DATA_KEYS and are never collected, so a
    // backup can never contain a token string.
    schedules: sanitizeSchedules(raw.schedules),
    sync: sanitizeSyncSettings(raw.sync),
    ai: sanitizeAiSettings(raw.ai),
  };
}

/** Build a snapshot from current data. `now` and `id` are parameters so tests can pin them. Pure. */
export function createSnapshot(data: BackupData, now: number = Date.now(), id: string = newSnapshotId()): BackupSnapshot {
  return { id, createdAt: now, data: JSON.parse(JSON.stringify(data)) as BackupData };
}

/**
 * Add a snapshot (newest first, capped at 3). An identical copy of
 * the newest snapshot is NOT added — the caller checks with
 * isSameData() first, so the cap is never spent on a no-change
 * snapshot. Pure.
 */
export function addSnapshot(state: BackupState, snapshot: BackupSnapshot): BackupState {
  const snapshots = [snapshot, ...state.snapshots].slice(0, BACKUP_MAX_SNAPSHOTS);
  return { auto: state.auto, snapshots };
}

/** True when two data objects are identical (JSON compare) — the no-change skip. Pure. */
export function isSameData(a: BackupData, b: BackupData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Full-backup file: build + strict parse (same rule as the tasks backup)
// ---------------------------------------------------------------------------

export interface FullBackupFile {
  app: "hiddengem-flow";
  type: "backup";
  version: 1;
  exportedAt: string;
  data: BackupData;
}

/** Build the export file content for `data`. Pure. */
export function buildFullBackup(data: BackupData, exportedAt: string = new Date().toISOString()): FullBackupFile {
  return {
    app: BACKUP_APP,
    type: BACKUP_TYPE,
    version: BACKUP_VERSION,
    exportedAt,
    data: JSON.parse(JSON.stringify(data)) as BackupData,
  };
}

export type FullBackupParseResult = { ok: true; data: BackupData } | { ok: false; error: string };

const NOT_A_BACKUP = "That file is not a HiddenGem Flow full backup — nothing was imported.";

/**
 * Validate a parsed full-backup file. Strict on identity (the app +
 * type markers, version 1 when present, data is an object) and on
 * every entry of every collection (a task needs id/name/url, a script
 * id/name/code/matches, a note id/title/body); a file with partly
 * unusable entries is refused as a whole — restoring half a backup
 * would silently lose data, so the user fixes the file first.
 * Lenient on timestamps inside entries (they are data, not identity).
 * Pure.
 */
export function parseFullBackup(parsed: unknown): FullBackupParseResult {
  if (!isRecord(parsed)) return { ok: false, error: NOT_A_BACKUP };
  if (parsed.app !== BACKUP_APP || parsed.type !== BACKUP_TYPE) return { ok: false, error: NOT_A_BACKUP };
  if (parsed.version !== undefined && parsed.version !== BACKUP_VERSION) return { ok: false, error: NOT_A_BACKUP };
  if (!isRecord(parsed.data)) return { ok: false, error: NOT_A_BACKUP };
  const d = parsed.data;
  const checks: Array<{ key: string; raw: unknown; valid: (v: unknown) => boolean }> = [
    { key: "tasks", raw: d.tasks, valid: validTask },
    { key: "scripts", raw: d.scripts, valid: validScript },
    { key: "notes", raw: d.notes, valid: validNote },
  ];
  // v1.3: folders are optional (pre-v1.3 backups have none), but when
  // present every entry must be usable — same strict rule as the rest.
  if (d.folders !== undefined) {
    if (!Array.isArray(d.folders)) return { ok: false, error: NOT_A_BACKUP };
    const usable = d.folders.filter(validFolder).length;
    if (usable !== d.folders.length) {
      return {
        ok: false,
        error: `The backup has ${d.folders.length} folders, but only ${usable} are usable — nothing was imported. Check the file before importing.`,
      };
    }
  }
  // v1.4: Flows are optional (pre-v1.4 backups have none), but when
  // present every entry must be usable — same strict rule as the rest.
  if (d.flows !== undefined) {
    if (!Array.isArray(d.flows)) return { ok: false, error: NOT_A_BACKUP };
    const usable = d.flows.filter(validFlow).length;
    if (usable !== d.flows.length) {
      return {
        ok: false,
        error: `The backup has ${d.flows.length} flows, but only ${usable} are usable — nothing was imported. Check the file before importing.`,
      };
    }
  }
  // v1.4: routines settings are optional; when present they must
  // sanitize (sanitizeRemindersSettings never throws and always
  // returns a usable value, so presence alone is enough).
  if (d.reminders !== undefined && (typeof d.reminders !== "object" || d.reminders === null || Array.isArray(d.reminders))) {
    return { ok: false, error: NOT_A_BACKUP };
  }
  // v1.5+: sessions / userstyles / snoozes are optional (pre-v1.5+
  // backups have none), but when present every entry must be usable.
  const v15checks: Array<{ key: string; raw: unknown; valid: (v: unknown) => boolean }> = [
    { key: "sessions", raw: d.sessions, valid: validSession },
    { key: "userstyles", raw: d.userstyles, valid: validUserStyle },
    {
      key: "snoozes",
      raw: d.snoozes,
      valid: (v: unknown) => sanitizeSnoozes([v]).length === 1,
    },
  ];
  for (const c of v15checks) {
    if (c.raw === undefined) continue;
    if (!Array.isArray(c.raw)) return { ok: false, error: NOT_A_BACKUP };
    const usable = c.raw.filter(c.valid).length;
    if (usable !== c.raw.length) {
      return {
        ok: false,
        error: `The backup has ${c.raw.length} ${c.key}, but only ${usable} are usable — nothing was imported. Check the file before importing.`,
      };
    }
  }
  if (d.followedCollections !== undefined) {
    if (!Array.isArray(d.followedCollections)) return { ok: false, error: NOT_A_BACKUP };
    if (sanitizeFollowed(d.followedCollections).length !== d.followedCollections.length) {
      return { ok: false, error: "The backup has followed collections that no longer exist — nothing was imported. Check the file before importing." };
    }
  }
  if (d.smartOpen !== undefined && (typeof d.smartOpen !== "object" || d.smartOpen === null || Array.isArray(d.smartOpen))) {
    return { ok: false, error: NOT_A_BACKUP };
  }
  // Later: schedules / sync / AI settings are optional (pre-Later
  // backups have none), but when present they must be objects —
  // sanitize* never throws, so presence + object shape is enough.
  // A backup that somehow contains a token key is refused as a
  // whole: tokens must never be in a backup file, even a hand-made one.
  if (d.syncTokens !== undefined || d.aiTokens !== undefined || d.tokens !== undefined || d.storeToken !== undefined) {
    return { ok: false, error: "That backup file contains a token — tokens are never part of a backup. Nothing was imported." };
  }
  for (const key of ["schedules", "sync", "ai"] as const) {
    if (d[key] !== undefined && (typeof d[key] !== "object" || d[key] === null || Array.isArray(d[key]))) {
      return { ok: false, error: NOT_A_BACKUP };
    }
  }
  for (const c of checks) {
    if (!Array.isArray(c.raw)) return { ok: false, error: NOT_A_BACKUP };
    const usable = c.raw.filter(c.valid).length;
    if (usable !== c.raw.length) {
      return {
        ok: false,
        error: `The backup has ${c.raw.length} ${c.key}, but only ${usable} are usable — nothing was imported. Check the file before importing.`,
      };
    }
  }
  const data = sanitizeBackupData(d);
  if (!data) return { ok: false, error: NOT_A_BACKUP };
  return { ok: true, data };
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

/** Load the backup state; the default (auto ON, no snapshots) when nothing is saved. */
export async function loadBackupState(): Promise<BackupState> {
  if (!storageAvailable()) return defaultBackupState();
  try {
    const data = await chrome.storage.local.get(BACKUP_KEY);
    return sanitizeBackupState(data?.[BACKUP_KEY]);
  } catch {
    return defaultBackupState();
  }
}

/** Persist the whole backup state (replaces the stored value). */
export async function saveBackupState(state: BackupState): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [BACKUP_KEY]: sanitizeBackupState(state) });
}

/** Read the whole current local state that a snapshot covers. */
export async function collectBackupData(): Promise<BackupData> {
  const [tasks, scripts, notes, layout, mode, folders, flows, reminders, sessions, userstyles, snoozes, followedCollections, smartOpen, schedules, sync, ai] = await Promise.all([
    loadTasks(),
    loadScripts(),
    loadNotes(),
    loadFloatLayout(),
    loadWindowMode(),
    loadFolders(),
    loadFlows(),
    loadRemindersSettings(),
    loadSessions(),
    loadUserStyles(),
    loadSnoozes(),
    loadFollowedCollections(),
    loadSmartOpenSettings(),
    loadSchedules(),
    loadSyncSettings(),
    loadAiSettings(),
  ]);
  return { tasks, scripts, notes, layout, mode, folders, flows, reminders, sessions, userstyles, snoozes, followedCollections, smartOpen, schedules, sync, ai };
}

/**
 * Take a snapshot of the current state and persist it (newest first,
 * capped at 3). Returns the new snapshot, or null when the data is
 * identical to the newest snapshot — no duplicate entries. Never
 * throws (a failed write just means no snapshot this time).
 */
export async function takeSnapshot(now: number = Date.now()): Promise<BackupSnapshot | null> {
  try {
    const state = await loadBackupState();
    const data = await collectBackupData();
    const latest = state.snapshots[0];
    if (latest && isSameData(latest.data, data)) return null;
    const snapshot = createSnapshot(data, now);
    await saveBackupState(addSnapshot(state, snapshot));
    return snapshot;
  } catch {
    return null;
  }
}

/**
 * Write `data` back over the current state (all keys). Called ONLY
 * by the background restore handler, after it has saved the current
 * state as a snapshot first — callers must never write a restore
 * directly. Never throws.
 */
export async function writeBackupData(data: BackupData): Promise<void> {
  const clean = sanitizeBackupData(data);
  if (!clean) return;
  try {
    await Promise.all([
      saveTasks(clean.tasks),
      saveScripts(clean.scripts),
      saveNotes(clean.notes),
      saveFloatLayout(clean.layout),
      saveWindowMode(clean.mode),
      saveFolders(clean.folders),
      saveFlows(clean.flows),
      saveRemindersSettings(clean.reminders),
      saveSessions(clean.sessions),
      saveUserStyles(clean.userstyles),
      saveSnoozes(clean.snoozes),
      saveFollowedCollections(clean.followedCollections),
      saveSmartOpenSettings(clean.smartOpen),
      saveSchedules(clean.schedules),
      saveSyncSettings(clean.sync),
      saveAiSettings(clean.ai),
    ]);
  } catch {
    // Partial writes are possible if storage fails mid-way; the
    // snapshot-first save still holds the pre-restore state, so the
    // user can restore it again.
  }
}

/** The storage keys a snapshot covers (for the background's change listener). */
export const BACKUP_DATA_KEYS = [TASKS_KEY, SCRIPTS_KEY, NOTES_KEY, FLOAT_LAYOUT_KEY, WINDOW_MODE_KEY, FOLDERS_KEY, FLOWS_KEY, REMINDERS_KEY, SESSIONS_KEY, USERSTYLES_KEY, SNOOZE_KEY, COLLECTIONS_FOLLOW_KEY, SMART_OPEN_KEY, SCHEDULES_KEY, SYNC_KEY, AI_KEY];
// v2.0.3: the new-tab opt-in key (hiddengemflow.newtab.v1) is
// DELIBERATELY absent here — the override is removed, so the key is
// dead. A stored value from v2.0.2 stays in storage, unread, and is
// never written back by a snapshot or a restore. Same treatment as
// the tokens keys below.
// Later: the tokens keys (SYNC_TOKENS_KEY, AI_TOKENS_KEY) and the
// scheduled-run log (SCHEDULE_RUNS_KEY) are DELIBERATELY absent here:
// tokens must never be in a backup, and the run log is live run state,
// not user data. See shared/sync.ts + shared/ai-author.ts.
// v2.1.0: the Studio keys are DELIBERATELY absent too — the store
// token (STORE_TOKEN_KEY) is a token like the others, the edited
// template (STUDIO_TEMPLATE_KEY) is Studio working state, and the
// test history (STUDIO_TESTS_KEY) is live run state like the run
// log. A backup file carrying a storeToken field is refused whole
// (parseFullBackup, same rule as syncTokens/aiTokens).
