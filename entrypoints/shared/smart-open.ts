// HiddenGem Flow — Smart Open All (v1.5+, #15).
//
// Open All, but smart: check which tabs are already open (skip
// duplicates — by normalized URL), open the rest into a named tab
// group, offer "only the ones you missed" on repeat, and suspend
// (discard, never close) unviewed tabs after N minutes.
//
// Tab grouping uses the OPTIONAL `tabGroups` permission: it is
// requested at first use of grouping (never required in the
// manifest). When the user denies it, grouping degrades honestly to
// plain tabs and the result says so.
//
// Same split as shared/tasks.ts: PURE half first, storage half
// after. The suspend-pending list lives in chrome.storage.session
// (tabIds die with the session — it is deliberately NOT backed up).

import { normalizeUrl } from "./tasks";

export const SMART_OPEN_KEY = "hiddengemflow.smartopen.v1";
/** Pending suspend list (session-only): tabId → when it may be discarded. */
export const SMART_OPEN_PENDING_KEY = "hiddengemflow.smartopen.pending.v1";
/** Ask the background to run a smart Open All. */
export const MSG_SMART_OPEN = "hiddengemflow:smart-open";
/** One-shot alarm that discards unviewed smart-opened tabs. */
export const ALARM_SMART_SUSPEND = "hgf-smart-suspend";

export interface SmartOpenSettings {
  /** Group newly opened tabs into a named tab group. Default true. */
  groupEnabled: boolean;
  /** Group title. Default "Morning Flow". */
  groupName: string;
  /** Suspend (discard) unviewed tabs after this many minutes. 0 = never. Default 30. */
  suspendMinutes: number;
}

export interface SmartOpenPending {
  tabId: number;
  openedAt: number;
  suspendAt: number;
  /** True once the user has viewed the tab — viewed tabs are never suspended. */
  viewed?: boolean;
}

export function defaultSmartOpenSettings(): SmartOpenSettings {
  return { groupEnabled: true, groupName: "Morning Flow", suspendMinutes: 30 };
}

export function sanitizeSmartOpenSettings(raw: unknown): SmartOpenSettings {
  const fallback = defaultSmartOpenSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const r = raw as Record<string, unknown>;
  const groupName = typeof r.groupName === "string" && r.groupName.trim() ? r.groupName.trim().slice(0, 60) : fallback.groupName;
  const suspend = typeof r.suspendMinutes === "number" && Number.isFinite(r.suspendMinutes) ? Math.max(0, Math.min(240, Math.round(r.suspendMinutes))) : fallback.suspendMinutes;
  return { groupEnabled: r.groupEnabled !== false, groupName, suspendMinutes: suspend };
}

/**
 * Plan a smart open: which task URLs are already open (skip),
 * which still need opening, and — for the "missed only" repeat —
 * which tasks were not opened today. Pure.
 *
 * `openUrls` are the URLs of currently open tabs; `taskUrls` are
 * the candidate task URLs (already normalized by the caller where
 * possible — this function normalizes both sides anyway).
 * `lastOpenedAt` maps normalized task URL → last-opened timestamp.
 */
export function planSmartOpen(
  taskUrls: string[],
  openUrls: string[],
  lastOpenedAt: Record<string, number | undefined> = {},
  now: number = Date.now(),
): { alreadyOpen: string[]; toOpen: string[]; missed: string[] } {
  const openNorm = new Set<string>();
  for (const u of openUrls) {
    const n = normalizeUrl(u);
    if (n) openNorm.add(n);
  }
  const alreadyOpen: string[] = [];
  const toOpen: string[] = [];
  const seen = new Set<string>();
  for (const raw of taskUrls) {
    const n = normalizeUrl(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    if (openNorm.has(n)) alreadyOpen.push(n);
    else toOpen.push(n);
  }
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const missed = toOpen.filter((n) => {
    const last = lastOpenedAt[n];
    return typeof last !== "number" || last < dayStart.getTime();
  });
  return { alreadyOpen, toOpen, missed };
}

/** One honest line for the smart-open result. Pure. */
export function formatSmartOpenResult(result: {
  opened: number;
  skipped: number;
  grouped: boolean;
  groupName?: string;
  groupDenied?: boolean;
  suspendMinutes?: number;
}): string {
  const parts: string[] = [];
  if (result.opened > 0) {
    parts.push(
      `Opened ${result.opened} tab${result.opened === 1 ? "" : "s"}` +
        (result.grouped && result.groupName ? ` into the “${result.groupName}” group` : ""),
    );
  } else {
    parts.push("Nothing new to open");
  }
  if (result.skipped > 0) parts.push(`${result.skipped} already open — skipped`);
  if (result.groupDenied) parts.push("tab grouping was declined, so the tabs opened ungrouped");
  if (result.opened > 0 && typeof result.suspendMinutes === "number" && result.suspendMinutes > 0) {
    parts.push(`unviewed tabs suspend after ${result.suspendMinutes} min`);
  }
  return parts.join(" · ") + ".";
}

/** Pending entries that are due for discard now (and not yet viewed). Pure. */
export function duePendingTabs(pending: SmartOpenPending[], now: number = Date.now()): SmartOpenPending[] {
  return pending.filter((p) => p.viewed !== true && typeof p.suspendAt === "number" && p.suspendAt <= now);
}

export function sanitizePending(raw: unknown): SmartOpenPending[] {
  if (!Array.isArray(raw)) return [];
  const out: SmartOpenPending[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.tabId !== "number" || typeof e.openedAt !== "number" || typeof e.suspendAt !== "number") continue;
    out.push({ tabId: e.tabId, openedAt: e.openedAt, suspendAt: e.suspendAt, ...(e.viewed === true ? { viewed: true } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Storage wrappers
// ---------------------------------------------------------------------------

declare const chrome: any;

export async function loadSmartOpenSettings(): Promise<SmartOpenSettings> {
  try {
    if (typeof chrome === "undefined" || !chrome?.storage?.local) return defaultSmartOpenSettings();
    const data = await chrome.storage.local.get(SMART_OPEN_KEY);
    return sanitizeSmartOpenSettings(data?.[SMART_OPEN_KEY]);
  } catch {
    return defaultSmartOpenSettings();
  }
}

export async function saveSmartOpenSettings(settings: SmartOpenSettings): Promise<void> {
  try {
    if (typeof chrome === "undefined" || !chrome?.storage?.local) return;
    await chrome.storage.local.set({ [SMART_OPEN_KEY]: sanitizeSmartOpenSettings(settings) });
  } catch {
    // Non-fatal: the setting just doesn't persist.
  }
}

/** Session-only pending list (chrome.storage.session — tabIds die with the session). */
export async function loadSmartOpenPending(): Promise<SmartOpenPending[]> {
  try {
    if (typeof chrome === "undefined" || !chrome?.storage?.session) return [];
    const data = await chrome.storage.session.get(SMART_OPEN_PENDING_KEY);
    return sanitizePending(data?.[SMART_OPEN_PENDING_KEY]);
  } catch {
    return [];
  }
}

export async function saveSmartOpenPending(pending: SmartOpenPending[]): Promise<void> {
  try {
    if (typeof chrome === "undefined" || !chrome?.storage?.session) return;
    await chrome.storage.session.set({ [SMART_OPEN_PENDING_KEY]: sanitizePending(pending) });
  } catch {
    // Non-fatal.
  }
}
