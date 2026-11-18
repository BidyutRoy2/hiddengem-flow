// HiddenGem Flow — scheduled / background scripts (Later, #13).
//
// A script the user already installed can run on a timer with NO page
// open — one schedule per script, explicit opt-in, default OFF for
// every script. Enabling a schedule needs an explicit confirm in the
// UI (the dashboard asks with window.confirm before it ever writes
// enabled:true); the background can never enable a schedule by itself.
//
// HOW A RUN ACTUALLY WORKS (honest, read this before assuming):
// chrome.userScripts only executes inside a page — there is no safe
// way to run a userscript with literally no page. A scheduled run
// therefore opens the script's @match site in a BACKGROUND tab
// (active:false), lets the already-registered script run on load
// exactly as it would on a page the user opened, waits a few seconds,
// then closes the tab. The run log says so ("Opened <host> in a
// background tab … tab closed"), so the user sees exactly what
// happened. What a scheduled run NEVER does:
//  * install anything (only scripts the user already installed run);
//  * run a script on a page the user has not granted access to — the
//    run re-validates host access at fire time (same rule as a manual
//    run, A-33/A-40), and a script without site access logs an honest
//    failure instead of running;
//  * execute code itself — no eval / new Function anywhere; the script
//    runs through the existing chrome.userScripts registration only.
// An offscreen document was evaluated and NOT used: a userscript
// cannot execute in an extension-origin offscreen document (wrong
// DOM, wrong origin, no GM shim), and injecting user code there
// would be eval-equivalent in a privileged context. The background
// tab is the only honest execution path, and it needs NO new
// permission and NO offscreen document (verified: the built manifest
// gains no permission for this feature).
//
// Alarms: one one-shot alarm per enabled schedule (`hgf-sched-<id>`),
// re-created after firing — the same pattern as v1.4 reminders, so a
// schedule is always derived from storage, never from a stale alarm.
// A run that is already in progress for the same script is skipped,
// never overlapped.
//
// Same split as shared/tasks.ts: PURE half first (no chrome APIs, no
// DOM, no hidden Date.now()), storage half after. Unit-testable in
// plain Node (see smoke-later.ts).

declare const chrome: any;

export const SCHEDULES_KEY = "hiddengemflow.schedules.v1";
/** Scheduled-run log (last 50, newest first). Live run state — NOT in backups. */
export const SCHEDULE_RUNS_KEY = "hiddengemflow.schedules.runs.v1";
export const SCHEDULE_RUNS_LIMIT = 50;

/** Ask the background to re-create all schedule alarms from storage. */
export const MSG_SCHEDULES_RESCHEDULE = "hiddengemflow:schedules-reschedule";
/** Ask the background to run one scheduled script right now (manual "Run now"). */
export const MSG_SCHEDULE_RUN_NOW = "hiddengemflow:schedule-run-now";

/** Alarm name for one script's schedule. */
export function scheduleAlarmName(scriptId: string): string {
  return `hgf-sched-${scriptId}`;
}

export interface ScheduleEntry {
  scriptId: string;
  /** Explicit opt-in. Default false; the background never sets this itself. */
  enabled: boolean;
  /** Minutes between runs. One of SCHEDULE_INTERVALS. */
  intervalMinutes: number;
}

export type ScheduleRunStatus = "ok" | "failed" | "skipped";

export interface ScheduleRunEntry {
  id: string;
  scriptId: string;
  scriptName: string;
  at: number;
  status: ScheduleRunStatus;
  /** One honest line: what happened (never contains a token or secret). */
  detail: string;
}

/** Interval choices (minutes). 1–2 min exist so a schedule can be proven live in a minute. */
export const SCHEDULE_INTERVALS = [1, 2, 5, 15, 30, 60, 180, 360, 720, 1440] as const;

export function isValidScheduleInterval(minutes: number): boolean {
  return (SCHEDULE_INTERVALS as readonly number[]).includes(minutes);
}

/** "Every 30 min" / "Every hour" / "Every 6 hours" / "Every day". Pure. */
export function formatScheduleInterval(minutes: number): string {
  if (minutes === 1) return "Every minute";
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes === 60) return "Every hour";
  if (minutes < 1440) {
    const h = minutes / 60;
    return `Every ${h} hour${h === 1 ? "" : "s"}`;
  }
  return "Every day";
}

/** The next fire time for an interval, from `now`. Pure. */
export function nextScheduleFire(intervalMinutes: number, now: number = Date.now()): number | null {
  if (!isValidScheduleInterval(intervalMinutes)) return null;
  return now + intervalMinutes * 60 * 1000;
}

/**
 * A @match pattern → a URL to open for a scheduled run. The pattern's
 * path loses its trailing `*` (and any `*` mid-path becomes nothing —
 * a scheduled run opens the site's root-ish page, never a guessed
 * deep link); a `*.host` pattern opens the bare host. Returns null
 * when the pattern cannot yield an http(s) URL. Pure.
 */
export function urlFromMatchPattern(pattern: string): string | null {
  const p = (pattern ?? "").trim();
  if (!p || p === "*" || p === "<all_urls>") return null;
  const m = p.match(/^(\*|https?):\/\/([^/]+)(\/.*)?$/i);
  if (!m) return null;
  const scheme = m[1] === "*" ? "https" : m[1].toLowerCase();
  let host = m[2];
  if (host === "*") return null;
  if (host.startsWith("*.")) host = host.slice(2);
  if (!host || host.includes("*")) return null;
  let path = m[3] ?? "/";
  // A scheduled run opens the pattern's page, not a wildcard guess:
  // cut the path at the first `*`.
  const star = path.indexOf("*");
  if (star >= 0) path = path.slice(0, star);
  if (!path) path = "/";
  // The path is used EXACTLY as the pattern spells it — no trailing
  // slash is ever appended. A slash changes the URL, and the
  // script's @match (an exact path match) would no longer match the
  // opened tab, so the script would silently never run while the log
  // claimed "ok" (audit A-55).
  try {
    const url = new URL(`${scheme}://${host}${path}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

/** One honest line for the run log: "09:00 ✓ Price watch ran — …". Pure. */
export function formatScheduleRunLine(entry: ScheduleRunEntry): string {
  const d = new Date(entry.at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const mark = entry.status === "ok" ? "✓" : entry.status === "failed" ? "⚠" : "–";
  return `${hh}:${mm} ${mark} ${entry.scriptName} — ${entry.detail}`;
}

function newScheduleRunId(): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return `schedrun-${c.randomUUID()}`;
  } catch {
    // Fall through to the timestamp fallback.
  }
  return `schedrun-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Clean a stored schedules value: a map scriptId → { enabled,
 * intervalMinutes }. Entries with an unusable id, a non-boolean
 * enabled, or an interval outside SCHEDULE_INTERVALS are dropped —
 * a hand-edited value can never schedule a run every 0 minutes.
 * Never throws; unusable input is {}. Pure.
 */
export function sanitizeSchedules(raw: unknown): Record<string, ScheduleEntry> {
  const out: Record<string, ScheduleEntry> = {};
  if (!isRecord(raw)) return out;
  for (const [scriptId, entry] of Object.entries(raw)) {
    if (typeof scriptId !== "string" || !scriptId) continue;
    if (!isRecord(entry)) continue;
    const interval = typeof entry.intervalMinutes === "number" ? entry.intervalMinutes : NaN;
    if (!isValidScheduleInterval(interval)) continue;
    out[scriptId] = {
      scriptId,
      enabled: entry.enabled === true,
      intervalMinutes: interval,
    };
  }
  return out;
}

/** The default schedules value: nothing scheduled (every script opted out). Pure. */
export function defaultSchedules(): Record<string, ScheduleEntry> {
  return {};
}

/**
 * Set (or replace) one script's schedule. `enabled:true` is only ever
 * written by the dashboard AFTER the user confirmed in the UI — this
 * function itself does not confirm anything, it only validates. An
 * interval outside the list throws (the caller shows the error).
 * Returns a new map; the input is untouched. Pure.
 */
export function setSchedule(
  schedules: Record<string, ScheduleEntry>,
  scriptId: string,
  enabled: boolean,
  intervalMinutes: number,
): Record<string, ScheduleEntry> {
  if (typeof scriptId !== "string" || !scriptId) throw new Error("Missing script id.");
  if (!isValidScheduleInterval(intervalMinutes)) {
    throw new Error(`Unknown interval — pick one of ${SCHEDULE_INTERVALS.join(", ")} minutes.`);
  }
  return { ...schedules, [scriptId]: { scriptId, enabled: enabled === true, intervalMinutes } };
}

/** Remove one script's schedule (e.g. the script was deleted). Returns a new map. Pure. */
export function removeSchedule(schedules: Record<string, ScheduleEntry>, scriptId: string): Record<string, ScheduleEntry> {
  const next = { ...schedules };
  delete next[scriptId];
  return next;
}

/** Enabled schedules only (the ones that get alarms). Pure. */
export function enabledSchedules(schedules: Record<string, ScheduleEntry>): ScheduleEntry[] {
  return Object.values(schedules).filter((s) => s.enabled === true);
}

function isScheduleRunEntry(raw: unknown): raw is ScheduleRunEntry {
  return (
    isRecord(raw) &&
    typeof raw.id === "string" &&
    typeof raw.scriptId === "string" &&
    typeof raw.scriptName === "string" &&
    typeof raw.at === "number" &&
    (raw.status === "ok" || raw.status === "failed" || raw.status === "skipped") &&
    typeof raw.detail === "string"
  );
}

/** Clean a stored run log: usable entries only, newest first, capped at 50. Pure. */
export function sanitizeScheduleRuns(raw: unknown): ScheduleRunEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries = raw.filter(isScheduleRunEntry);
  entries.sort((a, b) => b.at - a.at);
  return entries.slice(0, SCHEDULE_RUNS_LIMIT);
}

/** Build a run-log entry. `now` and `id` are parameters so tests can pin them. Pure. */
export function createScheduleRunEntry(
  scriptId: string,
  scriptName: string,
  status: ScheduleRunStatus,
  detail: string,
  now: number = Date.now(),
  id: string = newScheduleRunId(),
): ScheduleRunEntry {
  return { id, scriptId, scriptName, at: now, status, detail: detail.slice(0, 300) };
}

/** Prepend an entry and prune to the limit. Does not mutate. Pure. */
export function addScheduleRunEntry(runs: ScheduleRunEntry[], entry: ScheduleRunEntry): ScheduleRunEntry[] {
  return sanitizeScheduleRuns([entry, ...runs]);
}

// ---------------------------------------------------------------------------
// Storage wrappers (chrome.storage.local only — not part of the pure half)
// ---------------------------------------------------------------------------

function storageAvailable(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome?.storage?.local;
  } catch {
    return false;
  }
}

/** Load the schedules map; {} when nothing is saved. */
export async function loadSchedules(): Promise<Record<string, ScheduleEntry>> {
  if (!storageAvailable()) return {};
  try {
    const data = await chrome.storage.local.get(SCHEDULES_KEY);
    return sanitizeSchedules(data?.[SCHEDULES_KEY]);
  } catch {
    return {};
  }
}

/** Persist the whole schedules map (replaces the stored value). */
export async function saveSchedules(schedules: Record<string, ScheduleEntry>): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [SCHEDULES_KEY]: sanitizeSchedules(schedules) });
}

/** Load the scheduled-run log (newest first); [] when nothing is saved. */
export async function loadScheduleRuns(): Promise<ScheduleRunEntry[]> {
  if (!storageAvailable()) return [];
  try {
    const data = await chrome.storage.local.get(SCHEDULE_RUNS_KEY);
    return sanitizeScheduleRuns(data?.[SCHEDULE_RUNS_KEY]);
  } catch {
    return [];
  }
}

/** Persist the run log (pruned to the last 50 first). */
export async function saveScheduleRuns(runs: ScheduleRunEntry[]): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [SCHEDULE_RUNS_KEY]: sanitizeScheduleRuns(runs) });
}

/** Append one entry to the run log. Never throws (logging must never break a run). */
export async function logScheduleRun(entry: ScheduleRunEntry): Promise<void> {
  try {
    const runs = await loadScheduleRuns();
    await saveScheduleRuns(addScheduleRunEntry(runs, entry));
  } catch {
    // The run already happened; the log line just stays missing.
  }
}
