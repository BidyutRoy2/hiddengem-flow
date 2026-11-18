// HiddenGem Flow — Flows: one named routine = tasks + scripts + note (v1.4, #6).
//
// A Flow bundles a set of daily-task ids, the userscript ids to run on
// the pages they open, and one note to show alongside — launched with
// one click (Run now) or on a schedule (chrome.alarms, see
// shared/reminders.ts). The schedule reuses the same "HH:MM" + days
// shape as task reminders.
//
// HARD RULES, enforced in the background (shared/flows.ts only ever
// describes data — the background decides):
//  * A Flow NEVER installs anything. Its scripts run only when already
//    installed, enabled and unarchived — and only on the pages the
//    Flow opens, through the normal chrome.userScripts registration
//    (the same engine as a manual run). A scheduled Flow firing
//    installs nothing either.
//  * A Flow's task/script/note ids are validated against storage at
//    run time; ids that no longer exist are dropped from that run
//    (and reported), never guessed at.
//  * Opening the Flow's tasks goes through the same openUrls funnel
//    as Open All, so the 50-tab cap and open-tabs tracking still apply.
//
// Same split as the other shared modules: PURE half first (no chrome
// APIs, no DOM, no hidden Date.now()), storage half after.
// Unit-testable in plain Node (see smoke-v14.ts).

import { describeDays, nextReminderFire, sanitizeDays, type TaskReminder } from "./reminders";

export const FLOWS_KEY = "hiddengemflow.flows.v1";

/** Ask the background to run a Flow (open its tasks, note which scripts match, show its note). */
export const MSG_FLOW_RUN = "hiddengemflow:flow-run";

/** Read-only omnibox diagnostic: run the background search for a query and return its matches (opens nothing). */
export const MSG_OMNIBOX_TEST = "hiddengemflow:omnibox-test";

/** At most this many Flows. */
export const MAX_FLOWS = 50;
/** A Flow name is at most this many characters. */
export const MAX_FLOW_NAME_LENGTH = 60;
/** A Flow description is at most this many characters. */
export const MAX_FLOW_DESC_LENGTH = 200;
/** A Flow holds at most this many tasks and this many scripts. */
export const MAX_FLOW_TASKS = 50;
export const MAX_FLOW_SCRIPTS = 20;

export interface FlowSchedule {
  /** "HH:MM", 24-hour clock. */
  time: string;
  /** Days of week, 0 = Sunday .. 6 = Saturday. Empty = every day. */
  days: number[];
}

export interface FlowLastRun {
  at: number;
  /** Tabs actually opened. */
  opened: number;
  /** Names of scripts that matched an opened page. */
  scriptNames: string[];
  /** Title of the note shown with the run, or null. */
  noteTitle: string | null;
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  taskIds: string[];
  scriptIds: string[];
  /** The note shown with the run, or null. */
  noteId: string | null;
  /** Schedule, or null when the Flow only runs by hand. */
  schedule: FlowSchedule | null;
  lastRun: FlowLastRun | null;
  createdAt: number;
  updatedAt: number;
}

function newFlowId(): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // Fall through to the timestamp fallback.
  }
  return `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Clean a Flow name: trimmed, 1–60 chars. Throws on an empty name. Pure. */
export function cleanFlowName(name: string): string {
  const clean = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!clean) throw new Error("Give the flow a name.");
  if (clean.length > MAX_FLOW_NAME_LENGTH) throw new Error(`Flow names are at most ${MAX_FLOW_NAME_LENGTH} characters.`);
  return clean;
}

/** Clean a Flow description: trimmed, at most 200 chars. Pure. */
export function cleanFlowDescription(desc: string): string {
  return String(desc ?? "").trim().slice(0, MAX_FLOW_DESC_LENGTH);
}

/** Clean an id list: non-empty strings only, deduped, capped. Pure. */
export function cleanIdList(raw: unknown, cap: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id !== "string" || !id) continue;
    if (!out.includes(id)) out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

/** Clean a Flow schedule: a valid "HH:MM" is required. Returns null when unusable. Pure. */
export function sanitizeFlowSchedule(raw: unknown): FlowSchedule | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.time !== "string") return null;
  const reminder: TaskReminder = { time: raw.time, days: sanitizeDays(raw.days) };
  const next = nextReminderFire(reminder.time, reminder.days, Date.now());
  if (next === null) return null;
  return { time: reminder.time, days: sanitizeDays(raw.days) };
}

/** The schedule chip: "Weekdays 09:00", "Daily 21:00", "Mon, Wed 09:00", or "Not scheduled". Pure. */
export function describeSchedule(schedule: FlowSchedule | null): string {
  if (!schedule) return "Not scheduled";
  return `${describeDays(schedule.days)} ${schedule.time}`;
}

/** The next time a Flow's schedule fires, or null when unscheduled / invalid. Pure. */
export function nextFlowFire(schedule: FlowSchedule | null, now: number = Date.now()): number | null {
  if (!schedule) return null;
  return nextReminderFire(schedule.time, schedule.days, now);
}

/**
 * Create a Flow. Throws on an empty name or when it has no tasks at
 * all (a routine with nothing to open is not a routine). Script and
 * note ids are kept as given — they are validated against storage at
 * run time, not at creation (a script installed later still counts).
 * `now` and `id` are parameters so tests can pin them. Pure.
 */
export function createFlow(
  name: string,
  description: string,
  taskIds: unknown,
  scriptIds: unknown,
  noteId: string | null,
  schedule: FlowSchedule | null,
  now: number = Date.now(),
  id: string = newFlowId(),
): Flow {
  const cleanName = cleanFlowName(name);
  const tasks = cleanIdList(taskIds, MAX_FLOW_TASKS);
  if (tasks.length === 0) throw new Error("A flow needs at least one task — pick the sites it opens.");
  return {
    id,
    name: cleanName,
    description: cleanFlowDescription(description),
    taskIds: tasks,
    scriptIds: cleanIdList(scriptIds, MAX_FLOW_SCRIPTS),
    noteId: typeof noteId === "string" && noteId ? noteId : null,
    schedule: schedule && sanitizeFlowSchedule(schedule) ? sanitizeFlowSchedule(schedule) : null,
    lastRun: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update a Flow's fields. Only the fields present in `patch` change;
 * `updatedAt` is stamped to `now` on every update. Unknown id → the
 * array is returned unchanged. Throws on an empty name or on an
 * update that would leave the Flow with no tasks. Returns a new array.
 * Pure.
 */
export function updateFlow(
  flows: Flow[],
  id: string,
  patch: { name?: string; description?: string; taskIds?: unknown; scriptIds?: unknown; noteId?: string | null; schedule?: FlowSchedule | null },
  now: number = Date.now(),
): Flow[] {
  return flows.map((f) => {
    if (f.id !== id) return f;
    let nextName = f.name;
    if (patch.name !== undefined) nextName = cleanFlowName(patch.name);
    let nextTaskIds = f.taskIds;
    if (patch.taskIds !== undefined) {
      nextTaskIds = cleanIdList(patch.taskIds, MAX_FLOW_TASKS);
      if (nextTaskIds.length === 0) throw new Error("A flow needs at least one task — pick the sites it opens.");
    }
    return {
      ...f,
      name: nextName,
      ...(patch.description !== undefined ? { description: cleanFlowDescription(patch.description) } : {}),
      taskIds: nextTaskIds,
      ...(patch.scriptIds !== undefined ? { scriptIds: cleanIdList(patch.scriptIds, MAX_FLOW_SCRIPTS) } : {}),
      ...(patch.noteId !== undefined ? { noteId: typeof patch.noteId === "string" && patch.noteId ? patch.noteId : null } : {}),
      ...(patch.schedule !== undefined ? { schedule: patch.schedule ? sanitizeFlowSchedule(patch.schedule) : null } : {}),
      updatedAt: now,
    };
  });
}

/** Remove a Flow by id. Returns a new array. Pure. */
export function deleteFlow(flows: Flow[], id: string): Flow[] {
  return flows.filter((f) => f.id !== id);
}

/** A Flow record is usable when it has a string id, a non-empty name and at least one task id. Pure. */
export function validFlow(raw: unknown): raw is Flow {
  return (
    isRecord(raw) &&
    typeof raw.id === "string" &&
    !!raw.id &&
    typeof raw.name === "string" &&
    !!raw.name.trim() &&
    Array.isArray(raw.taskIds) &&
    raw.taskIds.length > 0
  );
}

/** Clean a stored Flow list: keep only usable Flows, dedupe ids, cap at 50. Never throws. Pure. */
export function sanitizeFlows(raw: unknown): Flow[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Flow[] = [];
  for (const entry of raw) {
    if (!validFlow(entry)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const createdAt = typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt) ? entry.createdAt : 0;
    const updatedAt = typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt) ? entry.updatedAt : createdAt;
    out.push({
      id: entry.id,
      name: String(entry.name).trim().slice(0, MAX_FLOW_NAME_LENGTH),
      description: typeof entry.description === "string" ? entry.description.slice(0, MAX_FLOW_DESC_LENGTH) : "",
      taskIds: cleanIdList(entry.taskIds, MAX_FLOW_TASKS),
      scriptIds: cleanIdList(entry.scriptIds, MAX_FLOW_SCRIPTS),
      noteId: typeof entry.noteId === "string" && entry.noteId ? entry.noteId : null,
      schedule: sanitizeFlowSchedule(entry.schedule),
      lastRun: isRecord(entry.lastRun) && typeof entry.lastRun.at === "number" ? (entry.lastRun as FlowLastRun) : null,
      createdAt,
      updatedAt,
    });
    if (out.length >= MAX_FLOWS) break;
  }
  return out;
}

/**
 * Split a Flow's ids into the ones that still exist and the ones that
 * do not — the background drops the missing ones from a run (and
 * reports them) instead of guessing. Pure.
 */
export function resolveFlowRefs(
  flow: Flow,
  taskIds: string[],
  scriptIds: string[],
  noteIds: string[],
): { taskIds: string[]; missingTaskIds: string[]; scriptIds: string[]; missingScriptIds: string[]; noteId: string | null; noteMissing: boolean } {
  const taskSet = new Set(taskIds);
  const scriptSet = new Set(scriptIds);
  const noteSet = new Set(noteIds);
  return {
    taskIds: flow.taskIds.filter((id) => taskSet.has(id)),
    missingTaskIds: flow.taskIds.filter((id) => !taskSet.has(id)),
    scriptIds: flow.scriptIds.filter((id) => scriptSet.has(id)),
    missingScriptIds: flow.scriptIds.filter((id) => !scriptSet.has(id)),
    noteId: flow.noteId && noteSet.has(flow.noteId) ? flow.noteId : null,
    noteMissing: !!flow.noteId && !noteSet.has(flow.noteId),
  };
}

/** Newest first (updatedAt desc). Does not mutate. Pure. */
export function sortFlows(flows: Flow[]): Flow[] {
  return [...flows].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** One honest line for a run result. Pure. */
export function formatFlowRunResult(run: { opened: number; skipped: number; scriptNames: string[]; skippedScripts: number; noAccessNames?: string[]; noteTitle: string | null }): string {
  const parts: string[] = [`Opened ${run.opened} tab${run.opened === 1 ? "" : "s"}.`];
  if (run.skipped > 0) parts.push(`${run.skipped} skipped (50 open at a time).`);
  if (run.scriptNames.length > 0) parts.push(`${run.scriptNames.length} script${run.scriptNames.length === 1 ? "" : "s"} running on the opened pages (${run.scriptNames.join(", ")}).`);
  if (run.skippedScripts > 0) parts.push(`${run.skippedScripts} script${run.skippedScripts === 1 ? "" : "s"} skipped — not installed, disabled, or matching no opened page.`);
  if ((run.noAccessNames ?? []).length > 0) parts.push(`${run.noAccessNames!.length} script${run.noAccessNames!.length === 1 ? "" : "s"} match${run.noAccessNames!.length === 1 ? "es" : ""} the opened pages but ${run.noAccessNames!.length === 1 ? "has" : "have"} no site access — grant it from the Scripts tab (${run.noAccessNames!.join(", ")}).`);
  if (run.noteTitle) parts.push(`Note: ${run.noteTitle}.`);
  return parts.join(" ");
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

/** Load all saved Flows; [] when nothing is saved or storage is unavailable. */
export async function loadFlows(): Promise<Flow[]> {
  if (!storageAvailable()) return [];
  try {
    const data = await chrome.storage.local.get(FLOWS_KEY);
    return sanitizeFlows(data?.[FLOWS_KEY]);
  } catch {
    return [];
  }
}

/** Persist the whole Flow list (replaces the stored value). */
export async function saveFlows(flows: Flow[]): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [FLOWS_KEY]: sanitizeFlows(flows) });
}
