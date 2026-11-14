// HiddenGem Flow — multi-tab run log shared module (Phase 4).
//
// A "run" is one tab this extension opened (Open All / Open Selected /
// a single task click) plus the installed+enabled scripts whose @match
// patterns match that tab's URL. Runs live in chrome.storage.local
// (hiddengemflow.runs.v1), newest first, last 50 kept.
//
// HONEST STATUS MODEL — the Logs UI states this too:
//  * chrome.userScripts registration is per-extension, not per-tab.
//    "running" therefore means "the matching scripts are registered
//    and this tab was opened by this extension" — not "the scripts are
//    proven to be executing inside this tab".
//  * "done" = the tab finished loading (chrome.tabs.onUpdated complete).
//  * "failed" = the URL was invalid, the tab could not be created, or
//    the tab closed before it finished loading.
//  * "stopped" = the user pressed Stop All while the run was queued/running.
//  * "queued" = recorded, tab creation not finished yet (brief).
//
// Pure half first (no chrome APIs, no Date.now() hidden inside — all
// inputs are parameters), then thin storage wrappers.

declare const chrome: any;

export const RUNS_KEY = "hiddengemflow.runs.v1";
export const RUNS_LIMIT = 50;

/** Message type the background service worker understands (Phase 4). */
export const MSG_STOP_ALL = "hiddengemflow:stop-all";

export type RunStatus = "queued" | "running" | "done" | "failed" | "stopped";

export interface RunEntry {
  runId: string;
  tabId: number | null;
  url: string;
  hostname: string;
  /** Installed+enabled script ids whose @match patterns match this URL. */
  scriptIds: string[];
  status: RunStatus;
  startedAt: number;
  updatedAt: number;
}

function newRunId(): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return `run-${c.randomUUID()}`;
  } catch {
    // Fall through to the timestamp fallback.
  }
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Hostname of a URL, or "" when it does not parse / has no host. */
export function runHostname(url: string): string {
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}

/**
 * Build a run entry. `now` and `runId` are parameters so tests can pin
 * them; callers normally omit both.
 */
export function createRunEntry(
  url: string,
  tabId: number | null,
  scriptIds: string[],
  now: number = Date.now(),
  status: RunStatus = "queued",
  runId: string = newRunId(),
): RunEntry {
  return {
    runId,
    tabId,
    url,
    hostname: runHostname(url),
    scriptIds: [...scriptIds],
    status,
    startedAt: now,
    updatedAt: now,
  };
}

/**
 * Keep the newest `limit` runs (by startedAt desc). Ties keep their
 * input order. Does not mutate.
 */
export function pruneRuns(runs: RunEntry[], limit: number = RUNS_LIMIT): RunEntry[] {
  return [...runs]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, Math.max(0, limit));
}

/** Prepend an entry and prune to the limit. Does not mutate. */
export function addRunEntry(runs: RunEntry[], entry: RunEntry, limit: number = RUNS_LIMIT): RunEntry[] {
  return pruneRuns([entry, ...runs], limit);
}

/**
 * Update one run by id (status and/or tabId), stamping updatedAt.
 * Unknown id → the array is returned unchanged (same reference).
 * Does not mutate.
 */
export function updateRunEntry(
  runs: RunEntry[],
  runId: string,
  patch: { status?: RunStatus; tabId?: number | null },
  now: number = Date.now(),
): RunEntry[] {
  let changed = false;
  const next = runs.map((r) => {
    if (r.runId !== runId) return r;
    changed = true;
    return { ...r, ...(patch.status ? { status: patch.status } : {}), ...(patch.tabId !== undefined ? { tabId: patch.tabId } : {}), updatedAt: now };
  });
  return changed ? next : runs;
}

/**
 * Move every run on `tabId` whose status is in `from` to `status`.
 * Used by the background's tabs.onUpdated (running → done on complete)
 * and tabs.onRemoved (running/queued → failed on early close).
 * Nothing matches → the array is returned unchanged (same reference).
 * Does not mutate.
 */
export function updateRunsByTab(
  runs: RunEntry[],
  tabId: number,
  status: RunStatus,
  from: RunStatus[],
  now: number = Date.now(),
): RunEntry[] {
  let changed = false;
  const next = runs.map((r) => {
    if (r.tabId !== tabId || !from.includes(r.status)) return r;
    changed = true;
    return { ...r, status, updatedAt: now };
  });
  return changed ? next : runs;
}

/**
 * Stop every queued/running run: returns the updated list plus the
 * runs that were stopped (so the background can best-effort close
 * exactly those tabs). Done/failed/stopped runs are untouched.
 * Does not mutate.
 */
export function stopRunningRuns(
  runs: RunEntry[],
  now: number = Date.now(),
): { runs: RunEntry[]; stopped: RunEntry[] } {
  const stopped: RunEntry[] = [];
  const next = runs.map((r) => {
    if (r.status !== "running" && r.status !== "queued") return r;
    const stoppedRun = { ...r, status: "stopped" as RunStatus, updatedAt: now };
    stopped.push(stoppedRun);
    return stoppedRun;
  });
  return { runs: next, stopped };
}

/** How many runs are currently queued or running. */
export function runningRunCount(runs: RunEntry[]): number {
  return runs.filter((r) => r.status === "running" || r.status === "queued").length;
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

function isRunEntry(raw: unknown): raw is RunEntry {
  return (
    !!raw &&
    typeof (raw as RunEntry).runId === "string" &&
    typeof (raw as RunEntry).url === "string" &&
    Array.isArray((raw as RunEntry).scriptIds) &&
    typeof (raw as RunEntry).status === "string" &&
    typeof (raw as RunEntry).startedAt === "number"
  );
}

/** Load all run entries (newest first); [] when nothing is saved. */
export async function loadRuns(): Promise<RunEntry[]> {
  if (!storageAvailable()) return [];
  try {
    const data = await chrome.storage.local.get(RUNS_KEY);
    const raw = data?.[RUNS_KEY];
    if (!Array.isArray(raw)) return [];
    return pruneRuns(raw.filter(isRunEntry));
  } catch {
    return [];
  }
}

/** Persist the whole run list (pruned to the last 50 first). */
export async function saveRuns(runs: RunEntry[]): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [RUNS_KEY]: pruneRuns(runs) });
}
