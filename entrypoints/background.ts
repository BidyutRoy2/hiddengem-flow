import { defineBackground } from "wxt/sandbox";
import { buildRegisteredScript, checkUserScripts, ensureGmRelayForEnabled, ensureGmRelayForPattern, reregisterEnabledFromStorage, scriptHasHostAccess, setScriptEnabled } from "./shared/engine";
import {
  MSG_STUDIO_STEP,
  MSG_STUDIO_TEST_START,
  MSG_STUDIO_TEST_STEPS,
  MSG_STUDIO_TEST_STOP,
  sanitizeStudioStep,
  studioStepState,
  type StudioStep,
} from "./shared/studio-protocol";
import {
  MSG_STOP_ALL,
  RUNS_LIMIT,
  addRunEntry,
  createRunEntry,
  loadRuns,
  saveRuns,
  stopRunningRuns,
  updateRunEntry,
  updateRunsByTab,
  type RunEntry,
} from "./shared/runs";
import { MSG_GM_NOTIFY, MSG_OPEN_EXTENSION_DETAILS, MSG_SCRIPTS_STATUS, MSG_TOGGLE_SCRIPT, createScript, loadScripts, scriptsForUrl, type Script } from "./shared/scripts";
import {
  GM_XHR_MAX_RESPONSE_BYTES,
  MSG_GM_XHR,
  MSG_SELF_TEST,
  connectHostsOf,
  isConnectAllowed,
  sanitizeGmXhrRequest,
  type GmXhrResponse,
} from "./shared/gm-xhr";
import { MSG_GET_ACTIVE_TAB, MSG_OPEN_URLS, TASKS_KEY, createTask, loadTasks, markOpened, normalizeUrl, saveTasks } from "./shared/tasks";
import { MSG_CHECK_UPDATES, checkForUpdates } from "./shared/updates";
import { BACKUP_DATA_KEYS, MSG_RESTORE_BACKUP, buildFullBackup, collectBackupData, loadBackupState, parseFullBackup, sanitizeBackupData, takeSnapshot, writeBackupData } from "./shared/backup";
import {
  CONTEXT_MENU_KEY,
  MSG_CLOSE_FLOATS,
  MSG_OPEN_MODE,
  WINDOW_MODE_KEY,
  loadContextMenuEnabled,
  loadWindowMode,
  openSidePanelForCurrentWindow,
  sanitizeWindowMode,
  setOpenTabHint,
  type WindowMode,
} from "./shared/window-mode";
import { NOTES_KEY, createNote, displayTitle, loadNotes, saveNotes } from "./shared/notes";
import { parseOmniboxInput, searchOmnibox } from "./shared/omnibox";
import {
  ALARM_NUDGE,
  ALARM_OPEN_ALL,
  ALARM_PREFIX,
  MSG_REMINDERS_FORCE_NUDGE,
  MSG_REMINDERS_RESCHEDULE,
  MSG_REMINDERS_STATUS,
  NUDGE_NOTIFICATION_ID,
  REMINDERS_KEY,
  flowAlarmName,
  flowNotificationId,
  formatNudgeMessage,
  loadRemindersSettings,
  nextNudgeFire,
  nextReminderFire,
  noteAlarmName,
  noteNotificationId,
  reminderAlarmName,
  taskNotificationId,
  unopenedPinnedTasks,
} from "./shared/reminders";
import {
  FLOWS_KEY,
  MSG_FLOW_RUN,
  MSG_OMNIBOX_TEST,
  formatFlowRunResult,
  loadFlows,
  nextFlowFire,
  resolveFlowRefs,
  saveFlows,
} from "./shared/flows";
import {
  MSG_OPEN_TABS_CHANGED,
  MSG_OPEN_TABS_CLOSE,
  MSG_OPEN_TABS_FOCUS,
  MSG_OPEN_TABS_GET,
  clearOpenTabs,
  loadOpenTabs,
  sameSite,
  sanitizeOpenTabsMap,
  saveOpenTabs,
  trackOpenTab,
  untrackTabId,
  untrackTask,
  type OpenTabsMap,
} from "./shared/open-tabs";
import {
  MSG_SESSION_DELETE,
  MSG_SESSION_RESTORE,
  MSG_SESSION_SAVE,
  addSession,
  createSessionFromTabs,
  deleteSession,
  loadSessions,
  saveSessions,
  sessionGroupNames,
  type Session,
} from "./shared/sessions";
import {
  ALARM_SMART_SUSPEND,
  MSG_SMART_OPEN,
  duePendingTabs,
  formatSmartOpenResult,
  loadSmartOpenPending,
  loadSmartOpenSettings,
  planSmartOpen,
  saveSmartOpenPending,
  type SmartOpenPending,
} from "./shared/smart-open";
import {
  MSG_USERSTYLES_APPLY,
  MSG_USERSTYLES_SYNC,
  USERSTYLE_SCRIPT_PREFIX,
  loadUserStyles,
  styleHostGranted,
  styleMatchPatterns,
  styleMatchesUrl,
  styleScheduleActive,
  validateUserStyleCss,
} from "./shared/userstyles";
import { MSG_SCRATCHPAD_RUN, validateScratchpad, type ScratchpadKind } from "./shared/scratchpad";
import { MSG_GM_VALUES_READ, parseGmValues } from "./shared/storage-viewer";
import {
  SNOOZE_KEY,
  loadSnoozes,
  saveSnoozes,
  snoozeAlarmName,
  snoozeNotificationId,
  visibleTasks,
} from "./shared/snooze";
import {
  MSG_SCHEDULES_RESCHEDULE,
  MSG_SCHEDULE_RUN_NOW,
  SCHEDULES_KEY,
  createScheduleRunEntry,
  enabledSchedules,
  loadSchedules,
  logScheduleRun,
  removeSchedule,
  saveSchedules,
  scheduleAlarmName,
  urlFromMatchPattern,
  type ScheduleEntry,
} from "./shared/schedules";
import {
  MSG_SYNC_NOW,
  MSG_SYNC_PULL,
  MSG_SYNC_STATUS,
  SYNC_ALARM,
  SYNC_KEY,
  buildSyncUploadBody,
  extractSyncDownloadBody,
  loadSyncSettings,
  loadSyncTokens,
  nextSyncFire,
  saveSyncSettings,
  syncDownloadUrl,
  syncHostAllowed,
  syncUploadUrl,
  validateSyncTarget,
} from "./shared/sync";

// HiddenGem Flow — background service worker (Unreleased).
//
// Jobs:
//  1. Toolbar click opens the floating window — two paths (v1.0.2):
//     (a) the active tab is an http(s) page → toggle the in-page
//     floating window, exactly as before (sendMessage, falling back to
//     chrome.scripting.executeScript via the `activeTab` permission);
//     (b) anything else (chrome://, brave://, Web Store, about:blank,
//     new-tab page, or no tab at all) → open the standalone floating
//     page (float.html) as a popup window, because content scripts
//     cannot be injected there at all. If injection on an http(s) page
//     throws anyway, fall back to the popup instead of doing nothing.
//     The popup window id is tracked so a second click focuses the
//     open popup instead of opening a duplicate. No
//     chrome_url_overrides — the user's new tab page is never replaced.
//  2. Open the dashboard page when asked (floating window / dashboard).
//  3. (Phase 2) Return the active tab's title + URL, so the floating
//     window's "Add current site" can prefill its form — content scripts
//     cannot call chrome.tabs themselves.
//  4. (Phase 2) Open a list of URLs one by one in new tabs (~350 ms
//     apart, so the browser is not flooded) and stamp lastOpenedAt on
//     the matching saved tasks. ALL tab opens in the extension go
//     through this handler — single, multi-select and Open All alike.
//  5. (Phase 3) Script engine: on install / startup, re-register every
//     enabled script one at a time (chrome.userScripts forgets nothing
//     itself, but re-registering keeps storage and the browser in sync
//     after an update). The floating window cannot call chrome.userScripts
//     itself, so it asks here for status + toggles. GM_notification from
//     a running script arrives here and becomes a real notification —
//     via the GM relay (finding A-04: the USER_SCRIPT world has no
//     chrome.runtime.sendMessage, so the shim signals through the DOM
//     and public/gm-relay.js forwards it; see shared/engine.ts).
//     (v1.0.1 live-test fix) Status also reports per-script HOST ACCESS:
//     registration alone does not make a script run — Chrome needs host
//     access for its @match sites (optional_host_permissions *://*/*,
//     granted per site by the user). Without it the script is inert and
//     the dashboard + floating say so.
//  6. (Phase 4) Multi-tab run log: every tab opened here gets a run
//     entry (hiddengemflow.runs.v1, last 50) with the installed+enabled
//     script ids whose @match patterns match that URL. "done" when the
//     tab finishes loading (tabs.onUpdated complete), "failed" when the
//     URL was invalid, the tab could not be created, or the tab closed
//     before finishing (tabs.onRemoved). "Stop All" marks queued/running
//     runs "stopped" and best-effort closes only the tabs this run
//     opened — it never touches other tabs.
//  7. (Unreleased) Extension update checker: on startup/install, and
//     whenever the dashboard asks (MSG_CHECK_UPDATES), ask the public
//     GitHub releases API whether a newer build exists. The check is
//     gated to at most once per 6h (plus a manual check from Settings)
//     and fails silently on rate limit / network error. It only ever
//     NOTICES a newer build — an unpacked install cannot update itself,
//     so the dashboard banner + floating line point the user at the
//     manual replace-files-and-Reload steps. See shared/updates.ts.
//  8. (v1.2.0) Window mode: one setting (floating / sidepanel /
//     popup) picks which surface the toolbar icon opens. The mode
//     lives in storage; the background applies setPanelBehavior for
//     the side panel, opens the popup window, and closes the surface
//     being switched away from. Context menus (Save to Daily Tasks,
//     Save selection as note, Run script on this page) and keyboard
//     shortcuts (commands) also live here. Automatic versioned
//     backup: a debounced snapshot on storage changes of the
//     backed-up keys (only when auto-backup is ON), one snapshot
//     before an extension update, and snapshot-first restore.
//  9. (v1.2.1) Open-tabs tracking: when a task site is opened from
//     the extension, the background records the opened tabId against
//     the taskId in chrome.storage.session (taskId → tabIds). Surfaces
//     show a ● Open badge (focuses the tab) + ✕ Close (closes exactly
//     those tabs). Tabs that close or navigate off the task's site
//     are untracked at once. Session-only — never in backups; cleared
//     on browser startup. See shared/open-tabs.ts.
// 10. (Later, #13/#20) Scheduled scripts + opt-in sync. A scheduled
//     script runs on its one-shot `hgf-sched-<id>` alarm: the
//     background re-validates the script (installed, enabled,
//     unarchived, engine on, host access granted) and opens its
//     @match site in a BACKGROUND tab so the registered userscript
//     runs on load, then closes the tab and writes one run-log line
//     (shared/schedules.ts). Sync uploads/downloads the backup
//     payload to the user's own WebDAV / Gist / Drive — default OFF,
//     tokens under a separate key that is never backed up or logged,
//     snapshot-first in both directions (shared/sync.ts). Neither
//     needs a new permission: alarms was already held, and no
//     offscreen document is used (a userscript cannot execute in one
//     — see shared/schedules.ts).
//
// MV3 service workers are killed after ~30s idle, so nothing stateful
// lives here — all state is in chrome.storage.local (open-tabs state
// in chrome.storage.session, which survives service-worker restarts
// but not browser restarts — exactly what tab tracking needs).

declare const chrome: any;

// WXT 0.19 builds a runtime-registered content script to the output root
// (verified: .output/chrome-mv3/floating.js) — NOT content-scripts/.
const FLOATING_FILE = "floating.js";
/** Recently shown GM_notification ids (finding A-04 dedupe). In-memory only; see the MSG_GM_NOTIFY handler. */
const seenNotifyIds = new Set<string>();
const OPEN_DASHBOARD = "hiddengemflow:open-dashboard";
const OPEN_STAGGER_MS = 350;
const MAX_OPEN_AT_ONCE = 50;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Phase 2: the active tab's title + URL (for "Add current site"). */
async function getActiveTab(): Promise<{ title: string; url: string }> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs?.[0];
  if (!tab || typeof tab.url !== "string" || !tab.url) {
    throw new Error("No active tab found.");
  }
  return { title: typeof tab.title === "string" && tab.title ? tab.title : tab.url, url: tab.url };
}

/**
 * Phase 2 + Phase 4: open `urls` one by one in new tabs, ~350 ms apart,
 * then stamp lastOpenedAt on the matching saved tasks (matched by
 * normalized URL). Invalid URLs are skipped, not opened. Returns how
 * many tabs were opened, how many valid URLs were dropped by the
 * 50-at-a-time cap (`skipped`), and how many URLs were invalid
 * (`invalid`) — the callers show these counts instead of silently
 * dropping tabs (Unreleased).
 *
 * Focus (Unreleased): only the FIRST tab opens in the foreground; every
 * later tab opens with active:false, so opening 10 tabs no longer
 * yanks focus 10 times and leaves the user on the last one.
 *
 * Phase 4: every URL — valid or not — gets a run entry in
 * hiddengemflow.runs.v1 (last 50 kept). A valid URL records the
 * installed+enabled script ids whose @match patterns match it, starts
 * "queued", becomes "running" once the tab exists, and is later marked
 * "done"/"failed" by the tabs.onUpdated / tabs.onRemoved listeners.
 * An invalid URL records a "failed" run (tabId null) so the Logs tab
 * shows what was skipped instead of hiding it.
 */
async function openUrls(rawUrls: unknown): Promise<{ opened: number; skipped: number; invalid: number }> {
  if (!Array.isArray(rawUrls)) throw new Error("urls must be an array.");
  const valid = rawUrls
    .map((u) => (typeof u === "string" ? normalizeUrl(u) : null))
    .filter((u): u is string => u !== null);
  const invalid = rawUrls.length - valid.length;
  const urls = valid.slice(0, MAX_OPEN_AT_ONCE);
  const skipped = valid.length - urls.length;
  let runs: RunEntry[] = [];
  try {
    runs = await loadRuns();
  } catch {
    runs = [];
  }
  let enabledScripts: Script[] = [];
  try {
    enabledScripts = (await loadScripts()).filter((s) => s.enabled);
  } catch {
    enabledScripts = [];
  }
  // Invalid URLs: failed runs, so the Logs tab shows the skip honestly.
  for (const raw of rawUrls) {
    if (typeof raw !== "string" || normalizeUrl(raw) === null) {
      const label = typeof raw === "string" && raw ? raw : "(not a URL)";
      runs = addRunEntry(runs, createRunEntry(label, null, [], Date.now(), "failed"), RUNS_LIMIT);
    }
  }
  try {
    await saveRuns(runs);
  } catch {
    // Run logging must never break opening tabs.
  }
  let opened = 0;
  // v1.2.1: tabs opened here, kept with their URL so the background
  // can record them against the matching task (open-tabs tracking).
  const openedTabs: Array<{ url: string; tabId: number }> = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const matchedIds = scriptsForUrl(enabledScripts, url).map((s) => s.id);
    const entry = createRunEntry(url, null, matchedIds);
    runs = addRunEntry(runs, entry, RUNS_LIMIT);
    try {
      await saveRuns(runs);
    } catch {
      // Non-fatal.
    }
    try {
      // Unreleased: first tab in the foreground, the rest in the background.
      const tab = await chrome.tabs.create({ url, active: i === 0 });
      const tabId = tab && typeof tab.id === "number" ? tab.id : null;
      runs = updateRunEntry(runs, entry.runId, { status: "running", tabId });
      opened += 1;
      if (tabId !== null) openedTabs.push({ url, tabId });
    } catch (err) {
      console.warn("[HiddenGem Flow] could not open tab:", url, err);
      runs = updateRunEntry(runs, entry.runId, { status: "failed" });
    }
    try {
      await saveRuns(runs);
    } catch {
      // Non-fatal.
    }
    if (url !== urls[urls.length - 1]) await delay(OPEN_STAGGER_MS);
  }
  if (opened > 0) {
    try {
      const tasks = await loadTasks();
      await saveTasks(markOpened(tasks, urls));
    } catch (err) {
      console.warn("[HiddenGem Flow] could not stamp lastOpenedAt:", err);
    }
    // v1.2.1: record the opened tabs against their tasks (best-effort —
    // tracking must never break opening tabs).
    void trackOpenedTaskTabs(openedTabs).catch(() => {
      // Silent: the tabs are open either way; the badges just stay off.
    });
  }
  return { opened, skipped, invalid };
}

/**
 * Unreleased — open this extension's own Details page in a new tab, so the
 * user can flip "Allow User Scripts" there. There is NO API that lets an
 * extension flip that toggle by itself — Chrome requires the user to do
 * it on chrome://extensions — so this only OPENS the page and reports
 * which URL it opened; the toggle itself stays off until a human flips
 * it. Fallback is the plain extensions list when the direct details
 * URL is refused.
 */
async function openExtensionDetails(): Promise<{ ok: boolean; url?: string; error?: string }> {
  const urls = [
    `chrome://extensions/?id=${chrome.runtime.id}`,
    "chrome://extensions/",
  ];
  for (const url of urls) {
    try {
      const tab = await createTabInNormalWindow(url);
      if (tab) return { ok: true, url };
    } catch {
      // Try the next URL.
    }
  }
  return { ok: false, error: "Could not open the extensions page. Open chrome://extensions yourself, find HiddenGem Flow → Details, and turn Allow User Scripts ON." };
}

/**
 * Phase 4 — Stop All: mark every queued/running run "stopped" and
 * best-effort close only the tabs this extension opened in those runs
 * (their tabIds). Tabs already closed, or tabs the user opened
 * themselves, are never touched. Returns how many runs were stopped.
 */
async function stopAllRuns(): Promise<{ stopped: number }> {
  let runs: RunEntry[] = [];
  try {
    runs = await loadRuns();
  } catch {
    return { stopped: 0 };
  }
  const { runs: next, stopped } = stopRunningRuns(runs);
  try {
    await saveRuns(next);
  } catch {
    // The in-memory result still counts; storage will catch up on the next run.
  }
  const tabIds = stopped
    .map((r) => r.tabId)
    .filter((id): id is number => typeof id === "number");
  if (tabIds.length > 0) {
    try {
      await chrome.tabs.remove(tabIds);
    } catch {
      // Best-effort: a tab may already be closed, or Chrome may refuse.
    }
  }
  return { stopped: stopped.length };
}

function dashboardUrl(tab?: string): string {
  const base = chrome.runtime.getURL("dashboard.html");
  return typeof tab === "string" && tab ? `${base}#${tab}` : base;
}

/**
 * Open `url` as a tab in a NORMAL browser window — never in the
 * caller's window. A tab created inside the standalone popup window
 * would hijack the popup (v1.0.2 fixed this for the dashboard; Unreleased
 * caught the same trap for the extension-details page before the live
 * test did). Prefer the focused normal window, else the first normal
 * window; fall back to Chrome's default.
 */
async function createTabInNormalWindow(url: string): Promise<unknown> {
  try {
    const wins = await chrome.windows.getAll();
    const list = Array.isArray(wins) ? wins : [];
    const target =
      list.find((w) => w?.focused && w?.type === "normal" && typeof w.id === "number") ??
      list.find((w) => w?.type === "normal" && typeof w.id === "number");
    if (target) return await chrome.tabs.create({ windowId: target.id, url });
  } catch {
    // Fall through to the default create below.
  }
  return chrome.tabs.create({ url });
}

async function openDashboard(tab?: string): Promise<void> {
  await createTabInNormalWindow(dashboardUrl(tab));
}

/**
 * Toggle the floating window in `tabId`.
 *
 * If the floating script is already running in the tab, a message to it
 * toggles visibility. If there is no listener (first click on this tab),
 * the message rejects and we inject the script — which creates the
 * window visible on first load.
 *
 * Returns true when the window was toggled or injected, false when the
 * injection failed (a restricted page) — the caller then falls back to
 * the standalone popup window instead of silently doing nothing.
 */
async function toggleFloating(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "hiddengemflow:toggle" });
    return true;
  } catch {
    // No floating window in this tab yet — inject it.
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [FLOATING_FILE],
    });
    return true;
  } catch (err) {
    console.warn("[HiddenGem Flow] cannot inject floating window:", err);
    return false;
  }
}

// --- v1.0.2: standalone floating popup (float.html) ---------------------
// chrome.windows.create for an extension page needs NO extra
// permission — verified from the built manifest (no new permission was
// added for this) and by the live test, which opens the popup.
const FLOAT_PAGE = "float.html";
const FLOAT_POPUP_WIDTH = 360;
const FLOAT_POPUP_HEIGHT = 680;
let floatWindowId: number | null = null;

// v1.2.0 deep audit (A-18): the popup window id is ALSO persisted in
// storage. The service worker is killed after ~30 s idle, and the
// popup page uses only short-lived sendMessage calls — nothing keeps
// the worker alive while the popup is open. After a restart the
// in-memory id is null, and the next toolbar click would open a
// SECOND popup instead of focusing the existing one. The persisted id
// survives restarts; openFloatPopup validates it with windows.get
// before focusing, so a stale id is safe. (This key is deliberately
// NOT in BACKUP_DATA_KEYS — it is ephemeral, not user data.)
const POPUP_WINDOW_ID_KEY = "hiddengemflow.popup.windowId.v1";

async function loadPersistedPopupWindowId(): Promise<number | null> {
  try {
    const data = await chrome.storage.local.get(POPUP_WINDOW_ID_KEY);
    const id = data?.[POPUP_WINDOW_ID_KEY];
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

async function savePersistedPopupWindowId(id: number | null): Promise<void> {
  try {
    if (id === null) await chrome.storage.local.remove(POPUP_WINDOW_ID_KEY);
    else await chrome.storage.local.set({ [POPUP_WINDOW_ID_KEY]: id });
  } catch {
    // Non-fatal: the in-memory id still works until the next restart.
  }
}

/**
 * Open the standalone floating window as a popup. If one is already
 * open, focus it instead of opening a duplicate. Returns the window id,
 * or null when creation failed.
 */
async function openFloatPopup(): Promise<number | null> {
  // A-18: the known id comes from memory OR from storage (the worker
  // may have restarted since the popup opened).
  const knownId = floatWindowId ?? (await loadPersistedPopupWindowId());
  if (knownId !== null) {
    try {
      await chrome.windows.get(knownId);
      try {
        await chrome.windows.update(knownId, { focused: true });
      } catch {
        // Focusing failed — the window exists but cannot be focused;
        // still better than opening a duplicate.
      }
      floatWindowId = knownId;
      return knownId;
    } catch {
      // Stale id (window closed without the onRemoved event firing
      // first) — fall through and create a fresh popup.
      floatWindowId = null;
      await savePersistedPopupWindowId(null);
    }
  }
  try {
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL(FLOAT_PAGE),
      type: "popup",
      width: FLOAT_POPUP_WIDTH,
      height: FLOAT_POPUP_HEIGHT,
      focused: true,
    });
    if (win && typeof win.id === "number") {
      floatWindowId = win.id;
      await savePersistedPopupWindowId(win.id);
      // Enforce the intended size: some environments (verified live in
      // Chrome for Testing under bare Xvfb, where no window manager
      // honours create() bounds) open the popup at the main window's
      // size instead of 360x680, while windows.update() IS honoured.
      // On a normal desktop this update is a no-op with the same size.
      await enforceFloatPopupSize(win.id);
      return win.id;
    }
    return null;
  } catch (err) {
    console.warn("[HiddenGem Flow] cannot open floating popup:", err);
    return null;
  }
}

/**
 * Force the popup back to FLOAT_POPUP_WIDTH x FLOAT_POPUP_HEIGHT.
 * Retries once after a short delay, because the first update can race
 * the window finishing its initial layout. Position is deliberately
 * left alone — Chrome/the OS chooses the placement.
 */
async function enforceFloatPopupSize(windowId: number): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await chrome.windows.update(windowId, {
        width: FLOAT_POPUP_WIDTH,
        height: FLOAT_POPUP_HEIGHT,
      });
      const after = await chrome.windows.get(windowId);
      if (after.width === FLOAT_POPUP_WIDTH && after.height === FLOAT_POPUP_HEIGHT) return;
    } catch {
      return; // Window closed already — nothing to enforce.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

/** Toolbar click routing (v1.0.2): http(s) tab → in-page window; every
 * other tab (chrome://, brave://, Web Store, about:blank, new tab, or
 * no tab) → standalone popup window. An injection failure on an http(s)
 * page also falls back to the popup. */
async function handleToolbarClick(tab: { id?: number; url?: string }): Promise<void> {
  const mode = await loadWindowMode();
  if (mode === "sidepanel") {
    // Should not fire — setPanelBehavior intercepts the click and
    // opens the panel natively. If the behavior was not applied yet
    // (fresh startup race), open the panel directly instead.
    await openSidePanelForCurrentWindow();
    return;
  }
  if (mode === "popup") {
    await openFloatPopup();
    return;
  }
  const url = typeof tab?.url === "string" ? tab.url : "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    if (typeof tab.id === "number") {
      const ok = await toggleFloating(tab.id);
      if (ok) {
        // v1.3 (A-33): this toolbar click granted activeTab for this
        // tab's origin — record it (contains() cannot see it).
        recordActiveTabGrant(tab.id, url);
        return;
      }
      // Injection failed on an http(s) page — fall through to popup.
    }
  }
  await openFloatPopup();
}

// ---------------------------------------------------------------------------
// v1.2.0: window mode, context menus, commands, automatic backup
// ---------------------------------------------------------------------------

/** Current mode, cached from storage (startup + onChanged keep it fresh). */
let currentMode: WindowMode = "floating";

/** One notification (best-effort — a failed create never breaks the action). */
function notify(title: string, message: string): void {
  try {
    void chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: title.slice(0, 80),
      message: message.slice(0, 400),
    });
  } catch {
    // Notifications unavailable — the action itself already happened.
  }
}

/**
 * v1.4: one notification WITH a stable id, so a click on it can be
 * routed back to exactly the task / note / flow it names (see
 * handleNotificationClicked). Same best-effort rule as notify().
 */
function notifyWithId(id: string, title: string, message: string): void {
  try {
    void chrome.notifications.create(id, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: title.slice(0, 80),
      message: message.slice(0, 400),
    });
  } catch {
    // Notifications unavailable — the action itself already happened.
  }
}

/**
 * v1.4: are notifications actually allowed? chrome.notifications
 * permission is in the manifest, but the user (or the OS) can still
 * block them — getPermissionLevel() is the only honest check. The
 * dashboard shows the answer, and alarm handlers skip the notify
 * (instead of failing silently) when it is "denied".
 */
async function getNotificationLevel(): Promise<"granted" | "denied"> {
  try {
    if (!chrome?.notifications?.getPermissionLevel) return "granted";
    const level = await new Promise<string>((resolve) => {
      try {
        chrome.notifications.getPermissionLevel((l: string) => resolve(typeof l === "string" ? l : "granted"));
      } catch {
        resolve("granted");
      }
    });
    return level === "denied" ? "denied" : "granted";
  } catch {
    return "granted";
  }
}

/**
 * The active tab of the browser window the user is looking at — the
 * last focused NORMAL window, else the first normal window. The
 * standalone popup window is never a target (its only tab is
 * float.html). Returns null when there is no normal window at all.
 */
async function getActiveTabOfNormalWindow(): Promise<{ id?: number; url?: string; title?: string } | null> {
  try {
    const wins = await chrome.windows.getAll({ populate: true });
    const list = Array.isArray(wins) ? wins : [];
    const target =
      list.find((w) => w?.focused && w?.type === "normal") ?? list.find((w) => w?.type === "normal");
    const tabs = target?.tabs;
    if (Array.isArray(tabs)) {
      const active = tabs.find((t) => t?.active);
      if (active) return active;
    }
  } catch {
    // Fall through to the query below.
  }
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Show the floating window in `tabId` (never hide it) — for commands
 * like quick-note, where toggling it off would be wrong. Falls back
 * to injection when no listener answers.
 */
async function showFloating(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "hiddengemflow:show" });
    return;
  } catch {
    // No floating window in this tab yet — inject it.
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [FLOATING_FILE] });
    // v1.3 (A-33): the injection granted activeTab for this tab.
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url) recordActiveTabGrant(tabId, tab.url);
    } catch {
      // The tab is gone — nothing to record.
    }
  } catch {
    // Injection failed (restricted page) — the caller falls back to the popup.
  }
}

/**
 * Open a window mode (toolbar-click equivalent, for commands and for
 * MSG_OPEN_MODE). Floating opens on the active tab of the last
 * focused normal window (popup fallback when there is no usable
 * tab); sidepanel opens directly (a command IS a user gesture);
 * popup opens/focuses the standalone window.
 */
async function openMode(mode: WindowMode): Promise<{ ok: boolean; error?: string }> {
  if (mode === "sidepanel") return openSidePanelForCurrentWindow();
  if (mode === "popup") {
    const id = await openFloatPopup();
    return id !== null ? { ok: true } : { ok: false, error: "Could not open the popup window." };
  }
  const tab = await getActiveTabOfNormalWindow();
  if (!tab) {
    await openFloatPopup();
    return { ok: true };
  }
  await handleToolbarClick(tab);
  return { ok: true };
}

/** Apply the toolbar-click behavior for `mode` (side panel intercepts the click natively). */
async function applyModeBehavior(mode: WindowMode): Promise<void> {
  try {
    if (!chrome?.sidePanel?.setPanelBehavior) return;
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: mode === "sidepanel" });
  } catch {
    // setPanelBehavior unavailable — onClicked still routes by mode.
  }
}

/**
 * Close the side panel, if it is open. There is no close API — the
 * documented way is setOptions({ enabled: false }), which closes an
 * open panel; re-enabling immediately after keeps the feature on for
 * the next open. Best-effort: if Chrome ever changes this behaviour,
 * the panel simply stays open and the user closes it with its ✕.
 */
async function closeSidePanelIfOpen(): Promise<void> {
  try {
    if (!chrome?.sidePanel?.setOptions) return;
    await chrome.sidePanel.setOptions({ enabled: false });
    await chrome.sidePanel.setOptions({ enabled: true });
  } catch {
    // Best-effort only.
  }
}

/** Close the standalone popup window, if it is open. Best-effort. */
async function closeFloatPopupWindow(): Promise<void> {
  if (floatWindowId === null) {
    // The in-memory id may already be gone (worker restart) while the
    // persisted id still points at an open popup — clear it too, so a
    // later open does not focus a window the mode change meant to close.
    const persisted = await loadPersistedPopupWindowId();
    if (persisted !== null) {
      await savePersistedPopupWindowId(null);
      try {
        await chrome.windows.remove(persisted);
      } catch {
        // Already closed.
      }
    }
    return;
  }
  const id = floatWindowId;
  floatWindowId = null;
  await savePersistedPopupWindowId(null);
  try {
    await chrome.windows.remove(id);
  } catch {
    // Already closed — the onRemoved listener clears the id too.
  }
}

/** React to a mode change: behaviour + close the surface being left. */
async function onWindowModeChanged(mode: WindowMode): Promise<void> {
  currentMode = mode;
  await applyModeBehavior(mode);
  if (mode !== "popup") await closeFloatPopupWindow();
  if (mode !== "sidepanel") await closeSidePanelIfOpen();
}

// --- Automatic backup (debounced snapshot on data changes) ---
let backupTimer: ReturnType<typeof setTimeout> | null = null;
/** Suppress the auto-snapshot right after a restore (the restore writes the same keys). */
let suppressAutoSnapshotUntil = 0;

function scheduleAutoSnapshot(): void {
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupTimer = null;
    void maybeAutoSnapshot();
  }, 2000);
}

async function maybeAutoSnapshot(): Promise<void> {
  if (Date.now() < suppressAutoSnapshotUntil) return;
  try {
    const state = await loadBackupState();
    if (!state.auto) return;
    await takeSnapshot();
  } catch {
    // A failed snapshot is silent — the next change re-triggers it.
  }
}

// --- Open-tabs tracking (v1.2.1) ---
// The map lives in chrome.storage.session (taskId → tabIds). Every
// mutation runs through one promise chain (same pattern as the
// context-menu serialization, A-25): two rapid opens must not
// read-modify-write the same map over each other. After every mutation
// the background fans the new map out to all tabs (content-script
// floats cannot read storage.session themselves); extension pages
// (dashboard, popup, side panel) get it through storage.onChanged on
// the session area directly.

/** Serialize open-tabs map mutations (read → mutate → save → broadcast). */
let openTabsChain: Promise<void> = Promise.resolve();

/** Fan the current map out to every tab's floating window. Never throws. */
async function broadcastOpenTabs(map: OpenTabsMap): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs || []) {
      if (typeof t?.id !== "number") continue;
      try {
        await chrome.tabs.sendMessage(t.id, { type: MSG_OPEN_TABS_CHANGED, map });
      } catch {
        // No floating window in this tab — nothing listening.
      }
    }
  } catch {
    // tabs.query failed — surfaces re-read the map on their next show.
  }
}

/**
 * Run `fn` against the stored map, persist what it returns and broadcast
 * it. `fn` is pure where possible (use the pure helpers in
 * shared/open-tabs.ts); it may also await tab checks (reconcile). The
 * function runs INSIDE the chain, against the freshly loaded map, so
 * concurrent callers cannot clobber each other. When nothing changed
 * the map is neither saved nor broadcast (closing an untracked tab
 * stays silent). Serialized: callers never interleave.
 */
function mutateOpenTabs(fn: (map: OpenTabsMap) => OpenTabsMap | Promise<OpenTabsMap>): Promise<OpenTabsMap> {
  const run = openTabsChain.then(async () => {
    const current = await loadOpenTabs();
    const next = sanitizeOpenTabsMap(await fn(current));
    if (JSON.stringify(next) === JSON.stringify(current)) return current;
    await saveOpenTabs(next);
    await broadcastOpenTabs(next);
    return next;
  });
  openTabsChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Record tabs opened by openUrls() against their tasks. Matching is by
 * normalized URL — task URLs are unique (duplicates are rejected on
 * save), so one URL maps to exactly one task. A URL with no matching
 * task is simply not tracked. Never throws.
 */
async function trackOpenedTaskTabs(opened: Array<{ url: string; tabId: number }>): Promise<void> {
  if (opened.length === 0) return;
  try {
    const tasks = await loadTasks();
    const byUrl = new Map<string, string>();
    for (const t of tasks) {
      const norm = normalizeUrl(t.url);
      if (norm) byUrl.set(norm, t.id);
    }
    let tracked = 0;
    await mutateOpenTabs((map) => {
      let next = map;
      for (const { url, tabId } of opened) {
        const norm = normalizeUrl(url);
        const taskId = norm ? byUrl.get(norm) : undefined;
        if (!taskId) continue;
        next = trackOpenTab(next, taskId, tabId);
        tracked += 1;
      }
      return next;
    });
    void tracked; // count is for debugging only; badges read the map.
  } catch {
    // Tracking must never break opening tabs.
  }
}

/** Drop one tabId from the map (tab closed manually). Never throws. */
async function untrackOpenTab(tabId: number): Promise<void> {
  try {
    await mutateOpenTabs((map) => untrackTabId(map, tabId).map);
  } catch {
    // Non-fatal: a stale entry is healed by reconcile + tab tolerance.
  }
}

/**
 * Focus a task's most recently opened tab (badge click). Tries tabIds
 * newest-first; a tab that is gone is untracked and the next one is
 * tried. Returns { ok, focusedTabId } or { ok:false, error }.
 */
async function focusTaskTabs(taskId: string): Promise<{ ok: boolean; focusedTabId?: number; error?: string }> {
  if (typeof taskId !== "string" || !taskId) return { ok: false, error: "Missing task id." };
  const map = await loadOpenTabs();
  const ids = [...(map[taskId] ?? [])].reverse();
  if (ids.length === 0) return { ok: false, error: "That task has no open tab." };
  for (const tabId of ids) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab) throw new Error("Tab is gone.");
      try {
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch {
        // Focusing the window is best-effort; activating the tab below still works.
      }
      await chrome.tabs.update(tabId, { active: true });
      return { ok: true, focusedTabId: tabId };
    } catch {
      // Tab is gone — drop it and try the next one.
      await untrackOpenTab(tabId);
    }
  }
  return { ok: false, error: "That tab is no longer open." };
}

/**
 * Close every tab tracked for a task (Close button). Closes by tabId
 * only — no other tab can be touched. Missing tabs are tolerated
 * (already closed). Returns { ok, closed }.
 */
async function closeTaskTabs(taskId: string): Promise<{ ok: boolean; closed?: number; error?: string }> {
  if (typeof taskId !== "string" || !taskId) return { ok: false, error: "Missing task id." };
  const map = await loadOpenTabs();
  const ids = [...(map[taskId] ?? [])];
  if (ids.length === 0) return { ok: true, closed: 0 };
  let closed = 0;
  try {
    await chrome.tabs.remove(ids);
    closed = ids.length;
  } catch {
    // tabs.remove throws when ANY id is already gone — fall back to
    // closing them one by one so one dead tab cannot block the rest.
    closed = 0;
    for (const id of ids) {
      try {
        await chrome.tabs.remove(id);
        closed += 1;
      } catch {
        // Already closed — counts as closed for the badge either way.
        closed += 1;
      }
    }
  }
  // The tabs.onRemoved listener also untracks these, but do it here
  // too: the close must reflect immediately, not after the event.
  await mutateOpenTabs((m) => untrackTask(m, taskId).map).catch(() => {
    // Non-fatal: onRemoved heals it.
  });
  return { ok: true, closed };
}

/**
 * Heal the map: drop entries for deleted tasks, and drop tracked tabs
 * that are gone or no longer on the task's site (URL edited, or the
 * tab navigated away without the onUpdated check catching it). Runs on
 * task-list changes and on startup. Never throws.
 */
async function reconcileOpenTabs(): Promise<void> {
  try {
    await mutateOpenTabs(async (map) => {
      const tasks = await loadTasks();
      const byId = new Map(tasks.map((t) => [t.id, t]));
      let next = map;
      for (const taskId of Object.keys(next)) {
        const task = byId.get(taskId);
        if (!task) {
          next = untrackTask(next, taskId).map;
          continue;
        }
        for (const tabId of [...(next[taskId] ?? [])]) {
          let keep = false;
          try {
            const tab = await chrome.tabs.get(tabId);
            keep = !!tab && typeof tab.url === "string" && sameSite(tab.url, task.url);
          } catch {
            keep = false;
          }
          if (!keep) next = untrackTabId(next, tabId).map;
        }
      }
      return next;
    });
  } catch {
    // Non-fatal: stale entries are tolerated everywhere else.
  }
}

/**
 * v1.4: re-create every routine alarm from current state. Clears all
 * `hgf-` alarms first, then re-creates: one per task reminder (not
 * for completed tasks — a done task needs no reminder), the daily
 * nudge, scheduled Open All, one per scheduled Flow, one per note
 * due date still in the future. Every recurring alarm is a ONE-SHOT:
 * the fire handler re-creates the next occurrence, so weekday-only
 * schedules never fire on the wrong day. Called on install/startup,
 * on every change to tasks/flows/notes/reminders settings, and after
 * every alarm fires. Never throws.
 */
async function rescheduleAlarms(): Promise<void> {
  try {
    if (!chrome?.alarms?.getAll || !chrome?.alarms?.create || !chrome?.alarms?.clear) return;
    const all = await chrome.alarms.getAll();
    for (const a of all || []) {
      if (typeof a?.name === "string" && a.name.startsWith(ALARM_PREFIX)) {
        try {
          await chrome.alarms.clear(a.name);
        } catch {
          // A stale alarm that cannot be cleared is harmless — its
          // handler validates the id against storage before acting.
        }
      }
    }
    const now = Date.now();
    const tasks = await loadTasks();
    for (const t of tasks) {
      if (!t.reminder || t.completed === true) continue;
      const when = nextReminderFire(t.reminder.time, t.reminder.days, now);
      if (when !== null) {
        try {
          await chrome.alarms.create(reminderAlarmName(t.id), { when });
        } catch {
          // One bad alarm must not block the rest.
        }
      }
    }
    const settings = await loadRemindersSettings();
    if (settings.nudgeEnabled) {
      try {
        await chrome.alarms.create(ALARM_NUDGE, { when: nextNudgeFire(settings.nudgeHour, now) });
      } catch {
        // Non-fatal.
      }
    }
    if (settings.scheduledOpenAll) {
      const when = nextReminderFire(settings.scheduledOpenAll.time, settings.scheduledOpenAll.days, now);
      if (when !== null) {
        try {
          await chrome.alarms.create(ALARM_OPEN_ALL, { when });
        } catch {
          // Non-fatal.
        }
      }
    }
    const flows = await loadFlows();
    for (const f of flows) {
      if (!f.schedule) continue;
      const when = nextFlowFire(f.schedule, now);
      if (when !== null) {
        try {
          await chrome.alarms.create(flowAlarmName(f.id), { when });
        } catch {
          // Non-fatal.
        }
      }
    }
    const notes = await loadNotes();
    for (const n of notes) {
      if (typeof n.dueAt !== "number" || n.dueAt <= now) continue;
      try {
        await chrome.alarms.create(noteAlarmName(n.id), { when: n.dueAt });
      } catch {
        // Non-fatal.
      }
    }
    // v1.5+ (#21): one one-shot alarm per snooze still in the future.
    const snoozes = await loadSnoozes();
    for (const s of snoozes) {
      if (typeof s.returnAt !== "number" || s.returnAt <= now) continue;
      try {
        await chrome.alarms.create(snoozeAlarmName(s.taskId), { when: s.returnAt });
      } catch {
        // Non-fatal.
      }
    }
    // v1.5+ (#11): one hourly alarm that re-checks dark-hours
    // userstyles (a style whose window just opened must register
    // without the user touching anything).
    try {
      const nextHour = new Date(now);
      nextHour.setMinutes(0, 0, 0);
      nextHour.setHours(nextHour.getHours() + 1);
      await chrome.alarms.create(ALARM_STYLES_HOURLY, { when: nextHour.getTime() });
    } catch {
      // Non-fatal.
    }
    // v1.5+ (#15): re-create the suspend alarm from the pending
    // list (a worker restart must not lose a scheduled discard).
    try {
      const pending = await loadSmartOpenPending();
      const future = pending.filter((p) => p.viewed !== true && typeof p.suspendAt === "number" && p.suspendAt > now);
      if (future.length > 0) {
        const earliest = Math.min(...future.map((p) => p.suspendAt));
        await chrome.alarms.create(ALARM_SMART_SUSPEND, { when: earliest });
      }
    } catch {
      // Non-fatal.
    }
    // Later (#13): one one-shot alarm per ENABLED schedule. A schedule
    // whose script was deleted/disabled is skipped here — the fire
    // handler logs the honest reason instead of alarming forever.
    try {
      const schedules = await loadSchedules();
      const scripts = await loadScripts();
      for (const entry of enabledSchedules(schedules)) {
        if (!scripts.some((s) => s.id === entry.scriptId)) continue;
        try {
          await chrome.alarms.create(scheduleAlarmName(entry.scriptId), {
            when: now + entry.intervalMinutes * 60 * 1000,
          });
        } catch {
          // One bad alarm must not block the rest.
        }
      }
    } catch {
      // Non-fatal.
    }
    // Later (#20): the periodic-sync alarm exists ONLY while sync is
    // enabled with a periodic interval. With sync off (the default)
    // no hgf-sync alarm is ever created — and no sync request is made.
    try {
      const syncSettings = await loadSyncSettings();
      const when = nextSyncFire(syncSettings, now);
      if (when !== null) {
        await chrome.alarms.create(SYNC_ALARM, { when });
      }
    } catch {
      // Non-fatal.
    }
  } catch {
    // Alarms unavailable — reminders just don't fire; the dashboard
    // status line says so instead of pretending otherwise.
  }
}

/** v1.4: one task's reminder fired. The task must still exist, still
 *  have that reminder, and not be completed — otherwise nothing
 *  happens (a stale alarm is inert). Notifications off → silent. */
async function fireReminderAlarm(taskId: string): Promise<void> {
  if (typeof taskId !== "string" || !taskId) return;
  const tasks = await loadTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task || !task.reminder || task.completed === true) return;
  if ((await getNotificationLevel()) !== "granted") return;
  notifyWithId(
    taskNotificationId(task.id),
    `HiddenGem Flow — ${task.name}`,
    `Reminder — opens at ${task.reminder.time}. Click to open the task.`,
  );
}

/**
 * v1.4: the daily-nudge check — shared by the alarm and by the
 * dashboard's "Test nudge now" button (MSG_REMINDERS_FORCE_NUDGE).
 * Pinned + unopened-today tasks get one notification; when there are
 * none, nothing is shown (the honest no-nudge state — the caller
 * reports "no pinned tasks need opening"). Notifications off → no
 * notification, and the error says so.
 */
async function runNudgeCheck(): Promise<{ nudged: boolean; count: number; names: string[]; error?: string }> {
  const settings = await loadRemindersSettings();
  if (!settings.nudgeEnabled) return { nudged: false, count: 0, names: [], error: "Daily nudge is off." };
  const tasks = await loadTasks();
  const unopened = unopenedPinnedTasks(tasks);
  if (unopened.length === 0) return { nudged: false, count: 0, names: [] };
  if ((await getNotificationLevel()) !== "granted") {
    return { nudged: false, count: unopened.length, names: unopened.map((t) => t.name), error: "Notifications are blocked — the nudge cannot alert you." };
  }
  notifyWithId(NUDGE_NOTIFICATION_ID, "HiddenGem Flow — Pinned task not opened", formatNudgeMessage(unopened));
  return { nudged: true, count: unopened.length, names: unopened.map((t) => t.name) };
}

/** v1.4: scheduled Open All fired — open the chosen scope through
 *  the same openUrls funnel as a manual Open All (50-tab cap +
 *  open-tabs tracking apply). */
async function fireOpenAllAlarm(): Promise<void> {
  const settings = await loadRemindersSettings();
  const scheduled = settings.scheduledOpenAll;
  if (!scheduled) return;
  const tasks = await loadTasks();
  const chosen = scheduled.scope === "pinned" ? tasks.filter((t) => t.pinned) : tasks;
  if (chosen.length === 0) return;
  const result = await openUrls(chosen.map((t) => t.url));
  if (result.opened > 0) {
    notify("HiddenGem Flow — Scheduled Open All", `Opened ${result.opened} tab${result.opened === 1 ? "" : "s"}${result.skipped > 0 ? `, ${result.skipped} skipped (50 open at a time)` : ""}.`);
  }
}

/**
 * v1.4: run one Flow — by hand (dashboard Run now) or on its alarm.
 * The Flow's ids are validated against storage FIRST (resolveFlowRefs):
 * ids that no longer exist are dropped from this run, never guessed.
 * Tasks open through openUrls (50-tab cap, run log, open-tabs
 * tracking). Scripts run ONLY when already installed, enabled and
 * unarchived — and only by matching an opened page through the
 * normal chrome.userScripts registration: nothing is ever installed
 * here, scheduled or manual. The Flow's note is returned (and its
 * title notified) so the caller can show it — the note itself is
 * never opened as a page.
 */
async function runFlow(
  flowId: string,
  source: "manual" | "alarm",
): Promise<{ ok: boolean; opened?: number; skipped?: number; scriptNames?: string[]; skippedScripts?: number; noteTitle?: string | null; noteBody?: string | null; noteId?: string | null; missingTasks?: number; noAccessScripts?: number; noAccessNames?: string[]; engineOff?: boolean; error?: string }> {
  if (typeof flowId !== "string" || !flowId) return { ok: false, error: "Missing flow id." };
  const flows = await loadFlows();
  const flow = flows.find((f) => f.id === flowId);
  if (!flow) return { ok: false, error: "That flow no longer exists." };
  const [tasks, scripts, notes] = await Promise.all([loadTasks(), loadScripts(), loadNotes()]);
  const refs = resolveFlowRefs(
    flow,
    tasks.map((t) => t.id),
    scripts.map((s) => s.id),
    notes.map((n) => n.id),
  );
  const flowTasks = refs.taskIds
    .map((id) => tasks.find((t) => t.id === id))
    .filter((t): t is (typeof tasks)[number] => !!t);
  if (flowTasks.length === 0) {
    return { ok: false, error: "This flow has no saved tasks left — edit it to add tasks." };
  }
  const result = await openUrls(flowTasks.map((t) => t.url));
  const openedUrls = flowTasks.map((t) => t.url);
  // Scripts that run: installed + enabled + unarchived AND matching
  // at least one opened page. Everything else is counted as skipped
  // (not installed / disabled / archived / matching no opened page) —
  // never installed, never run on a page the Flow did not open.
  // When Chrome's "Allow User Scripts" toggle is OFF, NO script can
  // run at all — the run then honestly reports every script skipped
  // instead of claiming matches that never execute (the toggle is
  // off in a fresh profile, so this is the common first-run case).
  const engineCheck = await checkUserScripts();
  const scriptsCanRun = engineCheck.available;
  const matchedScripts: typeof scripts = [];
  const noAccessScripts: typeof scripts = [];
  for (const id of refs.scriptIds) {
    if (!scriptsCanRun) break;
    const script = scripts.find((s) => s.id === id);
    if (!script || !script.enabled || script.archived === true) continue;
    if (!openedUrls.some((url) => scriptsForUrl([script], url).length > 0)) continue;
    // v1.4 (A-40): a URL match alone does NOT mean the script runs.
    // Chrome only executes user scripts on pages the extension has
    // host access for, and a Flow-opened tab carries no activeTab
    // grant (there is no gesture on it) — so only a persistent
    // site-access grant counts here. Without one the script is
    // skipped and named, never claimed as running (the same honesty
    // rule A-33 applied to run-script / self-test).
    if (await scriptHasHostAccess(script)) matchedScripts.push(script);
    else noAccessScripts.push(script);
  }
  const skippedScripts = flow.scriptIds.length - matchedScripts.length;
  const note = refs.noteId ? notes.find((n) => n.id === refs.noteId) ?? null : null;
  const noteTitle = note ? displayTitle(note.title, note.body) : null;
  const lastRun = { at: Date.now(), opened: result.opened, scriptNames: matchedScripts.map((s) => s.name), noteTitle };
  try {
    // lastRun only — updatedAt is NOT bumped, so a run never
    // re-sorts the Flow list.
    await saveFlows(flows.map((f) => (f.id === flowId ? { ...f, lastRun } : f)));
  } catch {
    // The run still happened; the last-run line just stays stale.
  }
  const summary = formatFlowRunResult({
    opened: result.opened,
    skipped: result.skipped,
    scriptNames: matchedScripts.map((s) => s.name),
    skippedScripts,
    noAccessNames: noAccessScripts.map((s) => s.name),
    noteTitle,
  });
  notifyWithId(flowNotificationId(flow.id), `HiddenGem Flow — ${flow.name}`, scriptsCanRun ? summary : `${summary} User scripts are off — enable the toggle to run scripts.`);
  void source; // manual vs alarm only changes who shows the result.
  return {
    ok: true,
    opened: result.opened,
    skipped: result.skipped,
    scriptNames: matchedScripts.map((s) => s.name),
    skippedScripts,
    noteTitle,
    noteBody: note ? note.body : null,
    noteId: note ? note.id : null,
    missingTasks: refs.missingTaskIds.length,
    noAccessScripts: noAccessScripts.length,
    noAccessNames: noAccessScripts.map((s) => s.name),
    engineOff: !scriptsCanRun,
  };
}

/** v1.4: a note's due date fired. The note must still exist and still
 *  carry that due date. Notifications off → silent. */
async function fireNoteAlarm(noteId: string): Promise<void> {
  if (typeof noteId !== "string" || !noteId) return;
  const notes = await loadNotes();
  const note = notes.find((n) => n.id === noteId);
  if (!note || typeof note.dueAt !== "number") return;
  if ((await getNotificationLevel()) !== "granted") return;
  notifyWithId(
    noteNotificationId(note.id),
    "HiddenGem Flow — Note due",
    `${displayTitle(note.title, note.body)} is due now. Click to open Notepad.`,
  );
}

// ---------------------------------------------------------------------------
// Later (#13) — scheduled scripts
// ---------------------------------------------------------------------------

/** Scripts with a run in progress right now (in-memory; a second fire for the same script is skipped, never overlapped). */
const scheduleRunning = new Set<string>();

/** Grace period a scheduled run's background tab stays open after load, so the script can do its work. */
const SCHEDULE_RUN_GRACE_MS = 5000;
/** Longest a scheduled run waits for its tab to finish loading. */
const SCHEDULE_RUN_LOAD_TIMEOUT_MS = 20000;

/**
 * Later (#13): run one scheduled script — on its alarm, or on the
 * dashboard's "Run now". Every gate is re-validated at fire time:
 * the script must still exist, be enabled and unarchived, the
 * userScripts engine must be on, and the extension must have host
 * access for the script's @match sites. ANY failure logs an honest
 * run-log line and opens NOTHING. A run on the ALARM additionally
 * requires the schedule to still be enabled (a stale alarm is inert);
 * a MANUAL "Run now" is an explicit user gesture, so it runs without
 * an enabled schedule — the confirm-first gate guards the AUTOMATIC
 * schedule, not a run the user just asked for. A run opens the
 * script's @match site in a BACKGROUND tab (active:false), waits for
 * load + a grace period so the registered script runs on load, then
 * closes the tab. The script is never installed here, never executed
 * by this code (no eval), and never runs on a page the user has not
 * granted access to. Returns { ok, error? } — the run log is the
 * visible record.
 */
async function fireScheduleRun(
  scriptId: string,
  source: "alarm" | "manual",
): Promise<{ ok: boolean; error?: string }> {
  if (typeof scriptId !== "string" || !scriptId) return { ok: false, error: "Missing script id." };
  const schedules = await loadSchedules();
  const schedule: ScheduleEntry | undefined = schedules[scriptId];
  if (source === "alarm" && (!schedule || schedule.enabled !== true)) {
    // Stale alarm (schedule turned off after the alarm was created) — inert, no log line.
    return { ok: false, error: "That schedule is off." };
  }
  const scripts = await loadScripts();
  const script = scripts.find((s) => s.id === scriptId);
  if (!script) {
    // The script is gone — drop its schedule and say so in the log.
    try {
      const current = await loadSchedules();
      await saveSchedules(removeSchedule(current, scriptId));
    } catch {
      // The schedule just stays until the next reschedule prunes it.
    }
    await logScheduleRun(createScheduleRunEntry(scriptId, "(deleted script)", "skipped", "Script no longer installed — schedule removed."));
    return { ok: false, error: "That script no longer exists — its schedule was removed." };
  }
  if (!script.enabled || script.archived === true) {
    await logScheduleRun(
      createScheduleRunEntry(scriptId, script.name, "failed", script.archived === true ? "Script is archived — restore it to run on a schedule." : "Script is disabled — enable it to run on a schedule."),
    );
    return { ok: false, error: "That script is disabled or archived." };
  }
  if (scheduleRunning.has(scriptId)) {
    await logScheduleRun(createScheduleRunEntry(scriptId, script.name, "skipped", "Previous run still going — skipped this time."));
    return { ok: false, error: "A run for this script is already going." };
  }
  const engineCheck = await checkUserScripts();
  if (!engineCheck.available) {
    await logScheduleRun(createScheduleRunEntry(scriptId, script.name, "failed", "User scripts are not enabled — flip “Allow User Scripts” on in the extension details."));
    return { ok: false, error: engineCheck.error ?? "User scripts are not enabled." };
  }
  // A-55: a run must never claim "ok" for a script that cannot
  // possibly execute. Registrations live in the extension's runtime
  // state — a service-worker restart can drop them — so verify this
  // script is actually registered RIGHT NOW. If it is not, try once
  // to re-register everything from storage; if it is STILL missing,
  // log an honest failure and open NOTHING.
  let registered = false;
  try {
    const all = await chrome.userScripts.getScripts();
    registered = (all || []).some((r: { id?: string }) => r.id === scriptId);
  } catch {
    registered = false;
  }
  if (!registered) {
    try {
      await reregisterEnabledFromStorage();
    } catch {
      // reregisterEnabledFromStorage never throws — belt and braces.
    }
    try {
      const again = await chrome.userScripts.getScripts();
      registered = (again || []).some((r: { id?: string }) => r.id === scriptId);
    } catch {
      registered = false;
    }
  }
  if (!registered) {
    await logScheduleRun(
      createScheduleRunEntry(scriptId, script.name, "failed", "Script is not registered — open the Scripts tab and re-enable it. Nothing ran."),
    );
    return { ok: false, error: "That script is not registered." };
  }
  // Same host-access rule as a manual run (A-33/A-40): a persistent
  // grant is the only thing that counts here — a scheduled run has no
  // toolbar click, so there is no activeTab grant to lean on.
  let hasAccess = false;
  try {
    hasAccess = await scriptHasHostAccess(script);
  } catch {
    hasAccess = false;
  }
  if (!hasAccess) {
    await logScheduleRun(
      createScheduleRunEntry(scriptId, script.name, "failed", "No site access for this script's sites — grant it from the Scripts tab (Grant site access). Nothing ran."),
    );
    return { ok: false, error: "That script has no site access yet." };
  }
  const url = (script.matches || []).map((m) => urlFromMatchPattern(m)).find((u): u is string => u !== null) ?? null;
  if (!url) {
    await logScheduleRun(createScheduleRunEntry(scriptId, script.name, "failed", "No @match site to open — add an @match line to run it on a schedule."));
    return { ok: false, error: "That script has no @match site to open." };
  }
  scheduleRunning.add(scriptId);
  let tabId: number | null = null;
  try {
    let tab: { id?: number } | null = null;
    try {
      tab = await chrome.tabs.create({ url, active: false });
    } catch (err) {
      await logScheduleRun(createScheduleRunEntry(scriptId, script.name, "failed", `Could not open the site tab: ${err instanceof Error ? err.message : String(err)}`));
      return { ok: false, error: "Could not open the site tab." };
    }
    tabId = typeof tab?.id === "number" ? tab.id : null;
    if (tabId === null) {
      await logScheduleRun(createScheduleRunEntry(scriptId, script.name, "failed", "The background tab could not be created."));
      return { ok: false, error: "The background tab could not be created." };
    }
    // Wait for the tab to finish loading (poll, up to the timeout).
    const deadline = Date.now() + SCHEDULE_RUN_LOAD_TIMEOUT_MS;
    let loaded = false;
    while (Date.now() < deadline) {
      try {
        const current = await chrome.tabs.get(tabId);
        if (!current) break;
        if (current.status === "complete") {
          loaded = true;
          break;
        }
      } catch {
        break; // Tab closed already.
      }
      await delay(500);
    }
    if (!loaded) {
      await logScheduleRun(createScheduleRunEntry(scriptId, script.name, "failed", "Site did not finish loading — will retry at the next run."));
      return { ok: false, error: "The site did not finish loading." };
    }
    // Grace period: the registered script runs on load; give it time
    // to do its work (e.g. write a GM value) before the tab closes.
    await delay(SCHEDULE_RUN_GRACE_MS);
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    })();
    await logScheduleRun(
      createScheduleRunEntry(scriptId, script.name, "ok", `Opened ${host} in a background tab — page loaded, script registered for this site, tab closed after 5 s.`),
    );
    return { ok: true };
  } finally {
    scheduleRunning.delete(scriptId);
    if (tabId !== null) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        // Already closed — fine.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Later (#20) — opt-in sync
// ---------------------------------------------------------------------------

/** Human label for a provider in status/error lines (never a URL or token). */
function syncProviderLabel(provider: string): string {
  if (provider === "gist") return "GitHub Gist";
  if (provider === "drive") return "Google Drive";
  return "the WebDAV server";
}

/** Record the last sync attempt in settings (never contains a token or URL). Never throws. */
async function recordSyncResult(ok: boolean, message: string): Promise<void> {
  try {
    const settings = await loadSyncSettings();
    await saveSyncSettings({ ...settings, lastSync: { at: Date.now(), ok, message: message.slice(0, 300) } });
  } catch {
    // The sync itself already happened (or failed); the record is secondary.
  }
}

/**
 * Later (#20): upload local state to the provider. Snapshot-first
 * (a bad push is recoverable from the snapshot), then validate the
 * target + host, then send. The token is attached ONLY after the
 * host check passes, and is never logged. On failure local data is
 * untouched and the error names the provider, never the URL.
 */
async function syncUpload(): Promise<{ ok: boolean; error?: string }> {
  const settings = await loadSyncSettings();
  if (settings.enabled !== true) return { ok: false, error: "Sync is off — turn it on in the Later tab first." };
  const target = validateSyncTarget(settings.provider, settings);
  if (!target.ok) {
    await recordSyncResult(false, target.error);
    return { ok: false, error: target.error };
  }
  const tokens = await loadSyncTokens();
  if (settings.provider === "gist" && !tokens.gistToken) {
    const error = "No Gist token saved — paste your personal access token in the Later tab first.";
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  if (settings.provider === "drive" && !tokens.driveToken) {
    const error = "No Drive token saved — paste your access token in the Later tab first.";
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  if (settings.provider === "webdav" && !tokens.webdavUser && !tokens.webdavPassword) {
    const error = "No WebDAV credentials saved — add them in the Later tab first (or leave them blank only if your server needs none).";
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  const url = syncUploadUrl(settings.provider, settings);
  if (!url || !syncHostAllowed(settings.provider, url)) {
    const error = `The ${syncProviderLabel(settings.provider)} address was refused — it does not match that provider.`;
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  // Snapshot FIRST — a sync must never destroy local data without one.
  await takeSnapshot();
  const data = await collectBackupData();
  const backupJson = JSON.stringify(buildFullBackup(data));
  const body = buildSyncUploadBody(settings.provider, backupJson);
  if (body === null) {
    const error = "Unknown sync provider — nothing was sent.";
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.provider === "webdav") {
    if (tokens.webdavUser || tokens.webdavPassword) {
      headers.Authorization = `Basic ${btoa(`${tokens.webdavUser}:${tokens.webdavPassword}`)}`;
    }
  } else if (settings.provider === "gist") {
    headers.Authorization = `Bearer ${tokens.gistToken}`;
  } else {
    headers.Authorization = `Bearer ${tokens.driveToken}`;
  }
  const method = settings.provider === "webdav" ? "PUT" : "PATCH";
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, credentials: "omit" });
  } catch (err) {
    const error = `Could not reach ${syncProviderLabel(settings.provider)} — ${err instanceof Error ? err.message : String(err)} Local data is untouched.`;
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  if (!res.ok) {
    const error = `${syncProviderLabel(settings.provider)} refused the upload (HTTP ${res.status}). Local data is untouched.`;
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  const message = `Uploaded to ${syncProviderLabel(settings.provider)} — ${data.tasks.length} task${data.tasks.length === 1 ? "" : "s"}, ${data.scripts.length} script${data.scripts.length === 1 ? "" : "s"}, ${data.notes.length} note${data.notes.length === 1 ? "" : "s"}.`;
  await recordSyncResult(true, message);
  return { ok: true };
}

/**
 * Later (#20): download the provider copy and write it over local
 * state — fetch + strict-parse first (the same parseFullBackup as a
 * file import; a bad payload is refused as a whole and local data is
 * untouched), then snapshot, then write. "Snapshot-first" means the
 * snapshot always precedes the WRITE that replaces local state — the
 * same order as a backup restore (and as the upload, which snapshots
 * before sending). takeSnapshot dedupes: if the newest snapshot
 * already holds the identical state it returns null, because that
 * snapshot already protects the state.
 */
async function syncDownload(): Promise<{ ok: boolean; error?: string }> {
  const settings = await loadSyncSettings();
  if (settings.enabled !== true) return { ok: false, error: "Sync is off — turn it on in the Later tab first." };
  const target = validateSyncTarget(settings.provider, settings);
  if (!target.ok) {
    await recordSyncResult(false, target.error);
    return { ok: false, error: target.error };
  }
  const tokens = await loadSyncTokens();
  if (settings.provider === "gist" && !tokens.gistToken) {
    const error = "No Gist token saved — paste your personal access token in the Later tab first.";
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  if (settings.provider === "drive" && !tokens.driveToken) {
    const error = "No Drive token saved — paste your access token in the Later tab first.";
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  if (settings.provider === "webdav" && !tokens.webdavUser && !tokens.webdavPassword) {
    const error = "No WebDAV credentials saved — add them in the Later tab first (or leave them blank only if your server needs none).";
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  const url = syncDownloadUrl(settings.provider, settings);
  if (!url || !syncHostAllowed(settings.provider, url)) {
    const error = `The ${syncProviderLabel(settings.provider)} address was refused — it does not match that provider.`;
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  const headers: Record<string, string> = {};
  if (settings.provider === "webdav") {
    if (tokens.webdavUser || tokens.webdavPassword) {
      headers.Authorization = `Basic ${btoa(`${tokens.webdavUser}:${tokens.webdavPassword}`)}`;
    }
  } else if (settings.provider === "gist") {
    headers.Authorization = `Bearer ${tokens.gistToken}`;
  } else {
    headers.Authorization = `Bearer ${tokens.driveToken}`;
  }
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers, credentials: "omit" });
  } catch (err) {
    const error = `Could not reach ${syncProviderLabel(settings.provider)} — ${err instanceof Error ? err.message : String(err)} Local data is untouched.`;
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  if (!res.ok) {
    const error = `${syncProviderLabel(settings.provider)} refused the download (HTTP ${res.status}). Local data is untouched.`;
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  let text = "";
  try {
    text = await res.text();
  } catch {
    const error = `Could not read the download from ${syncProviderLabel(settings.provider)}. Local data is untouched.`;
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  const backupJson = extractSyncDownloadBody(settings.provider, text);
  if (!backupJson) {
    const error = `The copy on ${syncProviderLabel(settings.provider)} has no HiddenGem Flow backup in it. Local data is untouched.`;
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(backupJson);
  } catch {
    const error = `The copy on ${syncProviderLabel(settings.provider)} is not a usable backup file. Local data is untouched.`;
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  const check = parseFullBackup(parsed);
  if (!check.ok) {
    const error = `${check.error} Local data is untouched.`;
    await recordSyncResult(false, error);
    return { ok: false, error };
  }
  // Snapshot FIRST — the download replaces local state, so the old
  // state must be one click away. (Same rule as a backup restore.)
  await takeSnapshot();
  suppressAutoSnapshotUntil = Date.now() + 10000;
  await writeBackupData(check.data);
  const message = `Downloaded from ${syncProviderLabel(settings.provider)} — ${check.data.tasks.length} task${check.data.tasks.length === 1 ? "" : "s"}, ${check.data.scripts.length} script${check.data.scripts.length === 1 ? "" : "s"}, ${check.data.notes.length} note${check.data.notes.length === 1 ? "" : "s"}. Your previous state was saved as a snapshot first.`;
  await recordSyncResult(true, message);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// v1.5+ — sessions, smart Open All, userstyles, scratchpad, GM viewer, snooze
// ---------------------------------------------------------------------------

/** Hourly check for dark-hours userstyles (re-created by rescheduleAlarms). */
const ALARM_STYLES_HOURLY = "hgf-styles-hourly";

/**
 * v1.5+ (#11): (re-)register the active userstyles as content
 * scripts. Every style is re-validated before registration (a
 * hand-edited stored style can never smuggle an @import in), and a
 * style whose schedule is closed right now is simply not
 * registered — the hourly alarm re-checks. Returns how many are
 * active and how many were skipped (invalid CSS or a Chrome refusal).
 */
async function syncUserStyles(): Promise<{ active: number; skipped: number; needsGrant: number }> {
  if (!chrome?.scripting?.registerContentScripts || !chrome?.scripting?.getRegisteredContentScripts) {
    return { active: 0, skipped: 0, needsGrant: 0 };
  }
  const styles = await loadUserStyles();
  const now = Date.now();
  // A dynamically registered content script only RUNS on hosts the
  // user granted (optional host permission) — registering for an
  // ungranted host succeeds but never applies, so those styles are
  // skipped and reported as needing a grant instead.
  let grantedOrigins: string[] = [];
  try {
    const all = await chrome.permissions.getAll();
    grantedOrigins = (all?.origins || []).filter((o: unknown): o is string => typeof o === "string");
  } catch {
    grantedOrigins = [];
  }
  try {
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const ids = (registered || [])
      .map((r: { id?: string }) => r?.id)
      .filter((id: string | undefined): id is string => typeof id === "string" && id.startsWith(USERSTYLE_SCRIPT_PREFIX));
    if (ids.length > 0) {
      try {
        await chrome.scripting.unregisterContentScripts({ ids });
      } catch {
        // Unregister failed — the register below replaces by id anyway.
      }
    }
  } catch {
    // getRegisteredContentScripts unavailable — register anyway.
  }
  let active = 0;
  let skipped = 0;
  let needsGrant = 0;
  for (const style of styles) {
    const previewOn = style.preview === true && style.enabled === true;
    if (!styleScheduleActive(style, now) && !previewOn) continue;
    const check = validateUserStyleCss(style.css);
    if (!check.ok) {
      skipped += 1;
      continue;
    }
    if (!styleHostGranted(grantedOrigins, style.host)) {
      needsGrant += 1;
      continue;
    }
    try {
      // NOTE: registerContentScripts() takes CSS as FILE paths, not
      // inline text — so the style is registered with the shared
      // injector script (public/style-injector.js), which reads the
      // CSS from storage and injects it as a <style> element.
      await chrome.scripting.registerContentScripts([{
        id: `${USERSTYLE_SCRIPT_PREFIX}${style.id}`,
        matches: styleMatchPatterns(style.host),
        js: ["style-injector.js"],
        runAt: "document_start",
        persistAcrossSessions: true,
      }]);
      active += 1;
    } catch {
      skipped += 1;
    }
  }
  // Live re-apply on tabs that are already open (best-effort — a
  // navigation re-runs the injector anyway).
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (typeof tab?.id !== "number" || typeof tab?.url !== "string") continue;
      if (!/^https?:\/\//.test(tab.url)) continue;
      if (!styles.some((s) => s.enabled === true && styleMatchesUrl(s, tab.url))) continue;
      chrome.tabs.sendMessage(tab.id, { type: MSG_USERSTYLES_APPLY }).catch(() => undefined);
    }
  } catch {
    // Messaging unavailable — navigation still applies the styles.
  }
  return { active, skipped, needsGrant };
}

/**
 * v1.5+ (#14/#15): the OPTIONAL `tabGroups` permission, checked
 * at first use of grouping/sessions (never required in the
 * manifest). Contains-only: the service worker has no user
 * activation, so a permissions.request() from here cannot show the
 * prompt — the dashboard asks on the click gesture instead (A-50).
 * Returns true only when Chrome says the permission is held. A
 * denial is NOT an error — the caller degrades to plain tabs and
 * says so.
 */
async function ensureTabGroupsPermission(): Promise<boolean> {
  try {
    if (!chrome?.permissions?.contains || !chrome?.tabs?.group) return false;
    if ((await chrome.permissions.contains({ permissions: ["tabGroups"] })) === true) return true;
    // A-51: the grant is not visible to contains() the instant the
    // user clicks Allow — the request promise resolves first and the
    // grant lands up to ~1s later (measured live: a check 400 ms
    // after Allow still read false). A fresh Allow would otherwise
    // always read as a denial (the dashboard sends the message the
    // moment the prompt closes). Poll for up to 1.5s; a real denial
    // still returns false (the tabs are already open by then, so
    // the only cost is a later status line).
    for (let i = 0; i < 7; i++) {
      await delay(200);
      if ((await chrome.permissions.contains({ permissions: ["tabGroups"] })) === true) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * v1.5+ (#14): save the tabs of the last focused NORMAL window as a
 * named session. Extension pages and chrome:// tabs are dropped by
 * createSessionFromTabs. Returns the session, or an error when the
 * window has no usable tab.
 */
async function saveCurrentSession(name: string): Promise<{ ok: boolean; session?: Session; error?: string }> {
  if (typeof name !== "string" || !name.trim()) return { ok: false, error: "Give the session a name." };
  const wins = await chrome.windows.getAll({ populate: true }).catch(() => []);
  const list = Array.isArray(wins) ? wins : [];
  const target = list.find((w) => w?.focused && w?.type === "normal") ?? list.find((w) => w?.type === "normal");
  if (!target || !Array.isArray(target.tabs) || target.tabs.length === 0) {
    return { ok: false, error: "No normal browser window is open to save." };
  }
  const tabs: Array<{ url?: string; title?: string; groupName?: string; pinned?: boolean }> = [];
  for (const t of target.tabs) {
    let groupName: string | undefined;
    if (typeof t?.groupId === "number" && t.groupId >= 0) {
      try {
        const group = await chrome.tabGroups.get(t.groupId);
        if (typeof group?.title === "string" && group.title) groupName = group.title;
      } catch {
        // Group title unreadable — the tab is still saved, ungrouped.
      }
    }
    tabs.push({ url: t?.url, title: t?.title, groupName, pinned: t?.pinned === true });
  }
  const session = createSessionFromTabs(name, tabs);
  if (!session) return { ok: false, error: "That window has no http(s) tabs to save." };
  const sessions = await loadSessions();
  await saveSessions(addSession(sessions, session));
  return { ok: true, session };
}

/**
 * v1.5+ (#14): restore a session into a NEW window. Existing tabs
 * are NEVER closed — the restore only creates. Tab groups are
 * restored where Chrome reports them and the optional tabGroups
 * permission is held (requested once, at the user's restore click);
 * a denial restores the tabs ungrouped and says so.
 */
async function restoreSession(sessionId: string): Promise<{ ok: boolean; opened?: number; grouped?: boolean; groupDenied?: boolean; error?: string }> {
  if (typeof sessionId !== "string" || !sessionId) return { ok: false, error: "Missing session id." };
  const sessions = await loadSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return { ok: false, error: "That session no longer exists." };
  if (session.tabs.length === 0) return { ok: false, error: "That session has no tabs." };
  let win: { id?: number } | null = null;
  try {
    win = await chrome.windows.create({ url: session.tabs[0].url, focused: true });
  } catch (err) {
    return { ok: false, error: `Could not open a new window: ${err instanceof Error ? err.message : String(err)}` };
  }
  const windowId = typeof win?.id === "number" ? win.id : null;
  if (windowId === null) return { ok: false, error: "Could not open a new window." };
  const openedTabIds: number[] = [];
  // The first tab already exists (the window's own tab). Match it by
  // URL so the group step below can include it.
  try {
    const firstTabs = await chrome.tabs.query({ windowId });
    const first = (firstTabs || [])[0];
    if (first && typeof first.id === "number") openedTabIds.push(first.id);
  } catch {
    // The window opened — grouping just loses the first tab.
  }
  let opened = 1;
  for (let i = 1; i < session.tabs.length; i++) {
    try {
      const tab = await chrome.tabs.create({ windowId, url: session.tabs[i].url, active: false, pinned: session.tabs[i].pinned === true });
      if (tab && typeof tab.id === "number") {
        openedTabIds.push(tab.id);
        opened += 1;
      }
      await delay(150);
    } catch {
      // One bad URL must not abort the rest of the session.
    }
  }
  // Restore tab groups (best-effort, optional permission).
  const groups = sessionGroupNames(session);
  let grouped = false;
  let groupDenied = false;
  if (groups.length > 0 && openedTabIds.length > 0) {
    const allowed = await ensureTabGroupsPermission();
    if (!allowed) {
      groupDenied = true;
    } else {
      for (const groupName of groups) {
        const memberIds = session.tabs
          .map((t, idx) => (t.groupName === groupName ? openedTabIds[idx] : undefined))
          .filter((id): id is number => typeof id === "number");
        if (memberIds.length === 0) continue;
        try {
          const groupId = await chrome.tabs.group({ tabIds: memberIds, createProperties: { windowId } });
          await chrome.tabGroups.update(groupId, { title: groupName });
          grouped = true;
        } catch {
          // One group failing must not abort the others.
        }
      }
    }
  }
  return { ok: true, opened, grouped, groupDenied };
}

/**
 * v1.5+ (#15): smart Open All. Skips tabs that are already open
 * (by normalized URL), opens the rest (first in front, the rest in
 * the background — same stagger as openUrls), groups the new ones
 * into the named group when the optional permission allows, and
 * schedules suspension (discard, never close) of unviewed tabs.
 * Scope "missed" opens only tasks not opened today.
 */
async function smartOpen(scope: string): Promise<{
  ok: boolean;
  opened?: number;
  skipped?: number;
  grouped?: boolean;
  groupName?: string;
  groupDenied?: boolean;
  message?: string;
  error?: string;
}> {
  const settings = await loadSmartOpenSettings();
  const tasks = await loadTasks();
  const snoozes = await loadSnoozes();
  const visible = visibleTasks(tasks, snoozes);
  const chosen = scope === "pinned" ? visible.filter((t) => t.pinned) : visible;
  if (chosen.length === 0) return { ok: false, error: scope === "pinned" ? "No pinned tasks to open (snoozed tasks stay hidden until they return)." : "No tasks to open (snoozed tasks stay hidden until they return)." };
  let openTabUrls: string[] = [];
  try {
    const tabs = await chrome.tabs.query({});
    openTabUrls = (tabs || []).map((t: { url?: string }) => t?.url).filter((u: unknown): u is string => typeof u === "string");
  } catch {
    openTabUrls = [];
  }
  const lastOpenedAt: Record<string, number | undefined> = {};
  for (const t of chosen) {
    const n = normalizeUrl(t.url);
    if (n) lastOpenedAt[n] = t.lastOpenedAt;
  }
  const plan = planSmartOpen(chosen.map((t) => t.url), openTabUrls, lastOpenedAt);
  const toOpen = scope === "missed" ? plan.missed : plan.toOpen;
  if (toOpen.length === 0) {
    return { ok: true, opened: 0, skipped: plan.alreadyOpen.length, grouped: false, message: formatSmartOpenResult({ opened: 0, skipped: plan.alreadyOpen.length, grouped: false }) };
  }
  // Open the missing tabs (run log + lastOpenedAt stamping, like openUrls).
  let runs: RunEntry[] = [];
  try {
    runs = await loadRuns();
  } catch {
    runs = [];
  }
  let enabledScripts: Script[] = [];
  try {
    enabledScripts = (await loadScripts()).filter((s) => s.enabled);
  } catch {
    enabledScripts = [];
  }
  const urls = toOpen.slice(0, MAX_OPEN_AT_ONCE);
  const openedTabIds: number[] = [];
  const openedTabs: Array<{ url: string; tabId: number }> = [];
  let opened = 0;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const matchedIds = scriptsForUrl(enabledScripts, url).map((s) => s.id);
    const entry = createRunEntry(url, null, matchedIds);
    runs = addRunEntry(runs, entry, RUNS_LIMIT);
    try {
      await saveRuns(runs);
    } catch {
      // Non-fatal.
    }
    try {
      const tab = await chrome.tabs.create({ url, active: i === 0 });
      const tabId = tab && typeof tab.id === "number" ? tab.id : null;
      runs = updateRunEntry(runs, entry.runId, { status: "running", tabId });
      opened += 1;
      if (tabId !== null) {
        openedTabIds.push(tabId);
        openedTabs.push({ url, tabId });
      }
    } catch (err) {
      console.warn("[HiddenGem Flow] smart Open All could not open tab:", url, err);
      runs = updateRunEntry(runs, entry.runId, { status: "failed" });
    }
    try {
      await saveRuns(runs);
    } catch {
      // Non-fatal.
    }
    if (url !== urls[urls.length - 1]) await delay(OPEN_STAGGER_MS);
  }
  if (opened > 0) {
    try {
      await saveTasks(markOpened(tasks, urls));
    } catch {
      // Non-fatal.
    }
    void trackOpenedTaskTabs(openedTabs).catch(() => {
      // Silent: the tabs are open either way.
    });
  }
  // Group the new tabs (optional permission; denial degrades honestly).
  let grouped = false;
  let groupDenied = false;
  if (settings.groupEnabled && openedTabIds.length > 0) {
    const allowed = await ensureTabGroupsPermission();
    if (!allowed) {
      groupDenied = true;
    } else {
      try {
        const winId = (await chrome.tabs.get(openedTabIds[0]))?.windowId;
        const groupId = await chrome.tabs.group({ tabIds: openedTabIds, createProperties: { windowId: winId } });
        await chrome.tabGroups.update(groupId, { title: settings.groupName });
        grouped = true;
      } catch {
        // Grouping failed — the tabs are open either way.
      }
    }
  }
  // Schedule suspension of unviewed tabs (discard, never close).
  if (settings.suspendMinutes > 0 && openedTabIds.length > 0) {
    const now = Date.now();
    const pending: SmartOpenPending[] = openedTabIds.map((tabId) => ({
      tabId,
      openedAt: now,
      suspendAt: now + settings.suspendMinutes * 60 * 1000,
    }));
    try {
      const existing = await loadSmartOpenPending();
      await saveSmartOpenPending([...existing, ...pending]);
    } catch {
      // Non-fatal: suspension just doesn't happen this time.
    }
    void rescheduleAlarms();
  }
  const message = formatSmartOpenResult({
    opened,
    skipped: plan.alreadyOpen.length,
    grouped,
    groupName: settings.groupName,
    groupDenied,
    suspendMinutes: settings.suspendMinutes,
  });
  if (opened > 0) notify("HiddenGem Flow — Smart Open All", message);
  return { ok: true, opened, skipped: plan.alreadyOpen.length, grouped, groupName: settings.groupName, groupDenied, message };
}

/**
 * v1.5+ (#15): discard the smart-opened tabs that are due for
 * suspension AND still unviewed. Discard only — a discarded tab
 * stays in the tab strip and reloads on click; it is never closed.
 * Viewed tabs (marked by tabs.onActivated) are never touched.
 */
async function discardPendingTabs(): Promise<{ discarded: number }> {
  const pending = await loadSmartOpenPending();
  const due = duePendingTabs(pending);
  let discarded = 0;
  const remaining = pending.filter((p) => !due.includes(p));
  for (const p of due) {
    try {
      const tab = await chrome.tabs.get(p.tabId);
      if (!tab || tab.active === true || tab.discarded === true) continue;
      await chrome.tabs.discard(p.tabId);
      discarded += 1;
    } catch {
      // Tab already closed — it just drops out of the pending list.
    }
  }
  await saveSmartOpenPending(remaining);
  return { discarded };
}

/**
 * v1.5+ (#21): a snooze fired. The snooze is removed (the task
 * returns to the main list) and the user is notified. The alarm
 * NEVER opens anything by itself — the task only reappears.
 */
async function fireSnoozeAlarm(taskId: string): Promise<void> {
  if (typeof taskId !== "string" || !taskId) return;
  const snoozes = await loadSnoozes();
  const snooze = snoozes.find((s) => s.taskId === taskId);
  if (!snooze) return;
  await saveSnoozes(snoozes.filter((s) => s.taskId !== taskId));
  const tasks = await loadTasks();
  const task = tasks.find((t) => t.id === taskId);
  if ((await getNotificationLevel()) !== "granted") return;
  notifyWithId(
    snoozeNotificationId(taskId),
    "HiddenGem Flow — Task back in your list",
    task ? `“${task.name}” is back in Daily Tasks — its snooze ended (${snooze.label}).` : "A snoozed task is back in Daily Tasks.",
  );
}

/**
 * v1.5+ (#12): run the scratchpad ONCE on the current tab.
 * JS goes through the temporary-userScripts path (the same
 * sanctioned route as "Run script on this page" — no eval, no new
 * Function; the code is the user's own typed text, registered for
 * exactly this tab's URL, reloaded once, unregistered after 15 s).
 * CSS tries chrome.scripting.insertCSS first (no toggle needed) and
 * falls back to the same temporary-userScripts path with a css
 * entry. Nothing is saved anywhere — the scratchpad writes no
 * storage at all.
 */
async function runScratchpad(code: string, kind: ScratchpadKind): Promise<{ ok: boolean; error?: string }> {
  const check = validateScratchpad(code, kind);
  if (!check.ok) return { ok: false, error: check.error };
  const tab = await getActiveTabOfNormalWindow();
  if (!tab || typeof tab.id !== "number" || typeof tab.url !== "string" || !tab.url) {
    return { ok: false, error: "No active tab to run on — open a site tab first." };
  }
  const tabId = tab.id;
  const tabUrl = tab.url;
  let pattern: string;
  try {
    const u = new URL(tabUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, error: "The scratchpad only runs on http(s) pages." };
    }
    const path = u.pathname.endsWith("*") ? u.pathname : `${u.pathname}*`;
    pattern = `${u.protocol}//${u.host}${path}`;
  } catch {
    return { ok: false, error: "That tab has no usable URL." };
  }
  if (kind === "css") {
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, css: code });
      return { ok: true };
    } catch {
      // No direct host access — fall through to the temp-userScripts path below.
    }
  }
  const engineCheck = await checkUserScripts();
  if (!engineCheck.available) {
    return {
      ok: false,
      error:
        kind === "css"
          ? "That tab needs site access first (Grant site access), and the CSS fallback needs the “Allow User Scripts” toggle ON."
          : engineCheck.error ?? "User scripts are not enabled.",
    };
  }
  const hasAccess = await hasHostAccessForTab(
    { id: "hgf-scratchpad", matches: [pattern] } as Script,
    tabId,
    tabUrl,
  ).catch(() => true);
  if (!hasAccess) {
    return { ok: false, error: "This site needs site access first (Dashboard → Scripts → Grant site access, or set Site access → On all sites in the extension details)." };
  }
  const tempId = `hgf-scratch-${Date.now().toString(36)}`;
  try {
    await chrome.userScripts.unregister({ ids: [tempId] });
  } catch {
    // Not registered yet — fine.
  }
  try {
    if (kind === "js") {
      const tempScript: Script = {
        id: tempId,
        name: "Scratchpad (temporary)",
        version: "1.0",
        description: "",
        author: null,
        namespace: null,
        matches: [pattern],
        grants: [],
        code,
        enabled: true,
        source: "manual",
        autoUpgrade: false,
        installedAt: Date.now(),
        updatedAt: Date.now(),
        history: [],
      };
      await chrome.userScripts.register([buildRegisteredScript(tempScript)]);
    } else {
      await chrome.userScripts.register([
        { id: tempId, matches: [pattern], css: [{ code }], runAt: "document_start", world: "USER_SCRIPT" },
      ]);
    }
  } catch (err) {
    return { ok: false, error: `Could not run it here: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    await chrome.tabs.reload(tabId);
  } catch {
    // The tab is gone — still clean up below.
  }
  setTimeout(() => {
    void chrome.userScripts.unregister({ ids: [tempId] }).catch(() => {
      // Already unregistered — fine.
    });
  }, 15000);
  return { ok: true };
}


/**
 * v1.5+ (#23): read one script's GM_setValue data from a tab that
 * is open on one of its @match sites. The reader is a STATIC
 * function (it only copies localStorage keys into an object) — it
 * never runs the script's code and never evals anything. READ-ONLY:
 * nothing here writes. When no matching tab is open, the viewer
 * says so instead of inventing values.
 */
async function readGmValues(scriptId: string): Promise<{ ok: boolean; values?: Array<{ key: string; value: string; truncated: boolean }>; error?: string }> {
  if (typeof scriptId !== "string" || !scriptId) return { ok: false, error: "Missing script id." };
  const scripts = await loadScripts();
  const script = scripts.find((s) => s.id === scriptId);
  if (!script) return { ok: false, error: "That script no longer exists." };
  let tabs: Array<{ id?: number; url?: string }> = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return { ok: false, error: "Could not read the open tabs." };
  }
  const target = (tabs || []).find((t) => typeof t?.url === "string" && scriptsForUrl([script], t.url).length > 0);
  if (!target || typeof target.id !== "number") {
    return { ok: false, error: "Open the site tab first — GM values live in that page, and no matching tab is open right now." };
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: target.id },
      func: () => {
        const out: Record<string, string> = {};
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k) out[k] = localStorage.getItem(k) ?? "";
          }
        } catch {
          // localStorage unreadable — return what we have.
        }
        return out;
      },
    });
    const snapshot = (results?.[0]?.result ?? {}) as Record<string, string>;
    const values = parseGmValues(snapshot, scriptId);
    return { ok: true, values };
  } catch (err) {
    return { ok: false, error: `Could not read that page's storage: ${err instanceof Error ? err.message : String(err)} — grant site access for the script's sites and try again.` };
  }
}

// --- v1.5+ (#14): auto-save the last closed window ----------------------
// windows.onRemoved fires AFTER the window is gone, so its tabs
// cannot be queried then. The background therefore keeps a live
// snapshot of every normal window's tabs (refreshed on tab
// create/update/remove); on close, the snapshot becomes the
// auto-saved "Last session" entry (replacing the previous one).
const windowTabs = new Map<number, Array<{ url?: string; title?: string; groupName?: string; pinned?: boolean }>>();

async function refreshWindowTabs(windowId: number): Promise<void> {
  try {
    const win = await chrome.windows.get(windowId);
    if (!win || win.type !== "normal") {
      windowTabs.delete(windowId);
      return;
    }
    const tabs = await chrome.tabs.query({ windowId });
    const list: Array<{ url?: string; title?: string; groupName?: string; pinned?: boolean }> = [];
    for (const t of tabs || []) {
      let groupName: string | undefined;
      if (typeof t?.groupId === "number" && t.groupId >= 0) {
        try {
          const group = await chrome.tabGroups.get(t.groupId);
          if (typeof group?.title === "string" && group.title) groupName = group.title;
        } catch {
          // Ungrouped for the snapshot — the tab is still saved.
        }
      }
      list.push({ url: t?.url, title: t?.title, groupName, pinned: t?.pinned === true });
    }
    windowTabs.set(windowId, list);
  } catch {
    windowTabs.delete(windowId);
  }
}

async function autoSaveLastSession(windowId: number): Promise<void> {
  const tabs = windowTabs.get(windowId);
  windowTabs.delete(windowId);
  if (!tabs || tabs.length === 0) return;
  const session = createSessionFromTabs("Last session", tabs);
  if (!session) return;
  try {
    const sessions = await loadSessions();
    await saveSessions(addSession(sessions, { ...session, auto: true }));
  } catch {
    // Auto-save must never break closing a window.
  }
}

/**
 * v1.4: one alarm fired. The name alone never opens anything — every
 * branch re-validates its id against storage first. Recurring alarms
 * are one-shots, so the next occurrence is re-created at the end.
 * Unknown `hgf-` names are ignored (a stale alarm from a deleted
 * task/flow/note is inert, and rescheduleAlarms clears it anyway).
 */
async function handleAlarm(alarm: { name?: string }): Promise<void> {
  const name = typeof alarm?.name === "string" ? alarm.name : "";
  if (!name.startsWith(ALARM_PREFIX)) return;
  try {
    if (name === ALARM_NUDGE) {
      await runNudgeCheck();
    } else if (name === ALARM_OPEN_ALL) {
      await fireOpenAllAlarm();
    } else if (name.startsWith("hgf-reminder-")) {
      await fireReminderAlarm(name.slice("hgf-reminder-".length));
    } else if (name.startsWith("hgf-flow-")) {
      await runFlow(name.slice("hgf-flow-".length), "alarm");
    } else if (name.startsWith("hgf-note-")) {
      await fireNoteAlarm(name.slice("hgf-note-".length));
    } else if (name.startsWith("hgf-snooze-")) {
      // v1.5+ (#21): the task returns to the main list. The alarm
      // never opens anything by itself — fireSnoozeAlarm only
      // removes the snooze and notifies.
      await fireSnoozeAlarm(name.slice("hgf-snooze-".length));
    } else if (name === ALARM_STYLES_HOURLY) {
      // v1.5+ (#11): re-check dark-hours styles; the trailing
      // rescheduleAlarms() below re-creates this hourly alarm.
      await syncUserStyles();
    } else if (name === ALARM_SMART_SUSPEND) {
      // v1.5+ (#15): discard unviewed smart-opened tabs (never close).
      await discardPendingTabs();
    } else if (name.startsWith("hgf-sched-")) {
      // Later (#13): one scheduled script fired. The run re-validates
      // everything at fire time; the trailing rescheduleAlarms()
      // below re-creates the next occurrence.
      await fireScheduleRun(name.slice("hgf-sched-".length), "alarm");
    } else if (name === SYNC_ALARM) {
      // Later (#20): periodic sync — upload only, snapshot-first.
      // A failure is recorded in the sync settings (lastSync), never
      // thrown: the alarm must not break the other handlers.
      await syncUpload();
    }
  } catch {
    // An alarm handler must never throw.
  }
  void rescheduleAlarms();
}

/**
 * v1.4: a notification was clicked. The id encodes exactly one
 * target, and the target is re-validated against storage before
 * anything opens — a notification naming a deleted task opens
 * nothing. GM_notification ids (auto-generated, no `hgf-n-` prefix)
 * fall through and do nothing, as before.
 */
async function handleNotificationClicked(id: string): Promise<void> {
  try {
    await chrome.notifications.clear(id);
  } catch {
    // Clearing is best-effort; the routing below still runs.
  }
  try {
    if (id === NUDGE_NOTIFICATION_ID) {
      await openDashboard("tasks");
      return;
    }
    if (id.startsWith("hgf-n-task-")) {
      const taskId = id.slice("hgf-n-task-".length);
      if (!taskId) return;
      const tasks = await loadTasks();
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      await openUrls([task.url]);
      return;
    }
    if (id.startsWith("hgf-n-note-")) {
      const noteId = id.slice("hgf-n-note-".length);
      if (!noteId) return;
      const notes = await loadNotes();
      if (!notes.some((n) => n.id === noteId)) return;
      await openDashboard("notes");
      return;
    }
    if (id.startsWith("hgf-n-flow-")) {
      const flowId = id.slice("hgf-n-flow-".length);
      if (!flowId) return;
      const flows = await loadFlows();
      if (!flows.some((f) => f.id === flowId)) return;
      await openDashboard("flows");
      return;
    }
    // v1.5+ (#21): a snooze-return notification opens the Tasks tab
    // (the task is back in the list — the click opens nothing else).
    if (id.startsWith("hgf-n-snooze-")) {
      const taskId = id.slice("hgf-n-snooze-".length);
      if (!taskId) return;
      const tasks = await loadTasks();
      if (!tasks.some((t) => t.id === taskId)) return;
      await openDashboard("tasks");
      return;
    }
  } catch {
    // A failed open after a click is silent — the notification is
    // already cleared, and there is no surface to report to.
  }
}

// --- Context menus (v1.2.0) ---
const MENU_PARENT_ID = "hgf-root";
const MENU_SAVE_TASK_ID = "hgf-save-task";
const MENU_SAVE_NOTE_ID = "hgf-save-note";
const MENU_RUN_PARENT_ID = "hgf-run";
const MENU_RUN_NONE_ID = "hgf-run-none";
const TEMP_SCRIPT_PREFIX = "hgf-temp-";

/** Serialize menu rebuilds (deep audit A-25): two rapid storage
 * changes (e.g. toggling several scripts) could interleave
 * removeAll/create and leave a partial menu until the next trigger.
 * Every rebuild now runs after the previous one finishes. */
let contextMenuSetupQueue: Promise<void> = Promise.resolve();
function setupContextMenus(): Promise<void> {
  const run = contextMenuSetupQueue.then(() => setupContextMenusInner());
  contextMenuSetupQueue = run.catch(() => {});
  return run;
}

/** (Re)build the whole context menu: parent + the three actions. Never throws. */
async function setupContextMenusInner(): Promise<void> {
  try {
    if (!chrome?.contextMenus?.create || !chrome?.contextMenus?.removeAll) return;
    await chrome.contextMenus.removeAll();
    // The menu can be turned off from Dashboard → Settings.
    if (!(await loadContextMenuEnabled())) return;
    chrome.contextMenus.create({
      id: MENU_PARENT_ID,
      title: "HiddenGem Flow",
      contexts: ["page", "link", "selection"],
    });
    chrome.contextMenus.create({
      id: MENU_SAVE_TASK_ID,
      parentId: MENU_PARENT_ID,
      title: "Save to Daily Tasks",
      contexts: ["page", "link"],
    });
    chrome.contextMenus.create({
      id: MENU_SAVE_NOTE_ID,
      parentId: MENU_PARENT_ID,
      title: "Save selection as note",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU_RUN_PARENT_ID,
      parentId: MENU_PARENT_ID,
      title: "Run script on this page",
      contexts: ["page"],
    });
    await rebuildRunScriptMenu();
  } catch {
    // Menus unavailable — the extension works without them.
  }
}

/** Fill the "Run script on this page" submenu with the enabled installed scripts. Never throws. */
async function rebuildRunScriptMenu(): Promise<void> {
  try {
    if (!chrome?.contextMenus?.create) return;
    let scripts: Script[] = [];
    try {
      scripts = (await loadScripts()).filter((s) => s.enabled);
    } catch {
      scripts = [];
    }
    if (scripts.length === 0) {
      const installed = await loadScripts().catch(() => [] as Script[]);
      chrome.contextMenus.create({
        id: MENU_RUN_NONE_ID,
        parentId: MENU_RUN_PARENT_ID,
        title: installed.length === 0 ? "(No scripts installed)" : "(No scripts enabled)",
        contexts: ["page"],
        enabled: false,
      });
      return;
    }
    for (const script of scripts) {
      chrome.contextMenus.create({
        id: `${MENU_RUN_PARENT_ID}-${script.id}`,
        parentId: MENU_RUN_PARENT_ID,
        title: script.name,
        contexts: ["page"],
      });
    }
  } catch {
    // A failed submenu build leaves the parent with no children —
    // the menu still opens, the submenu is just empty.
  }
}

/**
 * v1.3 (A-33) — does this tab have an activeTab grant? There is no
 * API that reports one: chrome.permissions.contains() and getAll()
 * both stay silent after a toolbar click (verified live, probe30b
 * diag), yet the userScripts engine still runs scripts there. Two
 * witnesses, in order: (1) the background's own record — every
 * injection through an activeTab gesture (toolbar click, show,
 * context-menu click) records the tab's origin here; the record is
 * cleared when the tab closes or navigates to another origin.
 * (2) a live float ping — the float is only ever injected through
 * an activeTab gesture, so an answer proves THIS document granted
 * access (the ping alone is not enough: a reload destroys the
 * injected float while the grant survives). Neither witness can be
 * faked by a web page: the map is written only by the background's
 * own gesture handlers, and only this tab's injected float answers
 * the ping. Never throws.
 */
const activeTabGrants = new Map<number, string>();

function recordActiveTabGrant(tabId: number, url: string): void {
  try {
    const u = new URL(String(url ?? ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    activeTabGrants.set(tabId, u.origin);
  } catch {
    // No usable URL — nothing to record.
  }
}

function activeTabGrantOrigin(tabId: number): string | null {
  return activeTabGrants.get(tabId) ?? null;
}

async function hasFloatPing(tabId: number): Promise<boolean> {
  try {
    const res = (await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: "hiddengemflow:ping" }),
      delay(1000).then(() => null),
    ])) as { ok?: boolean } | null;
    return res?.ok === true;
  } catch {
    return false;
  }
}

/**
 * v1.3 (A-33) — host access for one tab: a persistent optional-host
 * grant (scriptHasHostAccess, origin-widened) OR a recorded activeTab
 * grant for this tab's origin OR a live float ping. Either one means
 * Chrome will run scripts on this tab; only when all three are false
 * do run-script / self-test warn instead of reloading.
 */
async function hasHostAccessForTab(script: Script, tabId: number, tabUrl?: string): Promise<boolean> {
  if (await scriptHasHostAccess(script)) return true;
  if (typeof tabUrl === "string" && tabUrl) {
    try {
      const origin = new URL(tabUrl).origin;
      const granted = activeTabGrantOrigin(tabId);
      if (granted && granted === origin) return true;
    } catch {
      // Fall through to the ping.
    }
  }
  return hasFloatPing(tabId);
}

/**
 * Run one installed script once on one tab: register a TEMPORARY
 * userScripts entry (id `hgf-temp-<scriptId>`) whose only match is
 * this tab's URL, reload the tab so it runs, then unregister the
 * entry after 15 s. The temp entry runs the user's own installed
 * script code through the same engine (same GM shim) — no new code,
 * no eval. Returns { ok } or { ok:false, error }.
 */
async function runScriptOnce(scriptId: string, tabId: number, tabUrl: string): Promise<{ ok: boolean; error?: string }> {
  const check = await checkUserScripts();
  if (!check.available) {
    return { ok: false, error: check.error ?? "User scripts are not enabled." };
  }
  let scripts: Script[] = [];
  try {
    scripts = await loadScripts();
  } catch {
    return { ok: false, error: "Could not read the installed scripts." };
  }
  const script = scripts.find((s) => s.id === scriptId);
  if (!script) return { ok: false, error: "Script not found." };
  if (!script.enabled) return { ok: false, error: "That script is disabled — enable it first." };
  // Match pattern from the tab URL: origin + path + "*". Query and
  // fragment are stripped — match patterns do not take them.
  let pattern: string;
  try {
    const u = new URL(tabUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, error: "Scripts only run on http(s) pages." };
    }
    const path = u.pathname.endsWith("*") ? u.pathname : `${u.pathname}*`;
    pattern = `${u.protocol}//${u.host}${path}`;
  } catch {
    return { ok: false, error: "That tab has no usable URL." };
  }
  const tempId = `${TEMP_SCRIPT_PREFIX}${script.id}`;
  const tempScript: Script = { ...script, id: tempId, matches: [pattern] };
  // Deep audit (A-24): check host access BEFORE registering and
  // reloading. The old order reloaded the tab first and only then
  // discovered the script could not run there — a pointless reload
  // plus a warning. Now the warning comes without the reload.
  // v1.3 (A-33): the check is tab-aware — chrome.permissions.contains()
  // does NOT report activeTab grants (verified live in probe30b:
  // contains() is false for a tab whose float was just injected by a
  // toolbar click, yet the engine still runs scripts there). A live
  // float ping proves that grant, so it counts as access too.
  let hasAccess = true;
  try {
    hasAccess = await hasHostAccessForTab({ ...script, matches: [pattern] }, tabId, tabUrl);
  } catch {
    hasAccess = true;
  }
  if (!hasAccess) {
    return {
      ok: true,
      error: `Running ${script.name} — but this site needs site access first (Dashboard → Scripts → Grant site access).`,
    };
  }
  try {
    await chrome.userScripts.unregister({ ids: [tempId] });
  } catch {
    // Not registered yet — fine.
  }
  try {
    await chrome.userScripts.register([buildRegisteredScript(tempScript)]);
  } catch (err) {
    return { ok: false, error: `Could not run it here: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    await chrome.tabs.reload(tabId);
  } catch {
    // The tab is gone — still clean up the temp entry below.
  }
  // Cleanup after the reload has had time to run the script. The
  // unregister is idempotent; a script already injected keeps
  // running, it just never runs again on a later load.
  setTimeout(() => {
    void chrome.userScripts.unregister({ ids: [tempId] }).catch(() => {
      // Already unregistered — fine.
    });
  }, 15000);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Studio test engine — Test in extension (v2.1.0, owner build only on the
// dashboard side; the background answers in both builds, because the
// messages carry no Studio UI and the Studio tab itself is what the
// public build omits).
//
// A draft runs ONCE on its real site as a TEMPORARY userScripts entry
// (id `hgf-studio-test-<n>`, match = the test URL only) — it is
// NEVER added to the installed scripts. The entry is unregistered on
// Stop, on test-tab close, on finish, and on a 3-minute hard cap.
// Per-step results arrive from the draft through the DOM-signal +
// relay pattern (A-04): the draft posts a data-hgf-studio-step node,
// public/gm-relay.js forwards it as MSG_STUDIO_STEP, and this file
// stores it under the sender tab's id. The draft's step payload is
// untrusted page data — sanitizeStudioStep reads only the four known
// fields, length-capped, and never executes anything.
// ---------------------------------------------------------------------------

const STUDIO_TEST_PREFIX = "hgf-studio-test-";
/** A test that reports nothing for 3 minutes is timed out (the entry is unregistered either way). */
const STUDIO_TEST_TIMEOUT_MS = 3 * 60 * 1000;

interface StudioTestState {
  tempId: string;
  tabId: number;
  name: string;
  site: string;
  startedAt: number;
  steps: StudioStep[];
  finished: boolean;
  result: string;
  failedStep: string;
}

/** Live Studio tests, keyed by test tab id. In-memory only (service-worker lifetime). */
const studioTests = new Map<number, StudioTestState>();

/** Derive the honest result from the observed steps: "passed" needs at least one ok step and no failed one. */
function studioTestResult(state: StudioTestState): { result: string; failedStep: string } {
  const failed = state.steps.find((s) => studioStepState(s.status) === "failed");
  if (failed) return { result: "failed", failedStep: `Step ${failed.step} failed${failed.detail ? ` — ${failed.detail}` : ""}` };
  const okCount = state.steps.filter((s) => studioStepState(s.status) === "ok").length;
  if (okCount > 0) return { result: "passed", failedStep: "" };
  return { result: "finished", failedStep: "" };
}

async function unregisterStudioTemp(tempId: string): Promise<void> {
  try {
    await chrome.userScripts.unregister({ ids: [tempId] });
  } catch {
    // Already unregistered — fine.
  }
}

async function finishStudioTest(tabId: number, result: string, failedStep: string): Promise<void> {
  const state = studioTests.get(tabId);
  if (!state) return;
  await unregisterStudioTemp(state.tempId);
  state.finished = true;
  state.result = result;
  state.failedStep = failedStep;
}

/**
 * Start a Studio test: register the draft temporarily, open its site
 * in a new tab. The tab is opened AFTER registration so the draft
 * runs on load. Returns the test tab id, or an honest error.
 */
async function startStudioTest(code: string, url: string): Promise<{ ok: boolean; tabId?: number; error?: string }> {
  const check = await checkUserScripts();
  if (!check.available) {
    return { ok: false, error: check.error ?? "User scripts are not enabled." };
  }
  if (typeof code !== "string" || !code.trim()) {
    return { ok: false, error: "There is no draft to test." };
  }
  if (code.length > 100 * 1024) {
    return { ok: false, error: "That draft is too large to test (over 100 KB)." };
  }
  let pattern: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, error: "Tests only run on http(s) pages." };
    }
    const path = u.pathname.endsWith("*") ? u.pathname : `${u.pathname}*`;
    pattern = `${u.protocol}//${u.host}${path}`;
  } catch {
    return { ok: false, error: "That test URL is not usable." };
  }
  let draft: Script;
  const tempId = `${STUDIO_TEST_PREFIX}${Date.now().toString(36)}`;
  try {
    draft = createScript(code, "manual", Date.now(), tempId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const tempScript: Script = { ...draft, id: tempId, matches: [pattern] };
  // Host access first (same A-24 order as runScriptOnce): the Studio
  // already asked for the origin grant on its click gesture, so a
  // persistent grant should be held; without it, warn, don't reload.
  let hasAccess = true;
  try {
    hasAccess = await hasHostAccessForTab(tempScript, 0, url);
  } catch {
    hasAccess = true;
  }
  if (!hasAccess) {
    return {
      ok: false,
      error: `This site needs site access first (Dashboard → Scripts → Grant site access, or set Site access → On all sites in the extension details).`,
    };
  }
  try {
    await chrome.userScripts.unregister({ ids: [tempId] });
  } catch {
    // Not registered yet — fine.
  }
  try {
    await chrome.userScripts.register([buildRegisteredScript(tempScript)]);
  } catch (err) {
    return { ok: false, error: `Could not register the draft for testing: ${err instanceof Error ? err.message : String(err)}` };
  }
  // The relay must also run on the test pattern so step signals reach
  // the background — registered for this one pattern only, WITHOUT
  // pruning the relays of enabled scripts (see ensureGmRelayForPattern).
  await ensureGmRelayForPattern(pattern);
  let tabId: number;
  try {
    const tab = await chrome.tabs.create({ url });
    if (typeof tab?.id !== "number") throw new Error("no tab id");
    tabId = tab.id;
  } catch (err) {
    await unregisterStudioTemp(tempId);
    return { ok: false, error: `The test tab could not be opened: ${err instanceof Error ? err.message : String(err)}` };
  }
  studioTests.set(tabId, {
    tempId,
    tabId,
    name: draft.name,
    site: url,
    startedAt: Date.now(),
    steps: [],
    finished: false,
    result: "",
    failedStep: "",
  });
  // Hard cap: unregister + mark timed out even if the Studio page is
  // closed and never polls again.
  setTimeout(() => {
    const state = studioTests.get(tabId);
    if (!state || state.finished) return;
    void finishStudioTest(tabId, "timed out", "");
  }, STUDIO_TEST_TIMEOUT_MS);
  return { ok: true, tabId };
}

/** Stop a Studio test: unregister the temporary entry and mark it stopped. Never throws. */
async function stopStudioTest(tabId: number): Promise<{ ok: boolean }> {
  const state = studioTests.get(tabId);
  if (!state) return { ok: true };
  if (!state.finished) {
    await finishStudioTest(tabId, "stopped", "");
  }
  return { ok: true };
}

/** The Studio's poll answer for one test tab. */
function studioTestPoll(tabId: number): { ok: boolean; steps: StudioStep[]; status: string; finished: boolean; result: string; failedStep: string } {
  const state = studioTests.get(tabId);
  if (!state) return { ok: false, steps: [], status: "unknown", finished: true, result: "stopped", failedStep: "" };
  const waiting = state.steps.some((s) => studioStepState(s.status) === "waiting-wallet");
  const status = state.finished ? state.result : waiting ? "waiting-wallet" : "running";
  // A finished test whose result was never derived (e.g. tab closed)
  // derives it now from the observed steps.
  let result = state.result;
  let failedStep = state.failedStep;
  if (state.finished && !result) {
    const derived = studioTestResult(state);
    result = derived.result;
    failedStep = derived.failedStep;
    state.result = result;
    state.failedStep = failedStep;
  }
  return { ok: true, steps: state.steps, status, finished: state.finished, result, failedStep };
}

/** A test tab was closed: unregister its temporary entry and mark it stopped. Never throws. */
function onStudioTestTabRemoved(tabId: number): void {
  const state = studioTests.get(tabId);
  if (!state || state.finished) return;
  void finishStudioTest(tabId, "stopped", "Test tab closed");
}


/**
 * v1.3 (#8) — GM_xmlhttpRequest, enforced in the background (the only
 * place the fetch happens). The shim/relay can ASK, but this handler
 * decides: the script must exist, be enabled and unarchived, declare
 * @grant GM_xmlhttpRequest, and list the request's host in @connect.
 * No credentials or cookies are ever sent (credentials:"omit", and
 * Cookie/Authorization headers are stripped). Redirects are followed
 * manually, at most 3 hops, and only to hosts that are ALSO in
 * @connect — a redirect to an unlisted host is refused, not followed.
 * The response body is capped at 1 MB.
 */
async function handleGmXhr(rawRequest: unknown): Promise<GmXhrResponse> {
  const req = sanitizeGmXhrRequest(rawRequest);
  if (!req) return { ok: false, status: 0, statusText: "Bad request", responseText: "", finalUrl: "", error: "The request was not usable." };
  let scripts: Script[] = [];
  try {
    scripts = await loadScripts();
  } catch {
    return { ok: false, status: 0, statusText: "Storage error", responseText: "", finalUrl: "", error: "Could not read the installed scripts." };
  }
  const script = scripts.find((s) => s.id === req.scriptId);
  if (!script) return { ok: false, status: 0, statusText: "No such script", responseText: "", finalUrl: "", error: "That script is not installed." };
  if (!script.enabled || script.archived === true) {
    return { ok: false, status: 0, statusText: "Script not running", responseText: "", finalUrl: "", error: "That script is disabled or archived." };
  }
  if (!script.grants.includes("GM_xmlhttpRequest")) {
    return { ok: false, status: 0, statusText: "Not granted", responseText: "", finalUrl: "", error: "That script does not declare @grant GM_xmlhttpRequest." };
  }
  const connects = connectHostsOf(script.code);
  if (!isConnectAllowed(req.url, connects)) {
    return { ok: false, status: 0, statusText: "Not in @connect", responseText: "", finalUrl: "", error: "That host is not listed in the script's @connect lines." };
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    const lower = k.toLowerCase();
    if (lower === "cookie" || lower === "authorization" || lower === "host" || lower === "origin" || lower === "referer") continue;
    headers[k] = v;
  }
  // Redirects: redirect:"manual" alone cannot work for fetches from
  // a service worker — the Location header is unreadable and the
  // response is opaque (verified live, probe30b: same-host redirects
  // failed with no error text). So: fetch once with redirect:"manual"
  // and handle a readable same-origin redirect directly; when the
  // response is an opaque redirect, re-fetch with redirects followed
  // and verify the FINAL URL against @connect. A redirect to an
  // unlisted host still fetches one credential-less GET (no cookies,
  // no auth), but its body is DISCARDED and the script gets a refusal
  // naming @connect — never the response. When the follow-fetch
  // itself throws (e.g. the target's CORS policy), the refusal is
  // the same: the target could not be verified, so nothing is
  // returned.
  const REFUSAL = "Redirect refused: the final host is not in the script's @connect lines.";
  let url = req.url;
  for (let hop = 0; hop <= 3; hop++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : req.data,
        credentials: "omit",
        redirect: "manual",
      });
    } catch (err) {
      return { ok: false, status: 0, statusText: "Network error", responseText: "", finalUrl: url, error: err instanceof Error ? err.message : String(err) };
    }
    // Opaque redirect (cross-origin from the service worker): the
    // target is unreadable here — verify it with a followed fetch.
    // A 3xx with no readable Location is the same situation (the
    // header is stripped cross-origin) — treat it identically.
    const location0 = res.headers.get("location");
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400 && !location0)) {
      let followed: Response;
      try {
        followed = await fetch(url, {
          method: req.method,
          headers,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : req.data,
          credentials: "omit",
        });
      } catch {
        return { ok: false, status: 0, statusText: "Redirect refused", responseText: "", finalUrl: url, error: REFUSAL };
      }
      const finalUrl = followed.url || url;
      if (!isConnectAllowed(finalUrl, connects) || !followed.ok) {
        return { ok: false, status: followed.status, statusText: followed.statusText, responseText: "", finalUrl, error: REFUSAL };
      }
      return await readBody(followed, finalUrl);
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      let next: string;
      try {
        next = new URL(location, url).href;
      } catch {
        return { ok: false, status: res.status, statusText: res.statusText, responseText: "", finalUrl: url, error: "The redirect target was not a usable URL." };
      }
      if (!isConnectAllowed(next, connects)) {
        return { ok: false, status: res.status, statusText: res.statusText, responseText: "", finalUrl: url, error: REFUSAL };
      }
      url = next;
      continue;
    }
    if (!isConnectAllowed(res.url || url, connects)) {
      return { ok: false, status: res.status, statusText: res.statusText, responseText: "", finalUrl: res.url || url, error: REFUSAL };
    }
    return await readBody(res, res.url || url);
  }
  return { ok: false, status: 0, statusText: "Too many redirects", responseText: "", finalUrl: url, error: "Too many redirects (over 3)." };

  async function readBody(res: Response, finalUrl: string): Promise<GmXhrResponse> {
    let text = "";
    try {
      text = await res.text();
    } catch (err) {
      return { ok: false, status: res.status, statusText: res.statusText, responseText: "", finalUrl, error: err instanceof Error ? err.message : String(err) };
    }
    if (new TextEncoder().encode(text).length > GM_XHR_MAX_RESPONSE_BYTES) {
      return { ok: false, status: res.status, statusText: res.statusText, responseText: "", finalUrl, error: "Response over 1 MB — refused." };
    }
    return { ok: res.ok, status: res.status, statusText: res.statusText, responseText: text, finalUrl };
  }
}

/**
 * v1.3 (#25) — one-click self-test. Registers a TEMPORARY userscript
 * (id `hgf-selftest`, match = the active tab's URL) that sets the
 * page title to "HGF-SELF-TEST-OK", reloads the tab, waits, then
 * reads the title back. Pass = the title changed (the toggle is ON
 * and scripts run on this site); fail = anything else, with the
 * honest reason. The temp entry is unregistered afterwards. No host
 * access → fail with the reason, no reload.
 */
const SELF_TEST_SCRIPT_ID = "hgf-selftest";
const SELF_TEST_TITLE = "HGF-SELF-TEST-OK";

async function runSelfTest(): Promise<{ ok: boolean; error?: string; title?: string }> {
  const check = await checkUserScripts();
  if (!check.available) {
    return { ok: false, error: check.error ?? "User scripts are not enabled." };
  }
  const tab = await getActiveTabOfNormalWindow();
  if (!tab || typeof tab.id !== "number" || typeof tab.url !== "string" || !tab.url) {
    return { ok: false, error: "No active tab to test on." };
  }
  let pattern: string;
  try {
    const u = new URL(tab.url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, error: "Self-test only runs on http(s) pages." };
    }
    const path = u.pathname.endsWith("*") ? u.pathname : `${u.pathname}*`;
    pattern = `${u.protocol}//${u.host}${path}`;
  } catch {
    return { ok: false, error: "That tab has no usable URL." };
  }
  const hasAccess = await hasHostAccessForTab({ id: SELF_TEST_SCRIPT_ID, matches: [pattern] } as Script, tab.id, tab.url).catch(() => true);
  if (!hasAccess) {
    return { ok: false, error: "This site needs site access first (Dashboard → Scripts → Grant site access, or set Site access → On all sites in the extension details)." };
  }
  const tempScript: Script = {
    id: SELF_TEST_SCRIPT_ID,
    name: "HiddenGem Flow self-test",
    version: "1.0",
    description: "",
    author: null,
    namespace: null,
    matches: [pattern],
    grants: [],
    code: `document.title = ${JSON.stringify(SELF_TEST_TITLE)};`,
    enabled: true,
    source: "manual",
    autoUpgrade: false,
    installedAt: Date.now(),
    updatedAt: Date.now(),
    history: [],
  };
  try {
    await chrome.userScripts.unregister({ ids: [SELF_TEST_SCRIPT_ID] });
  } catch {
    // Not registered yet — fine.
  }
  try {
    await chrome.userScripts.register([buildRegisteredScript(tempScript)]);
  } catch (err) {
    return { ok: false, error: `Could not register the self-test: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    await chrome.tabs.reload(tab.id);
  } catch {
    await chrome.userScripts.unregister({ ids: [SELF_TEST_SCRIPT_ID] }).catch(() => undefined);
    return { ok: false, error: "The tab could not be reloaded." };
  }
  await delay(4000);
  let title: string | undefined;
  try {
    const after = await chrome.tabs.get(tab.id);
    title = typeof after?.title === "string" ? after.title : undefined;
  } catch {
    title = undefined;
  }
  await chrome.userScripts.unregister({ ids: [SELF_TEST_SCRIPT_ID] }).catch(() => undefined);
  if (title === SELF_TEST_TITLE) return { ok: true, title };
  return { ok: false, error: `The self-test script did not run — the page title is still "${title ?? "(unknown)"}". Check the "Allow User Scripts" toggle and site access, then try again.`, title };
}

/** Unregister any stale temp entries left by a previous run (startup/install). Never throws. */
async function cleanupTempScripts(): Promise<void> {
  try {
    if (!chrome?.userScripts?.getScripts) return;
    const registered = await chrome.userScripts.getScripts();
    const stale = (registered || [])
      .map((s: { id?: string }) => s?.id)
      .filter((id: string | undefined): id is string => typeof id === "string" && (id.startsWith(TEMP_SCRIPT_PREFIX) || id.startsWith("hgf-scratch-") || id.startsWith(STUDIO_TEST_PREFIX)));
    if (stale.length === 0) return;
    await chrome.userScripts.unregister({ ids: stale });
  } catch {
    // getScripts throws while user scripts are off — nothing to clean.
  }
}

async function handleContextMenuClick(
  info: { menuItemId?: string | number; linkUrl?: string; linkText?: string; selectionText?: string; pageUrl?: string },
  tab?: { id?: number; url?: string; title?: string },
): Promise<void> {
  const menuItemId = typeof info?.menuItemId === "string" ? info.menuItemId : "";
  // v1.3 (A-33): a context-menu click on a tab grants activeTab for
  // that tab's origin — record it for the run-script host check.
  if (typeof tab?.id === "number" && typeof tab?.url === "string" && tab.url) {
    recordActiveTabGrant(tab.id, tab.url);
  }
  if (menuItemId === MENU_SAVE_TASK_ID) {
    const isLink = typeof info.linkUrl === "string" && info.linkUrl;
    const url = isLink ? (info.linkUrl as string) : tab?.url ?? info.pageUrl ?? "";
    const name = isLink
      ? (typeof info.linkText === "string" && info.linkText.trim() ? info.linkText.trim() : url)
      : (tab?.title ?? url);
    try {
      const tasks = await loadTasks();
      const task = createTask(name, url, Date.now(), undefined, tasks);
      await saveTasks([...tasks, task]);
      notify("Saved to Daily Tasks", task.name);
    } catch (err) {
      notify("Could not save this site", err instanceof Error ? err.message : String(err));
    }
    return;
  }
  if (menuItemId === MENU_SAVE_NOTE_ID) {
    const text = typeof info.selectionText === "string" ? info.selectionText : "";
    if (!text.trim()) {
      notify("Nothing selected", "Select some text first, then right-click → Save selection as note.");
      return;
    }
    try {
      const notes = await loadNotes();
      const title = tab?.title ?? "";
      const note = createNote(title, text, "Personal", []);
      await saveNotes([...notes, note]);
      notify("Note saved", title ? `Saved from ${title}` : "Saved to Notepad.");
    } catch (err) {
      notify("Could not save the note", err instanceof Error ? err.message : String(err));
    }
    return;
  }
  if (menuItemId.startsWith(`${MENU_RUN_PARENT_ID}-`) && menuItemId !== MENU_RUN_NONE_ID) {
    const scriptId = menuItemId.slice(MENU_RUN_PARENT_ID.length + 1);
    const tabId = typeof tab?.id === "number" ? tab.id : null;
    const tabUrl = tab?.url ?? info.pageUrl ?? "";
    if (tabId === null) {
      notify("Could not run the script", "No tab to run it on.");
      return;
    }
    const result = await runScriptOnce(scriptId, tabId, tabUrl);
    if (!result.ok) {
      notify("Could not run the script", result.error ?? "Unknown error.");
      return;
    }
    // runScriptOnce returns ok:true with an `error` field only for
    // the host-access warning — show it as the message, not a failure.
    if (result.error) {
      notify("HiddenGem Flow", result.error);
      return;
    }
    const scripts = await loadScripts().catch(() => [] as Script[]);
    const name = scripts.find((s) => s.id === scriptId)?.name ?? "The script";
    notify("HiddenGem Flow", `Running ${name} on this page…`);
    return;
  }
}

// --- Keyboard shortcuts (manifest `commands`, v1.2.0) ---
async function handleCommand(command: string): Promise<void> {
  if (command === "toggle-flow") {
    const mode = await loadWindowMode();
    const res = await openMode(mode);
    // A keyboard command carries no user gesture Chrome accepts for
    // chrome.sidePanel.open() (verified live, probe27d) — so in
    // sidepanel mode the open fails. Never fail silently: tell the
    // user the one extra click. Floating / popup open normally.
    if (!res.ok && mode === "sidepanel") {
      notify(
        "Side Panel needs one toolbar-icon click",
        "Chrome will not open a panel from a keyboard shortcut — click the HiddenGem Flow toolbar icon once to dock.",
      );
    }
    return;
  }
  if (command === "open-dashboard") {
    await openDashboard();
    return;
  }
  if (command === "add-current-site") {
    const tab = await getActiveTabOfNormalWindow();
    if (!tab?.url) {
      notify("Could not save this site", "No active tab found.");
      return;
    }
    try {
      const tasks = await loadTasks();
      const task = createTask(tab.title ?? tab.url, tab.url, Date.now(), undefined, tasks);
      await saveTasks([...tasks, task]);
      notify("Saved to Daily Tasks", task.name);
    } catch (err) {
      notify("Could not save this site", err instanceof Error ? err.message : String(err));
    }
    return;
  }
  if (command === "quick-note") {
    await setOpenTabHint("notes");
    const mode = await loadWindowMode();
    if (mode === "floating") {
      const tab = await getActiveTabOfNormalWindow();
      if (tab && typeof tab.id === "number" && (tab.url ?? "").startsWith("http")) {
        await showFloating(tab.id);
        return;
      }
      await openFloatPopup();
      return;
    }
    if (mode === "sidepanel") {
      // Same gesture rule as toggle-flow above: a command cannot open
      // the panel, so the user gets the one-click instruction instead
      // of a silent no-op. The Notepad hint is already set, so when
      // the panel opens (toolbar icon) it lands on Notepad.
      const res = await openSidePanelForCurrentWindow();
      if (!res.ok) {
        notify(
          "Side Panel needs one toolbar-icon click",
          "Chrome will not open a panel from a keyboard shortcut — click the HiddenGem Flow toolbar icon once to dock.",
        );
      }
      return;
    }
    await openFloatPopup();
    return;
  }
}

export default defineBackground(() => {
  chrome.action.onClicked.addListener((tab: { id?: number; url?: string }) => {
    void handleToolbarClick(tab);
  });

  // Forget the popup window id when the user closes the popup, so the
  // next toolbar click creates a fresh one instead of focusing a dead id.
  try {
    chrome.windows.onRemoved.addListener((windowId: number) => {
      if (windowId === floatWindowId) {
        floatWindowId = null;
        void savePersistedPopupWindowId(null);
      }
    });
  } catch {
    // windows events unavailable — openFloatPopup re-validates the id
    // with chrome.windows.get before focusing, so a stale id is safe.
  }

  // v2.1.0 (Studio Test): closing a test tab unregisters its
  // temporary entry immediately — the Studio's Stop button is not
  // the only way a test ends.
  try {
    chrome.tabs.onRemoved.addListener((tabId: number) => {
      onStudioTestTabRemoved(tabId);
    });
  } catch {
    // tabs events unavailable — the 3-minute hard cap still unregisters the entry.
  }

  chrome.runtime.onMessage.addListener(
    (message: { type?: string; urls?: unknown; id?: string; taskId?: string; enabled?: boolean; title?: string; message?: string; tab?: string; force?: boolean }, _sender: unknown, sendResponse: (r: unknown) => void) => {
      if (message?.type === OPEN_DASHBOARD) {
        void openDashboard(typeof message.tab === "string" ? message.tab : undefined).then(
          () => sendResponse({ ok: true }),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      if (message?.type === MSG_GET_ACTIVE_TAB) {
        void getActiveTab().then(
          (tab) => sendResponse({ ok: true, ...tab }),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      if (message?.type === MSG_OPEN_URLS) {
        void openUrls(message.urls).then(
          (result) => sendResponse({ ok: true, ...result }),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- Unreleased: floating window / float popup "Open extension details
      // to enable" button. Opens the Details page only — it cannot flip
      // the toggle itself (see openExtensionDetails). ---
      if (message?.type === MSG_OPEN_EXTENSION_DETAILS) {
        void openExtensionDetails().then(
          (result) => sendResponse(result),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- Unreleased: extension update check (dashboard ask / Settings manual check) ---
      if (message?.type === MSG_CHECK_UPDATES) {
        void checkForUpdates(message?.force === true).then(
          (result) =>
            sendResponse({
              ok: result.ok,
              available: result.available,
              record: result.record ?? null,
              checked: result.checked,
              error: result.error,
            }),
          (err: unknown) => sendResponse({ ok: false, available: false, record: null, checked: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- v1.2.0 deep audit (A-20): the side panel asks the background
      // to close every open in-page float when it opens. The background
      // never sees the toolbar click that opens the panel
      // (setPanelBehavior intercepts it), so without this the float
      // that set the mode would stay open with a stale "click the
      // toolbar icon once to dock" hint. Tabs without a float ignore
      // the message (sendMessage rejects — caught per tab).
      if (message?.type === MSG_CLOSE_FLOATS) {
        void (async () => {
          try {
            const tabs = await chrome.tabs.query({});
            for (const t of tabs || []) {
              if (typeof t?.id !== "number") continue;
              try {
                await chrome.tabs.sendMessage(t.id, { type: "hiddengemflow:close" });
              } catch {
                // No floating window in this tab — nothing to close.
              }
            }
          } catch {
            // tabs.query failed — the floats stay; the user closes them.
          }
        })();
        sendResponse({ ok: true });
        return false;
      }
      // --- v1.2.0: open a window mode (Dashboard / popup / side panel switch menus) ---
      if (message?.type === MSG_OPEN_MODE) {
        const mode = sanitizeWindowMode((message as { mode?: unknown }).mode);
        void openMode(mode).then(
          (result) => sendResponse({ ok: result.ok, error: result.error }),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- v1.2.0: restore a backup (snapshot-first, then write) ---
      // The dashboard sends already-validated BackupData (from a
      // snapshot or a parsed file). The CURRENT state is snapshotted
      // first, so a restore can never delete data — the old state is
      // always one click away. The auto-snapshot is suppressed for
      // 10 s so the restore's own writes do not snapshot the
      // just-restored state on top of it.
      if (message?.type === MSG_RESTORE_BACKUP) {
        const clean = sanitizeBackupData((message as { data?: unknown }).data);
        if (!clean) {
          sendResponse({ ok: false, error: "That backup data is not usable — nothing was restored." });
          return false;
        }
        void (async () => {
          try {
            await takeSnapshot();
            suppressAutoSnapshotUntil = Date.now() + 10000;
            await writeBackupData(clean);
            sendResponse({ ok: true });
          } catch (err) {
            sendResponse({ ok: false, error: String(err instanceof Error ? err.message : err) });
          }
        })();
        return true; // async response
      }
      // --- Phase 4: Stop All running runs ---
      if (message?.type === MSG_STOP_ALL) {
        void stopAllRuns().then(
          (result) => sendResponse({ ok: true, ...result }),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- Phase 3: script engine bridge ---
      if (message?.type === MSG_SCRIPTS_STATUS) {
        void (async () => {
          const check = await checkUserScripts();
          const scripts = await loadScripts();
          // Per-script host access (live-test fix v1.0.1): registration
          // alone does not make a script run — Chrome needs host access
          // for its @match sites. The floating window shows which
          // matching scripts are still waiting on a grant.
          const hostAccess: Record<string, boolean> = {};
          for (const s of scripts) {
            hostAccess[s.id] = await scriptHasHostAccess(s);
          }
          sendResponse({ ok: true, available: check.available, error: check.error, scripts, hostAccess });
        })().catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
        return true; // async response
      }
      if (message?.type === MSG_TOGGLE_SCRIPT) {
        if (typeof message.id !== "string") {
          sendResponse({ ok: false, error: "Missing script id." });
          return false;
        }
        void (async () => {
          const check = await checkUserScripts();
          if (!check.available) {
            sendResponse({ ok: false, error: check.error ?? "User scripts are not enabled." });
            return;
          }
          const scripts = await setScriptEnabled(message.id as string, message.enabled === true);
          const updated = scripts.find((s) => s.id === message.id);
          sendResponse({ ok: true, enabled: updated?.enabled ?? false });
        })().catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
        return true; // async response
      }
      if (message?.type === MSG_GM_NOTIFY) {
        // GM_notification from a running userscript: a real notification.
        // Fire-and-forget — the script must never wait on the UI.
        // Dedupe by the relay/shim notification id: a relay re-register
        // or a page restore must not double-show the same notification.
        // The id set is in-memory only (service-worker lifetime); the
        // shim's DOM node is removed after draining, so duplicates are
        // rare — this is belt and braces, capped so it cannot grow.
        if (typeof message.id === "string" && message.id) {
          if (seenNotifyIds.has(message.id)) {
            sendResponse({ ok: true, duplicate: true });
            return false;
          }
          seenNotifyIds.add(message.id);
          if (seenNotifyIds.size > 200) {
            const first = seenNotifyIds.values().next().value as string | undefined;
            if (first) seenNotifyIds.delete(first);
          }
        }
        try {
          void chrome.notifications.create({
            type: "basic",
            iconUrl: chrome.runtime.getURL("icons/icon128.png"),
            title: typeof message.title === "string" && message.title ? message.title.slice(0, 80) : "HiddenGem Flow",
            message: typeof message.message === "string" && message.message ? message.message.slice(0, 400) : "",
          });
        } catch {
          // Notifications unavailable — the script call is a no-op.
        }
        sendResponse({ ok: true });
        return false;
      }
      if (message?.type === MSG_GM_XHR) {
        // v1.3 (#8): the relay forwards a script's GM_xmlhttpRequest
        // here; the handler re-validates everything and fetches.
        // The sender is validated by the scriptId in the request —
        // a forged message can only ask for a script the sender
        // cannot name, and every check runs against storage.
        const req = (message as { request?: unknown }).request;
        if (!req || typeof req !== "object") {
          sendResponse({ ok: false, status: 0, statusText: "Bad request", responseText: "", finalUrl: "", error: "The request was not usable." });
          return false;
        }
        void handleGmXhr(req).then(
          (res) => sendResponse(res),
          (err: unknown) => sendResponse({ ok: false, status: 0, statusText: "Error", responseText: "", finalUrl: "", error: String(err) }),
        );
        return true; // async response
      }
      if (message?.type === MSG_SELF_TEST) {
        // v1.3 (#25): one-click self-test from the onboarding card.
        void runSelfTest().then(
          (res) => sendResponse(res),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      if (message?.type === MSG_STUDIO_STEP) {
        // v2.1.0 (Studio Test): one step event, forwarded by the
        // gm-relay from a test tab. The sender tab id scopes the step
        // — a step can never land on another tab's test. The payload
        // is untrusted page data: sanitizeStudioStep reads only the
        // four known fields and never executes anything.
        const senderTab = (_sender as { tab?: { id?: number } } | null)?.tab;
        const tabId = typeof senderTab?.id === "number" ? senderTab.id : -1;
        const state = tabId >= 0 ? studioTests.get(tabId) : undefined;
        if (state && !state.finished) {
          const raw = (message as { step?: unknown }).step;
          const step = sanitizeStudioStep(typeof raw === "string" ? raw : JSON.stringify(raw ?? ""));
          if (step && !state.steps.some((s) => s.id === step.id)) {
            state.steps.push(step);
            if (state.steps.length > 100) state.steps.splice(0, state.steps.length - 100);
          }
        }
        sendResponse({ ok: true });
        return false;
      }
      if (message?.type === MSG_STUDIO_TEST_START) {
        // v2.1.0 (Studio Test): register the draft temporarily + open its site.
        const code = (message as { code?: unknown }).code;
        const url = (message as { url?: unknown }).url;
        if (typeof code !== "string" || typeof url !== "string") {
          sendResponse({ ok: false, error: "The test needs a draft and a URL." });
          return false;
        }
        void startStudioTest(code, url).then(
          (res) => sendResponse(res),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      if (message?.type === MSG_STUDIO_TEST_STOP) {
        const tabId = (message as { tabId?: unknown }).tabId;
        if (typeof tabId !== "number") {
          sendResponse({ ok: false });
          return false;
        }
        void stopStudioTest(tabId).then(
          (res) => sendResponse(res),
          () => sendResponse({ ok: true }),
        );
        return true; // async response
      }
      if (message?.type === MSG_STUDIO_TEST_STEPS) {
        const tabId = (message as { tabId?: unknown }).tabId;
        if (typeof tabId !== "number") {
          sendResponse({ ok: false, steps: [], status: "unknown", finished: true, result: "stopped", failedStep: "" });
          return false;
        }
        sendResponse(studioTestPoll(tabId));
        return false;
      }
      if (message?.type === MSG_OPEN_TABS_GET) {
        // v1.2.1: surfaces (incl. the content-script float) read the map.
        loadOpenTabs()
          .then((map) => sendResponse({ ok: true, map }))
          .catch(() => sendResponse({ ok: false, error: "Could not read the open tabs." }));
        return true; // async response
      }
      if (message?.type === MSG_OPEN_TABS_FOCUS) {
        if (typeof message?.taskId !== "string" || !message.taskId) {
          sendResponse({ ok: false, error: "Missing task id." });
          return false;
        }
        focusTaskTabs(message.taskId)
          .then((res) => sendResponse(res))
          .catch(() => sendResponse({ ok: false, error: "Could not focus the tab." }));
        return true; // async response
      }
      if (message?.type === MSG_OPEN_TABS_CLOSE) {
        if (typeof message?.taskId !== "string" || !message.taskId) {
          sendResponse({ ok: false, error: "Missing task id." });
          return false;
        }
        closeTaskTabs(message.taskId)
          .then((res) => sendResponse(res))
          .catch(() => sendResponse({ ok: false, error: "Could not close the tabs." }));
        return true; // async response
      }
      // --- v1.4: run a Flow (dashboard Run now / scheduled alarm path
      // shares the same background function). The handler validates
      // the flow id; runFlow validates every id inside the Flow.
      if (message?.type === MSG_FLOW_RUN) {
        if (typeof message?.id !== "string" || !message.id) {
          sendResponse({ ok: false, error: "Missing flow id." });
          return false;
        }
        void runFlow(message.id, "manual").then(
          (res) => sendResponse(res),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- v1.4 (#18): read-only omnibox diagnostic — runs the same
      // searchOmnibox the onInputChanged handler uses and returns its
      // matches, so a probe (and the user, via the console) can verify
      // the search without typing in the address bar. It opens
      // nothing and never executes the query.
      if (message?.type === MSG_OMNIBOX_TEST) {
        const query = typeof (message as { query?: unknown }).query === "string" ? (message as { query: string }).query : "";
        void (async () => {
          const [tasks, scripts, notes] = await Promise.all([loadTasks(), loadScripts(), loadNotes()]);
          sendResponse({
            ok: true,
            results: searchOmnibox(
              {
                tasks: tasks.map((t) => ({ id: t.id, name: t.name, url: t.url })),
                scripts: scripts.map((s) => ({ id: s.id, name: s.name, version: s.version })),
                notes: notes.map((n) => ({ id: n.id, title: displayTitle(n.title, n.body), body: n.body, tags: n.tags, brand: n.brand })),
              },
              query,
            ),
          });
        })().catch(() => sendResponse({ ok: false, error: "Could not search." }));
        return true; // async response
      }
      // --- v1.4: reminders status (notification level + alarms) ---
      if (message?.type === MSG_REMINDERS_STATUS) {
        void (async () => {
          const level = await getNotificationLevel();
          let alarms: string[] = [];
          try {
            const all = await chrome.alarms.getAll();
            alarms = (all || []).map((a: { name?: string }) => a?.name).filter((n: unknown): n is string => typeof n === "string" && n.startsWith(ALARM_PREFIX));
          } catch {
            alarms = [];
          }
          const settings = await loadRemindersSettings();
          sendResponse({ ok: true, level, alarms, settings });
        })().catch(() => sendResponse({ ok: false, error: "Could not read the reminders status." }));
        return true; // async response
      }
      // --- v1.4: run the daily-nudge check right now ---
      if (message?.type === MSG_REMINDERS_FORCE_NUDGE) {
        void runNudgeCheck().then(
          (res) => sendResponse({ ok: true, ...res }),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- v1.4: re-create all routine alarms from current state ---
      if (message?.type === MSG_REMINDERS_RESCHEDULE) {
        void rescheduleAlarms().then(
          () => sendResponse({ ok: true }),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- v1.5+ (#14): save / restore / delete a session ---
      if (message?.type === MSG_SESSION_SAVE) {
        const name = typeof (message as { name?: unknown }).name === "string" ? (message as { name: string }).name : "";
        void saveCurrentSession(name).then(
          (res) => sendResponse(res),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      if (message?.type === MSG_SESSION_RESTORE) {
        if (typeof message?.id !== "string" || !message.id) {
          sendResponse({ ok: false, error: "Missing session id." });
          return false;
        }
        void restoreSession(message.id).then(
          (res) => sendResponse(res),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      if (message?.type === MSG_SESSION_DELETE) {
        if (typeof message?.id !== "string" || !message.id) {
          sendResponse({ ok: false, error: "Missing session id." });
          return false;
        }
        void (async () => {
          const sessions = await loadSessions();
          await saveSessions(deleteSession(sessions, message.id as string));
          sendResponse({ ok: true });
        })().catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
        return true; // async response
      }
      // --- v1.5+ (#15): smart Open All (skip open tabs, group, suspend) ---
      if (message?.type === MSG_SMART_OPEN) {
        const scope = typeof (message as { scope?: unknown }).scope === "string" ? (message as { scope: string }).scope : "all";
        if (scope !== "all" && scope !== "pinned" && scope !== "missed") {
          sendResponse({ ok: false, error: "Unknown Open All scope — use all, pinned or missed." });
          return false;
        }
        void smartOpen(scope).then(
          (res) => sendResponse(res),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- v1.5+ (#11): re-register active userstyles ---
      if (message?.type === MSG_USERSTYLES_SYNC) {
        void syncUserStyles().then(
          (res) => sendResponse({ ok: true, ...res }),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- v1.5+ (#12): run the scratchpad once on the current tab ---
      if (message?.type === MSG_SCRATCHPAD_RUN) {
        const code = typeof (message as { code?: unknown }).code === "string" ? (message as { code: string }).code : "";
        const kind = (message as { kind?: unknown }).kind === "css" ? "css" : "js";
        void runScratchpad(code, kind as ScratchpadKind).then(
          (res) => sendResponse(res),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- v1.5+ (#23): read one script's GM values (read-only) ---
      if (message?.type === MSG_GM_VALUES_READ) {
        if (typeof message?.id !== "string" || !message.id) {
          sendResponse({ ok: false, error: "Missing script id." });
          return false;
        }
        void readGmValues(message.id).then(
          (res) => sendResponse(res),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- Later (#13): re-create all schedule alarms from storage ---
      if (message?.type === MSG_SCHEDULES_RESCHEDULE) {
        void rescheduleAlarms().then(
          () => sendResponse({ ok: true }),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- Later (#13): run one scheduled script right now ---
      if (message?.type === MSG_SCHEDULE_RUN_NOW) {
        if (typeof message?.id !== "string" || !message.id) {
          sendResponse({ ok: false, error: "Missing script id." });
          return false;
        }
        void fireScheduleRun(message.id, "manual").then(
          (res) => sendResponse(res),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- Later (#20): upload local state to the provider now ---
      if (message?.type === MSG_SYNC_NOW) {
        void syncUpload().then(
          (res) => sendResponse(res),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- Later (#20): download the provider copy (snapshot-first) ---
      if (message?.type === MSG_SYNC_PULL) {
        void syncDownload().then(
          (res) => sendResponse(res),
          (err: unknown) => sendResponse({ ok: false, error: String(err) }),
        );
        return true; // async response
      }
      // --- Later (#20): sync status (settings + last sync + alarms — never tokens) ---
      if (message?.type === MSG_SYNC_STATUS) {
        void (async () => {
          let alarms: string[] = [];
          try {
            const all = await chrome.alarms.getAll();
            alarms = (all || []).map((a: { name?: string }) => a?.name).filter((n: unknown): n is string => typeof n === "string" && n.startsWith(ALARM_PREFIX));
          } catch {
            alarms = [];
          }
          const settings = await loadSyncSettings();
          sendResponse({ ok: true, alarms, settings });
        })().catch(() => sendResponse({ ok: false, error: "Could not read the sync status." }));
        return true; // async response
      }
      return false;
    },
  );

  chrome.runtime.onInstalled.addListener((details: { reason?: string; previousVersion?: string }) => {
    console.info("[HiddenGem Flow] installed — v3.0.0");
    void reregisterEnabledFromStorage();
    void syncUserStyles();
    void ensureGmRelayForEnabled();
    // v1.4: routine alarms from current state (install + update).
    void rescheduleAlarms();
    // Unreleased: update check on install — gated inside checkForUpdates
    // (at most once per 6h), silent on failure.
    void checkForUpdates().catch(() => {
      // Silent by design — no banner, no error.
    });
    // v1.2.0: window mode behaviour + context menus + temp cleanup.
    void (async () => {
      currentMode = await loadWindowMode();
      await applyModeBehavior(currentMode);
    })();
    void setupContextMenus();
    void cleanupTempScripts();
    // v1.2.0: snapshot BEFORE an update — the data is still the old
    // version's data when this fires, so the snapshot is the
    // pre-update state. A fresh install (no previousVersion) takes no
    // snapshot: there is nothing to protect yet.
    if (details?.previousVersion) {
      void takeSnapshot();
    }
  });

  chrome.runtime.onStartup.addListener(() => {
    void reregisterEnabledFromStorage();
    void syncUserStyles();
    // v1.5+ (#14): seed the window-tabs snapshots so a window closed
    // before any tab event still auto-saves as "Last session".
    void (async () => {
      try {
        const wins = await chrome.windows.getAll();
        for (const w of wins || []) {
          if (typeof w?.id === "number") await refreshWindowTabs(w.id);
        }
      } catch {
        // Non-fatal.
      }
    })();
    void ensureGmRelayForEnabled();
    // v1.4: routine alarms from current state (a restart clears nothing
    // — alarms persist — but a changed task/flow since last run must
    // be reflected, and stale alarms from deleted items cleared).
    void rescheduleAlarms();
    void checkForUpdates().catch(() => {
      // Same gate, same silence as on install.
    });
    void (async () => {
      currentMode = await loadWindowMode();
      await applyModeBehavior(currentMode);
    })();
    void setupContextMenus();
    void cleanupTempScripts();
    // v1.2.1: open-tabs tracking is session-only — tabIds from a
    // previous browser session are dead. storage.session is cleared
    // with the session, but clear explicitly too (safety net).
    void clearOpenTabs();
  });

  // v1.2.0: keyboard shortcuts (manifest `commands`).
  try {
    chrome.commands.onCommand.addListener((command: string) => {
      void handleCommand(command);
    });
  } catch {
    // commands API unavailable — the shortcuts just do nothing.
  }

  // v1.2.0: context menu clicks.
  try {
    chrome.contextMenus.onClicked.addListener((info: { menuItemId?: string | number; linkUrl?: string; linkText?: string; selectionText?: string; pageUrl?: string }, tab?: { id?: number; url?: string; title?: string }) => {
      void handleContextMenuClick(info, tab);
    });
  } catch {
    // contextMenus API unavailable — setup already no-opped.
  }

  // v1.2.0: storage changes the background must react to.
  //  * Window mode → behaviour + close the surface being left.
  //  * Backed-up data keys → debounced auto-snapshot (when auto is ON).
  //  * Scripts → rebuild the "Run script on this page" submenu.
  //  * Tasks → reconcile open-tabs tracking (deleted/edited tasks).
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== "local") return;
      if (changes[WINDOW_MODE_KEY]) {
        const mode = sanitizeWindowMode(changes[WINDOW_MODE_KEY].newValue);
        void onWindowModeChanged(mode);
      }
      if (BACKUP_DATA_KEYS.some((k) => changes[k])) {
        scheduleAutoSnapshot();
      }
      if (changes["hiddengemflow.scripts.v1"]) {
        void setupContextMenus();
      }
      if (changes[CONTEXT_MENU_KEY]) {
        void setupContextMenus();
      }
      if (changes[TASKS_KEY]) {
        void reconcileOpenTabs();
      }
      // v1.4: tasks / flows / notes / routines settings all feed the
      // alarm schedule — any change re-creates it (cheap: clear +
      // re-create from state). The auto-snapshot above already fires
      // for these keys through BACKUP_DATA_KEYS.
      if (changes[TASKS_KEY] || changes[FLOWS_KEY] || changes[NOTES_KEY] || changes[REMINDERS_KEY]) {
        void rescheduleAlarms();
      }
      // v1.5+: a snooze change re-creates the snooze alarms; a
      // userstyle change re-registers the active styles.
      if (changes[SNOOZE_KEY]) {
        void rescheduleAlarms();
      }
      if (changes["hiddengemflow.userstyles.v1"]) {
        void syncUserStyles();
      }
      // Later: a schedule or sync-settings change re-creates the
      // schedule + periodic-sync alarms from storage.
      if (changes[SCHEDULES_KEY] || changes[SYNC_KEY]) {
        void rescheduleAlarms();
      }
    });
  } catch {
    // Storage events unavailable — mode behaviour still applies at
    // startup, and the menu is built on install/startup.
  }

  // Finding A-04: host access granted AFTER a script was registered
  // (dashboard "Grant site access") must re-attempt the GM relay
  // registration for that script's patterns — registration throws
  // while the pattern is ungranted, so the grant event is the retry.
  //
  // Deep audit (A-27): the same grant must ALSO re-register the
  // scripts themselves. A script whose registration failed for lack
  // of host access stayed unregistered until the next service-worker
  // restart — the dashboard says "Grant it once and the script runs
  // on every visit", which was only true after a restart. The grant
  // event is the retry for both.
  try {
    chrome.permissions.onAdded.addListener(() => {
      void reregisterEnabledFromStorage();
      void ensureGmRelayForEnabled();
    });
  } catch {
    // permissions events unavailable — startup/registration retries cover it.
  }

  // v1.4: routine alarms + notification clicks + omnibox.
  try {
    chrome.alarms?.onAlarm?.addListener((alarm: { name?: string }) => {
      void handleAlarm(alarm);
    });
  } catch {
    // Alarms API unavailable — reminders just don't fire.
  }
  try {
    chrome.notifications?.onClicked?.addListener((id: string) => {
      void handleNotificationClicked(id);
    });
  } catch {
    // Notifications API unavailable — clicks do nothing.
  }
  // v1.4 (#18): omnibox keyword "flow". onInputChanged searches real
  // storage (tasks first, then scripts, then notes); onInputEntered
  // opens the picked match — the text is only ever parsed as a
  // `kind:id` lookup key whose id must exist, or re-searched as a
  // plain query. Input is never executed as code.
  try {
    chrome.omnibox?.onInputChanged?.addListener((text: string, suggest: (results: Array<{ content: string; description: string }>) => void) => {
      void (async () => {
        const [tasks, scripts, notes] = await Promise.all([loadTasks(), loadScripts(), loadNotes()]);
        const results = searchOmnibox(
          {
            tasks: tasks.map((t) => ({ id: t.id, name: t.name, url: t.url })),
            scripts: scripts.map((s) => ({ id: s.id, name: s.name, version: s.version })),
            notes: notes.map((n) => ({ id: n.id, title: displayTitle(n.title, n.body), body: n.body, tags: n.tags, brand: n.brand })),
          },
          text,
        );
        try {
          chrome.omnibox.setDefaultSuggestion({
            description: results.length > 0 ? `Open the best match for "${text}"` : `No match for "${text}" — press Enter to open the dashboard.`,
          });
        } catch {
          // setDefaultSuggestion unavailable — suggestions still show.
        }
        try {
          suggest(
            results.map((r) => ({
              content: r.content,
              description: `${r.kind === "task" ? "Task" : r.kind === "script" ? "Script" : "Note"}: ${r.title} — ${r.description}`,
            })),
          );
        } catch {
          // Suggest failed — the default suggestion still applies.
        }
      })();
    });
    chrome.omnibox?.onInputEntered?.addListener((text: string) => {
      void (async () => {
        const parsed = parseOmniboxInput(text);
        if (parsed) {
          if (parsed.kind === "task") {
            const tasks = await loadTasks();
            const task = tasks.find((t) => t.id === parsed.id);
            if (task) {
              await openUrls([task.url]);
              return;
            }
          } else if (parsed.kind === "script") {
            const scripts = await loadScripts();
            if (scripts.some((s) => s.id === parsed.id)) {
              await openDashboard("scripts");
              return;
            }
          } else if (parsed.kind === "note") {
            const notes = await loadNotes();
            if (notes.some((n) => n.id === parsed.id)) {
              await openDashboard("notes");
              return;
            }
          }
          // The picked id no longer exists — fall through to a fresh
          // search instead of opening nothing.
        }
        const [tasks, scripts, notes] = await Promise.all([loadTasks(), loadScripts(), loadNotes()]);
        const results = searchOmnibox(
          {
            tasks: tasks.map((t) => ({ id: t.id, name: t.name, url: t.url })),
            scripts: scripts.map((s) => ({ id: s.id, name: s.name, version: s.version })),
            notes: notes.map((n) => ({ id: n.id, title: displayTitle(n.title, n.body), body: n.body, tags: n.tags, brand: n.brand })),
          },
          text,
          1,
        );
        if (results.length === 0) {
          await openDashboard();
          return;
        }
        const first = results[0];
        if (first.kind === "task") {
          const task = tasks.find((t) => t.id === first.id);
          if (task) await openUrls([task.url]);
          else await openDashboard("tasks");
        } else if (first.kind === "script") {
          await openDashboard("scripts");
        } else {
          await openDashboard("notes");
        }
      })();
    });
  } catch {
    // Omnibox API unavailable — the keyword just does nothing.
  }

  // --- Phase 4: run status from tab lifecycle ---
  // A running run becomes "done" when its tab finishes loading.
  chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: { status?: string }) => {
    if (changeInfo?.status !== "complete") return;
    void (async () => {
      try {
        const runs = await loadRuns();
        const next = updateRunsByTab(runs, tabId, "done", ["running"]);
        if (next !== runs) await saveRuns(next);
      } catch {
        // Non-fatal: the run just stays "running" until Stop All or a reload.
      }
    })();
  });

  // v1.2.1: a tracked tab that navigates OFF the task's site loses
  // its badge — untrack it the moment its URL changes. Only the URL
  // is checked here (not the load status — the run-status listener
  // above owns that); a same-site redirect keeps the badge.
  chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: { url?: string }) => {
    if (typeof changeInfo?.url !== "string" || !changeInfo.url) return;
    // Narrowed once here — the async closure below cannot narrow the
    // parameter's optional property on its own.
    const navigatedUrl: string = changeInfo.url;
    void (async () => {
      try {
        // Task data is loaded outside the chain (read-only hint); the
        // actual untracking runs inside mutateOpenTabs against the
        // freshly loaded map, so a concurrent open cannot be clobbered.
        const tasks = await loadTasks();
        const byId = new Map(tasks.map((t) => [t.id, t]));
        await mutateOpenTabs((map) => {
          let next = map;
          for (const taskId of Object.keys(next)) {
            if (!(next[taskId] ?? []).includes(tabId)) continue;
            const task = byId.get(taskId);
            if (task && sameSite(navigatedUrl, task.url)) continue;
            next = untrackTabId(next, tabId).map;
          }
          return next;
        });
      } catch {
        // Non-fatal: reconcile heals a stale entry later.
      }
    })();
  });

  // v1.3 (A-33): an activeTab grant ends when its tab closes or
  // navigates to another origin — drop the record then, so a stale
  // grant can never authorize a run on a different site. (A
  // same-origin reload keeps the grant, matching Chrome: the GM
  // script still runs after a reload, probe30b.)
  chrome.tabs.onRemoved.addListener((tabId: number) => {
    activeTabGrants.delete(tabId);
  });
  chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: { url?: string }) => {
    if (typeof changeInfo?.url !== "string" || !changeInfo.url) return;
    const granted = activeTabGrants.get(tabId);
    if (!granted) return;
    try {
      if (new URL(changeInfo.url).origin !== granted) activeTabGrants.delete(tabId);
    } catch {
      activeTabGrants.delete(tabId);
    }
  });

  // A queued/running run whose tab closes early becomes "failed".
  // Done runs are untouched — closing a finished tab is normal.
  chrome.tabs.onRemoved.addListener((tabId: number) => {
    // v1.2.1: a manually closed tab drops its badge at once, in every
    // open surface (broadcast inside mutateOpenTabs).
    void untrackOpenTab(tabId);
    void (async () => {
      try {
        const runs = await loadRuns();
        const next = updateRunsByTab(runs, tabId, "failed", ["running", "queued"]);
        if (next !== runs) await saveRuns(next);
      } catch {
        // Non-fatal.
      }
    })();
  });

  // --- v1.5+ (#14): auto-save the last closed window as a session ---
  // The window-tabs snapshot is refreshed on every tab change, so
  // windows.onRemoved can save the window that just closed. The
  // popup window (float.html) is not a normal window, so its tabs
  // never land in a session.
  try {
    chrome.windows.onRemoved.addListener((windowId: number) => {
      void autoSaveLastSession(windowId);
    });
    chrome.tabs.onCreated.addListener((tab: { windowId?: number }) => {
      if (typeof tab?.windowId === "number") void refreshWindowTabs(tab.windowId);
    });
    chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: { url?: string; status?: string }, tab: { windowId?: number }) => {
      if (typeof tab?.windowId === "number" && (changeInfo?.url || changeInfo?.status === "complete")) {
        void refreshWindowTabs(tab.windowId);
      }
    });
    chrome.tabs.onRemoved.addListener((tabId: number, removeInfo: { windowId?: number }) => {
      if (typeof removeInfo?.windowId === "number") void refreshWindowTabs(removeInfo.windowId);
    });
  } catch {
    // Window/tab events unavailable — auto-save just doesn't happen.
  }

  // --- v1.5+ (#15): a smart-opened tab the user actually viewed is
  // never suspended. tabs.onActivated marks it viewed in the pending
  // list (best-effort; a missed mark only delays a discard).
  try {
    chrome.tabs.onActivated.addListener((activeInfo: { tabId?: number }) => {
      const tabId = activeInfo?.tabId;
      if (typeof tabId !== "number") return;
      void (async () => {
        try {
          const pending = await loadSmartOpenPending();
          const entry = pending.find((p) => p.tabId === tabId);
          if (!entry || entry.viewed === true) return;
          await saveSmartOpenPending(pending.map((p) => (p.tabId === tabId ? { ...p, viewed: true } : p)));
        } catch {
          // Non-fatal.
        }
      })();
    });
  } catch {
    // Activation events unavailable — suspension still only discards
    // tabs that are not active at discard time.
  }
});
