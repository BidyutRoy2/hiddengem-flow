// HiddenGem Flow — Sessions / workspaces (v1.5+, #14).
//
// Save the currently open tabs as a named session (URLs + titles +
// tab-group name where one exists), restore into a NEW window, and
// auto-save the last closed window as a "Last session" entry.
// Restoring NEVER closes the user's existing tabs — the restore
// always opens a new window; the background enforces that (see
// background.ts restoreSession).
//
// Same split as shared/tasks.ts: PURE half first (no chrome APIs, no
// DOM, no hidden Date.now()), storage half after. Unit-testable in
// plain Node (see smoke-v15.ts).
//
// Storage: chrome.storage.local, key hiddengemflow.sessions.v1 —
// sessions ARE user data, so they go IN backups (BACKUP_DATA_KEYS).

export const SESSIONS_KEY = "hiddengemflow.sessions.v1";
/** Ask the background to save the current window as a named session. */
export const MSG_SESSION_SAVE = "hiddengemflow:session-save";
/** Ask the background to restore a session into a new window. */
export const MSG_SESSION_RESTORE = "hiddengemflow:session-restore";
/** Ask the background to delete a session. */
export const MSG_SESSION_DELETE = "hiddengemflow:session-delete";
/** Max sessions kept (the auto "Last session" entry does not count extra — it replaces the previous auto one). */
export const SESSIONS_MAX = 20;
/** Max tabs recorded in one session. */
export const SESSION_TABS_MAX = 50;

export interface SessionTab {
  url: string;
  title: string;
  /** Tab-group title the tab belonged to, when Chrome reported one. */
  groupName?: string;
  pinned?: boolean;
}

export interface Session {
  id: string;
  name: string;
  createdAt: number;
  tabs: SessionTab[];
  /** True for the auto-saved "Last session" entry (replaced on the next window close). */
  auto?: boolean;
}

declare const chrome: any;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function newId(): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // Fall through.
  }
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A session tab is usable only with a non-empty http(s) URL. Pure. */
export function validSessionTab(raw: unknown): raw is SessionTab {
  if (!isRecord(raw) || typeof raw.url !== "string" || !raw.url) return false;
  try {
    const u = new URL(raw.url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  } catch {
    return false;
  }
  return typeof raw.title === "string";
}

export function validSession(raw: unknown): raw is Session {
  if (!isRecord(raw)) return false;
  if (typeof raw.id !== "string" || !raw.id) return false;
  if (typeof raw.name !== "string" || !raw.name.trim()) return false;
  if (typeof raw.createdAt !== "number" || !Number.isFinite(raw.createdAt)) return false;
  if (!Array.isArray(raw.tabs) || raw.tabs.length === 0) return false;
  return raw.tabs.every(validSessionTab);
}

/** Clean one stored session (drops unusable tabs; null when nothing usable is left). Pure. */
export function sanitizeSession(raw: unknown): Session | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id) return null;
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "";
  if (!name) return null;
  const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : 0;
  if (createdAt <= 0) return null;
  if (!Array.isArray(raw.tabs)) return null;
  const tabs: SessionTab[] = [];
  for (const t of raw.tabs) {
    if (!validSessionTab(t)) continue;
    tabs.push({
      url: (t as SessionTab).url,
      title: ((t as SessionTab).title || (t as SessionTab).url).slice(0, 300),
      ...(typeof (t as SessionTab).groupName === "string" && (t as SessionTab).groupName
        ? { groupName: (t as SessionTab).groupName!.slice(0, 60) }
        : {}),
      ...((t as SessionTab).pinned === true ? { pinned: true } : {}),
    });
  }
  if (tabs.length === 0) return null;
  return { id: raw.id, name, createdAt, tabs: tabs.slice(0, SESSION_TABS_MAX), ...(raw.auto === true ? { auto: true } : {}) };
}

/** Clean a stored sessions list (newest first, capped). Pure. */
export function sanitizeSessions(raw: unknown): Session[] {
  if (!Array.isArray(raw)) return [];
  const out: Session[] = [];
  for (const entry of raw) {
    const clean = sanitizeSession(entry);
    if (clean) out.push(clean);
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out.slice(0, SESSIONS_MAX);
}

/**
 * Build a session from the tabs of one window. Extension pages,
 * chrome:// pages and about:blank are dropped (they cannot be
 * restored as tabs); duplicate URLs are kept once. Returns null
 * when no usable tab is left. Pure.
 */
export function createSessionFromTabs(
  name: string,
  tabs: Array<{ url?: string; title?: string; groupName?: string; pinned?: boolean }>,
  now: number = Date.now(),
  id: string = newId(),
): Session | null {
  const cleanName = typeof name === "string" ? name.trim().slice(0, 80) : "";
  if (!cleanName) return null;
  const seen = new Set<string>();
  const sessionTabs: SessionTab[] = [];
  for (const t of tabs) {
    if (typeof t?.url !== "string" || !t.url) continue;
    if (!t.url.startsWith("http://") && !t.url.startsWith("https://")) continue;
    if (seen.has(t.url)) continue;
    seen.add(t.url);
    sessionTabs.push({
      url: t.url,
      title: (typeof t.title === "string" && t.title ? t.title : t.url).slice(0, 300),
      ...(typeof t.groupName === "string" && t.groupName ? { groupName: t.groupName.slice(0, 60) } : {}),
      ...(t.pinned === true ? { pinned: true } : {}),
    });
    if (sessionTabs.length >= SESSION_TABS_MAX) break;
  }
  if (sessionTabs.length === 0) return null;
  return { id, name: cleanName, createdAt: now, tabs: sessionTabs };
}

/** Add a session (newest first, capped; an auto entry replaces the previous auto entry). Pure. */
export function addSession(sessions: Session[], session: Session): Session[] {
  const rest = session.auto === true ? sessions.filter((s) => s.auto !== true) : sessions;
  return [session, ...rest].slice(0, SESSIONS_MAX);
}

/** Delete a session by id. Pure. */
export function deleteSession(sessions: Session[], id: string): Session[] {
  return sessions.filter((s) => s.id !== id);
}

/** Distinct group names in a session, in first-seen order. Pure. */
export function sessionGroupNames(session: Session): string[] {
  const out: string[] = [];
  for (const t of session.tabs) {
    if (t.groupName && !out.includes(t.groupName)) out.push(t.groupName);
  }
  return out;
}

/** "3 tabs · saved today 08:58" / "5 tabs · saved yesterday". Pure. */
export function formatSessionTime(createdAt: number, now: number = Date.now()): string {
  const d = new Date(createdAt);
  const n = new Date(now);
  const dayStart = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((dayStart(n) - dayStart(d)) / 86400000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (diffDays === 0) return `today ${hh}:${mm}`;
  if (diffDays === 1) return `yesterday ${hh}:${mm}`;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${hh}:${mm}`;
}

/** One-line summary for a session row. Pure. */
export function sessionSummary(session: Session, now: number = Date.now()): string {
  const n = session.tabs.length;
  return `${n} tab${n === 1 ? "" : "s"} · saved ${formatSessionTime(session.createdAt, now)}${session.auto === true ? " · auto-saved" : ""}`;
}

// ---------------------------------------------------------------------------
// Storage wrappers (chrome.storage.local only)
// ---------------------------------------------------------------------------

function storageAvailable(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome?.storage?.local;
  } catch {
    return false;
  }
}

export async function loadSessions(): Promise<Session[]> {
  if (!storageAvailable()) return [];
  try {
    const data = await chrome.storage.local.get(SESSIONS_KEY);
    return sanitizeSessions(data?.[SESSIONS_KEY]);
  } catch {
    return [];
  }
}

export async function saveSessions(sessions: Session[]): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [SESSIONS_KEY]: sanitizeSessions(sessions) });
}
