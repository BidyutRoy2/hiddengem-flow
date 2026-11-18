// HiddenGem Flow — open-tabs tracking (v1.2.1).
//
// When a Daily Task site is opened FROM the extension (task-row click,
// Open selected, Open All), the background records the opened tabId
// against that taskId. Every surface (floating window, side panel,
// popup, dashboard) then shows a green "● Open" badge + a red-outline
// "✕ Close" button on that task's row: the badge focuses the tab, the
// Close button closes exactly those tabs, by tabId.
//
// Same split as shared/tasks.ts:
//  * PURE half (up to the "Storage" section): no `chrome` APIs, no DOM,
//    no Date.now() — all inputs are parameters. Unit-testable in plain
//    Node (see smoke-open-tabs.ts).
//  * Storage half: thin wrappers around chrome.storage.session. Only
//    the background, the dashboard and the float-page surfaces import
//    these — a content script (the in-page floating window) CANNOT use
//    chrome.storage.session, so it reads the map through the background
//    (MSG_OPEN_TABS_GET) and gets live updates fanned out as
//    MSG_OPEN_TABS_CHANGED messages (same pattern as MSG_CLOSE_FLOATS).
//
// SESSION-ONLY, by design: tabIds die with the browser session, so the
// map lives in chrome.storage.session (cleared when the browser closes;
// the background also clears it explicitly on startup as a safety net).
// It is deliberately NOT in BACKUP_DATA_KEYS — a snapshot must never
// carry tabIds, and a restore must never resurrect them.
//
// SITE MATCHING: a tracked tab keeps its badge only while it is still
// on the task's SITE (same hostname, www. stripped, http/https treated
// the same — a redirect must not drop the badge). Navigating to another
// host untracks the tab. The background checks this on tabs.onUpdated
// and when reconciling (task deleted / URL edited / startup).

export const OPEN_TABS_KEY = "hiddengemflow.tasks.open.v1";

/** Ask the background for the current open-tabs map. */
export const MSG_OPEN_TABS_GET = "hiddengemflow:open-tabs-get";
/** Fanned out by the background after every map change (content-script floats). Carries the new map. */
export const MSG_OPEN_TABS_CHANGED = "hiddengemflow:open-tabs-changed";
/** Ask the background to focus a task's most recently opened tab. */
export const MSG_OPEN_TABS_FOCUS = "hiddengemflow:open-tabs-focus";
/** Ask the background to close every tab tracked for a task. */
export const MSG_OPEN_TABS_CLOSE = "hiddengemflow:open-tabs-close";

/** taskId → tabIds, in the order the tabs were opened (most recent last). */
export type OpenTabsMap = Record<string, number[]>;

/** Max tabs tracked for one task — the same cap as opening at once (50). Older tabs are dropped first. */
export const OPEN_TABS_PER_TASK_MAX = 50;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Hostname for site matching: lowercased, one leading "www." stripped. Null when the URL is not http(s) or has no usable host. */
export function siteHost(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Only http(s) pages are real sites. A chrome://, about: or file:
  // URL must never match a task — a tracked tab that navigates to one
  // loses its badge. (Without this, "chrome://extensions/" parses to
  // the host "extensions" and could match a task on that bare host.)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  let host = parsed.hostname;
  if (!host) return null;
  host = host.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  return host || null;
}

/**
 * True when both URLs are on the same site (same hostname after the
 * www. strip; http vs https does not matter — a redirect keeps the
 * badge). False when either URL is unusable or has no host. Pure.
 */
export function sameSite(a: string, b: string): boolean {
  const ha = siteHost(a);
  const hb = siteHost(b);
  if (!ha || !hb) return false;
  return ha === hb;
}

/**
 * Sanitize a stored map: keys must be non-empty strings, values arrays
 * of positive integer tabIds (deduped, capped at OPEN_TABS_PER_TASK_MAX
 * — oldest dropped first), empty entries dropped. Anything else → {}.
 * Pure.
 */
export function sanitizeOpenTabsMap(raw: unknown): OpenTabsMap {
  const out: OpenTabsMap = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [taskId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof taskId !== "string" || !taskId) continue;
    if (!Array.isArray(value)) continue;
    const ids: number[] = [];
    for (const v of value) {
      if (typeof v === "number" && Number.isInteger(v) && v > 0 && !ids.includes(v)) ids.push(v);
    }
    const kept = ids.slice(-OPEN_TABS_PER_TASK_MAX);
    if (kept.length > 0) out[taskId] = kept;
  }
  return out;
}

/** How many tabs are tracked for one task (0 when none). Pure. */
export function openTabsCount(map: OpenTabsMap, taskId: string): number {
  if (!map || typeof taskId !== "string") return 0;
  const ids = map[taskId];
  return Array.isArray(ids) ? ids.length : 0;
}

/** Total tracked tabs across all tasks. Pure. */
export function openTabsTotal(map: OpenTabsMap): number {
  if (!map || typeof map !== "object") return 0;
  let total = 0;
  for (const ids of Object.values(map)) {
    if (Array.isArray(ids)) total += ids.length;
  }
  return total;
}

/**
 * Record a tabId for a task. Returns a NEW map; the input is untouched.
 * The tabId moves to the end when re-tracked (most recent last). Pure.
 */
export function trackOpenTab(map: OpenTabsMap, taskId: string, tabId: number): OpenTabsMap {
  const clean = sanitizeOpenTabsMap(map);
  if (typeof taskId !== "string" || !taskId) return clean;
  if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId <= 0) return clean;
  const ids = (clean[taskId] ?? []).filter((id) => id !== tabId);
  ids.push(tabId);
  clean[taskId] = ids.slice(-OPEN_TABS_PER_TASK_MAX);
  return clean;
}

/**
 * Remove a tabId from every task it is tracked under. Returns
 * { map, changed } — the map is a new object only when something was
 * removed. Pure.
 */
export function untrackTabId(map: OpenTabsMap, tabId: number): { map: OpenTabsMap; changed: boolean } {
  const clean = sanitizeOpenTabsMap(map);
  if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId <= 0) return { map: clean, changed: false };
  let changed = false;
  for (const taskId of Object.keys(clean)) {
    const before = clean[taskId];
    const after = before.filter((id) => id !== tabId);
    if (after.length !== before.length) {
      changed = true;
      if (after.length === 0) delete clean[taskId];
      else clean[taskId] = after;
    }
  }
  return { map: clean, changed };
}

/**
 * Drop all tracking for one task (task deleted). Returns { map, changed }.
 * The tabs themselves are NOT closed — only the tracking is dropped. Pure.
 */
export function untrackTask(map: OpenTabsMap, taskId: string): { map: OpenTabsMap; changed: boolean } {
  const clean = sanitizeOpenTabsMap(map);
  if (typeof taskId !== "string" || !(taskId in clean)) return { map: clean, changed: false };
  delete clean[taskId];
  return { map: clean, changed: true };
}

/** Badge text for a count: "● Open" or "● Open ×2". Pure. */
export function openBadgeLabel(count: number): string {
  if (typeof count !== "number" || count <= 0) return "● Open";
  return count === 1 ? "● Open" : `● Open ×${count}`;
}

// ---------------------------------------------------------------------------
// Session storage wrappers (extension contexts only — background,
// dashboard, float-page). A content script must NOT call these:
// chrome.storage.session is unavailable there; the in-page float reads
// the map through MSG_OPEN_TABS_GET instead.
// ---------------------------------------------------------------------------

declare const chrome: any;

function sessionAvailable(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome?.storage?.session;
  } catch {
    return false;
  }
}

/** Load the current map; {} when nothing is tracked or storage is unavailable. */
export async function loadOpenTabs(): Promise<OpenTabsMap> {
  if (!sessionAvailable()) return {};
  try {
    const data = await chrome.storage.session.get(OPEN_TABS_KEY);
    return sanitizeOpenTabsMap(data?.[OPEN_TABS_KEY]);
  } catch {
    return {};
  }
}

/** Persist the whole map (replaces the stored value). */
export async function saveOpenTabs(map: OpenTabsMap): Promise<void> {
  if (!sessionAvailable()) return;
  await chrome.storage.session.set({ [OPEN_TABS_KEY]: sanitizeOpenTabsMap(map) });
}

/** Clear all tracking (browser startup safety net). */
export async function clearOpenTabs(): Promise<void> {
  if (!sessionAvailable()) return;
  try {
    await chrome.storage.session.remove(OPEN_TABS_KEY);
  } catch {
    // Non-fatal: a stale map is healed by reconcile + tab tolerance.
  }
}

// ---------------------------------------------------------------------------
// Message helpers — usable from ANY surface, including the content-script
// float (runtime.sendMessage works there). All never throw.
// ---------------------------------------------------------------------------

/** Ask the background for the current map. {} when the background does not answer. */
export async function requestOpenTabs(): Promise<OpenTabsMap> {
  try {
    const res = await chrome.runtime.sendMessage({ type: MSG_OPEN_TABS_GET });
    if (!res?.ok) return {};
    return sanitizeOpenTabsMap(res.map);
  } catch {
    return {};
  }
}

/** Ask the background to focus a task's most recently opened tab. */
export async function focusOpenTaskTabs(taskId: string): Promise<{ ok: boolean; focusedTabId?: number; error?: string }> {
  try {
    const res = await chrome.runtime.sendMessage({ type: MSG_OPEN_TABS_FOCUS, taskId });
    if (!res?.ok) return { ok: false, error: typeof res?.error === "string" ? res.error : "The background did not answer." };
    return { ok: true, focusedTabId: typeof res.focusedTabId === "number" ? res.focusedTabId : undefined };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}

/** Ask the background to close every tab tracked for a task. */
export async function closeOpenTaskTabs(taskId: string): Promise<{ ok: boolean; closed?: number; error?: string }> {
  try {
    const res = await chrome.runtime.sendMessage({ type: MSG_OPEN_TABS_CLOSE, taskId });
    if (!res?.ok) return { ok: false, error: typeof res?.error === "string" ? res.error : "The background did not answer." };
    return { ok: true, closed: typeof res.closed === "number" ? res.closed : 0 };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}

// ---------------------------------------------------------------------------
// Row UI helpers — ONE rendering for the badge + close button, used by
// the float-page surfaces, the in-page float and the dashboard. The
// caller wires the clicks to focusOpenTaskTabs / closeOpenTaskTabs (or
// its own re-render after them). All text is set with textContent
// (AUDIT A-01 rule); the count is a number, never user text.
// ---------------------------------------------------------------------------

/** The green "● Open" / "● Open ×N" badge. Clicking it focuses the tab (onFocus). */
export function createOpenBadge(count: number, onFocus: () => void): HTMLButtonElement {
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "open-badge";
  badge.textContent = openBadgeLabel(count);
  badge.title = "Focus the open tab";
  badge.setAttribute("aria-label", "Focus the open tab");
  badge.addEventListener("click", (e) => {
    e.stopPropagation();
    onFocus();
  });
  return badge;
}

/** The red-outline "✕ Close" button. Clicking it closes the task's tracked tab(s) (onClose). */
export function createCloseOpenTabsButton(onClose: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "close-btn";
  btn.textContent = "✕ Close";
  btn.title = "Close the open tab(s) for this task";
  btn.setAttribute("aria-label", "Close the open tabs for this task");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClose();
  });
  return btn;
}
