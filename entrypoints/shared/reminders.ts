// HiddenGem Flow — task reminders + scheduled Open All + daily nudge (v1.4, #5).
//
// Reminders ride on chrome.alarms (no install warning, minimum 1 min)
// + chrome.notifications (already held since Phase 3). One alarm per
// reminder, one alarm for the daily nudge, one for scheduled Open All,
// one per scheduled Flow, one per note due date (see shared/notes.ts).
// Every recurring alarm is a ONE-SHOT re-created after it fires, so a
// weekday-only schedule never fires on a Saturday — a repeating
// periodInMinutes alarm cannot express "weekdays only".
//
// Alarm names (all prefixed `hgf-`, validated by the background before
// anything fires — an alarm name alone never opens anything):
//   hgf-reminder-<taskId>  one task's due time
//   hgf-nudge              the daily pinned-task nudge
//   hgf-openall            scheduled Open All
//   hgf-flow-<flowId>      a scheduled Flow (see shared/flows.ts)
//   hgf-note-<noteId>      a note's due date
//
// Same split as shared/tasks.ts: PURE half first (no chrome APIs, no
// DOM, no hidden Date.now()), storage half after. Unit-testable in
// plain Node (see smoke-v14.ts).

export interface TaskReminder {
  /** "HH:MM", 24-hour clock. */
  time: string;
  /** Days of week the reminder repeats on, 0 = Sunday .. 6 = Saturday.
   *  Empty or absent = every day. */
  days?: number[];
}

/** The routines settings: daily nudge + scheduled Open All. */
export interface RemindersSettings {
  /** Daily nudge for unopened pinned tasks. Default true. */
  nudgeEnabled: boolean;
  /** Hour of day (local) the nudge fires, 0–23. Default 18. */
  nudgeHour: number;
  /** Scheduled Open All, or null when not set. */
  scheduledOpenAll: ScheduledOpenAll | null;
}

export interface ScheduledOpenAll {
  /** "HH:MM", 24-hour clock. */
  time: string;
  /** Days of week, 0 = Sunday .. 6 = Saturday. Empty = every day. */
  days: number[];
  /** Which tasks to open. */
  scope: "pinned" | "all";
}

export const REMINDERS_KEY = "hiddengemflow.reminders.v1";

/** Ask the background for the reminders status (notification level + scheduled alarms). */
export const MSG_REMINDERS_STATUS = "hiddengemflow:reminders-status";
/** Run the daily-nudge check right now (dashboard "Test nudge now" + live probe). */
export const MSG_REMINDERS_FORCE_NUDGE = "hiddengemflow:reminders-force-nudge";
/** Ask the background to re-create all routine alarms from current state. */
export const MSG_REMINDERS_RESCHEDULE = "hiddengemflow:reminders-reschedule";

export const ALARM_PREFIX = "hgf-";
export const ALARM_NUDGE = "hgf-nudge";
export const ALARM_OPEN_ALL = "hgf-openall";

export function reminderAlarmName(taskId: string): string {
  return `hgf-reminder-${taskId}`;
}
export function flowAlarmName(flowId: string): string {
  return `hgf-flow-${flowId}`;
}
export function noteAlarmName(noteId: string): string {
  return `hgf-note-${noteId}`;
}

/** Notification ids the background creates (prefix `hgf-n-`, distinct
 *  from alarm names so a click can never be mistaken for an alarm). */
export function taskNotificationId(taskId: string): string {
  return `hgf-n-task-${taskId}`;
}
export function noteNotificationId(noteId: string): string {
  return `hgf-n-note-${noteId}`;
}
export function flowNotificationId(flowId: string): string {
  return `hgf-n-flow-${flowId}`;
}
export const NUDGE_NOTIFICATION_ID = "hgf-n-nudge";

/** Day names, index 0 = Sunday. Short forms for labels. */
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Parse a "HH:MM" time. Returns { hour, minute } or null when the
 * string is not a valid 24-hour time (empty, "9:00", "24:00",
 * "09:60", non-numeric). Pure.
 */
export function parseReminderTime(raw: string): { hour: number; minute: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec((raw ?? "").trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** True when `raw` is a usable "HH:MM" reminder time. Pure. */
export function isValidReminderTime(raw: string): boolean {
  return parseReminderTime(raw) !== null;
}

/** Clean a day list: integers 0–6 only, deduped, sorted. Non-array input is []. Pure. */
export function sanitizeDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const d of raw) {
    if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6) continue;
    if (!out.includes(d)) out.push(d);
  }
  return out.sort((a, b) => a - b);
}

/** Clean a task reminder: a valid time is required, days are optional. Returns null when unusable. Pure. */
export function sanitizeReminder(raw: unknown): TaskReminder | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as { time?: unknown; days?: unknown };
  if (typeof r.time !== "string" || !isValidReminderTime(r.time)) return null;
  const days = sanitizeDays(r.days);
  return days.length > 0 ? { time: r.time, days } : { time: r.time };
}

/**
 * Describe a day list: [] → "Daily", [1..5] → "Weekdays", [0,6] →
 * "Weekends", otherwise "Mon, Wed". Pure.
 */
export function describeDays(days: number[] | undefined): string {
  const d = sanitizeDays(days);
  if (d.length === 0 || d.length === 7) return "Daily";
  if (d.length === 5 && d.every((x, i) => x === [1, 2, 3, 4, 5][i])) return "Weekdays";
  if (d.length === 2 && d[0] === 0 && d[1] === 6) return "Weekends";
  return d.map((x) => DAY_SHORT[x]).join(", ");
}

/**
 * The next time a "HH:MM" reminder fires, as a millisecond timestamp,
 * given `now`. Today when the time is still ahead, otherwise the next
 * day the reminder repeats on. Days are local days of week. Pure.
 * Returns null when the time is invalid.
 */
export function nextReminderFire(time: string, days: number[] | undefined, now: number = Date.now()): number | null {
  const parsed = parseReminderTime(time);
  if (!parsed) return null;
  const wanted = sanitizeDays(days);
  const base = new Date(now);
  for (let add = 0; add < 8; add++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + add, parsed.hour, parsed.minute, 0, 0);
    if (d.getTime() <= now) continue;
    if (wanted.length === 0 || wanted.includes(d.getDay())) return d.getTime();
  }
  return null;
}

/**
 * The next daily-nudge fire: today at `hour:00` when still ahead,
 * otherwise tomorrow at `hour:00` (local time). Pure.
 */
export function nextNudgeFire(hour: number, now: number = Date.now()): number {
  const h = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 18;
  const base = new Date(now);
  const today = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, 0, 0, 0).getTime();
  if (today > now) return today;
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, h, 0, 0, 0).getTime();
}

/**
 * The row chip for a task reminder: "Today 09:00" when the next fire
 * is today, "Tomorrow 09:00" when it is tomorrow, otherwise "Mon
 * 09:00" (the weekday of the next fire). "No reminder" when there is
 * none. Pure.
 */
export function formatReminder(reminder: TaskReminder | undefined | null, now: number = Date.now()): string {
  if (!reminder) return "No reminder";
  const next = nextReminderFire(reminder.time, reminder.days, now);
  if (next === null) return "No reminder";
  const d = new Date(next);
  const n = new Date(now);
  const dayStart = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((dayStart(d) - dayStart(n)) / 86400000);
  const hhmm = reminder.time;
  if (diffDays === 0) return `Today ${hhmm}`;
  if (diffDays === 1) return `Tomorrow ${hhmm}`;
  return `${DAY_SHORT[d.getDay()]} ${hhmm}`;
}

/** Start of today (local), as a timestamp. Pure. */
export function startOfToday(now: number = Date.now()): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export interface NudgeTask {
  id: string;
  name: string;
  pinned: boolean;
  lastOpenedAt?: number;
  completed?: boolean;
}

/**
 * Pinned tasks that still need a nudge: pinned, not completed, and
 * not opened today (never opened, or lastOpenedAt before today).
 * Sorted pinned-first order is the caller's job — this only filters.
 * Pure.
 */
export function unopenedPinnedTasks(tasks: NudgeTask[], now: number = Date.now()): NudgeTask[] {
  const today = startOfToday(now);
  return (tasks ?? []).filter(
    (t) => t.pinned && t.completed !== true && (typeof t.lastOpenedAt !== "number" || t.lastOpenedAt < today),
  );
}

/** One honest line for the nudge: "amahub is still unopened today. Open it now?" / "3 pinned tasks are still unopened today." Pure. */
export function formatNudgeMessage(tasks: NudgeTask[]): string {
  if (tasks.length === 0) return "";
  if (tasks.length === 1) return `${tasks[0].name} is still unopened today. Open it now?`;
  return `${tasks.length} pinned tasks are still unopened today. Open them now?`;
}

/** Default routines settings: nudge on at 18:00, no scheduled Open All. Pure. */
export function defaultRemindersSettings(): RemindersSettings {
  return { nudgeEnabled: true, nudgeHour: 18, scheduledOpenAll: null };
}

/** Clean a stored routines settings value. Never throws; unusable input becomes the default. Pure. */
export function sanitizeRemindersSettings(raw: unknown): RemindersSettings {
  const fallback = defaultRemindersSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const r = raw as { nudgeEnabled?: unknown; nudgeHour?: unknown; scheduledOpenAll?: unknown };
  let scheduledOpenAll: ScheduledOpenAll | null = null;
  if (r.scheduledOpenAll && typeof r.scheduledOpenAll === "object" && !Array.isArray(r.scheduledOpenAll)) {
    const s = r.scheduledOpenAll as { time?: unknown; days?: unknown; scope?: unknown };
    if (typeof s.time === "string" && isValidReminderTime(s.time)) {
      scheduledOpenAll = {
        time: s.time,
        days: sanitizeDays(s.days),
        scope: s.scope === "all" ? "all" : "pinned",
      };
    }
  }
  return {
    nudgeEnabled: r.nudgeEnabled === false ? false : true,
    nudgeHour: typeof r.nudgeHour === "number" && Number.isInteger(r.nudgeHour) && r.nudgeHour >= 0 && r.nudgeHour <= 23 ? r.nudgeHour : 18,
    scheduledOpenAll,
  };
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

/** Load the routines settings; the default when nothing is saved. */
export async function loadRemindersSettings(): Promise<RemindersSettings> {
  if (!storageAvailable()) return defaultRemindersSettings();
  try {
    const data = await chrome.storage.local.get(REMINDERS_KEY);
    return sanitizeRemindersSettings(data?.[REMINDERS_KEY]);
  } catch {
    return defaultRemindersSettings();
  }
}

/** Persist the routines settings (replaces the stored value). */
export async function saveRemindersSettings(settings: RemindersSettings): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [REMINDERS_KEY]: sanitizeRemindersSettings(settings) });
}
