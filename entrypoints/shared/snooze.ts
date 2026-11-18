// HiddenGem Flow — Snooze queue (v1.5+, #21).
//
// Snooze a task to tomorrow / this evening (or in 1 minute, for a
// quick check). LOCAL list only — the Chrome Reading List API is
// deliberately NOT used (it would add a "Read and change entries in
// the reading list" warning for something a local list does better).
//
// A snoozed task leaves the main list (the dashboard filters it out
// until its return time) and returns at its time via the existing
// alarms system: one one-shot alarm per snooze (`hgf-snooze-<id>`),
// re-created by rescheduleAlarms() on every change. A snooze alarm
// NEVER opens anything by itself — it only removes the snooze entry
// and notifies; the task simply reappears in the list.

export const SNOOZE_KEY = "hiddengemflow.snoozes.v1";

export function snoozeAlarmName(taskId: string): string {
  return `hgf-snooze-${taskId}`;
}

export function snoozeNotificationId(taskId: string): string {
  return `hgf-n-snooze-${taskId}`;
}

export interface Snooze {
  taskId: string;
  snoozedAt: number;
  returnAt: number;
  label: string;
}

export type SnoozeTarget = "tomorrow-0900" | "this-evening" | "in-1-minute";

/** Compute the return time for a snooze target. Pure. */
export function snoozeReturnAt(target: SnoozeTarget, now: number = Date.now()): { returnAt: number; label: string } {
  const d = new Date(now);
  if (target === "in-1-minute") {
    return { returnAt: now + 60 * 1000, label: "in 1 minute" };
  }
  if (target === "this-evening") {
    const evening = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 0, 0);
    // After 18:00, "this evening" is already past — it means tomorrow evening.
    if (evening.getTime() <= now) evening.setDate(evening.getDate() + 1);
    return { returnAt: evening.getTime(), label: "this evening (18:00)" };
  }
  const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 0, 0);
  return { returnAt: tomorrow.getTime(), label: "tomorrow 09:00" };
}

/** Create (or replace) a snooze for a task. Pure. */
export function createSnooze(taskId: string, target: SnoozeTarget, now: number = Date.now()): Snooze | null {
  if (typeof taskId !== "string" || !taskId) return null;
  const { returnAt, label } = snoozeReturnAt(target, now);
  return { taskId, snoozedAt: now, returnAt, label };
}

/** Add/replace a snooze in the list. Pure. */
export function addSnooze(snoozes: Snooze[], snooze: Snooze): Snooze[] {
  return [...snoozes.filter((s) => s.taskId !== snooze.taskId), snooze];
}

/** Remove a snooze (task returned, or user unsnoozed). Pure. */
export function removeSnooze(snoozes: Snooze[], taskId: string): Snooze[] {
  return snoozes.filter((s) => s.taskId !== taskId);
}

/** Is this task snoozed right now (return time still in the future)? Pure. */
export function isSnoozed(snoozes: Snooze[], taskId: string, now: number = Date.now()): boolean {
  const s = snoozes.find((x) => x.taskId === taskId);
  return !!s && s.returnAt > now;
}

/** Filter snoozed tasks OUT of a task list (the main list). Pure. */
export function visibleTasks<T extends { id: string }>(tasks: T[], snoozes: Snooze[], now: number = Date.now()): T[] {
  return tasks.filter((t) => !isSnoozed(snoozes, t.id, now));
}

/** Snoozes whose return time has passed (due to return). Pure. */
export function dueSnoozes(snoozes: Snooze[], now: number = Date.now()): Snooze[] {
  return snoozes.filter((s) => s.returnAt <= now);
}

/** "Snoozed → Tomorrow 09:00" — the queue row line. Pure. */
export function formatSnooze(snooze: Snooze): string {
  return `Snoozed → ${snooze.label}`;
}

export function sanitizeSnoozes(raw: unknown): Snooze[] {
  if (!Array.isArray(raw)) return [];
  const out: Snooze[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.taskId !== "string" || !e.taskId) continue;
    if (typeof e.snoozedAt !== "number" || typeof e.returnAt !== "number") continue;
    if (typeof e.label !== "string" || !e.label) continue;
    out.push({ taskId: e.taskId, snoozedAt: e.snoozedAt, returnAt: e.returnAt, label: e.label.slice(0, 60) });
  }
  return out;
}

declare const chrome: any;

export async function loadSnoozes(): Promise<Snooze[]> {
  try {
    if (typeof chrome === "undefined" || !chrome?.storage?.local) return [];
    const data = await chrome.storage.local.get(SNOOZE_KEY);
    return sanitizeSnoozes(data?.[SNOOZE_KEY]);
  } catch {
    return [];
  }
}

export async function saveSnoozes(snoozes: Snooze[]): Promise<void> {
  try {
    if (typeof chrome === "undefined" || !chrome?.storage?.local) return;
    await chrome.storage.local.set({ [SNOOZE_KEY]: sanitizeSnoozes(snoozes) });
  } catch {
    // Non-fatal.
  }
}
