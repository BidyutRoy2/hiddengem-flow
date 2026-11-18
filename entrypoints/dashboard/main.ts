// HiddenGem Flow — dashboard (Phase 4).
//
// Overview counts are read live from chrome.storage.local. If the Phase 3
// key does not exist yet, its count is honestly 0 — no demo data is ever
// invented. Tab switching and the position reset are plain DOM code.
// The Daily Tasks tab is fully working: add / edit / delete / pin /
// search / single, multi-select and Open All. Every tab open goes through
// the background (hiddengemflow:open-urls), which staggers the tabs and
// stamps lastOpenedAt. Nothing here talks to a server — the only external
// request in Phase 2 is the best-effort favicon image (Google s2), which
// falls back to a letter tile when it fails.
//
// Phase 3 adds the Scripts tab: create / import / edit / enable-disable /
// back up / restore / delete / version-upgrade, with a heuristic security
// scan that must be reviewed before any install confirms. Registration
// goes through shared/engine.ts (chrome.userScripts); if the user has not
// flipped "Allow User Scripts" in chrome://extensions, the banner says so
// and installs are saved-but-not-running — never silently dropped.
//
// Phase 4 adds the Script Store tab (Official Store: user-triggered load,
// search, Latest/Oldest, scan-then-confirm install, per-script
// auto-upgrade that only ever offers), the Smart Notification Bridge
// (banner in the Scripts tab and the floating window when the current
// site already has an official script — cached store index only, never
// a network fetch), and the Logs tab (live per-tab run status + Stop All).

import { checkUserScripts, registerEnabledScripts, registerScript, requestHostAccess, scriptHasHostAccess, setScriptEnabled, unregisterScript } from "../shared/engine";
import {
  EXTERNAL_SEARCH_NOTE,
  MAX_INSTALL_SIZE_BYTES,
  formatBytes,
  highlightEditor,
  isFetchableScriptUrl,
  lintEditor,
  newScriptTemplate,
  parseEditorMetadata,
  validateFetchedScript,
} from "../shared/editor";
import {
  ARCHIVED_FOLDER_ID,
  FOLDERS_KEY,
  UNSORTED_FOLDER_ID,
  archiveScript,
  bulkArchive,
  bulkDelete,
  bulkDisable,
  bulkEnable,
  bulkExportJson,
  createFolder,
  deleteFolder,
  folderCounts,
  loadFolders,
  moveScriptToFolder,
  parseTags,
  renameFolder,
  saveFolders,
  scriptsInFolder,
  setScriptTags,
  unarchiveScript,
  type Folder,
} from "../shared/folders";
import { MSG_SELF_TEST } from "../shared/gm-xhr";
import {
  FLOWS_KEY,
  MSG_FLOW_RUN,
  createFlow,
  deleteFlow,
  describeSchedule,
  formatFlowRunResult,
  loadFlows,
  saveFlows,
  sortFlows,
  updateFlow,
  type Flow,
} from "../shared/flows";
import { renderMarkdown } from "../shared/markdown";
import {
  MSG_REMINDERS_FORCE_NUDGE,
  MSG_REMINDERS_RESCHEDULE,
  MSG_REMINDERS_STATUS,
  REMINDERS_KEY,
  describeDays,
  formatReminder,
  loadRemindersSettings,
  saveRemindersSettings,
  type RemindersSettings,
} from "../shared/reminders";
import {
  MSG_STOP_ALL,
  RUNS_KEY,
  loadRuns,
  runningRunCount,
  type RunEntry,
  type RunStatus,
} from "../shared/runs";
import {
  MSG_OPEN_EXTENSION_DETAILS,
  SCRIPT_ERRORS_KEY,
  compareVersions,
  countLinesChanged,
  createScript,
  deleteScript,
  fileBaseName,
  loadScriptErrors,
  loadScripts,
  nonJsExtension,
  parseMetadata,
  rollbackTo,
  saveScripts,
  scriptsForUrl,
  securityScan,
  updateScriptCode,
  type ScanReport,
  type Script,
  type ScriptSource,
} from "../shared/scripts";
import {
  dismissBridgeForHostname,
  fetchStoreCode,
  fetchStoreIndex,
  findStoreScriptsForUrl,
  hostnameOf,
  isBridgeDismissed,
  loadBridgeDismissed,
  formatStoreDateShort,
  loadStoreCache,
  searchStoreScripts,
  sortStoreScriptsBy,
  type StoreCache,
  type StoreFetchResult,
  type StoreIndex,
  type StoreScript,
} from "../shared/store";
import {
  MSG_GET_ACTIVE_TAB,
  MSG_OPEN_URLS,
  TASKS_KEY,
  buildFaviconUrl,
  buildTasksBackup,
  createTask,
  deleteTask,
  formatImportResult,
  formatOpenResult,
  letterFor,
  loadTasks,
  mergeTasksBackup,
  openUrlsViaBackground,
  parseTasksBackup,
  saveTasks,
  searchTasks,
  sortTasks,
  togglePin,
  toggleTaskCompleted,
  updateTask,
  type Task,
} from "../shared/tasks";
import {
  MSG_CHECK_UPDATES,
  UPDATE_KEY,
  dismissUpdate,
  isUpdateAvailable,
  loadUpdateRecord,
  type UpdateRecord,
} from "../shared/updates";
import {
  OPEN_TABS_KEY,
  closeOpenTaskTabs,
  createCloseOpenTabsButton,
  createOpenBadge,
  focusOpenTaskTabs,
  loadOpenTabs,
  openTabsCount,
  openTabsTotal,
  type OpenTabsMap,
} from "../shared/open-tabs";
import {
  BACKUP_KEY,
  MSG_RESTORE_BACKUP,
  buildFullBackup,
  collectBackupData,
  formatBackupChip,
  formatBackupTime,
  loadBackupState,
  parseFullBackup,
  saveBackupState,
  snapshotLabel,
  type BackupData,
  type BackupSnapshot,
} from "../shared/backup";
import { displayTitle, loadNotes, NOTES_KEY, type Note } from "../shared/notes";
import {
  CONTEXT_MENU_KEY,
  MSG_OPEN_MODE,
  WINDOW_MODE_KEY,
  loadContextMenuEnabled,
  loadWindowMode,
  openSidePanelForCurrentWindow,
  sanitizeWindowMode,
  saveContextMenuEnabled,
  saveWindowMode,
  windowModeLabel,
  type WindowMode,
} from "../shared/window-mode";
import {
  MSG_SESSION_DELETE,
  MSG_SESSION_RESTORE,
  MSG_SESSION_SAVE,
  loadSessions,
  sessionSummary,
  type Session,
} from "../shared/sessions";
import {
  MSG_SMART_OPEN,
  defaultSmartOpenSettings,
  formatSmartOpenResult,
  loadSmartOpenSettings,
  saveSmartOpenSettings,
  type SmartOpenSettings,
} from "../shared/smart-open";
import {
  MSG_USERSTYLES_SYNC,
  createUserStyle,
  deleteUserStyle,
  loadUserStyles,
  saveUserStyles,
  styleHostGranted,
  styleScheduleActive,
  updateUserStyle,
  validateUserStyleCss,
  type UserStyle,
} from "../shared/userstyles";
import { MSG_SCRATCHPAD_RUN } from "../shared/scratchpad";
import { MSG_GM_VALUES_READ, buildScriptRunExport, formatGmValue } from "../shared/storage-viewer";
import {
  SNOOZE_KEY,
  addSnooze,
  createSnooze,
  loadSnoozes,
  removeSnooze,
  saveSnoozes,
  visibleTasks,
  type Snooze,
  type SnoozeTarget,
} from "../shared/snooze";
import { BUILTIN_COLLECTIONS, loadFollowedCollections, resolveCollections, saveFollowedCollections, searchStore, toggleCollectionFollow } from "../shared/collections";
import { assembleDossier } from "../shared/dossier";
import { LOCAL_FILE_SPIKE, localFileName, validateLocalFileReimport } from "../shared/local-file";
import { mountFloatNotes, type FloatNotesHandle } from "../shared/notes-ui";
import { IS_OWNER_BUILD } from "../shared/variant";
import {
  MSG_SCHEDULES_RESCHEDULE,
  MSG_SCHEDULE_RUN_NOW,
  SCHEDULE_INTERVALS,
  formatScheduleInterval,
  loadScheduleRuns,
  loadSchedules,
  saveSchedules,
  setSchedule,
  type ScheduleEntry,
  type ScheduleRunEntry,
} from "../shared/schedules";
import {
  MSG_SYNC_NOW,
  MSG_SYNC_PULL,
  SYNC_PROVIDER_LABELS,
  defaultSyncSettings,
  formatSyncInterval,
  loadSyncSettings,
  loadSyncTokens,
  saveSyncSettings,
  saveSyncTokens,
  syncOriginPattern,
  syncTokenStored,
  validateSyncTarget,
  type SyncProvider,
  type SyncSettings,
  type SyncTokens,
} from "../shared/sync";

declare const chrome: any;

const SCRIPTS_KEY = "hiddengemflow.scripts.v1";
const POS_KEY = "hiddengemflow.floating.pos";

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

async function loadCounts(): Promise<void> {
  let tasks = 0;
  let scripts = 0;
  let notes = 0;
  try {
    const data = await chrome.storage.local.get([SCRIPTS_KEY]);
    scripts = countOf(data?.[SCRIPTS_KEY]);
    tasks = (await loadTasks()).length;
    notes = (await loadNotes()).length;
  } catch {
    // Outside the extension context: stay at honest zeros.
  }
  const t = document.getElementById("stat-tasks");
  const s = document.getElementById("stat-scripts");
  const n = document.getElementById("stat-notes");
  const f = document.getElementById("footCount");
  if (t) t.textContent = String(tasks);
  if (s) s.textContent = String(scripts);
  if (n) n.textContent = String(notes);
  if (f) f.textContent = `${tasks} task sites · ${scripts} scripts · ${notes} notes`;
}

function initTabs(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>(".tab"));
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab ?? "overview";
      selectTab(name);
      try {
        history.replaceState(null, "", `#${name}`);
      } catch {
        // Non-fatal: the tab still switches.
      }
    });
  });
  // Open-to-tab: dashboard.html#store (and #tasks/#scripts/#logs/
  // #settings) selects that tab on load — the bridge button uses #store.
  const hash = location.hash.replace(/^#/, "");
  if (VALID_TABS.includes(hash)) selectTab(hash);
}

/**
 * Phase 4: select a tab by name (used by clicks and by the #hash on
 * load). Unknown names fall back to Overview. Switching to Logs
 * refreshes the run list; switching to Scripts refreshes the bridge
 * banner.
 */
function selectTab(name: string): void {
  if (!VALID_TABS.includes(name) && !extraTabs.includes(name)) name = "overview";
  currentTabName = name;
  const tabs = Array.from(document.querySelectorAll<HTMLElement>(".tab"));
  tabs.forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${name}`);
  });
  if (name === "logs") void refreshLogs();
  if (name === "scripts") void refreshScriptBridgeBanner();
  // Notepad (finding A-09): re-read storage on every switch, mirroring
  // the tasks fix above — a note saved from the floating window must
  // appear here without a reload.
  if (name === "notes") {
    void notesHandle?.refresh();
  }
  // v1.4: Flows tab re-reads storage on every switch — a Flow run from
  // another surface (or its last-run line) must show fresh.
  if (name === "flows") {
    void refreshFlows();
  }
  // v1.5+: Sessions / Styles / Dossier re-read on every switch.
  if (name === "sessions") void refreshSessionsTab();
  if (name === "styles") void refreshStylesTab();
  if (name === "dossier") void refreshDossierTab();
  // Later: the Later tab re-reads storage on every switch — a
  // scheduled run fired while the dashboard was open must show fresh.
  if (name === "later") void refreshLaterTab();
  if (name === "studio") studioOnSelect?.();
  // LIVE TEST FIX (v1.0.1, bug #3): tasks and scripts were loaded once
  // at startup, so a task saved from the floating window (or a script
  // toggled there) never appeared in the dashboard until the page was
  // reloaded — the live test saved a task from the floating window and
  // the Tasks tab still showed 0 rows. Re-read storage on every switch
  // to the tab (same pattern Logs/Scripts already used for their own
  // refreshes). A storage-change listener (initTasks / initScripts)
  // covers updates while the tab is already open.
  if (name === "tasks") {
    void loadTasks().then((loaded) => {
      tasks = loaded;
      refreshUI();
      void loadCounts();
    });
  }
  if (name === "scripts") {
    void (async () => {
      scripts = await loadScripts();
      scriptErrors = await loadScriptErrors();
      folders = await loadFolders();
      renderScripts();
      void refreshSiteScripts();
    })();
  }
}

function initReset(): void {
  const btn = document.getElementById("resetPos");
  const out = document.getElementById("resetResult");
  btn?.addEventListener("click", async () => {
    try {
      await chrome.storage.local.remove(POS_KEY);
      if (out) out.textContent = "Position reset — the floating window will open at the default spot next time.";
    } catch {
      if (out) out.textContent = "Could not reset (storage unavailable).";
    }
  });
}

// ---------------------------------------------------------------------------
// Extension update checker (Unreleased)
// ---------------------------------------------------------------------------
// The banner on the Overview tab + the Settings check. The dashboard
// never fetches the releases API itself — it asks the background
// (MSG_CHECK_UPDATES), which gates the check to at most once per 6h
// (a manual Settings check forces it). A failed check stays silent:
// the banner keeps showing the last good record, and the Settings
// status line is the only place a manual failure is mentioned.

function updateBannerText(record: UpdateRecord): string {
  const when = formatStoreDateShort(record.assetUpdatedAt || record.publishedAt) || record.assetUpdatedAt || record.publishedAt;
  return `A newer build is available — ${record.tag} (updated ${when}). Download it from the release page, replace the files in your unpacked extension folder, then press Reload in chrome://extensions. Do not remove the extension — removing deletes your saved tasks and scripts.`;
}

function wasUpdateDismissed(record: UpdateRecord | null): boolean {
  return (
    !!record &&
    record.dismissedTag !== "" &&
    record.dismissedTag === record.tag &&
    record.dismissedAssetUpdatedAt === record.assetUpdatedAt
  );
}

function renderUpdateState(record: UpdateRecord | null): void {
  const last = el("updateLastChecked");
  if (last) {
    last.textContent =
      record && record.checkedAt > 0
        ? `Last checked: ${new Date(record.checkedAt).toLocaleString()}`
        : "Last checked: never.";
  }
  const banner = el("updateBanner");
  const text = el("updateBannerText");
  const download = el<HTMLAnchorElement>("updateDownload");
  if (!banner || !text) return;
  if (isUpdateAvailable(record)) {
    text.textContent = updateBannerText(record as UpdateRecord);
    // The download control is a real link (target=_blank); point it at
    // the release page from the record. The static href in the HTML is
    // the same release page as a fallback.
    if (download && (record as UpdateRecord).downloadUrl) {
      download.href = (record as UpdateRecord).downloadUrl;
    }
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

async function askBackgroundForUpdate(force: boolean): Promise<{ ok: boolean; available: boolean; record: UpdateRecord | null }> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: MSG_CHECK_UPDATES, force })) as {
      ok?: boolean;
      available?: boolean;
      record?: UpdateRecord | null;
    } | null;
    if (res && typeof res === "object") {
      return { ok: res.ok === true, available: res.available === true, record: res.record ?? null };
    }
  } catch {
    // Background unreachable — fall through to the stored record.
  }
  const stored = await loadUpdateRecord();
  // Raw availability (same rule as the background): the Settings result
  // reports whether a newer build exists, not whether the banner shows.
  return { ok: false, available: stored?.available ?? false, record: stored };
}

function initUpdateChecker(): void {
  const howToBtn = el<HTMLButtonElement>("updateHowToBtn");
  const howTo = el("updateHowTo");
  const dismissBtn = el<HTMLButtonElement>("updateDismissBtn");
  const checkBtn = el<HTMLButtonElement>("updateCheckNow");
  const checkResult = el("updateCheckResult");

  howToBtn?.addEventListener("click", () => {
    if (howTo) howTo.hidden = !howTo.hidden;
  });
  dismissBtn?.addEventListener("click", async () => {
    await dismissUpdate();
    // The storage listener below re-renders; render now too in case
    // storage events are unavailable in this context.
    renderUpdateState(await loadUpdateRecord());
  });
  checkBtn?.addEventListener("click", async () => {
    if (checkBtn) checkBtn.disabled = true;
    if (checkResult) checkResult.textContent = "Checking…";
    const result = await askBackgroundForUpdate(true);
    renderUpdateState(result.record);
    if (checkResult) {
      if (!result.ok) {
        checkResult.textContent = "Could not reach GitHub — try again later.";
      } else if (result.available && result.record) {
        const dismissed = wasUpdateDismissed(result.record);
        checkResult.textContent = dismissed
          ? `A newer build is available — ${result.record.tag}. You dismissed the Overview banner for this release — it will show again for a newer one.`
          : `A newer build is available — ${result.record.tag}. See the Overview tab for the download link.`;
      } else {
        checkResult.textContent = "You are up to date.";
      }
    }
    if (checkBtn) checkBtn.disabled = false;
  });

  // Render from the stored record immediately, then ask the background
  // (non-forced — the 6h gate applies) and re-render from the answer.
  void loadUpdateRecord().then((record) => renderUpdateState(record));
  void askBackgroundForUpdate(false).then((result) => renderUpdateState(result.record));

  // Live-update while the dashboard stays open (the background check
  // on startup/install can land after this page opened).
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === "local" && changes[UPDATE_KEY]) {
        void loadUpdateRecord().then((record) => renderUpdateState(record));
      }
    });
  } catch {
    // Storage events unavailable — the ask above still applies.
  }
}

// ---------------------------------------------------------------------------
// Daily Tasks (Phase 2)
// ---------------------------------------------------------------------------

let tasks: Task[] = [];
// v1.5+ (#21): snoozed tasks (loaded in initTasks; refreshUI hides them).
let snoozes: Snooze[] = [];
let editingId: string | null = null;
let searchQuery = "";
const selected = new Set<string>();
// v1.2.1: open-tabs map (taskId → tabIds), session storage — read
// once at init and on session changes (see initTasks).
let openTabs: OpenTabsMap = {};

// Phase 4 state that initTabs() may touch during module evaluation
// (selectTab on a #hash calls refreshLogs / refreshScriptBridgeBanner
// before the section declarations below run), so it lives up here.
const VALID_TABS = ["overview", "tasks", "scripts", "store", "notes", "flows", "sessions", "styles", "dossier", "later", "logs", "settings"];
// v2.1.0: tabs added at runtime by the owner-only Studio module
// (the Studio tab button is created by shared/studio.ts, owner
// build only — the public build has no "studio" tab at all).
const extraTabs: string[] = [];
/** Called by the Studio module when its tab is selected (refresh its views). Set only in the owner build. */
let studioOnSelect: (() => void) | null = null;
// v1.5+ state (declared up here so the init calls below can use it).
let v15Sessions: Session[] = [];
let v15Styles: UserStyle[] = [];
let v15EditingStyleId: string | null = null;
let v15Followed: string[] = [];
let v15SmartSettings: SmartOpenSettings = defaultSmartOpenSettings();
let v15GrantedOrigins: string[] = [];
let currentTabName = "overview";
let logsTimer: number | null = null;
let bridgeHostname: string | null = null;
// Notepad (finding A-09): the dashboard mounts the same shared notes UI
// as the floating windows, over the same storage key. Declared up here
// because selectTab() (called from initTabs() on a #notes hash) may
// touch it before initNotes() runs.
let notesHandle: FloatNotesHandle | null = null;

// v1.4: Flows tab state. Declared up here for the same reason —
// selectTab() on a #flows hash may call refreshFlows() before
// initFlows() runs.
let flows: Flow[] = [];
let flowTasks: Task[] = [];
let flowScripts: Script[] = [];
let flowNotes: Note[] = [];
let editingFlowId: string | null = null;

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function showError(message: string): void {
  const err = el("taskError");
  if (!err) return;
  if (message) {
    err.textContent = message;
    err.hidden = false;
  } else {
    err.textContent = "";
    err.hidden = true;
  }
}

function refreshUI(): void {
  // v1.5+ (#21): snoozed tasks leave the main list until they return.
  const visible = visibleTasks(sortTasks(searchTasks(tasks, searchQuery)), snoozes);
  const list = el("taskList");
  const empty = el("taskEmpty");
  const count = el("taskCount");
  const selectAll = el<HTMLInputElement>("selectAllTasks");
  const openSelected = el<HTMLButtonElement>("openSelected");
  const openAll = el<HTMLButtonElement>("openAllTasks");
  // v1.2.1: dashboard summary chip — total tracked tabs across tasks.
  const openSummary = el("taskOpenSummary");
  const totalOpen = openTabsTotal(openTabs);
  if (openSummary) {
    openSummary.hidden = totalOpen === 0;
    openSummary.textContent = totalOpen === 0 ? "" : `● ${totalOpen} tab${totalOpen === 1 ? "" : "s"} open from tasks`;
  }

  const snoozedCount = tasks.length - visibleTasks(tasks, snoozes).length;
  if (count) {
    count.textContent =
      tasks.length === 0
        ? ""
        : searchQuery
          ? `${visible.length} of ${tasks.length} task sites`
          : `${tasks.length} task site${tasks.length === 1 ? "" : "s"}${snoozedCount > 0 ? ` · ${snoozedCount} snoozed` : ""}`;
  }
  if (empty) empty.hidden = tasks.length !== 0;
  if (openAll) openAll.disabled = tasks.length === 0;
  if (selectAll) {
    selectAll.checked = visible.length > 0 && visible.every((t) => selected.has(t.id));
    selectAll.disabled = visible.length === 0;
  }
  if (openSelected) {
    openSelected.disabled = selected.size === 0;
    openSelected.textContent = selected.size > 0 ? `Open selected (${selected.size})` : "Open selected";
  }
  if (!list) return;

  list.innerHTML = "";
  for (const task of visible) {
    const li = document.createElement("li");
    li.className = "task-row";
    if (task.pinned) li.classList.add("pinned");
    // v1.4: a completed task reads as done (name struck through).
    if (task.completed === true) li.classList.add("done");

    // Favicon: best-effort <img>; on failure it hides itself and the
    // letter tile underneath stays visible.
    const favUrl = task.favicon ?? buildFaviconUrl(task.url);
    const fav = document.createElement("span");
    fav.className = "fav";
    fav.textContent = letterFor(task.name);
    if (favUrl) {
      const img = document.createElement("img");
      img.className = "fav-img";
      img.src = favUrl;
      img.alt = "";
      img.addEventListener("error", () => img.remove());
      fav.appendChild(img);
    }

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "task-check";
    check.checked = selected.has(task.id);
    check.setAttribute("aria-label", `Select ${task.name}`);
    check.addEventListener("click", (e) => e.stopPropagation());
    check.addEventListener("change", () => {
      if (check.checked) selected.add(task.id);
      else selected.delete(task.id);
      refreshUI();
    });

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "task-open";
    openBtn.title = `Open ${task.name} in a new tab`;
    const name = document.createElement("span");
    name.className = "task-name";
    name.textContent = (task.pinned ? "📌 " : "") + task.name;
    const url = document.createElement("span");
    url.className = "task-url";
    url.textContent = task.url;
    openBtn.append(fav, name, url);
    openBtn.addEventListener("click", () => void openTasks([task]));

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = "icon-btn";
    pinBtn.title = task.pinned ? "Unpin" : "Pin to top";
    pinBtn.textContent = task.pinned ? "★" : "☆";
    pinBtn.setAttribute("aria-label", `${task.pinned ? "Unpin" : "Pin"} ${task.name}`);
    pinBtn.addEventListener("click", async () => {
      tasks = togglePin(tasks, task.id);
      await persist();
    });

    // v1.4: mark done / not done (a checklist tick in a note also
    // sets this). A completed task gets no reminder.
    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "icon-btn";
    if (task.completed === true) doneBtn.classList.add("done-on");
    doneBtn.title = task.completed === true ? "Mark as not done" : "Mark as done";
    doneBtn.textContent = task.completed === true ? "✓" : "○";
    doneBtn.setAttribute("aria-label", `${task.completed === true ? "Mark as not done" : "Mark as done"}: ${task.name}`);
    doneBtn.addEventListener("click", async () => {
      tasks = toggleTaskCompleted(tasks, task.id);
      await persist();
    });

    // v1.5+ (#21): snooze this task to tomorrow 09:00 (one click;
    // other targets live in the Sessions tab's snooze queue).
    const snoozeBtn = document.createElement("button");
    snoozeBtn.type = "button";
    snoozeBtn.className = "icon-btn";
    snoozeBtn.title = "Snooze to tomorrow 09:00";
    snoozeBtn.textContent = "⏰";
    snoozeBtn.setAttribute("aria-label", `Snooze ${task.name} to tomorrow 09:00`);
    snoozeBtn.addEventListener("click", async () => {
      const snooze = createSnooze(task.id, "tomorrow-0900");
      if (!snooze) return;
      snoozes = addSnooze(snoozes, snooze);
      await saveSnoozes(snoozes);
      await chrome.runtime.sendMessage({ type: MSG_REMINDERS_RESCHEDULE }).catch(() => undefined);
      refreshUI();
      void loadCounts();
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "icon-btn";
    editBtn.title = "Edit";
    editBtn.textContent = "✎";
    editBtn.setAttribute("aria-label", `Edit ${task.name}`);
    editBtn.addEventListener("click", () => startEdit(task));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn danger";
    delBtn.title = "Delete";
    delBtn.textContent = "🗑";
    delBtn.setAttribute("aria-label", `Delete ${task.name}`);
    delBtn.addEventListener("click", async () => {
      if (!window.confirm(`Delete "${task.name}"?`)) return;
      tasks = deleteTask(tasks, task.id);
      selected.delete(task.id);
      if (editingId === task.id) cancelEdit();
      await persist();
    });

    li.append(check, openBtn, pinBtn, snoozeBtn, editBtn, delBtn);
    // v1.2.1: an open task gets its ● Open badge (focuses the tab)
    // and ✕ Close (closes exactly those tabs), and the emerald row
    // border. Both re-read the map after the action; the session
    // onChanged listener below refreshes the row either way.
    const openCount = openTabsCount(openTabs, task.id);
    if (openCount > 0) {
      li.classList.add("open");
      const badge = createOpenBadge(openCount, () => {
        void focusOpenTaskTabs(task.id).then(() => void refreshOpenTabs());
      });
      const closeBtn = createCloseOpenTabsButton(() => {
        void closeOpenTaskTabs(task.id).then(() => void refreshOpenTabs());
      });
      li.insertBefore(badge, pinBtn);
      li.insertBefore(closeBtn, pinBtn);
    }
    // v1.4: reminder chip (when set and the task is not done) + the
    // done toggle, both before the pin button.
    if (task.reminder && task.completed !== true) {
      const chip = document.createElement("span");
      chip.className = "task-reminder-chip";
      chip.textContent = `🔔 ${formatReminder(task.reminder)}`;
      chip.title = `Reminder: ${describeDays(task.reminder.days)} at ${task.reminder.time} — click to open the task`;
      li.insertBefore(chip, pinBtn);
    }
    li.insertBefore(doneBtn, pinBtn);
    list.appendChild(li);
  }

  if (visible.length === 0 && tasks.length > 0 && empty) {
    empty.hidden = false;
    empty.textContent = "No task sites match that search.";
  } else if (tasks.length === 0 && empty) {
    empty.textContent = "No task sites saved yet — add your first one above.";
  }
}

/** v1.2.1: re-read the open-tabs map (session storage) and re-render the rows + summary chip. */
async function refreshOpenTabs(): Promise<void> {
  openTabs = await loadOpenTabs();
  refreshUI();
}

async function persist(): Promise<void> {
  try {
    await saveTasks(tasks);
  } catch {
    showError("Could not save (storage unavailable).");
  }
  refreshUI();
  void loadCounts();
}

/** Show the result of an open ("Opened 3 tabs." / "Opened 50 tabs. 10 skipped (50 open at a time).") under the task actions. */
function showOpenStatus(message: string): void {
  const status = el("taskOpenStatus");
  if (!status) return;
  if (message) {
    status.textContent = message;
    status.hidden = false;
  } else {
    status.textContent = "";
    status.hidden = true;
  }
}

/** Show the result of a task export / import ("Imported 5 tasks. 1 skipped — already saved.") under the task actions. */
function showImportStatus(message: string): void {
  const status = el("taskImportStatus");
  if (!status) return;
  if (message) {
    status.textContent = message;
    status.hidden = false;
  } else {
    status.textContent = "";
    status.hidden = true;
  }
}

async function openTasks(toOpen: Task[]): Promise<void> {
  if (toOpen.length === 0) return;
  const result = await openUrlsViaBackground(toOpen.map((t) => t.url));
  if (!result.ok) {
    showError("Could not open the tab(s) — the background did not answer. Try again.");
    return;
  }
  // Unreleased: show the counts — including silently skipped tabs, which
  // the old boolean-only reply hid ("Opened 50 tabs. 10 skipped.").
  showOpenStatus(formatOpenResult(result));
  // The background stamped lastOpenedAt; reload so the list stays fresh.
  tasks = await loadTasks();
  refreshUI();
  void loadCounts();
}

function startEdit(task: Task): void {
  editingId = task.id;
  const nameInput = el<HTMLInputElement>("taskName");
  const urlInput = el<HTMLInputElement>("taskUrl");
  const cancelBtn = el("taskCancelEdit");
  const saveBtn = el<HTMLButtonElement>("taskSave");
  if (nameInput) nameInput.value = task.name;
  if (urlInput) urlInput.value = task.url;
  const reminderInput = el<HTMLInputElement>("taskReminderTime");
  if (reminderInput) reminderInput.value = task.reminder?.time ?? "";
  setDayCheckboxes("taskReminderDays", task.reminder?.days);
  if (cancelBtn) cancelBtn.hidden = false;
  if (saveBtn) saveBtn.textContent = "Save changes";
  showError("");
  nameInput?.focus();
}

function cancelEdit(): void {
  editingId = null;
  const nameInput = el<HTMLInputElement>("taskName");
  const urlInput = el<HTMLInputElement>("taskUrl");
  const cancelBtn = el("taskCancelEdit");
  const saveBtn = el<HTMLButtonElement>("taskSave");
  if (nameInput) nameInput.value = "";
  if (urlInput) urlInput.value = "";
  const reminderInput = el<HTMLInputElement>("taskReminderTime");
  if (reminderInput) reminderInput.value = "";
  setDayCheckboxes("taskReminderDays", undefined);
  if (cancelBtn) cancelBtn.hidden = true;
  if (saveBtn) saveBtn.textContent = "Save task";
  showError("");
}

// ---------------------------------------------------------------------------
// v1.4: repeat-day checkboxes (Mon..Sun) shared by task reminders,
// scheduled Open All and Flow schedules. All 7 checked (or none) means
// "every day" — readDayCheckboxes returns undefined for that case, and
// setDayCheckboxes(undefined) checks all 7.
// ---------------------------------------------------------------------------

const DAY_CHECK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_CHECK_LABEL: Record<number, string> = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };

function buildDayCheckboxes(containerId: string): void {
  const box = el(containerId);
  if (!box || box.childElementCount > 0) return;
  for (const d of DAY_CHECK_ORDER) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(d);
    input.checked = true;
    label.append(input, document.createTextNode(` ${DAY_CHECK_LABEL[d]}`));
    box.appendChild(label);
  }
}

function readDayCheckboxes(containerId: string): number[] | undefined {
  const box = el(containerId);
  if (!box) return undefined;
  const checked = Array.from(box.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))
    .filter((i) => i.checked)
    .map((i) => Number(i.value));
  if (checked.length === 0 || checked.length === 7) return undefined;
  return checked.sort((a, b) => a - b);
}

function setDayCheckboxes(containerId: string, days: number[] | undefined): void {
  const box = el(containerId);
  if (!box) return;
  const wanted = days && days.length > 0 ? new Set(days) : null;
  for (const input of Array.from(box.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))) {
    input.checked = wanted === null ? true : wanted.has(Number(input.value));
  }
}

function initTasks(): void {
  const form = el<HTMLFormElement>("taskForm");
  const nameInput = el<HTMLInputElement>("taskName");
  const urlInput = el<HTMLInputElement>("taskUrl");
  const searchInput = el<HTMLInputElement>("taskSearch");
  const selectAll = el<HTMLInputElement>("selectAllTasks");
  const openSelectedBtn = el<HTMLButtonElement>("openSelected");
  const openAllBtn = el<HTMLButtonElement>("openAllTasks");
  const cancelBtn = el("taskCancelEdit");
  const exportBtn = el<HTMLButtonElement>("taskExport");
  const importBtn = el<HTMLButtonElement>("taskImportBtn");
  const importFile = el<HTMLInputElement>("taskImportFile");

  // v1.4: reminder repeat-day checkboxes in the add/edit form.
  buildDayCheckboxes("taskReminderDays");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput?.value ?? "";
    const url = urlInput?.value ?? "";
    // v1.4: reminder — a time sets it, an empty time clears it.
    const reminderTime = el<HTMLInputElement>("taskReminderTime")?.value ?? "";
    const reminderDays = readDayCheckboxes("taskReminderDays");
    const reminder = reminderTime
      ? { time: reminderTime, ...(reminderDays ? { days: reminderDays } : {}) }
      : null;
    try {
      if (editingId) {
        tasks = updateTask(tasks, editingId, { name, url, reminder });
      } else {
        // Unreleased: createTask gets the current list, so a URL that is
        // already saved is rejected with "This site is already saved."
        tasks = sortTasks([
          ...tasks,
          createTask(name, url, Date.now(), undefined, tasks, reminder ? { reminder } : undefined),
        ]);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "That URL does not look valid.");
      return;
    }
    cancelEdit();
    await persist();
    // Keep the success visible: focus the search so the new row is seen.
    searchInput?.focus();
  });

  cancelBtn?.addEventListener("click", () => cancelEdit());

  searchInput?.addEventListener("input", () => {
    searchQuery = searchInput.value;
    refreshUI();
  });

  selectAll?.addEventListener("change", () => {
    const visible = visibleTasks(sortTasks(searchTasks(tasks, searchQuery)), snoozes);
    if (selectAll.checked) visible.forEach((t) => selected.add(t.id));
    else visible.forEach((t) => selected.delete(t.id));
    refreshUI();
  });

  openSelectedBtn?.addEventListener("click", () => {
    const chosen = tasks.filter((t) => selected.has(t.id));
    void openTasks(chosen);
  });

  openAllBtn?.addEventListener("click", () => {
    void openTasks(sortTasks(tasks));
  });

  // Tasks backup (finding A-07): one JSON file, dashboard only — same
  // pattern as the scripts Backup (export JSON) / Restore backup.
  // Export is always a faithful copy of the list as shown; import
  // merges (a URL that is already saved is skipped, never replaced),
  // so no confirm is needed — nothing is ever deleted by it.
  exportBtn?.addEventListener("click", () => {
    const backup = buildTasksBackup(tasks);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`hiddengem-flow-tasks-${stamp}.json`, JSON.stringify(backup, null, 2), "application/json");
    showError("");
    showImportStatus(
      backup.tasks.length === 0
        ? "Exported an empty backup — no tasks saved yet."
        : `Exported ${backup.tasks.length} task${backup.tasks.length === 1 ? "" : "s"} to hiddengem-flow-tasks-${stamp}.json.`,
    );
  });

  importBtn?.addEventListener("click", () => importFile?.click());
  importFile?.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    importFile.value = "";
    if (!file) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      showError("That file is not a HiddenGem Flow tasks backup — nothing was imported.");
      showImportStatus("");
      return;
    }
    const result = parseTasksBackup(parsed);
    if (!result.ok) {
      showError(result.error);
      showImportStatus("");
      return;
    }
    const merged = mergeTasksBackup(tasks, result.tasks);
    tasks = merged.tasks;
    await persist();
    showError("");
    showImportStatus(formatImportResult(merged.imported, merged.skipped, result.tasks.length));
  });

  void loadTasks().then((loaded) => {
    tasks = loaded;
    refreshUI();
    void loadCounts();
  });
  // v1.5+ (#21): snoozes load once, then live-update (a snooze
  // firing in the background must bring the task back at once).
  void loadSnoozes().then((loaded) => {
    snoozes = loaded;
    refreshUI();
  });
  // v1.2.1: the open-tabs map lives in storage.session — load it once,
  // then live-update when a tab opens, closes or navigates (same
  // onChanged pattern as TASKS_KEY, on the session area).
  void refreshOpenTabs();
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === "session" && changes[OPEN_TABS_KEY]) {
        void refreshOpenTabs();
      }
    });
  } catch {
    // Storage events unavailable — the tab-switch reload still applies.
  }

  // Live-test fix (v1.0.1, bug #3): a task saved from the floating
  // window (or stamped by the background) while this page is open must
  // appear without a reload. The Logs tab already had this pattern for
  // RUNS_KEY; tasks get the same for TASKS_KEY. (The tab-switch reload
  // in selectTab covers the case where the listener missed an event.)
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === "local" && changes[TASKS_KEY]) {
        void loadTasks().then((loaded) => {
          tasks = loaded;
          refreshUI();
          void loadCounts();
        });
      }
      if (areaName === "local" && changes[SNOOZE_KEY]) {
        void loadSnoozes().then((loaded) => {
          snoozes = loaded;
          refreshUI();
        });
      }
    });
  } catch {
    // Storage events unavailable — the tab-switch reload still applies.
  }
}

function initNotes(): void {
  // The dashboard shows the SAME notes as the floating windows (same
  // storage key, same list + editor, wider layout). The float's
  // "View all in Dashboard →" opens this tab, so the second callback
  // is a no-op here — there is nowhere else to go.
  notesHandle = mountFloatNotes(document, () => {
    // Already on the dashboard.
  });
  void notesHandle.refresh();
  // v1.4 (A-38): a note saved from the floating window (or changed by
  // the background checklist tick) while this page is open must appear
  // without a reload — the same live-update pattern tasks got for
  // TASKS_KEY (v1.0.1, bug #3). refresh() never clobbers an open
  // editor: only the list re-renders.
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === "local" && changes[NOTES_KEY]) {
        void notesHandle?.refresh();
      }
    });
  } catch {
    // Storage events unavailable — the tab-switch reload still applies.
  }
}

// ---------------------------------------------------------------------------
// v1.4: Flows — one routine = tasks + scripts + note.
// ---------------------------------------------------------------------------

function showFlowError(message: string): void {
  const err = el("flowError");
  if (!err) return;
  if (message) {
    err.textContent = message;
    err.hidden = false;
  } else {
    err.textContent = "";
    err.hidden = true;
  }
}

function showFlowRunStatus(message: string, isError = false): void {
  const status = el("flowRunStatus");
  if (!status) return;
  if (message) {
    status.textContent = message;
    status.hidden = false;
    status.classList.toggle("error-text", isError);
  } else {
    status.textContent = "";
    status.hidden = true;
  }
}

/** Ask the background to run a Flow. Resolves to the run result (or ok:false when the background did not answer). */
function sendFlowRun(id: string): Promise<{
  ok: boolean;
  opened?: number;
  skipped?: number;
  scriptNames?: string[];
  skippedScripts?: number;
  noteTitle?: string | null;
  noteBody?: string | null;
  noteId?: string | null;
  missingTasks?: number;
  noAccessScripts?: number;
  noAccessNames?: string[];
  engineOff?: boolean;
  error?: string;
}> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: MSG_FLOW_RUN, id }, (res: unknown) => {
        resolve((res ?? { ok: false, error: "The background did not answer." }) as {
          ok: boolean;
          opened?: number;
          skipped?: number;
          scriptNames?: string[];
          skippedScripts?: number;
          noteTitle?: string | null;
          noteBody?: string | null;
          noteId?: string | null;
          missingTasks?: number;
          noAccessScripts?: number;
          noAccessNames?: string[];
          error?: string;
        });
      });
    } catch (err) {
      resolve({ ok: false, error: String(err instanceof Error ? err.message : err) });
    }
  });
}

/** Ask the background for the reminders status (notification level + scheduled alarms). */
function askRemindersStatus(): Promise<{ ok: boolean; level?: string; alarms?: string[]; settings?: RemindersSettings }> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: MSG_REMINDERS_STATUS }, (res: unknown) => {
        resolve((res ?? { ok: false }) as { ok: boolean; level?: string; alarms?: string[]; settings?: RemindersSettings });
      });
    } catch {
      resolve({ ok: false });
    }
  });
}

async function refreshReminderStatus(): Promise<void> {
  const line = el("reminderStatus");
  if (!line) return;
  const res = await askRemindersStatus();
  if (!res.ok) {
    line.textContent = "Could not check reminders — the background did not answer.";
    return;
  }
  const count = Array.isArray(res.alarms) ? res.alarms.length : 0;
  if (res.level === "denied") {
    line.textContent = `Reminders are OFF — notifications are blocked in Chrome. Reminders are still scheduled (${count} alarm${count === 1 ? "" : "s"}), but nothing can alert you. Turn notifications on in chrome://settings/content/notifications.`;
  } else {
    line.textContent = `Reminders are on — notifications allowed. ${count} routine alarm${count === 1 ? "" : "s"} scheduled.`;
  }
}

/** Re-read flows + tasks + scripts + notes and re-render the tab. */
async function refreshFlows(): Promise<void> {
  flows = await loadFlows();
  flowTasks = await loadTasks();
  flowScripts = await loadScripts();
  flowNotes = await loadNotes();
  renderFlowFormPicks();
  renderFlowList();
  void refreshReminderStatus();
}

function renderFlowFormPicks(): void {
  const taskPick = el("flowTaskPick");
  if (taskPick) {
    taskPick.textContent = "";
    const editing = editingFlowId ? flows.find((f) => f.id === editingFlowId) : undefined;
    if (flowTasks.length === 0) {
      taskPick.textContent = "No tasks saved yet — add some on the Daily Tasks tab first.";
    }
    for (const task of sortTasks(flowTasks)) {
      const label = document.createElement("label");
      label.className = "flow-pick-row";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = task.id;
      input.checked = editing ? editing.taskIds.includes(task.id) : false;
      label.append(input, document.createTextNode(` ${task.name}`));
      taskPick.appendChild(label);
    }
  }
  const scriptPick = el("flowScriptPick");
  if (scriptPick) {
    scriptPick.textContent = "";
    const editing = editingFlowId ? flows.find((f) => f.id === editingFlowId) : undefined;
    if (flowScripts.length === 0) {
      scriptPick.textContent = "No scripts installed yet — a flow can run with tasks only.";
    }
    for (const script of flowScripts) {
      const label = document.createElement("label");
      label.className = "flow-pick-row";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = script.id;
      input.checked = editing ? editing.scriptIds.includes(script.id) : false;
      const suffix = script.archived === true ? " (archived — will not run)" : !script.enabled ? " (disabled — will not run)" : "";
      label.append(input, document.createTextNode(` ${script.name}${suffix}`));
      scriptPick.appendChild(label);
    }
  }
  const noteSel = el<HTMLSelectElement>("flowNote");
  if (noteSel) {
    const current = noteSel.value;
    noteSel.textContent = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "No note";
    noteSel.appendChild(none);
    for (const note of flowNotes) {
      const opt = document.createElement("option");
      opt.value = note.id;
      opt.textContent = displayTitle(note.title, note.body);
      noteSel.appendChild(opt);
    }
    const editing = editingFlowId ? flows.find((f) => f.id === editingFlowId) : undefined;
    noteSel.value = editing?.noteId ?? current;
  }
}

function renderFlowList(): void {
  const list = el("flowList");
  const empty = el("flowEmpty");
  if (!list) return;
  list.textContent = "";
  const sorted = sortFlows(flows);
  if (empty) empty.hidden = sorted.length !== 0;
  for (const flow of sorted) {
    const li = document.createElement("li");
    li.className = "flow-card";

    const head = document.createElement("div");
    head.className = "flow-head";
    const name = document.createElement("b");
    name.textContent = flow.name;
    head.appendChild(name);
    const sched = document.createElement("span");
    sched.className = "flow-sched";
    sched.textContent = describeSchedule(flow.schedule);
    head.appendChild(sched);
    li.appendChild(head);

    if (flow.description) {
      const desc = document.createElement("p");
      desc.className = "flow-desc";
      desc.textContent = flow.description;
      li.appendChild(desc);
    }

    const addChips = (labelText: string, chips: Array<{ text: string; cls?: string }>): void => {
      const sec = document.createElement("div");
      sec.className = "flow-sec";
      sec.textContent = labelText;
      li.appendChild(sec);
      const wrap = document.createElement("div");
      for (const chip of chips) {
        const span = document.createElement("span");
        span.className = `flow-chip${chip.cls ? ` ${chip.cls}` : ""}`;
        span.textContent = chip.text;
        wrap.appendChild(span);
      }
      li.appendChild(wrap);
    };
    addChips(
      "TASKS",
      flow.taskIds.map((id) => {
        const task = flowTasks.find((t) => t.id === id);
        return task ? { text: task.name } : { text: "(deleted task)", cls: "missing" };
      }),
    );
    if (flow.scriptIds.length > 0) {
      addChips(
        "SCRIPTS",
        flow.scriptIds.map((id) => {
          const script = flowScripts.find((s) => s.id === id);
          if (!script) return { text: "(deleted script)", cls: "missing" };
          if (script.archived === true) return { text: `${script.name} (archived)`, cls: "missing" };
          if (!script.enabled) return { text: `${script.name} (disabled)`, cls: "missing" };
          return { text: script.name, cls: "script" };
        }),
      );
    }
    if (flow.noteId) {
      const note = flowNotes.find((n) => n.id === flow.noteId);
      addChips("NOTE", [{ text: note ? displayTitle(note.title, note.body) : "(deleted note)", cls: "note" }]);
    }

    if (flow.lastRun) {
      const last = document.createElement("p");
      last.className = "flow-last-run";
      const when = new Date(flow.lastRun.at).toLocaleString();
      last.textContent = `Last run ${when} — opened ${flow.lastRun.opened} tab${flow.lastRun.opened === 1 ? "" : "s"}${flow.lastRun.scriptNames.length > 0 ? ` · ${flow.lastRun.scriptNames.join(", ")}` : ""}${flow.lastRun.noteTitle ? ` · note: ${flow.lastRun.noteTitle}` : ""}.`;
      li.appendChild(last);
    }

    const row = document.createElement("div");
    row.className = "flow-run";
    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.className = "primary";
    runBtn.textContent = "▶ Run now";
    runBtn.addEventListener("click", () => void runFlowFromDashboard(flow));
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "secondary";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => startFlowEdit(flow));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "secondary danger-btn";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      if (!window.confirm(`Delete the flow "${flow.name}"?`)) return;
      flows = deleteFlow(flows, flow.id);
      if (editingFlowId === flow.id) cancelFlowEdit();
      await saveFlows(flows);
      renderFlowList();
    });
    row.append(runBtn, editBtn, delBtn);
    li.appendChild(row);
    list.appendChild(li);
  }
}

async function runFlowFromDashboard(flow: Flow): Promise<void> {
  showFlowRunStatus(`Running "${flow.name}"…`);
  const preview = el("flowNotePreview");
  if (preview) {
    preview.hidden = true;
    preview.textContent = "";
  }
  const res = await sendFlowRun(flow.id);
  if (!res.ok) {
    showFlowRunStatus(`Could not run "${flow.name}": ${res.error ?? "unknown error"}`, true);
    return;
  }
  showFlowRunStatus(
    `"${flow.name}": ` +
      formatFlowRunResult({
        opened: res.opened ?? 0,
        skipped: res.skipped ?? 0,
        scriptNames: res.scriptNames ?? [],
        skippedScripts: res.skippedScripts ?? 0,
        noAccessNames: res.noAccessNames ?? [],
        noteTitle: res.noteTitle ?? null,
      }) +
      (res.engineOff ? " User scripts are OFF — scripts are saved but cannot run until the toggle is on." : ""),
  );
  if (res.noteBody) {
    const previewEl = el("flowNotePreview");
    if (previewEl) {
      previewEl.textContent = "";
      const title = document.createElement("h3");
      title.textContent = res.noteTitle ?? "Note";
      previewEl.appendChild(title);
      const body = document.createElement("div");
      body.className = "flow-note-body";
      renderMarkdown(res.noteBody, body, document);
      previewEl.appendChild(body);
      previewEl.hidden = false;
    }
  }
  await refreshFlows();
}

function startFlowEdit(flow: Flow): void {
  editingFlowId = flow.id;
  const title = el("flowFormTitle");
  if (title) title.textContent = `Edit flow — ${flow.name}`;
  const nameInput = el<HTMLInputElement>("flowName");
  const descInput = el<HTMLInputElement>("flowDesc");
  const timeInput = el<HTMLInputElement>("flowTime");
  const cancelBtn = el("flowCancelEdit");
  const saveBtn = el<HTMLButtonElement>("flowSave");
  if (nameInput) nameInput.value = flow.name;
  if (descInput) descInput.value = flow.description;
  if (timeInput) timeInput.value = flow.schedule?.time ?? "";
  setDayCheckboxes("flowDays", flow.schedule?.days);
  if (cancelBtn) cancelBtn.hidden = false;
  if (saveBtn) saveBtn.textContent = "Save changes";
  showFlowError("");
  renderFlowFormPicks();
  document.getElementById("flowFormCard")?.scrollIntoView({ block: "nearest" });
}

function cancelFlowEdit(): void {
  editingFlowId = null;
  const title = el("flowFormTitle");
  if (title) title.textContent = "New flow";
  const nameInput = el<HTMLInputElement>("flowName");
  const descInput = el<HTMLInputElement>("flowDesc");
  const timeInput = el<HTMLInputElement>("flowTime");
  const saveBtn = el<HTMLButtonElement>("flowSave");
  const cancelBtn = el("flowCancelEdit");
  if (nameInput) nameInput.value = "";
  if (descInput) descInput.value = "";
  if (timeInput) timeInput.value = "";
  setDayCheckboxes("flowDays", undefined);
  if (saveBtn) saveBtn.textContent = "Save flow";
  if (cancelBtn) cancelBtn.hidden = true;
  showFlowError("");
  renderFlowFormPicks();
}

function initFlows(): void {
  buildDayCheckboxes("openAllDays");
  buildDayCheckboxes("flowDays");

  // Nudge hour select: 00:00–23:00.
  const hourSel = el<HTMLSelectElement>("nudgeHour");
  if (hourSel && hourSel.options.length === 0) {
    for (let h = 0; h < 24; h++) {
      const opt = document.createElement("option");
      opt.value = String(h);
      opt.textContent = `${String(h).padStart(2, "0")}:00`;
      hourSel.appendChild(opt);
    }
  }

  // Load the routines settings into the form.
  void loadRemindersSettings().then((settings) => {
    const nudgeToggle = el<HTMLInputElement>("nudgeToggle");
    if (nudgeToggle) nudgeToggle.checked = settings.nudgeEnabled;
    if (hourSel) hourSel.value = String(settings.nudgeHour);
    const openAllTime = el<HTMLInputElement>("openAllTime");
    if (openAllTime) openAllTime.value = settings.scheduledOpenAll?.time ?? "";
    const openAllScope = el<HTMLSelectElement>("openAllScope");
    if (openAllScope) openAllScope.value = settings.scheduledOpenAll?.scope ?? "pinned";
    setDayCheckboxes("openAllDays", settings.scheduledOpenAll?.days);
  });

  el<HTMLButtonElement>("remindersSave")?.addEventListener("click", async () => {
    const status = el("remindersSaveStatus");
    const nudgeToggle = el<HTMLInputElement>("nudgeToggle");
    const hour = Number(el<HTMLSelectElement>("nudgeHour")?.value ?? "18");
    const openAllTime = el<HTMLInputElement>("openAllTime")?.value ?? "";
    const openAllScope = el<HTMLSelectElement>("openAllScope")?.value === "all" ? "all" : "pinned";
    const openAllDays = readDayCheckboxes("openAllDays");
    const settings: RemindersSettings = {
      nudgeEnabled: nudgeToggle?.checked !== false,
      nudgeHour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 18,
      scheduledOpenAll: openAllTime
        ? { time: openAllTime, days: openAllDays ?? [], scope: openAllScope }
        : null,
    };
    try {
      await saveRemindersSettings(settings);
    } catch {
      if (status) {
        status.hidden = false;
        status.textContent = "Could not save (storage unavailable).";
      }
      return;
    }
    // The background re-creates the alarms on the storage change.
    if (status) {
      status.hidden = false;
      status.textContent = openAllTime
        ? `Reminders saved — scheduled Open All at ${openAllTime} (${describeDays(openAllDays)}).`
        : "Reminders saved.";
    }
    void refreshReminderStatus();
  });

  el<HTMLButtonElement>("nudgeTest")?.addEventListener("click", async () => {
    const status = el("remindersSaveStatus");
    let res: { ok: boolean; nudged?: boolean; count?: number; names?: string[]; error?: string };
    try {
      res = (await chrome.runtime.sendMessage({ type: MSG_REMINDERS_FORCE_NUDGE })) as typeof res;
    } catch {
      res = { ok: false, error: "The background did not answer." };
    }
    if (!status) return;
    status.hidden = false;
    if (!res.ok) {
      status.textContent = `Could not test the nudge: ${res.error ?? "unknown error"}`;
    } else if (res.nudged) {
      status.textContent = `Nudge sent — ${res.count} pinned task${(res.count ?? 0) === 1 ? "" : "s"} still unopened: ${(res.names ?? []).join(", ")}.`;
    } else if ((res.count ?? 0) > 0) {
      status.textContent = `Nudge NOT sent — ${res.error ?? "notifications are blocked"}. ${(res.count ?? 0)} pinned task${(res.count ?? 0) === 1 ? " is" : "s are"} still unopened.`;
    } else if (res.error) {
      status.textContent = `No nudge needed — ${res.error}`;
    } else {
      status.textContent = "No nudge needed — every pinned task was opened today.";
    }
    void refreshReminderStatus();
  });

  el<HTMLButtonElement>("flowSave")?.addEventListener("click", async () => {
    const name = el<HTMLInputElement>("flowName")?.value ?? "";
    const desc = el<HTMLInputElement>("flowDesc")?.value ?? "";
    const taskIds = Array.from(document.querySelectorAll<HTMLInputElement>("#flowTaskPick input[type=checkbox]"))
      .filter((i) => i.checked)
      .map((i) => i.value);
    const scriptIds = Array.from(document.querySelectorAll<HTMLInputElement>("#flowScriptPick input[type=checkbox]"))
      .filter((i) => i.checked)
      .map((i) => i.value);
    const noteId = el<HTMLSelectElement>("flowNote")?.value || null;
    const time = el<HTMLInputElement>("flowTime")?.value ?? "";
    const days = readDayCheckboxes("flowDays");
    const schedule = time ? { time, days: days ?? [] } : null;
    try {
      if (editingFlowId) {
        flows = updateFlow(flows, editingFlowId, { name, description: desc, taskIds, scriptIds, noteId, schedule });
      } else {
        flows = sortFlows([...flows, createFlow(name, desc, taskIds, scriptIds, noteId, schedule)]);
      }
    } catch (err) {
      showFlowError(err instanceof Error ? err.message : "That flow is not usable.");
      return;
    }
    await saveFlows(flows);
    // The background re-creates the Flow's alarm on the storage change.
    cancelFlowEdit();
    renderFlowList();
    showFlowRunStatus("");
  });
  el<HTMLButtonElement>("flowCancelEdit")?.addEventListener("click", () => cancelFlowEdit());

  void refreshFlows();
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== "local") return;
      if (changes[FLOWS_KEY] || changes[TASKS_KEY] || changes[REMINDERS_KEY]) {
        // A storage change while this tab is open re-renders the list
        // (and the form picks, unless a Flow is being edited — the
        // picks would reset the user's half-filled choices).
        if (currentTabName === "flows") {
          void (async () => {
            flows = await loadFlows();
            flowTasks = await loadTasks();
            flowScripts = await loadScripts();
            flowNotes = await loadNotes();
            if (editingFlowId === null) renderFlowFormPicks();
            renderFlowList();
            void refreshReminderStatus();
          })();
        }
      }
    });
  } catch {
    // Storage events unavailable — the tab-switch reload still applies.
  }
}

// ---------------------------------------------------------------------------
// v1.2.0: Backup & Restore card + header chip.
// ---------------------------------------------------------------------------

/** Ask the background to restore already-validated backup data. The background snapshots the current state first, then writes. */
function sendRestore(data: BackupData): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: MSG_RESTORE_BACKUP, data }, (res: unknown) => {
        const clean = (res ?? {}) as { ok?: boolean; error?: string };
        resolve({ ok: clean.ok === true, error: clean.error });
      });
    } catch (err) {
      resolve({ ok: false, error: String(err instanceof Error ? err.message : err) });
    }
  });
}

/** Ask the background to open a window mode (floating/popup). Side Panel is opened directly from the dashboard's own click handler instead — a real gesture. */
function sendOpenMode(mode: WindowMode): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: MSG_OPEN_MODE, mode }, (res: unknown) => {
        const clean = (res ?? {}) as { ok?: boolean; error?: string };
        resolve({ ok: clean.ok === true, error: clean.error });
      });
    } catch (err) {
      resolve({ ok: false, error: String(err instanceof Error ? err.message : err) });
    }
  });
}

async function renderBackupCard(): Promise<void> {
  const state = await loadBackupState();
  const chip = el<HTMLElement>("backupChip");
  if (chip) {
    chip.hidden = false;
    chip.textContent = formatBackupChip(state);
  }
  const toggle = el<HTMLInputElement>("autoBackupToggle");
  if (toggle) toggle.checked = state.auto === true;
  const last = el<HTMLElement>("backupLast");
  if (last) {
    last.textContent =
      state.snapshots.length === 0
        ? "No snapshots yet."
        : `Last backup: ${formatBackupTime(state.snapshots[0].createdAt)} — ${state.snapshots.length} snapshot${state.snapshots.length === 1 ? "" : "s"} kept (max 3).`;
  }
  const list = el<HTMLUListElement>("backupSnapshots");
  if (list) {
    // Cleared, then rebuilt with textContent only — snapshot labels
    // are real stored dates, never page data, and never innerHTML.
    list.textContent = "";
    for (const snap of state.snapshots) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.className = "snap-label";
      const strong = document.createElement("strong");
      strong.textContent = snapshotLabel(snap);
      const small = document.createElement("small");
      small.textContent = `${snap.data.tasks.length} tasks · ${snap.data.scripts.length} scripts · ${snap.data.notes.length} notes · mode ${windowModeLabel(snap.data.mode)}`;
      label.append(strong, small);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary";
      btn.textContent = "Restore";
      btn.addEventListener("click", () => void restoreFromSnapshot(snap));
      li.append(label, btn);
      list.append(li);
    }
  }
  const empty = el<HTMLElement>("backupEmpty");
  if (empty) empty.hidden = state.snapshots.length !== 0;
}

async function restoreFromSnapshot(snap: BackupSnapshot): Promise<void> {
  const status = el<HTMLElement>("backupStatus");
  const error = el<HTMLElement>("backupError");
  if (error) error.hidden = true;
  const res = await sendRestore(snap.data);
  if (status) {
    status.hidden = false;
    status.textContent = res.ok
      ? `Restored the snapshot from ${formatBackupTime(snap.createdAt)} — your previous state was saved as a new snapshot first.`
      : `Restore failed: ${res.error ?? "unknown error"}`;
  }
  await renderBackupCard();
}

function initBackup(): void {
  const toggle = el<HTMLInputElement>("autoBackupToggle");
  toggle?.addEventListener("change", async () => {
    const state = await loadBackupState();
    await saveBackupState({ ...state, auto: toggle.checked });
    await renderBackupCard();
  });

  el<HTMLButtonElement>("backupExport")?.addEventListener("click", async () => {
    const status = el<HTMLElement>("backupStatus");
    const error = el<HTMLElement>("backupError");
    if (error) error.hidden = true;
    const data = await collectBackupData();
    const backup = buildFullBackup(data);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`hiddengem-flow-backup-${stamp}.json`, JSON.stringify(backup, null, 2), "application/json");
    if (status) {
      status.hidden = false;
      status.textContent = `Exported a full backup — ${data.tasks.length} tasks, ${data.scripts.length} scripts, ${data.notes.length} notes.`;
    }
  });

  const restoreBtn = el<HTMLButtonElement>("backupRestoreFileBtn");
  const restoreFile = el<HTMLInputElement>("backupRestoreFile");
  restoreBtn?.addEventListener("click", () => restoreFile?.click());
  restoreFile?.addEventListener("change", async () => {
    const file = restoreFile.files?.[0];
    restoreFile.value = "";
    if (!file) return;
    const status = el<HTMLElement>("backupStatus");
    const error = el<HTMLElement>("backupError");
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      if (status) status.hidden = true;
      if (error) {
        error.hidden = false;
        error.textContent = "That file is not a HiddenGem Flow full backup — nothing was imported.";
      }
      return;
    }
    const result = parseFullBackup(parsed);
    if (!result.ok) {
      if (status) status.hidden = true;
      if (error) {
        error.hidden = false;
        error.textContent = result.error;
      }
      return;
    }
    if (error) error.hidden = true;
    const res = await sendRestore(result.data);
    if (status) {
      status.hidden = false;
      status.textContent = res.ok
        ? "Restored from the file — your previous state was saved as a new snapshot first."
        : `Restore failed: ${res.error ?? "unknown error"}`;
    }
    await renderBackupCard();
  });

  void renderBackupCard();
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === "local" && changes[BACKUP_KEY]) void renderBackupCard();
    });
  } catch {
    // Storage events unavailable — the card still renders on open.
  }
}

// ---------------------------------------------------------------------------
// v1.2.0: Window mode card.
// ---------------------------------------------------------------------------

function initWindowMode(): void {
  const radios = (): HTMLInputElement[] =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input[name="windowMode"]'));
  const status = el<HTMLElement>("modeStatus");
  const reflect = async (): Promise<void> => {
    const mode = await loadWindowMode();
    radios().forEach((r) => {
      r.checked = r.value === mode;
    });
  };
  radios().forEach((r) =>
    r.addEventListener("change", async () => {
      if (!r.checked) return;
      const mode = sanitizeWindowMode(r.value);
      await saveWindowMode(mode);
      if (status) {
        status.hidden = false;
        status.textContent = `Window mode set to ${windowModeLabel(mode)} — the toolbar icon opens it next time.`;
      }
    }),
  );
  el<HTMLButtonElement>("openModeNow")?.addEventListener("click", async () => {
    const selected = radios().find((r) => r.checked)?.value ?? "floating";
    const mode = sanitizeWindowMode(selected);
    await saveWindowMode(mode);
    if (mode === "sidepanel") {
      // Direct call in this click handler = a real user gesture, so
      // chrome.sidePanel.open() is allowed here.
      const res = await openSidePanelForCurrentWindow();
      if (status) {
        status.hidden = false;
        status.textContent = res.ok
          ? "Side Panel is opening — it stays docked while you switch tabs."
          : `Could not open the Side Panel: ${res.error ?? "unknown error"}`;
      }
      return;
    }
    const res = await sendOpenMode(mode);
    if (status) {
      status.hidden = false;
      status.textContent = res.ok
        ? `${windowModeLabel(mode)} is opening.`
        : `Could not open ${windowModeLabel(mode)}: ${res.error ?? "unknown error"}`;
    }
  });
  void reflect();
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === "local" && changes[WINDOW_MODE_KEY]) void reflect();
    });
  } catch {
    // Storage events unavailable — the radios still reflect on open.
  }
}

// ---------------------------------------------------------------------------
// v1.2.0: right-click menu on/off (Settings).
// ---------------------------------------------------------------------------

function initContextMenuToggle(): void {
  const toggle = el<HTMLInputElement>("contextMenuToggle");
  const status = el<HTMLElement>("contextMenuStatus");
  if (!toggle) return;
  void loadContextMenuEnabled().then((enabled) => {
    toggle.checked = enabled;
  });
  toggle.addEventListener("change", async () => {
    await saveContextMenuEnabled(toggle.checked);
    if (status) {
      status.hidden = false;
      status.textContent = toggle.checked
        ? "Right-click menu is on — right-click any page to see it."
        : "Right-click menu is off — it will not appear on any page.";
    }
  });
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === "local" && changes[CONTEXT_MENU_KEY]) {
        void loadContextMenuEnabled().then((enabled) => {
          toggle.checked = enabled;
        });
      }
    });
  } catch {
    // Storage events unavailable — the toggle still reflects on open.
  }
}


// v2.1.0 — Studio (owner build only): the Studio tab + panel
// are created at runtime by shared/studio.ts, so the public bundle
// contains no Studio code at all. The dynamic import is the whole
// mechanism: with IS_OWNER_BUILD false the bundler drops this
// branch — and the Studio module with it.
function initStudioTab(): void {
  if (!IS_OWNER_BUILD) return;
  void import("../shared/studio")
    .then((m) =>
      m.initStudio({
        selectTab,
        addTab: (name: string) => {
          if (!VALID_TABS.includes(name) && !extraTabs.includes(name)) extraTabs.push(name);
        },
        registerOnSelect: (fn: () => void) => {
          studioOnSelect = fn;
        },
        openDraftInEditor: (code: string) => {
          loadCodeIntoEditor(code, "manual");
          selectTab("scripts");
        },
      }),
    )
    .catch(() => {
      // The Studio failed to load — the rest of the dashboard is unaffected.
    });
}

initTabs();
initReset();
initUpdateChecker();
initTasks();
initScripts();
initStore();
initNotes();
initFlows();
initSessions();
initStyles();
initDossier();
initLater();
initStudioTab();
initLogs();
initBackup();
initWindowMode();
initContextMenuToggle();
void loadCounts();

// ---------------------------------------------------------------------------
// Scripts — Script Manager (Phase 3)
// ---------------------------------------------------------------------------

let scripts: Script[] = [];
let scriptErrors: Record<string, string> = {};
let editingScriptId: string | null = null;
let pendingScriptSource: ScriptSource = "manual";
/** v1.3 (#9): script folders + the current folder filter. null = All scripts, "" = Unsorted. */
let folders: Folder[] = [];
let folderFilter: string | null = null;
/** v1.3 (#9): bulk-selected script ids. */
const selectedScripts = new Set<string>();
/** v1.3 (#7): code fetched from a URL, awaiting Confirm Install (never installed before that click). */
let pendingUrlCode: string | null = null;
/** Unreleased: file base name used as the script name when an imported
 * file has no @name line (e.g. "my-script.txt" → "my-script"). Set by
 * the file import handler; null for paste/URL imports and new scripts. */
let pendingFallbackName: string | null = null;
let scannedCode: string | null = null;
let engineAvailable = false;
/** Store scripts already offered an auto-upgrade check this dashboard load (once each). */
const autoUpdateChecked = new Set<string>();

function showScriptEditorError(message: string): void {
  const err = el("scriptEditorError");
  if (!err) return;
  if (message) {
    err.textContent = message;
    err.hidden = false;
  } else {
    err.textContent = "";
    err.hidden = true;
  }
}

/** Non-blocking note under the import form (name suggestion / non-JS warning). `warn` uses the warning style, anything else the plain hint style. */
function showScriptImportNote(message: string, warn = false): void {
  const note = el("scriptImportNote");
  if (!note) return;
  if (message) {
    note.textContent = message;
    note.className = warn ? "warn" : "hint";
    note.hidden = false;
  } else {
    note.textContent = "";
    note.hidden = true;
  }
}

function showScriptImportError(message: string): void {
  const err = el("scriptImportError");
  if (!err) return;
  if (message) {
    err.textContent = message;
    err.hidden = false;
  } else {
    err.textContent = "";
    err.hidden = true;
  }
}

/** v1.3 (#7): fill or hide the URL-install preview card. `preview` null hides it. */
function showUrlPreview(preview: { name: string; version: string; matches: string[]; sizeLabel: string; scan: ScanReport } | null): void {
  const card = el("scriptUrlPreview");
  if (!card) return;
  if (!preview) {
    card.hidden = true;
    return;
  }
  const name = el("scriptUrlPreviewName");
  const meta = el("scriptUrlPreviewMeta");
  const scan = el("scriptUrlPreviewScan");
  if (name) name.textContent = preview.name;
  if (meta) {
    meta.textContent = `v${preview.version} · ${preview.matches.length > 0 ? `@match ${preview.matches.join(", ")}` : "no @match — runs nowhere"} · ${preview.sizeLabel}`;
  }
  if (scan) {
    scan.textContent = `Scan ${preview.scan.score}/100 · Grade ${preview.scan.grade}${preview.scan.findings.length > 0 ? ` · ${preview.scan.findings.length} finding${preview.scan.findings.length === 1 ? "" : "s"} — read them in the editor after install` : " · clean"}`;
  }
  card.hidden = false;
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

async function refreshScriptEngineBanner(): Promise<void> {
  const banner = el("scriptEngineBanner");
  try {
    const check = await checkUserScripts();
    engineAvailable = check.available;
    if (banner) banner.hidden = check.available;
  } catch {
    engineAvailable = false;
    if (banner) banner.hidden = false;
  }
  renderScripts();
  void refreshOnboarding();
}

/**
 * v1.3 (#25) — onboarding helper: one screen that says whether the
 * "Allow User Scripts" toggle is ON or OFF, links to the extension
 * details, and runs the self-test. The status comes from a real
 * checkUserScripts() probe — never guessed.
 */
async function refreshOnboarding(): Promise<void> {
  const status = el("onboardStatus");
  const result = el("onboardResult");
  if (!status) return;
  let available = false;
  try {
    available = (await checkUserScripts()).available;
  } catch {
    available = false;
  }
  if (available) {
    status.textContent = "● User Scripts: ON — scripts can run";
    status.className = "ok";
  } else {
    status.textContent = "● User Scripts: OFF — no script is running yet";
    status.className = "off";
  }
  if (result) {
    result.hidden = true;
    result.textContent = "";
  }
}

async function runOnboardingSelfTest(): Promise<void> {
  const result = el("onboardResult");
  const btn = el<HTMLButtonElement>("onboardSelfTest");
  if (btn) btn.disabled = true;
  if (result) {
    result.hidden = false;
    result.textContent = "Running the self-test — the active tab reloads once…";
  }
  try {
    const res = (await chrome.runtime.sendMessage({ type: MSG_SELF_TEST })) as { ok?: boolean; error?: string; title?: string } | null;
    if (result) {
      if (res?.ok) {
        result.textContent = "✓ Self-test passed — the test script ran and changed the active tab's title. User scripts are working on this site.";
      } else {
        result.textContent = `✕ Self-test failed — ${res?.error ?? "unknown error"}`;
      }
    }
  } catch (err) {
    if (result) result.textContent = `✕ Self-test failed — ${err instanceof Error ? err.message : String(err)}`;
  }
  if (btn) btn.disabled = false;
}

/**
 * v1.3 (#7) — "Find scripts for this site": installed scripts whose
 * @match fits the active tab, then matching Official Store scripts
 * (from the cached index only — no network fetch here). Live search
 * of GreasyFork / OpenUserJS is not built in (those sites do not
 * allow the extension page to read their search results, and the
 * extension holds no host permission for them) — the note says so
 * plainly instead of faking results.
 */
async function refreshSiteScripts(): Promise<void> {
  const list = el("siteScriptsList");
  const empty = el("siteScriptsEmpty");
  const forLine = el("siteScriptsFor");
  const note = el("siteScriptsNote");
  if (!list) return;
  if (note) note.textContent = EXTERNAL_SEARCH_NOTE;
  let tab: { ok?: boolean; url?: string } | null = null;
  try {
    tab = (await chrome.runtime.sendMessage({ type: MSG_GET_ACTIVE_TAB })) as { ok?: boolean; url?: string } | null;
  } catch {
    tab = null;
  }
  list.innerHTML = "";
  if (!tab?.ok || !tab.url) {
    if (forLine) forLine.textContent = "No active tab to match against — open a site first, then come back here.";
    if (empty) empty.hidden = false;
    return;
  }
  const host = hostnameOf(tab.url);
  if (forLine) forLine.textContent = host ? `Currently open site: ${host}` : `Currently open site: ${tab.url}`;
  let shown = 0;
  for (const script of scripts) {
    if (script.archived) continue;
    if (!scriptsForUrl([script], tab.url).length) continue;
    shown += 1;
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "site-script-name";
    name.textContent = script.name;
    const meta = document.createElement("span");
    meta.className = "site-script-meta";
    meta.textContent = `v${script.version} · ${script.enabled ? "Installed, enabled" : "Installed, disabled"}`;
    li.append(name, meta);
    list.append(li);
  }
  try {
    const cache = await loadStoreCache();
    if (cache) {
      for (const storeScript of findStoreScriptsForUrl(cache.index.scripts, tab.url)) {
        if (scripts.some((s) => s.name === storeScript.name)) continue;
        shown += 1;
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.className = "site-script-name";
        name.textContent = storeScript.name;
        const meta = document.createElement("span");
        meta.className = "site-script-meta";
        meta.textContent = `by ${storeScript.author ?? "HiddenGem"} · v${storeScript.version} · Official store`;
        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "secondary";
        openBtn.textContent = "Open in Script Store";
        openBtn.addEventListener("click", () => selectTab("store"));
        li.append(name, meta, openBtn);
        list.append(li);
      }
    }
  } catch {
    // Store cache unreadable — the installed rows above still stand.
  }
  if (empty) empty.hidden = shown !== 0;
}

/**
 * Smart Notification Bridge (Phase 4) — dashboard Scripts tab side.
 *
 * Asks the background for the currently-open tab and checks the
 * CACHED store index only (no network fetch). Shows the banner when a
 * store script matches that tab's URL and the banner was not dismissed
 * for its hostname. When the dashboard itself is the active tab its
 * chrome-extension:// URL never matches a store script (urlMatches
 * only accepts http(s)), so the banner simply stays hidden — that is
 * the specified behaviour, not a bug.
 */
async function refreshScriptBridgeBanner(): Promise<void> {
  const banner = el("scriptBridgeBanner");
  if (!banner) return;
  banner.hidden = true;
  let tab: { ok?: boolean; url?: string } | null = null;
  try {
    tab = (await chrome.runtime.sendMessage({ type: MSG_GET_ACTIVE_TAB })) as { ok?: boolean; url?: string } | null;
  } catch {
    tab = null;
  }
  if (!tab?.ok || !tab.url) return;
  const hostname = hostnameOf(tab.url);
  if (!hostname) return;
  let dismissed: Record<string, number> = {};
  try {
    dismissed = await loadBridgeDismissed();
  } catch {
    dismissed = {};
  }
  if (isBridgeDismissed(dismissed, hostname)) return;
  let cache: StoreCache | null = null;
  try {
    cache = await loadStoreCache();
  } catch {
    cache = null;
  }
  if (!cache) return;
  if (findStoreScriptsForUrl(cache.index.scripts, tab.url).length === 0) return;
  bridgeHostname = hostname;
  banner.hidden = false;
}

function renderMeta(code: string): void {
  const box = el("scriptMeta");
  if (!box) return;
  const meta = parseEditorMetadata(code);
  const lines: string[] = [];
  lines.push(`<strong>Name:</strong> ${escapeHtml(meta.name ?? "(no @name — will install as “Untitled script”)")}`);
  lines.push(`<strong>Version:</strong> ${escapeHtml(meta.version ?? "(no @version — defaults to 1.0)")}`);
  if (meta.author) lines.push(`<strong>Author:</strong> ${escapeHtml(meta.author)}`);
  if (meta.description) lines.push(`<strong>Description:</strong> ${escapeHtml(meta.description)}`);
  if (meta.matches.length > 0) {
    lines.push(`<strong>Runs on:</strong> ${meta.matches.map((m) => `<code>${escapeHtml(m)}</code>`).join(", ")}`);
  } else {
    lines.push(`<strong>Runs on:</strong> <span class="warn">no @match patterns — this script will run nowhere until you add one.</span>`);
  }
  if (meta.grants.length > 0) lines.push(`<strong>Asks for:</strong> ${meta.grants.map((g) => `<code>${escapeHtml(g)}</code>`).join(", ")}`);
  if (meta.requires.length > 0) lines.push(`<strong>@require:</strong> ${meta.requires.map((r) => `<code>${escapeHtml(r)}</code>`).join(", ")}`);
  if (meta.runAt) lines.push(`<strong>@run-at:</strong> <code>${escapeHtml(meta.runAt)}</code>`);
  if (meta.connects.length > 0) lines.push(`<strong>@connect:</strong> ${meta.connects.map((c) => `<code>${escapeHtml(c)}</code>`).join(", ")}`);
  if (meta.updateURL) lines.push(`<strong>Update URL:</strong> <code>${escapeHtml(meta.updateURL)}</code>`);
  if (meta.downloadURL) lines.push(`<strong>Download URL:</strong> <code>${escapeHtml(meta.downloadURL)}</code>`);
  box.innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
}

/** v1.3 (#3): lint + highlight preview for the editor. Runs on every input; never throws. */
function renderEditorLint(code: string): void {
  const lintBox = el("scriptLint");
  if (lintBox) {
    const issues = lintEditor(code);
    if (issues.length === 0) {
      lintBox.innerHTML = "";
      const ok = document.createElement("p");
      ok.className = "lint-clean";
      ok.textContent = "✓ Lint clean — brackets match, @match patterns parse.";
      lintBox.append(ok);
    } else {
      lintBox.innerHTML = "";
      for (const issue of issues) {
        const p = document.createElement("p");
        p.className = `lint-issue lint-${issue.severity}`;
        p.textContent = `Line ${issue.line}: ${issue.message}`;
        lintBox.append(p);
      }
    }
  }
  const preview = el("scriptHighlight");
  if (preview) preview.innerHTML = highlightEditor(code);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** HTML for a scan report — shared by the editor scan box and the store detail view. */
function scanHtml(report: ScanReport): string {
  const gradeClass = `grade-${report.grade}`;
  let html = `<div class="scan-head"><span class="scan-score ${gradeClass}">${report.score}/100 · Grade ${report.grade}</span>`;
  if (report.findings.length === 0) {
    html += `<span>Clean — no risky patterns found. (Heuristic scan, not proof of safety.)</span>`;
  } else {
    html += `<span>${report.findings.length} finding${report.findings.length === 1 ? "" : "s"} — read before you confirm.</span>`;
  }
  html += `</div>`;
  if (report.findings.length > 0) {
    html += `<ul class="findings">`;
    for (const f of report.findings) {
      html += `<li class="sev-${f.severity}"><span class="sev">${f.severity.toUpperCase()}</span> <strong>${escapeHtml(f.rule)}</strong> — ${escapeHtml(f.message)}</li>`;
    }
    html += `</ul>`;
  }
  if (report.grade === "F" || report.grade === "D") {
    html += `<p class="warn"><strong>Low score — think twice.</strong> The scan is a warning, not a block: you can still install this script, but only if you understand what it does and where it came from.</p>`;
  }
  return html;
}

function renderScan(code: string): ScanReport {
  const box = el("scriptScan");
  const report = securityScan(code);
  if (!box) return report;
  box.hidden = false;
  box.innerHTML = scanHtml(report);
  return report;
}

function renderScripts(): void {
  const list = el("scriptList");
  const empty = el("scriptEmpty");
  const count = el("scriptCount");
  if (count) {
    const archivedCount = scripts.filter((s) => s.archived).length;
    count.textContent =
      scripts.length === 0
        ? ""
        : `${scripts.length} installed · ${scripts.filter((s) => s.enabled && !s.archived).length} enabled${archivedCount > 0 ? ` · ${archivedCount} archived` : ""}`;
  }
  // v1.3 (#9): the main list shows unarchived scripts in the current
  // folder filter (null = All, "" = Unsorted, else one folder id).
  // The Archived filter shows nothing in the main list — the
  // Archived section below the list is where those scripts live.
  const visible =
    folderFilter === null
      ? scripts.filter((s) => !s.archived)
      : folderFilter === ARCHIVED_FOLDER_ID
        ? []
        : folderFilter === UNSORTED_FOLDER_ID
          ? scriptsInFolder(scripts, null)
          : scriptsInFolder(scripts, folderFilter);
  if (empty) {
    empty.hidden = visible.length !== 0;
    if (visible.length === 0) {
      empty.textContent =
        folderFilter === ARCHIVED_FOLDER_ID
          ? "Archived scripts are listed below."
          : scripts.filter((s) => !s.archived).length === 0
            ? "No scripts installed yet — create one above, or import a .js, .user.js or .txt file."
            : "No scripts in this folder yet — move one here with its folder menu, or create a new script.";
    }
  }
  if (!list) return;
  list.innerHTML = "";
  renderFolders();
  renderBulkBar();
  for (const script of visible) {
    const li = document.createElement("li");
    li.className = "script-row";
    li.dataset.scriptId = script.id;
    if (!script.enabled) li.classList.add("disabled");

    const head = document.createElement("div");
    head.className = "script-head";
    const name = document.createElement("span");
    name.className = "script-name";
    name.textContent = script.name;
    const ver = document.createElement("span");
    ver.className = "script-ver";
    ver.textContent = `v${script.version}`;
    const src = document.createElement("span");
    src.className = "badge-src";
    src.textContent = script.source === "store" ? "store" : script.source === "import" ? "imported" : "manual";
    const enableLabel = document.createElement("label");
    enableLabel.className = "script-enable";
    const enable = document.createElement("input");
    enable.type = "checkbox";
    enable.checked = script.enabled;
    enable.setAttribute("aria-label", `Enable ${script.name}`);
    enable.addEventListener("change", () => void onToggleScript(script.id, enable.checked, enable));
    enableLabel.append(enable, document.createTextNode(script.enabled ? "Enabled" : "Disabled"));
    head.append(name, ver, src, enableLabel);

    const metaLine = document.createElement("p");
    metaLine.className = "script-meta-line";
    const bits: string[] = [];
    if (script.author) bits.push(`by ${script.author}`);
    bits.push(script.matches.length > 0 ? `runs on ${script.matches.join(", ")}` : "runs nowhere — no @match patterns");
    if (script.description) bits.push(script.description);
    metaLine.textContent = bits.join(" · ");

    // v1.3 (#9): bulk-select checkbox at the start of the row head.
    const select = document.createElement("input");
    select.type = "checkbox";
    select.className = "script-select";
    select.checked = selectedScripts.has(script.id);
    select.setAttribute("aria-label", `Select ${script.name} for bulk actions`);
    select.addEventListener("change", () => {
      if (select.checked) selectedScripts.add(script.id);
      else selectedScripts.delete(script.id);
      renderBulkBar();
    });
    head.prepend(select);

    li.append(head, metaLine);

    // v1.3 (#9): folder + tags line under the meta line.
    const folderLine = document.createElement("p");
    folderLine.className = "script-folder-label";
    const folderName = script.folderId ? (folders.find((f) => f.id === script.folderId)?.name ?? "Unsorted") : "Unsorted";
    folderLine.textContent = `📁 ${folderName}`;
    li.append(folderLine);
    if (script.tags && script.tags.length > 0) {
      const tagsRow = document.createElement("div");
      tagsRow.className = "script-tags";
      for (const tag of script.tags) {
        const chip = document.createElement("span");
        chip.className = "script-tag";
        chip.textContent = tag;
        tagsRow.append(chip);
      }
      li.append(tagsRow);
    }

    // Phase 4: per-script auto-upgrade toggle on installed store
    // scripts. Default OFF; ON only ever offers a new version
    // (version diff + scan + Confirm) — it never installs silently.
    if (script.source === "store") {
      const auRow = document.createElement("div");
      auRow.className = "row auto-upgrade-row";
      const auLabel = document.createElement("label");
      auLabel.className = "select-all";
      const au = document.createElement("input");
      au.type = "checkbox";
      au.checked = script.autoUpgrade;
      au.setAttribute("aria-label", `Auto-upgrade ${script.name}`);
      au.addEventListener("change", async () => {
        scripts = scripts.map((s) => (s.id === script.id ? { ...s, autoUpgrade: au.checked } : s));
        await persistScripts();
      });
      auLabel.append(au, document.createTextNode("Auto-upgrade — offer new versions only, never install silently"));
      auRow.append(auLabel);
      li.append(auRow);
    }

    if (script.matches.length === 0) {
      const warn = document.createElement("p");
      warn.className = "warn";
      warn.textContent = "Not registered: add an @match line (edit the script) or this script never runs.";
      li.append(warn);
    }
    const errMsg = scriptErrors[script.id];
    if (errMsg) {
      const errEl = document.createElement("p");
      errEl.className = "error";
      errEl.textContent = errMsg;
      li.append(errEl);
    }

    // LIVE TEST FIX (v1.0.1): a registered script still does not run
    // where the extension has no host access (Chrome docs: userScripts
    // needs "host_permissions for sites you want to run scripts on").
    // Access is optional and per-site — this button asks for it with
    // Chrome's own prompt (needs this click as the user gesture).
    // Until granted, the row says so instead of pretending the script
    // runs. Async check on purpose: renderScripts stays synchronous.
    if (script.enabled && script.matches.length > 0) {
      void scriptHasHostAccess(script).then((granted) => {
        if (granted) return;
        if (!li.isConnected || li.dataset.scriptId !== script.id) return;
        const warn = document.createElement("p");
        warn.className = "warn";
        warn.textContent =
          "Registered, but not running yet: this extension has no site access for these @match sites. Grant it once and the script runs on every visit.";
        const grantBtn = document.createElement("button");
        grantBtn.type = "button";
        grantBtn.className = "secondary";
        grantBtn.textContent = "Grant site access";
        grantBtn.setAttribute("aria-label", `Grant site access for ${script.name}`);
        grantBtn.addEventListener("click", async () => {
          grantBtn.disabled = true;
          try {
            await requestHostAccess(script);
          } catch {
            // Declined or unavailable — the row still shows the warning.
          }
          grantBtn.disabled = false;
          renderScripts();
        });
        const row = document.createElement("div");
        row.className = "row";
        row.append(grantBtn);
        li.append(warn, row);
      });
    }

    const actions = document.createElement("div");
    actions.className = "row script-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "secondary";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => openScriptEditor(script));

    const histBtn = document.createElement("button");
    histBtn.type = "button";
    histBtn.className = "secondary";
    histBtn.textContent = `History (${script.history.length})`;
    histBtn.disabled = script.history.length === 0;
    histBtn.addEventListener("click", () => {
      const box = li.querySelector<HTMLElement>("[data-box='history']");
      if (box) box.hidden = !box.hidden;
    });

    const updateBtn = document.createElement("button");
    updateBtn.type = "button";
    updateBtn.className = "secondary";
    const hasUpdateUrl = !!script.updateURL || !!script.downloadURL;
    updateBtn.textContent =
      script.source === "store" ? "Check for updates" : hasUpdateUrl ? "Check for update" : "Re-import to update";
    updateBtn.addEventListener("click", () => {
      if (!hasUpdateUrl) {
        openScriptImport();
        showScriptImportError(`"${script.name}" has no @updateURL or @downloadURL — paste or fetch the new version here, then install it.`);
        return;
      }
      void checkScriptUpdate(script, li);
    });

    // Unreleased — per-script export, both extensions, same content:
    // a .user.js file and a plain .txt file (the text-file round-trip
    // works both ways: a .txt export can be imported again as-is).
    const expJsBtn = document.createElement("button");
    expJsBtn.type = "button";
    expJsBtn.className = "secondary";
    expJsBtn.textContent = "Export .user.js";
    expJsBtn.title = "Download this script as a .user.js file";
    expJsBtn.addEventListener("click", () => downloadFile(safeScriptFilename(script.name, ".user.js"), script.code, "text/javascript"));

    const expTxtBtn = document.createElement("button");
    expTxtBtn.type = "button";
    expTxtBtn.className = "secondary";
    expTxtBtn.textContent = "Export .txt";
    expTxtBtn.title = "Download this script as a plain .txt file";
    expTxtBtn.addEventListener("click", () => downloadFile(safeScriptFilename(script.name, ".txt"), script.code, "text/plain"));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "secondary danger-btn";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => void onDeleteScript(script));

    // v1.3 (#9): move-to-folder select + Archive button.
    const folderSelect = document.createElement("select");
    folderSelect.setAttribute("aria-label", `Move ${script.name} to a folder`);
    const unsortedOpt = document.createElement("option");
    unsortedOpt.value = "";
    unsortedOpt.textContent = "Unsorted";
    folderSelect.append(unsortedOpt);
    for (const f of folders) {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name;
      folderSelect.append(opt);
    }
    folderSelect.value = script.folderId ?? "";
    folderSelect.addEventListener("change", async () => {
      scripts = moveScriptToFolder(scripts, script.id, folderSelect.value === "" ? null : folderSelect.value);
      await persistScripts();
    });

    const archiveBtn = document.createElement("button");
    archiveBtn.type = "button";
    archiveBtn.className = "secondary";
    archiveBtn.textContent = "Archive";
    archiveBtn.title = "Archive this script — it stops running until restored";
    archiveBtn.addEventListener("click", () => void onArchiveScript(script));

    actions.append(editBtn, histBtn, updateBtn, expJsBtn, expTxtBtn, folderSelect, archiveBtn, delBtn);
    li.append(actions);

    // History box.
    const histBox = document.createElement("div");
    histBox.className = "history-box";
    histBox.dataset.box = "history";
    histBox.hidden = true;
    if (script.history.length > 0) {
      const title = document.createElement("p");
      title.className = "hint";
      title.textContent = "Saved versions — newest first. Rollback restores the code and keeps the history.";
      histBox.append(title);
      const histList = document.createElement("ul");
      histList.className = "history-list";
      script.history.forEach((entry, index) => {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = `v${entry.version} — ${formatDate(entry.savedAt)}`;
        const rb = document.createElement("button");
        rb.type = "button";
        rb.className = "secondary";
        rb.textContent = "Rollback";
        rb.addEventListener("click", () => void onRollbackScript(script, index));
        item.append(label, rb);
        histList.append(item);
      });
      histBox.append(histList);
    }
    li.append(histBox);

    // Update-check result box.
    const updateBox = document.createElement("div");
    updateBox.className = "update-box";
    updateBox.dataset.box = "update";
    updateBox.hidden = true;
    li.append(updateBox);

    list.appendChild(li);
  }
  renderArchivedSection();
}

/** v1.3 (#9): the folders sidebar — All / Unsorted / each folder / Archived, with live counts. */
function renderFolders(): void {
  const list = el("folderList");
  if (!list) return;
  list.innerHTML = "";
  const counts = folderCounts(folders, scripts);
  const archivedCount = scripts.filter((s) => s.archived).length;
  const total = scripts.filter((s) => !s.archived).length;
  const makeRow = (label: string, value: string | null, count: number, deletable: Folder | null): void => {
    const li = document.createElement("li");
    if (folderFilter === value) li.classList.add("active");
    li.textContent = label;
    const c = document.createElement("span");
    c.className = "folder-count";
    c.textContent = String(count);
    li.append(c);
    if (deletable) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "folder-del";
      del.textContent = "✕";
      del.title = `Delete folder "${deletable.name}" (scripts become Unsorted)`;
      del.setAttribute("aria-label", `Delete folder ${deletable.name}`);
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        void onDeleteFolder(deletable);
      });
      li.append(del);
      li.addEventListener("dblclick", () => void onRenameFolder(deletable));
      li.title = "Double-click to rename";
    }
    li.addEventListener("click", () => {
      folderFilter = value;
      renderScripts();
    });
    list.append(li);
  };
  makeRow("📁 All scripts", null, total, null);
  makeRow("📁 Unsorted", UNSORTED_FOLDER_ID, counts[UNSORTED_FOLDER_ID] ?? 0, null);
  for (const f of folders) makeRow(`📁 ${f.name}`, f.id, counts[f.id] ?? 0, f);
  makeRow("🗄 Archived", ARCHIVED_FOLDER_ID, archivedCount, null);
}

/** v1.3 (#9): the bulk bar — visible only while scripts are selected. */
function renderBulkBar(): void {
  const bar = el("bulkBar");
  const count = el("bulkCount");
  if (!bar) return;
  bar.hidden = selectedScripts.size === 0;
  if (count) count.textContent = `${selectedScripts.size} selected`;
}

/** v1.3 (#9): the Archived section under the main list. */
function renderArchivedSection(): void {
  const section = el("archivedSection");
  const list = el("archivedList");
  const count = el("archivedCount");
  if (!section || !list) return;
  const archived = scripts.filter((s) => s.archived);
  section.hidden = archived.length === 0;
  if (count) count.textContent = `(${archived.length})`;
  list.innerHTML = "";
  for (const script of archived) {
    const li = document.createElement("li");
    li.className = "script-row archived";
    const head = document.createElement("div");
    head.className = "script-head";
    const name = document.createElement("span");
    name.className = "script-name";
    name.textContent = script.name;
    const ver = document.createElement("span");
    ver.className = "script-ver";
    ver.textContent = `v${script.version}`;
    head.append(name, ver);
    const metaLine = document.createElement("p");
    metaLine.className = "script-meta-line";
    metaLine.textContent = script.matches.length > 0 ? `runs on ${script.matches.join(", ")}` : "runs nowhere — no @match patterns";
    const actions = document.createElement("div");
    actions.className = "row script-actions";
    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "primary";
    restoreBtn.textContent = "Restore";
    restoreBtn.addEventListener("click", () => void onRestoreScript(script));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "secondary danger-btn";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => void onDeleteScript(script));
    actions.append(restoreBtn, delBtn);
    li.append(head, metaLine, actions);
    list.append(li);
  }
}

async function onArchiveScript(script: Script): Promise<void> {
  scripts = archiveScript(scripts, script.id);
  selectedScripts.delete(script.id);
  // Persist FIRST, then unregister: unregisterScript writes the
  // errors key, and the storage listener reloads scripts from
  // storage — persisting first means that reload reads the archived
  // state instead of reverting this change (probe30a bug).
  await persistScripts();
  await unregisterScript(script.id);
}

async function onRestoreScript(script: Script): Promise<void> {
  scripts = unarchiveScript(scripts, script.id);
  await persistScripts();
  const restored = scripts.find((s) => s.id === script.id);
  if (restored?.enabled) {
    try {
      await registerScript(restored);
    } catch {
      scriptErrors = await loadScriptErrors();
      renderScripts();
    }
  }
}

async function onDeleteFolder(folder: Folder): Promise<void> {
  if (!window.confirm(`Delete folder "${folder.name}"? Its scripts become Unsorted — no scripts are deleted.`)) return;
  try {
    const result = deleteFolder(folders, scripts, folder.id);
    folders = result.folders;
    scripts = result.scripts;
    if (folderFilter === folder.id) folderFilter = null;
    await saveFolders(folders);
    await persistScripts();
  } catch (err) {
    const errEl = el("folderError");
    if (errEl) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      errEl.hidden = false;
    }
  }
}

async function onRenameFolder(folder: Folder): Promise<void> {
  const name = window.prompt("Rename folder:", folder.name);
  if (name === null) return;
  try {
    folders = renameFolder(folders, folder.id, name);
    await saveFolders(folders);
    renderFolders();
  } catch (err) {
    const errEl = el("folderError");
    if (errEl) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      errEl.hidden = false;
    }
  }
}

async function persistScripts(): Promise<void> {
  try {
    await saveScripts(scripts);
    scriptErrors = await loadScriptErrors();
  } catch {
    showScriptEditorError("Could not save (storage unavailable).");
  }
  renderScripts();
  void loadCounts();
}

async function onToggleScript(id: string, enabled: boolean, checkbox: HTMLInputElement): Promise<void> {
  if (enabled && !engineAvailable) {
    // Toggle would "succeed" in storage but the script would never run.
    // Revert the checkbox and point at the banner instead.
    checkbox.checked = false;
    await refreshScriptEngineBanner();
    renderScripts();
    return;
  }
  try {
    scripts = await setScriptEnabled(id, enabled);
    scriptErrors = await loadScriptErrors();
  } catch (err) {
    checkbox.checked = !enabled;
    showScriptEditorError(err instanceof Error ? err.message : "Could not change that script.");
    return;
  }
  renderScripts();
  void loadCounts();
}

async function onDeleteScript(script: Script): Promise<void> {
  if (!window.confirm(`Delete "${script.name}"? This removes the script and its version history.`)) return;
  scripts = deleteScript(scripts, script.id);
  // Persist FIRST, then unregister (same race as onArchiveScript:
  // unregisterScript writes the errors key, and a listener reload
  // before the save would resurrect the deleted script).
  await persistScripts();
  await unregisterScript(script.id);
}

async function onRollbackScript(script: Script, index: number): Promise<void> {
  let rolled: Script;
  try {
    rolled = rollbackTo(script, index);
  } catch (err) {
    showScriptEditorError(err instanceof Error ? err.message : "Could not roll back.");
    return;
  }
  scripts = scripts.map((s) => (s.id === script.id ? rolled : s));
  await persistScripts();
  if (rolled.enabled) {
    try {
      await registerScript(rolled);
    } catch {
      scriptErrors = await loadScriptErrors();
      renderScripts();
    }
  }
}

async function checkScriptUpdate(script: Script, li: HTMLElement): Promise<void> {
  const box = li.querySelector<HTMLElement>("[data-box='update']");
  if (!box) return;
  box.hidden = false;
  box.textContent = "Fetching update…";
  const url = script.updateURL ?? script.downloadURL ?? "";
  let code: string;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    code = await res.text();
  } catch (err) {
    box.innerHTML = "";
    const p = document.createElement("p");
    p.className = "error";
    p.textContent = `Could not fetch the update: ${err instanceof Error ? err.message : String(err)}`;
    box.append(p);
    return;
  }
  const meta = parseMetadata(code);
  const newVersion = meta.version ?? script.version;
  const cmp = compareVersions(newVersion, script.version);
  box.innerHTML = "";
  if (cmp <= 0) {
    const p = document.createElement("p");
    p.textContent = `Already up to date — the newest version is v${newVersion} (installed v${script.version}).`;
    box.append(p);
    return;
  }
  const changed = countLinesChanged(script.code, code);
  const scan = securityScan(code, meta);
  const summary = document.createElement("p");
  summary.innerHTML = `Update available: <strong>v${escapeHtml(script.version)} → v${escapeHtml(newVersion)}</strong> · ${changed} line${changed === 1 ? "" : "s"} changed · new code scans <strong>${scan.score}/100 · Grade ${scan.grade}</strong>${scan.findings.length > 0 ? ` (${scan.findings.length} finding${scan.findings.length === 1 ? "" : "s"} — review the scan in the editor before you confirm)` : " (clean)"}.`;
  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "primary";
  confirmBtn.textContent = `Confirm update to v${newVersion}`;
  confirmBtn.addEventListener("click", async () => {
    scripts = updateScriptCode(scripts, script.id, code);
    await persistScripts();
    const updated = scripts.find((s) => s.id === script.id);
    if (updated?.enabled) {
      try {
        await registerScript(updated);
      } catch {
        scriptErrors = await loadScriptErrors();
        renderScripts();
      }
    }
    box.hidden = true;
  });
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "secondary";
  cancelBtn.textContent = "Discard update";
  cancelBtn.addEventListener("click", () => {
    box.hidden = true;
  });
  const row = document.createElement("div");
  row.className = "row";
  row.append(confirmBtn, cancelBtn);
  box.append(summary, row);
}

/** v1.3 (#3): fill the editor's folder dropdown (Unsorted + each folder). */
function fillEditorFolderOptions(selectedId: string | null): void {
  const select = el<HTMLSelectElement>("scriptEditorFolder");
  if (!select) return;
  select.innerHTML = "";
  const unsorted = document.createElement("option");
  unsorted.value = "";
  unsorted.textContent = "Unsorted";
  select.append(unsorted);
  for (const f of folders) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.name;
    select.append(opt);
  }
  select.value = selectedId ?? "";
}

function openScriptEditor(script?: Script): void {
  const card = el("scriptEditorCard");
  const title = el("scriptEditorTitle");
  const editor = el<HTMLTextAreaElement>("scriptEditor");
  const scanBox = el("scriptScan");
  const confirmBtn = el<HTMLButtonElement>("scriptConfirmInstall");
  if (!card || !editor) return;
  editingScriptId = script?.id ?? null;
  pendingScriptSource = script?.source ?? "manual";
  pendingFallbackName = null;
  scannedCode = null;
  if (title) title.textContent = script ? `Edit — ${script.name}` : "New script";
  if (script) editor.value = script.code;
  fillEditorFolderOptions(script?.folderId ?? null);
  const tagsInput = el<HTMLInputElement>("scriptEditorTags");
  if (tagsInput) tagsInput.value = (script?.tags ?? []).join(", ");
  if (scanBox) {
    scanBox.hidden = true;
    scanBox.innerHTML = "";
  }
  if (confirmBtn) confirmBtn.hidden = true;
  showScriptEditorError("");
  card.hidden = false;
  renderMeta(editor.value);
  renderEditorLint(editor.value);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  editor.focus();
}

function closeScriptEditor(): void {
  const card = el("scriptEditorCard");
  if (card) card.hidden = true;
  editingScriptId = null;
  pendingScriptSource = "manual";
  pendingFallbackName = null;
  scannedCode = null;
  showScriptEditorError("");
}

function openScriptImport(): void {
  const card = el("scriptImportCard");
  if (!card) return;
  showScriptImportError("");
  card.hidden = false;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function loadCodeIntoEditor(code: string, source: ScriptSource): void {
  openScriptEditor();
  const editor = el<HTMLTextAreaElement>("scriptEditor");
  if (!editor) return;
  editingScriptId = null;
  pendingScriptSource = source;
  editor.value = code;
  renderMeta(code);
  editor.focus();
}

function downloadFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "My cool script!" + ".user.js" → "My_cool_script.user.js". Never empty. */
function safeScriptFilename(name: string, ext: string): string {
  const base = String(name ?? "script").trim().replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "script";
  return `${base}${ext}`;
}

async function initScripts(): Promise<void> {
  const newBtn = el("scriptNew");
  const editor = el<HTMLTextAreaElement>("scriptEditor");
  const scanBtn = el("scriptScanBtn");
  const confirmBtn = el<HTMLButtonElement>("scriptConfirmInstall");
  const cancelBtn = el("scriptCancelEdit");
  const importBtn = el("scriptImportBtn");
  const importFile = el<HTMLInputElement>("scriptImportFile");
  const backupBtn = el("scriptBackup");
  const restoreBtn = el("scriptRestoreBtn");
  const restoreFile = el<HTMLInputElement>("scriptRestoreFile");
  const pasteBtn = el("scriptPasteImport");
  const pasteArea = el<HTMLTextAreaElement>("scriptPaste");
  const urlBtn = el("scriptUrlImport");
  const urlInput = el<HTMLInputElement>("scriptImportUrl");

  newBtn?.addEventListener("click", () => openScriptEditor());

  // v1.3 (#3): "New script from current page" — the template's
  // @match is prefilled from the active tab's URL.
  const newFromPageBtn = el("scriptNewFromPage");
  newFromPageBtn?.addEventListener("click", async () => {
    let pageUrl: string | null = null;
    try {
      const tab = (await chrome.runtime.sendMessage({ type: MSG_GET_ACTIVE_TAB })) as { ok?: boolean; url?: string } | null;
      if (tab?.ok && tab.url) pageUrl = tab.url;
    } catch {
      pageUrl = null;
    }
    openScriptEditor();
    const editorEl = el<HTMLTextAreaElement>("scriptEditor");
    if (editorEl) {
      editorEl.value = newScriptTemplate(pageUrl);
      renderMeta(editorEl.value);
      renderEditorLint(editorEl.value);
      editorEl.focus();
    }
  });

  // v1.3 (#25): onboarding card buttons.
  el("onboardOpenDetails")?.addEventListener("click", async () => {
    try {
      await chrome.runtime.sendMessage({ type: MSG_OPEN_EXTENSION_DETAILS });
    } catch {
      // The banner above already explains the manual steps.
    }
  });
  el("onboardSelfTest")?.addEventListener("click", () => void runOnboardingSelfTest());

  // v1.3 (#9): new-folder input + bulk bar buttons.
  el("folderNewBtn")?.addEventListener("click", async () => {
    const input = el<HTMLInputElement>("folderNewName");
    const errEl = el("folderError");
    if (!input) return;
    try {
      folders = createFolder(folders, input.value);
      await saveFolders(folders);
      input.value = "";
      if (errEl) errEl.hidden = true;
      renderFolders();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err instanceof Error ? err.message : String(err);
        errEl.hidden = false;
      }
    }
  });
  el("bulkEnable")?.addEventListener("click", async () => {
    const ids = [...selectedScripts];
    const result = bulkEnable(scripts, ids);
    scripts = result.scripts;
    selectedScripts.clear();
    await persistScripts();
    for (const id of ids) {
      const s = scripts.find((x) => x.id === id);
      if (s?.enabled && !s.archived) {
        try {
          await registerScript(s);
        } catch {
          // Per-script errors are persisted by registerScript.
        }
      }
    }
    scriptErrors = await loadScriptErrors();
    renderScripts();
  });
  el("bulkDisable")?.addEventListener("click", async () => {
    const ids = [...selectedScripts];
    scripts = bulkDisable(scripts, ids).scripts;
    selectedScripts.clear();
    await persistScripts();
    for (const id of ids) await unregisterScript(id);
    renderScripts();
  });
  el("bulkExport")?.addEventListener("click", () => {
    const ids = [...selectedScripts];
    downloadFile(`hiddengem-flow-scripts-${ids.length}-selected-${new Date().toISOString().slice(0, 10)}.json`, bulkExportJson(scripts, ids), "application/json");
  });
  el("bulkArchive")?.addEventListener("click", async () => {
    const ids = [...selectedScripts];
    scripts = bulkArchive(scripts, ids).scripts;
    selectedScripts.clear();
    await persistScripts();
    for (const id of ids) await unregisterScript(id);
    renderScripts();
  });
  el("bulkDelete")?.addEventListener("click", async () => {
    const ids = [...selectedScripts];
    if (!window.confirm(`Delete ${ids.length} selected script${ids.length === 1 ? "" : "s"}? This removes them and their version history.`)) return;
    scripts = bulkDelete(scripts, ids).scripts;
    selectedScripts.clear();
    await persistScripts();
    for (const id of ids) await unregisterScript(id);
    renderScripts();
  });
  el("bulkClear")?.addEventListener("click", () => {
    selectedScripts.clear();
    renderScripts();
  });

  // Tab inserts two spaces instead of moving focus away.
  editor?.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const start = editor.selectionStart ?? 0;
    const end = editor.selectionEnd ?? 0;
    editor.value = `${editor.value.slice(0, start)}  ${editor.value.slice(end)}`;
    editor.selectionStart = editor.selectionEnd = start + 2;
    scannedCode = null;
    const confirm = el<HTMLButtonElement>("scriptConfirmInstall");
    if (confirm) confirm.hidden = true;
  });

  // Live metadata as the user types; a changed code invalidates the scan.
  editor?.addEventListener("input", () => {
    renderMeta(editor.value);
    renderEditorLint(editor.value);
    if (scannedCode !== null && scannedCode !== editor.value) {
      scannedCode = null;
      if (confirmBtn) confirmBtn.hidden = true;
      const scanBox = el("scriptScan");
      if (scanBox) {
        scanBox.hidden = true;
        scanBox.innerHTML = "";
      }
    }
  });

  scanBtn?.addEventListener("click", () => {
    const code = editor?.value ?? "";
    if (!code.trim()) {
      showScriptEditorError("Script code is empty.");
      return;
    }
    showScriptEditorError("");
    renderMeta(code);
    renderScan(code);
    scannedCode = code;
    if (confirmBtn) {
      confirmBtn.hidden = false;
      confirmBtn.textContent = editingScriptId ? "Confirm save" : "Confirm install";
    }
  });

  confirmBtn?.addEventListener("click", async () => {
    const code = editor?.value ?? "";
    if (!code.trim() || scannedCode === null || scannedCode !== code) {
      showScriptEditorError("Scan again first — the code changed since the last scan.");
      return;
    }
    try {
      // v1.3 (#9): the editor's folder + tags travel with the save.
      const folderId = (el<HTMLSelectElement>("scriptEditorFolder")?.value ?? "") || null;
      const tags = parseTags(el<HTMLInputElement>("scriptEditorTags")?.value ?? "");
      if (editingScriptId) {
        scripts = updateScriptCode(scripts, editingScriptId, code);
        scripts = scripts.map((s) => (s.id === editingScriptId ? { ...s, folderId, tags } : s));
        const updated = scripts.find((s) => s.id === editingScriptId);
        await persistScripts();
        if (updated?.enabled) {
          try {
            await registerScript(updated);
          } catch {
            scriptErrors = await loadScriptErrors();
            renderScripts();
          }
        }
      } else {
        // Unreleased: pendingFallbackName carries the imported file's base
        // name when the code has no @name (see the file import handler).
        const created = createScript(code, pendingScriptSource, Date.now(), undefined, pendingFallbackName ?? undefined, { folderId, tags });
        scripts = [...scripts, created];
        await persistScripts();
        if (created.enabled) {
          try {
            await registerScript(created);
          } catch {
            scriptErrors = await loadScriptErrors();
            renderScripts();
          }
        }
      }
    } catch (err) {
      showScriptEditorError(err instanceof Error ? err.message : "Could not save the script.");
      return;
    }
    closeScriptEditor();
  });

  cancelBtn?.addEventListener("click", () => closeScriptEditor());

  importBtn?.addEventListener("click", () => openScriptImport());
  const importFileBtn = el("scriptImportFileBtn");
  importFileBtn?.addEventListener("click", () => importFile?.click());
  // Unreleased: ANY text file can be picked — .js, .user.js, .txt and
  // anything else (the file input has no accept filter). The content
  // is read as text and loaded into the editor for the usual scan +
  // confirm; nothing installs straight from a file. Two honest notes:
  // (a) a file in another language (e.g. Python) can be inspected
  // here, but it cannot RUN in a browser page — only JavaScript
  // userscripts run; (b) a file with no @name line installs under the
  // file's base name, unless you add a @name line first.
  importFile?.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    importFile.value = "";
    if (!file) return;
    showScriptImportNote("");
    try {
      const code = await file.text();
      if (!code.trim()) throw new Error("That file is empty.");
      loadCodeIntoEditor(code, "import");
      showScriptImportError("");
      const ext = nonJsExtension(file.name);
      if (ext) {
        showScriptImportNote(
          `This looks like a .${ext} file, not JavaScript — it is loaded here so you can read it, but it cannot run in a browser page. Only JavaScript userscripts can run as scripts.`,
          true,
        );
      } else if (parseMetadata(code).name === null) {
        pendingFallbackName = fileBaseName(file.name);
        showScriptImportNote(`No @name in this file — it will install as “${pendingFallbackName}” unless you add a @name line.`);
      }
    } catch (err) {
      showScriptImportError(err instanceof Error ? err.message : "Could not read that file.");
    }
  });

  pasteBtn?.addEventListener("click", () => {
    const code = pasteArea?.value ?? "";
    if (!code.trim()) {
      showScriptImportError("Paste some script code first.");
      return;
    }
    showScriptImportError("");
    loadCodeIntoEditor(code, "import");
  });

  // v1.3 (#7): Install from URL — fetch ON THIS CLICK ONLY, then
  // validate + preview. NOTHING installs here: the preview card
  // shows name / version / @match / size / scan score, and only the
  // Confirm Install button in the preview installs the script.
  urlBtn?.addEventListener("click", async () => {
    const raw = (urlInput?.value ?? "").trim();
    if (!raw) {
      showScriptImportError("Enter a script URL first.");
      return;
    }
    if (!isFetchableScriptUrl(raw)) {
      showScriptImportError("That URL does not look valid — it must be an http(s) link.");
      return;
    }
    showScriptImportError("");
    showUrlPreview(null);
    try {
      const res = await fetch(raw);
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
      const code = await res.text();
      const validated = validateFetchedScript(code, raw);
      if (!validated.ok) {
        showScriptImportError(validated.error);
        return;
      }
      pendingUrlCode = code;
      showUrlPreview(validated.preview);
    } catch (err) {
      showScriptImportError(`Could not fetch that URL: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // v1.3 (#7): the preview's Confirm Install — the ONLY place a
  // URL-fetched script is installed.
  const urlConfirmBtn = el("scriptUrlConfirm");
  urlConfirmBtn?.addEventListener("click", async () => {
    if (!pendingUrlCode) return;
    const code = pendingUrlCode;
    pendingUrlCode = null;
    showUrlPreview(null);
    try {
      const created = createScript(code, "import", Date.now(), undefined, undefined, {
        folderId: folderFilter && folderFilter !== ARCHIVED_FOLDER_ID && folderFilter !== UNSORTED_FOLDER_ID ? folderFilter : null,
        tags: [],
      });
      scripts = [...scripts, created];
      await persistScripts();
      if (created.enabled) {
        try {
          await registerScript(created);
        } catch {
          scriptErrors = await loadScriptErrors();
          renderScripts();
        }
      }
      showScriptImportError("");
      showScriptImportNote(`Installed "${created.name}" v${created.version} from the URL.`);
    } catch (err) {
      showScriptImportError(err instanceof Error ? err.message : "Could not install that script.");
    }
  });

  const urlDiscardBtn = el("scriptUrlDiscard");
  urlDiscardBtn?.addEventListener("click", () => {
    pendingUrlCode = null;
    showUrlPreview(null);
  });

  backupBtn?.addEventListener("click", () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(
      `hiddengem-flow-scripts-backup-${stamp}.json`,
      JSON.stringify({ app: "HiddenGem Flow", format: 1, exportedAt: new Date().toISOString(), scripts }, null, 2),
      "application/json",
    );
  });

  restoreBtn?.addEventListener("click", () => restoreFile?.click());
  restoreFile?.addEventListener("change", async () => {
    const file = restoreFile.files?.[0];
    restoreFile.value = "";
    if (!file) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      showScriptImportError("That backup file is not valid JSON.");
      return;
    }
    const incoming = (parsed as { scripts?: unknown }).scripts;
    if (!Array.isArray(incoming)) {
      showScriptImportError("That file is not a HiddenGem Flow backup (no scripts list inside).");
      return;
    }
    const valid = incoming.filter(
      (s): s is Script =>
        !!s && typeof (s as Script).id === "string" && typeof (s as Script).name === "string" && typeof (s as Script).code === "string",
    );
    if (valid.length === 0) {
      showScriptImportError("The backup has no usable scripts in it.");
      return;
    }
    if (valid.length !== incoming.length) {
      showScriptImportError(`The backup had ${incoming.length} entries, but only ${valid.length} are usable — the rest were skipped. Check the file before restoring.`);
      return;
    }
    if (
      !window.confirm(
        `Restore backup with ${valid.length} script${valid.length === 1 ? "" : "s"}? Merge: scripts with the same id are replaced by the backup copy, everything else you have installed stays.`,
      )
    ) {
      return;
    }
    const byId = new Map(scripts.map((s) => [s.id, s]));
    for (const s of valid) byId.set(s.id, { ...s, history: Array.isArray(s.history) ? s.history : [] });
    scripts = [...byId.values()];
    await persistScripts();
    if (engineAvailable) {
      try {
        await registerEnabledScripts(scripts);
        scriptErrors = await loadScriptErrors();
        renderScripts();
      } catch {
        // Errors are persisted per script; the list shows them.
      }
    }
    showScriptImportError("");
  });

  // Initial load.
  scripts = await loadScripts();
  scriptErrors = await loadScriptErrors();
  folders = await loadFolders();
  renderScripts();
  if (editor) {
    renderMeta(editor.value);
    renderEditorLint(editor.value);
  }
  await refreshScriptEngineBanner();
  void refreshSiteScripts();

  // Live-test fix (v1.0.1, bug #3) — same staleness as tasks: a script
  // toggled from the floating window (or installed elsewhere) while this
  // page is open must show up without a reload. Listener + tab-switch
  // reload in selectTab, mirroring the tasks fix above.
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== "local") return;
      // A script change reloads the list; an errors change reloads
      // only the errors. (Reloading scripts on an errors-key write
      // used to clobber an in-flight archive/delete: unregisterScript
      // writes the errors key, and the reload read the still-unsaved
      // scripts — probe30a, fixed by persisting first AND by this
      // split. The persist-first order in the handlers is the real
      // fix; this split just stops the extra reload.)
      if (changes[SCRIPTS_KEY]) {
        void (async () => {
          scripts = await loadScripts();
          renderScripts();
        })();
      }
      if (changes[SCRIPT_ERRORS_KEY]) {
        void (async () => {
          scriptErrors = await loadScriptErrors();
          renderScripts();
        })();
      }
      // v1.3 (#9): folders changed elsewhere (restore, another surface).
      if (changes[FOLDERS_KEY]) {
        void (async () => {
          folders = await loadFolders();
          renderScripts();
        })();
      }
    });
  } catch {
    // Storage events unavailable — the tab-switch reload still applies.
  }

  // Unreleased: the engine banner's "Open extension details to enable"
  // button. It only OPENS the extension's Details page — the toggle
  // itself still needs a human click there (no extension can flip it).
  const detailsBtn = el<HTMLButtonElement>("scriptEngineOpenDetails");
  detailsBtn?.addEventListener("click", async () => {
    try {
      const res = (await chrome.runtime.sendMessage({ type: MSG_OPEN_EXTENSION_DETAILS })) as { ok?: boolean; error?: string } | null;
      if (res?.ok) return;
      throw new Error(res?.error ?? "Could not open the extensions page.");
    } catch {
      if (detailsBtn) {
        detailsBtn.disabled = true;
        detailsBtn.textContent = "Could not open the page — open chrome://extensions yourself";
      }
    }
  });

  // Phase 4: bridge banner buttons (the banner itself is refreshed by
  // refreshScriptBridgeBanner on Scripts-tab select and on load).
  const bridgeOpenBtn = el("scriptBridgeOpen");
  const bridgeDismissBtn = el("scriptBridgeDismiss");
  bridgeOpenBtn?.addEventListener("click", () => {
    selectTab("store");
    try {
      history.replaceState(null, "", "#store");
    } catch {
      // Non-fatal.
    }
  });
  const bridgeDossierBtn = el("scriptBridgeDossier");
  bridgeDossierBtn?.addEventListener("click", () => {
    // v1.5+ (#17): the bridge grows into the dossier — open it for
    // the site the banner is about (or the active tab's site).
    const site = bridgeHostname ?? "";
    selectTab("dossier");
    try {
      history.replaceState(null, "", site ? `#dossier` : "#dossier");
    } catch {
      // Non-fatal.
    }
    void refreshDossierTab(site || undefined);
  });
  bridgeDismissBtn?.addEventListener("click", async () => {
    if (bridgeHostname) {
      try {
        await dismissBridgeForHostname(bridgeHostname);
      } catch {
        // Non-fatal: the banner still hides for this view.
      }
    }
    const banner = el("scriptBridgeBanner");
    if (banner) banner.hidden = true;
  });

  // Phase 4: store scripts with auto-upgrade ON get one update offer
  // per dashboard load (version diff + scan + Confirm — never silent).
  for (const s of scripts) {
    if (s.source !== "store" || !s.autoUpgrade) continue;
    if (!s.updateURL && !s.downloadURL) continue;
    if (autoUpdateChecked.has(s.id)) continue;
    autoUpdateChecked.add(s.id);
    const row = document.querySelector<HTMLElement>(`[data-script-id="${s.id}"]`);
    if (row) void checkScriptUpdate(s, row);
  }
}

// ---------------------------------------------------------------------------
// Script Store — Official Store (Phase 4)
// ---------------------------------------------------------------------------

let storeIndex: StoreIndex | null = null;
let storeQuery = "";
let storeSort: "published" | "updated" | "name" = "updated";
let storeDetail: StoreScript | null = null;
let storeDetailCode: string | null = null;
let storeDetailScanned = false;

function showStoreError(message: string): void {
  const err = el("storeError");
  if (!err) return;
  if (message) {
    err.textContent = message;
    err.hidden = false;
  } else {
    err.textContent = "";
    err.hidden = true;
  }
}

function showStoreNote(message: string): void {
  const note = el("storeNote");
  if (!note) return;
  if (message) {
    note.textContent = message;
    note.hidden = false;
  } else {
    note.textContent = "";
    note.hidden = true;
  }
}

/** True when this exact store script (name + version) is already installed. */
function isStoreInstalled(script: StoreScript): boolean {
  return scripts.some((s) => s.source === "store" && s.name === script.name && s.version === script.version);
}

/** Short @match list for a card: first two sites, then "+N more". */
function shortMatches(matches: string[]): string {
  if (matches.length <= 2) return matches.join(", ");
  return `${matches.slice(0, 2).join(", ")} +${matches.length - 2} more`;
}

/** "Published 15 Nov 2026 · Updated 15 Nov 2026" — "Date not listed" when the entry has no date (never invented). */
function storeDatesLine(script: StoreScript): string {
  const pub = formatStoreDateShort(script.publishedAt);
  const upd = formatStoreDateShort(script.updatedAt);
  return `Published ${pub || "Date not listed"} · Updated ${upd || "Date not listed"}`;
}

function renderStoreList(): void {
  const card = el("storeListCard");
  const list = el("storeList");
  const noResults = el("storeNoResults");
  const empty = el("storeEmpty");
  if (!card || !list) return;
  if (!storeIndex) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const visible = sortStoreScriptsBy(searchStoreScripts(storeIndex.scripts, storeQuery), storeSort);
  if (empty) empty.hidden = storeIndex.scripts.length !== 0;
  if (noResults) noResults.hidden = !(storeIndex.scripts.length > 0 && visible.length === 0);
  list.innerHTML = "";
  for (const script of visible) {
    const li = document.createElement("li");
    li.className = "store-card";

    const head = document.createElement("div");
    head.className = "store-card-head";
    const name = document.createElement("span");
    name.className = "script-name";
    name.textContent = script.name;
    const ver = document.createElement("span");
    ver.className = "script-ver";
    ver.textContent = `v${script.version}`;
    head.append(name, ver);
    if (isStoreInstalled(script)) {
      const badge = document.createElement("span");
      badge.className = "badge-src";
      badge.textContent = "Installed";
      head.append(badge);
    }

    const desc = document.createElement("p");
    desc.className = "store-desc";
    desc.textContent = script.description || "No description in the store entry.";

    const metaLine = document.createElement("p");
    metaLine.className = "script-meta-line";
    const bits: string[] = [];
    if (script.author) bits.push(`by ${script.author}`);
    bits.push(
      script.matches.length > 0
        ? `Runs on ${shortMatches(script.matches)}`
        : "No @match info in the store entry — this script runs nowhere until matches are added.",
    );
    metaLine.textContent = bits.join(" · ");

    const dates = document.createElement("p");
    dates.className = "script-meta-line store-dates";
    dates.textContent = storeDatesLine(script);

    // "Install" opens the detail view — the code is fetched and scanned
    // there, and installing still needs Add script + Confirm install.
    // The button never installs anything by itself.
    const installBtn = document.createElement("button");
    installBtn.type = "button";
    installBtn.className = "primary store-install";
    installBtn.textContent = "Install";
    installBtn.title = `View ${script.name} — scan first, then confirm to install`;
    installBtn.addEventListener("click", () => void openStoreDetail(script));

    li.append(head, desc, metaLine, dates, installBtn);
    list.appendChild(li);
  }
}

async function openStoreDetail(script: StoreScript): Promise<void> {
  storeDetail = script;
  storeDetailCode = null;
  storeDetailScanned = false;
  const card = el("storeDetailCard");
  const nameEl = el("storeDetailName");
  const metaEl = el("storeDetailMeta");
  const descEl = el("storeDetailDesc");
  const scanBox = el("storeDetailScan");
  const errEl = el("storeDetailError");
  const installedEl = el("storeDetailInstalled");
  const installBtn = el<HTMLButtonElement>("storeInstallBtn");
  const confirmBtn = el<HTMLButtonElement>("storeConfirmInstall");
  const autoUp = el<HTMLInputElement>("storeAutoUpgrade");
  if (!card) return;
  if (nameEl) nameEl.textContent = `${script.name} — v${script.version}`;
  if (metaEl) {
    const bits: string[] = [];
    if (script.author) bits.push(`by ${script.author}`);
    bits.push(script.matches.length > 0 ? `runs on ${script.matches.join(", ")}` : "no @match info in the store entry");
    bits.push(storeDatesLine(script));
    if (script.homepage) bits.push(`homepage: ${script.homepage}`);
    metaEl.textContent = bits.join(" · ");
  }
  if (descEl) descEl.textContent = script.description || "No description in the store entry.";
  if (scanBox) {
    scanBox.hidden = true;
    scanBox.innerHTML = "";
  }
  if (errEl) {
    errEl.hidden = true;
    errEl.textContent = "";
  }
  if (autoUp) autoUp.checked = false; // Auto-upgrade defaults OFF.
  if (confirmBtn) confirmBtn.hidden = true;
  const already = isStoreInstalled(script);
  if (installedEl) {
    installedEl.hidden = !already;
    installedEl.textContent = already
      ? `Already installed (v${script.version}). Installing again would create a duplicate — delete the installed copy first if you want to reinstall.`
      : "";
  }
  if (installBtn) {
    installBtn.disabled = true; // Enabled only once the code is fetched + scanned.
    installBtn.textContent = "Add script";
  }
  card.hidden = false;
  card.scrollIntoView({ behavior: "smooth", block: "start" });

  // Fetch the code (user-triggered, on detail-open) and scan it.
  // The Add button stays disabled until this succeeds.
  const result = await fetchStoreCode(script);
  if (!storeDetail || storeDetail !== script) return; // User closed it or picked another script meanwhile.
  if (!result.ok || !result.code) {
    if (errEl) {
      errEl.textContent = `Could not fetch this script's code: ${result.error ?? "unknown error"}`;
      errEl.hidden = false;
    }
    return;
  }
  storeDetailCode = result.code;
  const report = securityScan(result.code);
  if (scanBox) {
    scanBox.hidden = false;
    scanBox.innerHTML = scanHtml(report);
  }
  storeDetailScanned = true;
  if (installBtn) installBtn.disabled = already;
}

async function installStoreScript(): Promise<void> {
  const installBtn = el<HTMLButtonElement>("storeInstallBtn");
  const confirmBtn = el<HTMLButtonElement>("storeConfirmInstall");
  const errEl = el("storeDetailError");
  if (!storeDetail || !storeDetailCode || !storeDetailScanned) {
    if (errEl) {
      errEl.textContent = "The code has not been fetched and scanned yet — wait for the scan, then try again.";
      errEl.hidden = false;
    }
    return;
  }
  if (isStoreInstalled(storeDetail)) return;
  const autoUp = el<HTMLInputElement>("storeAutoUpgrade");
  const name = storeDetail.name;
  const version = storeDetail.version;
  try {
    const created = createScript(storeDetailCode, "store");
    // The store entry is the authority for where updates come from:
    // prefer its own update/download URLs; fall back to the code URL
    // so "Check for updates" has something to fetch.
    if (storeDetail.updateURL) created.updateURL = storeDetail.updateURL;
    if (storeDetail.downloadURL) created.downloadURL = storeDetail.downloadURL;
    if (!created.downloadURL && storeDetail.codeUrl) created.downloadURL = storeDetail.codeUrl;
    created.autoUpgrade = autoUp?.checked === true;
    scripts = [...scripts, created];
    await persistScripts();
    if (created.enabled) {
      try {
        await registerScript(created);
      } catch {
        scriptErrors = await loadScriptErrors();
        renderScripts();
      }
    }
  } catch (err) {
    if (errEl) {
      errEl.textContent = err instanceof Error ? err.message : "Could not install the script.";
      errEl.hidden = false;
    }
    return;
  }
  if (confirmBtn) confirmBtn.hidden = true;
  if (installBtn) {
    installBtn.disabled = true;
    installBtn.textContent = "Installed ✓";
  }
  const installedEl = el("storeDetailInstalled");
  if (installedEl) {
    installedEl.hidden = false;
    installedEl.textContent = `Installed as “${name}” v${version} — see the Scripts tab.`;
  }
  renderStoreList();
}

function initStore(): void {
  const loadBtn = el<HTMLButtonElement>("storeLoad");
  const searchInput = el<HTMLInputElement>("storeSearch");
  const sortSelect = el<HTMLSelectElement>("storeSort");
  const installBtn = el<HTMLButtonElement>("storeInstallBtn");
  const confirmBtn = el<HTMLButtonElement>("storeConfirmInstall");
  const closeBtn = el("storeDetailClose");

  loadBtn?.addEventListener("click", async () => {
    if (loadBtn) {
      loadBtn.disabled = true;
      loadBtn.textContent = "Loading…";
    }
    showStoreError("");
    showStoreNote("");
    const notPublished = el("storeNotPublished");
    if (notPublished) notPublished.hidden = true;
    let result: StoreFetchResult;
    try {
      result = await fetchStoreIndex();
    } catch (err) {
      result = { ok: false, source: "none", skipped: 0, error: err instanceof Error ? err.message : String(err) };
    }
    if (loadBtn) {
      loadBtn.disabled = false;
      loadBtn.textContent = "Load store";
    }
    const sourceBadge = el("storeSource");
    const meta = el("storeMeta");
    if (!result.ok || !result.index) {
      storeIndex = null;
      renderStoreList();
      showStoreError(result.error ? `Could not load the store: ${result.error}` : "Could not load the store.");
      if (notPublished) notPublished.hidden = false;
      if (sourceBadge) sourceBadge.hidden = true;
      if (meta) meta.textContent = "";
      return;
    }
    storeIndex = result.index;
    if (sourceBadge) {
      sourceBadge.hidden = false;
      sourceBadge.textContent =
        result.source === "jsdelivr" ? "jsDelivr" : result.source === "raw" ? "raw.githubusercontent" : "cached";
    }
    if (meta) {
      const count = result.index.scripts.length;
      // The meta line always shows WHEN the store was fetched: for a
      // live fetch, this moment; for a cached copy, when the cache was
      // saved. No fetch happens except on this button click.
      const when =
        result.source === "cached" && result.cachedAt
          ? ` · cached from ${new Date(result.cachedAt).toLocaleString()}`
          : ` · Store fetched: ${new Date().toLocaleString()}`;
      const skipped =
        result.skipped > 0 ? ` · ${result.skipped} entr${result.skipped === 1 ? "y" : "ies"} skipped (missing name, version or code)` : "";
      meta.textContent = `${count} script${count === 1 ? "" : "s"}${when}${skipped}`;
    }
    showStoreNote(result.note ?? "");
    renderStoreList();
  });

  searchInput?.addEventListener("input", () => {
    storeQuery = searchInput.value;
    renderStoreList();
  });

  sortSelect?.addEventListener("change", () => {
    const v = sortSelect.value;
    storeSort = v === "published" ? "published" : v === "name" ? "name" : "updated";
    renderStoreList();
  });

  installBtn?.addEventListener("click", () => {
    if (!storeDetailCode || !storeDetailScanned) return;
    if (confirmBtn) {
      confirmBtn.hidden = false;
      confirmBtn.focus();
    }
  });

  confirmBtn?.addEventListener("click", () => void installStoreScript());

  closeBtn?.addEventListener("click", () => {
    const card = el("storeDetailCard");
    if (card) card.hidden = true;
    storeDetail = null;
    storeDetailCode = null;
    storeDetailScanned = false;
  });
}

// ---------------------------------------------------------------------------
// Logs — multi-tab runs (Phase 4)
// ---------------------------------------------------------------------------

function scriptNameForRun(id: string): string {
  return scripts.find((s) => s.id === id)?.name ?? id;
}

function runStatusLabel(status: RunStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
  }
}

async function refreshLogs(): Promise<void> {
  const list = el("runList");
  const empty = el("runEmpty");
  const stopBtn = el<HTMLButtonElement>("stopAllRuns");
  let runs: RunEntry[] = [];
  try {
    runs = await loadRuns();
  } catch {
    runs = [];
  }
  if (stopBtn) stopBtn.disabled = runningRunCount(runs) === 0;
  if (empty) empty.hidden = runs.length !== 0;
  if (!list) return;
  list.innerHTML = "";
  for (const run of runs) {
    const li = document.createElement("li");
    li.className = "run-row";

    const head = document.createElement("div");
    head.className = "run-head";
    const site = document.createElement("span");
    site.className = "run-site";
    site.textContent = run.hostname || run.url;
    const badge = document.createElement("span");
    badge.className = `status-badge status-${run.status}`;
    badge.textContent = runStatusLabel(run.status);
    head.append(site, badge);

    const urlEl = document.createElement("p");
    urlEl.className = "run-url";
    urlEl.textContent = run.url;

    const scriptsEl = document.createElement("p");
    scriptsEl.className = "script-meta-line";
    scriptsEl.textContent =
      run.scriptIds.length > 0
        ? `Scripts: ${run.scriptIds.map(scriptNameForRun).join(", ")}`
        : "No installed scripts match this URL.";

    const timeEl = document.createElement("p");
    timeEl.className = "run-time";
    timeEl.textContent = formatDate(run.startedAt);

    li.append(head, urlEl, scriptsEl, timeEl);
    list.appendChild(li);
  }
}

function initLogs(): void {
  const stopBtn = el<HTMLButtonElement>("stopAllRuns");
  stopBtn?.addEventListener("click", async () => {
    if (stopBtn) stopBtn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: MSG_STOP_ALL });
    } catch {
      // Background did not answer — leave the list as-is.
    }
    await refreshLogs();
  });
  try {
    chrome.storage.onChanged.addListener(
      (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
        if (areaName === "local" && changes[RUNS_KEY]) void refreshLogs();
      },
    );
  } catch {
    // Storage events unavailable — the 2s poll below still refreshes.
  }
  if (logsTimer === null) {
    logsTimer = window.setInterval(() => {
      if (currentTabName === "logs" && document.visibilityState === "visible") void refreshLogs();
    }, 2000);
  }
  void refreshLogs();
}

// ---------------------------------------------------------------------------
// v1.5+ — Sessions / Smart Open All / Snooze / Styles / Scratchpad /
// Dossier / Collections / Storage viewer / Local-file
// (v2.0.3: the new-tab dashboard is removed — no New-tab settings.)
// ---------------------------------------------------------------------------

function v15ShowStatus(id: string, text: string): void {
  const node = el(id);
  if (node) {
    node.hidden = false;
    node.textContent = text;
  }
}

function v15ShowError(id: string, text: string): void {
  const node = el(id);
  if (node) {
    node.hidden = !text;
    node.textContent = text;
  }
}

// --- Sessions + Smart Open All + Snooze queue -------------------------------

async function refreshSessionsTab(): Promise<void> {
  v15Sessions = await loadSessions();
  snoozes = await loadSnoozes();
  v15SmartSettings = await loadSmartOpenSettings();
  renderSessionList();
  renderSnoozeList();
  const groupName = el<HTMLInputElement>("smartGroupName");
  if (groupName) groupName.value = v15SmartSettings.groupName;
  const suspend = el<HTMLInputElement>("smartSuspendMinutes");
  if (suspend) suspend.value = String(v15SmartSettings.suspendMinutes);
  const groupToggle = el<HTMLInputElement>("smartGroupToggle");
  if (groupToggle) groupToggle.checked = v15SmartSettings.groupEnabled;
  // Snooze-task picker (unsnoozed tasks only).
  const sel = el<HTMLSelectElement>("snoozeTaskSel");
  if (sel) {
    const current = sel.value;
    sel.textContent = "";
    const visible = visibleTasks(tasks, snoozes);
    for (const t of visible) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    }
    if (current) sel.value = current;
  }
}

function renderSessionList(): void {
  const list = el("sessionList");
  const empty = el("sessionEmpty");
  if (!list) return;
  list.textContent = "";
  for (const session of v15Sessions) {
    const li = document.createElement("li");
    li.className = "flow-row";
    const name = document.createElement("strong");
    name.textContent = session.name + (session.auto === true ? " (auto-saved)" : "");
    const meta = document.createElement("span");
    meta.className = "hint";
    meta.textContent = sessionSummary(session);
    const tabsLine = document.createElement("div");
    tabsLine.className = "hint";
    tabsLine.textContent = session.tabs.map((t) => t.title).slice(0, 5).join(" · ") + (session.tabs.length > 5 ? ` · ${session.tabs.length - 5} more…` : "");
    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "primary";
    restoreBtn.textContent = "Restore session";
    restoreBtn.addEventListener("click", async () => {
      restoreBtn.disabled = true;
      // Ask for the OPTIONAL tabGroups permission here, on the
      // click gesture: the background service worker has no user
      // activation, so a request from there is always declined.
      // Never hang the restore on the prompt — if the user has not
      // answered in 5s, restore ungrouped (a later Allow still
      // grants it for next time).
      try {
        await Promise.race([
          chrome.permissions.request({ permissions: ["tabGroups"] }).catch(() => false),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
        ]);
      } catch {
        // Denied or unavailable — the restore still runs ungrouped.
      }
      try {
        const res = (await chrome.runtime.sendMessage({ type: MSG_SESSION_RESTORE, id: session.id })) as { ok?: boolean; opened?: number; grouped?: boolean; groupDenied?: boolean; error?: string } | null;
        if (res?.ok) {
          v15ShowStatus("sessionStatus", `Restored ${res.opened ?? session.tabs.length} tab${(res.opened ?? 0) === 1 ? "" : "s"} into a new window${res.grouped ? " (tab groups restored)" : ""}${res.groupDenied ? " — tab grouping was declined, so the tabs opened ungrouped" : ""}. Your existing tabs were not touched.`);
        } else {
          v15ShowStatus("sessionStatus", res?.error ?? "Could not restore that session.");
        }
      } catch {
        v15ShowStatus("sessionStatus", "Could not restore that session (background did not answer).");
      }
      restoreBtn.disabled = false;
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "secondary";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      if (!window.confirm(`Delete the session “${session.name}”?`)) return;
      try {
        await chrome.runtime.sendMessage({ type: MSG_SESSION_DELETE, id: session.id });
      } catch {
        // Background did not answer — re-read below either way.
      }
      await refreshSessionsTab();
    });
    li.append(name, meta, tabsLine, restoreBtn, delBtn);
    list.appendChild(li);
  }
  if (empty) empty.hidden = v15Sessions.length > 0;
}

function renderSnoozeList(): void {
  const list = el("snoozeList");
  const empty = el("snoozeEmpty");
  if (!list) return;
  list.textContent = "";
  for (const snooze of snoozes) {
    const task = tasks.find((t) => t.id === snooze.taskId);
    if (!task) continue;
    const li = document.createElement("li");
    li.className = "flow-row";
    const name = document.createElement("strong");
    name.textContent = task.name;
    const meta = document.createElement("span");
    meta.className = "hint";
    meta.textContent = `Snoozed → ${snooze.label}`;
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "secondary";
    backBtn.textContent = "Bring back now";
    backBtn.addEventListener("click", async () => {
      snoozes = removeSnooze(snoozes, snooze.taskId);
      await saveSnoozes(snoozes);
      await chrome.runtime.sendMessage({ type: MSG_REMINDERS_RESCHEDULE }).catch(() => undefined);
      refreshUI();
      await refreshSessionsTab();
    });
    li.append(name, meta, backBtn);
    list.appendChild(li);
  }
  if (empty) empty.hidden = list.childElementCount > 0;
}

function initSessions(): void {
  el("sessionSave")?.addEventListener("click", async () => {
    const nameInput = el<HTMLInputElement>("sessionName");
    const name = nameInput?.value ?? "";
    try {
      const res = (await chrome.runtime.sendMessage({ type: MSG_SESSION_SAVE, name })) as { ok?: boolean; session?: Session; error?: string } | null;
      if (res?.ok && res.session) {
        v15ShowStatus("sessionStatus", `Saved “${res.session.name}” — ${res.session.tabs.length} tab${res.session.tabs.length === 1 ? "" : "s"}.`);
        if (nameInput) nameInput.value = "";
      } else {
        v15ShowStatus("sessionStatus", res?.error ?? "Could not save that session.");
      }
    } catch {
      v15ShowStatus("sessionStatus", "Could not save that session (background did not answer).");
    }
    await refreshSessionsTab();
  });
  el("smartOpenAll")?.addEventListener("click", async () => {
    const res = await v15RunSmartOpen("all");
    if (res) v15ShowStatus("smartOpenStatus", res);
  });
  el("smartOpenMissed")?.addEventListener("click", async () => {
    const res = await v15RunSmartOpen("missed");
    if (res) v15ShowStatus("smartOpenStatus", res);
  });
  el("smartSave")?.addEventListener("click", async () => {
    const groupName = el<HTMLInputElement>("smartGroupName")?.value ?? "";
    const suspend = Number(el<HTMLInputElement>("smartSuspendMinutes")?.value ?? "30");
    const groupEnabled = el<HTMLInputElement>("smartGroupToggle")?.checked ?? true;
    v15SmartSettings = {
      groupEnabled,
      groupName: groupName.trim() || defaultSmartOpenSettings().groupName,
      suspendMinutes: Number.isFinite(suspend) ? Math.max(0, Math.min(240, Math.round(suspend))) : 30,
    };
    await saveSmartOpenSettings(v15SmartSettings);
    v15ShowStatus("smartSaveStatus", "Smart Open All settings saved.");
  });
  el("snoozeAdd")?.addEventListener("click", async () => {
    const taskId = el<HTMLSelectElement>("snoozeTaskSel")?.value ?? "";
    const target = (el<HTMLSelectElement>("snoozeTarget")?.value ?? "tomorrow-0900") as SnoozeTarget;
    if (!taskId) {
      v15ShowStatus("snoozeStatus", "Pick a task to snooze first.");
      return;
    }
    const snooze = createSnooze(taskId, target);
    if (!snooze) return;
    snoozes = addSnooze(snoozes, snooze);
    await saveSnoozes(snoozes);
    await chrome.runtime.sendMessage({ type: MSG_REMINDERS_RESCHEDULE }).catch(() => undefined);
    v15ShowStatus("snoozeStatus", `Snoozed — it returns ${snooze.label}.`);
    refreshUI();
    await refreshSessionsTab();
  });
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === "local" && (changes["hiddengemflow.sessions.v1"] || changes[SNOOZE_KEY])) {
        if (currentTabName === "sessions") void refreshSessionsTab();
      }
    });
  } catch {
    // Storage events unavailable — the tab-switch reload still applies.
  }
  void refreshSessionsTab();
}

async function v15RunSmartOpen(scope: "all" | "pinned" | "missed"): Promise<string | null> {
  // Ask for the OPTIONAL tabGroups permission here, on the click
  // gesture (see the session-restore button above). Same 5s race:
  // never hang Smart Open All on the prompt.
  try {
    await Promise.race([
      chrome.permissions.request({ permissions: ["tabGroups"] }).catch(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
    ]);
  } catch {
    // Denied or unavailable — Smart Open All still runs ungrouped.
  }
  try {
    const res = (await chrome.runtime.sendMessage({ type: MSG_SMART_OPEN, scope })) as { ok?: boolean; message?: string; error?: string } | null;
    if (res?.ok) return res.message ?? formatSmartOpenResult({ opened: 0, skipped: 0, grouped: false });
    return res?.error ?? "Smart Open All did not run.";
  } catch {
    return "Smart Open All did not run (background did not answer).";
  }
}

// --- Styles + Scratchpad -----------------------------------------------------

async function refreshStylesTab(): Promise<void> {
  v15Styles = await loadUserStyles();
  try {
    const all = await chrome.permissions.getAll();
    v15GrantedOrigins = (all?.origins || []).filter((o: unknown): o is string => typeof o === "string");
  } catch {
    v15GrantedOrigins = [];
  }
  renderStyleList();
}

function renderStyleList(): void {
  const list = el("styleList");
  const empty = el("styleEmpty");
  if (!list) return;
  list.textContent = "";
  for (const style of v15Styles) {
    const li = document.createElement("li");
    li.className = "flow-row";
    const name = document.createElement("strong");
    name.textContent = style.name;
    const meta = document.createElement("span");
    meta.className = "hint";
    const active = styleScheduleActive(style);
    const granted = styleHostGranted(v15GrantedOrigins, style.host);
    meta.textContent = `${style.host} · ${style.enabled ? (active ? "active now" : style.schedule === "dark-hours" ? `dark hours ${style.startHour}:00–${style.endHour}:00` : "enabled") : "disabled"}${style.preview === true ? " · live preview on" : ""}${style.enabled ? (granted ? "" : " · needs site access") : ""}`;
    // A style only RUNS on a host the user granted (same two-grant
    // model as userscripts) — the button asks for that one host.
    if (style.enabled && !granted) {
      const grantBtn = document.createElement("button");
      grantBtn.type = "button";
      grantBtn.className = "primary";
      grantBtn.textContent = "Grant site access";
      grantBtn.addEventListener("click", async () => {
        grantBtn.disabled = true;
        try {
          const ok = await chrome.permissions.request({ origins: [`*://${style.host}/*`] });
          if (ok) {
            await chrome.runtime.sendMessage({ type: MSG_USERSTYLES_SYNC }).catch(() => undefined);
            v15ShowStatus("styleStatus", `Site access granted for ${style.host} — the style applies on its site now.`);
          } else {
            v15ShowStatus("styleStatus", `Site access was not granted — “${style.name}” stays saved but will not apply until you grant ${style.host}.`);
          }
        } catch {
          v15ShowStatus("styleStatus", "Could not ask for site access (the browser did not answer).");
        }
        await refreshStylesTab();
      });
      li.append(grantBtn);
    }
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "secondary";
    toggleBtn.textContent = style.enabled ? "Disable" : "Enable";
    toggleBtn.addEventListener("click", async () => {
      const res = updateUserStyle(v15Styles, style.id, { enabled: !style.enabled });
      if (!res.ok) return;
      v15Styles = res.styles;
      await saveUserStyles(v15Styles);
      await chrome.runtime.sendMessage({ type: MSG_USERSTYLES_SYNC }).catch(() => undefined);
      await refreshStylesTab();
    });
    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "secondary";
    previewBtn.textContent = style.preview === true ? "Preview off" : "Preview";
    previewBtn.addEventListener("click", async () => {
      const res = updateUserStyle(v15Styles, style.id, { preview: style.preview !== true });
      if (!res.ok) return;
      v15Styles = res.styles;
      await saveUserStyles(v15Styles);
      await chrome.runtime.sendMessage({ type: MSG_USERSTYLES_SYNC }).catch(() => undefined);
      await refreshStylesTab();
    });
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "secondary";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => {
      v15EditingStyleId = style.id;
      const nameInput = el<HTMLInputElement>("styleName");
      const hostInput = el<HTMLInputElement>("styleHost");
      const cssInput = el<HTMLTextAreaElement>("styleCss");
      const sched = el<HTMLSelectElement>("styleSchedule");
      const start = el<HTMLInputElement>("styleStartHour");
      const end = el<HTMLInputElement>("styleEndHour");
      const preview = el<HTMLInputElement>("stylePreview");
      if (nameInput) nameInput.value = style.name;
      if (hostInput) hostInput.value = style.host;
      if (cssInput) cssInput.value = style.css;
      if (sched) sched.value = style.schedule;
      if (start) start.value = String(style.startHour);
      if (end) end.value = String(style.endHour);
      if (preview) preview.checked = style.preview === true;
      const cancel = el("styleCancelEdit");
      if (cancel) cancel.hidden = false;
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "secondary";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      if (!window.confirm(`Delete the style “${style.name}”?`)) return;
      v15Styles = deleteUserStyle(v15Styles, style.id);
      await saveUserStyles(v15Styles);
      await chrome.runtime.sendMessage({ type: MSG_USERSTYLES_SYNC }).catch(() => undefined);
      await refreshStylesTab();
    });
    li.append(name, meta, toggleBtn, previewBtn, editBtn, delBtn);
    list.appendChild(li);
  }
  if (empty) empty.hidden = v15Styles.length > 0;
}

function initStyles(): void {
  el("styleSave")?.addEventListener("click", async () => {
    const name = el<HTMLInputElement>("styleName")?.value ?? "";
    const host = el<HTMLInputElement>("styleHost")?.value ?? "";
    const css = el<HTMLTextAreaElement>("styleCss")?.value ?? "";
    const schedule = (el<HTMLSelectElement>("styleSchedule")?.value ?? "always") as "always" | "dark-hours";
    const startHour = Number(el<HTMLInputElement>("styleStartHour")?.value ?? "19");
    const endHour = Number(el<HTMLInputElement>("styleEndHour")?.value ?? "7");
    const preview = el<HTMLInputElement>("stylePreview")?.checked ?? false;
    if (v15EditingStyleId) {
      const res = updateUserStyle(v15Styles, v15EditingStyleId, { name, host, css, schedule, startHour, endHour, preview });
      if (!res.ok) {
        v15ShowError("styleError", res.error);
        return;
      }
      v15Styles = res.styles;
      v15EditingStyleId = null;
      const cancel = el("styleCancelEdit");
      if (cancel) cancel.hidden = true;
    } else {
      const created = createUserStyle({ name, host, css, schedule, startHour, endHour });
      if (!created.ok) {
        v15ShowError("styleError", created.error);
        return;
      }
      v15Styles = [created.style, ...v15Styles];
      if (preview) {
        const res = updateUserStyle(v15Styles, created.style.id, { preview: true });
        if (res.ok) v15Styles = res.styles;
      }
    }
    v15ShowError("styleError", "");
    await saveUserStyles(v15Styles);
    let needsGrant = 0;
    try {
      const res = (await chrome.runtime.sendMessage({ type: MSG_USERSTYLES_SYNC })) as { ok?: boolean; needsGrant?: number } | null;
      needsGrant = typeof res?.needsGrant === "number" ? res.needsGrant : 0;
    } catch {
      // Background did not answer — the status below still applies.
    }
    v15ShowStatus(
      "styleStatus",
      needsGrant > 0
        ? `Style saved — but it needs site access for ${v15Styles.find((st) => st.enabled && !styleHostGranted(v15GrantedOrigins, st.host))?.host ?? "its site"} before it can apply (use “Grant site access” in the list).`
        : "Style saved — it applies on its site now.",
    );
    await refreshStylesTab();
  });
  el("styleCancelEdit")?.addEventListener("click", () => {
    v15EditingStyleId = null;
    const cancel = el("styleCancelEdit");
    if (cancel) cancel.hidden = true;
    const nameInput = el<HTMLInputElement>("styleName");
    const hostInput = el<HTMLInputElement>("styleHost");
    const cssInput = el<HTMLTextAreaElement>("styleCss");
    if (nameInput) nameInput.value = "";
    if (hostInput) hostInput.value = "";
    if (cssInput) cssInput.value = "";
  });
  el("scratchRun")?.addEventListener("click", async () => {
    const code = el<HTMLTextAreaElement>("scratchCode")?.value ?? "";
    const kind = (el<HTMLSelectElement>("scratchKind")?.value ?? "js") as "js" | "css";
    const btn = el<HTMLButtonElement>("scratchRun");
    if (btn) btn.disabled = true;
    try {
      const res = (await chrome.runtime.sendMessage({ type: MSG_SCRATCHPAD_RUN, code, kind })) as { ok?: boolean; error?: string } | null;
      if (res?.ok) {
        v15ShowStatus("scratchStatus", kind === "js" ? "Ran once on the current tab — nothing was saved." : "Applied once on the current tab — nothing was saved.");
      } else {
        v15ShowStatus("scratchStatus", res?.error ?? "Could not run it on the current tab.");
      }
    } catch {
      v15ShowStatus("scratchStatus", "Could not run it (background did not answer).");
    }
    if (btn) btn.disabled = false;
  });
  el("scratchClear")?.addEventListener("click", () => {
    const code = el<HTMLTextAreaElement>("scratchCode");
    if (code) code.value = "";
    v15ShowStatus("scratchStatus", "Cleared — nothing was saved.");
  });
  el("scratchSaveScript")?.addEventListener("click", () => {
    const code = el<HTMLTextAreaElement>("scratchCode")?.value ?? "";
    if (!code.trim()) {
      v15ShowStatus("scratchStatus", "Type some JavaScript first.");
      return;
    }
    // Open the v1.3 editor with the scratchpad code — the script is
    // only installed after the usual scan + Confirm there.
    selectTab("scripts");
    try {
      history.replaceState(null, "", "#scripts");
    } catch {
      // Non-fatal.
    }
    const newBtn = el<HTMLButtonElement>("scriptNew");
    newBtn?.click();
    const editor = el<HTMLTextAreaElement>("scriptEditor");
    if (editor) {
      editor.value = code;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
    v15ShowStatus("scratchStatus", "Opened in the script editor — scan it and confirm to install.");
  });
  el("scratchSaveStyle")?.addEventListener("click", async () => {
    const code = el<HTMLTextAreaElement>("scratchCode")?.value ?? "";
    if (!code.trim()) {
      v15ShowStatus("scratchStatus", "Type some CSS first.");
      return;
    }
    const check = validateUserStyleCss(code);
    if (!check.ok) {
      v15ShowStatus("scratchStatus", check.error ?? "That CSS is not usable as a style.");
      return;
    }
    let host = "";
    try {
      const tab = (await chrome.runtime.sendMessage({ type: MSG_GET_ACTIVE_TAB })) as { ok?: boolean; url?: string } | null;
      if (tab?.ok && tab.url) {
        host = new URL(tab.url).hostname.replace(/^www\./, "");
      }
    } catch {
      host = "";
    }
    const nameInput = el<HTMLInputElement>("styleName");
    const hostInput = el<HTMLInputElement>("styleHost");
    const cssInput = el<HTMLTextAreaElement>("styleCss");
    if (nameInput) nameInput.value = "Scratchpad style";
    if (hostInput) hostInput.value = host;
    if (cssInput) cssInput.value = code;
    v15ShowStatus("scratchStatus", host ? `Loaded into the userstyle form for ${host} — save it to apply.` : "Loaded into the userstyle form — fill in the site host, then save.");
  });
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === "local" && changes["hiddengemflow.userstyles.v1"]) {
        if (currentTabName === "styles") void refreshStylesTab();
      }
    });
  } catch {
    // Storage events unavailable — the tab-switch reload still applies.
  }
  void refreshStylesTab();
}

// --- Dossier + Collections + Storage viewer + Local-file --------------------

async function refreshDossierTab(siteHost?: string): Promise<void> {
  const sel = el<HTMLSelectElement>("dossierSite");
  if (sel) {
    const current = siteHost ?? sel.value;
    sel.textContent = "";
    for (const t of tasks) {
      const opt = document.createElement("option");
      opt.value = t.url;
      opt.textContent = `${t.name} — ${t.url}`;
      sel.appendChild(opt);
    }
    if (current) sel.value = current;
    // If the caller named a host (bridge button), pick the first task on it.
    if (siteHost) {
      const match = tasks.find((t) => {
        try {
          return new URL(t.url).hostname.replace(/^www\./, "") === siteHost.replace(/^www\./, "");
        } catch {
          return false;
        }
      });
      if (match) sel.value = match.url;
    }
  }
  await renderDossier();
  await renderCollections();
  renderViewerSelects();
}

async function renderDossier(): Promise<void> {
  const box = el("dossierContent");
  const empty = el("dossierEmpty");
  if (!box) return;
  box.textContent = "";
  const url = el<HTMLSelectElement>("dossierSite")?.value ?? "";
  if (!url || tasks.length === 0) {
    if (empty) empty.hidden = tasks.length > 0;
    return;
  }
  if (empty) empty.hidden = true;
  const [allScripts, allNotes, runs] = await Promise.all([loadScripts(), loadNotes(), loadRuns()]);
  let cache: StoreCache | null = null;
  try {
    cache = await loadStoreCache();
  } catch {
    cache = null;
  }
  const dossier = assembleDossier({ url, tasks, scripts: allScripts, notes: allNotes, runs, storeScripts: cache?.index.scripts ?? [] });
  const head = document.createElement("div");
  head.className = "dossier-head";
  const title = document.createElement("b");
  title.textContent = dossier.task?.name ?? dossier.host ?? url;
  const sub = document.createElement("span");
  sub.textContent = url;
  head.append(title, sub);
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "primary";
  openBtn.textContent = "Open site";
  openBtn.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: MSG_OPEN_URLS, urls: [url] });
  });
  head.appendChild(openBtn);
  box.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "dossier-grid";
  const col = (heading: string, rows: Array<[string, string]>): HTMLElement => {
    const c = document.createElement("div");
    c.className = "dossier-col";
    const h = document.createElement("h4");
    h.textContent = heading;
    c.appendChild(h);
    if (rows.length === 0) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "Nothing here yet.";
      c.appendChild(p);
    }
    for (const [a, b] of rows) {
      const row = document.createElement("div");
      row.className = "d-row";
      const left = document.createElement("b");
      left.textContent = a;
      const right = document.createElement("span");
      right.textContent = b;
      row.append(left, right);
      c.appendChild(row);
    }
    return c;
  };
  grid.appendChild(
    col("THIS SITE'S TASK", dossier.task ? [
      [dossier.task.name, dossier.task.pinned ? "Pinned 📌" : ""],
      ["Last opened", dossier.task.lastOpenedAt ? new Date(dossier.task.lastOpenedAt).toLocaleString() : "never"],
      ["Reminder", dossier.task.reminder ? `${dossier.task.reminder.time}` : "none"],
    ] : [["No task saved for this site", ""]]),
  );
  grid.appendChild(
    col("MATCHING SCRIPTS", [
      ...dossier.matchingScripts.map((s): [string, string] => [s.name, s.enabled ? "Installed" : "Disabled"]),
      ...dossier.nonMatchingScripts.slice(0, 3).map((s): [string, string] => [s.name, "no match"]),
    ]),
  );
  grid.appendChild(
    col("TAGGED NOTES", dossier.taggedNotes.map((n): [string, string] => [displayTitle(n.title, n.body), n.tags.join(" · ")])),
  );
  grid.appendChild(
    col("RUN HISTORY", dossier.runHistory.map((r): [string, string] => [
      r.scriptIds.length > 0 ? r.scriptIds.map((id) => allScripts.find((s) => s.id === id)?.name ?? id).join(", ") : "Opened",
      `${new Date(r.startedAt).toLocaleTimeString()} · ${r.status}`,
    ])),
  );
  box.appendChild(grid);
  if (dossier.storeRecommendations.length > 0) {
    const rec = document.createElement("div");
    rec.className = "store-rec";
    const b = document.createElement("b");
    b.textContent = "Store recommendation";
    const span = document.createElement("span");
    span.textContent = `The official store has ${dossier.storeRecommendations.length} more script${dossier.storeRecommendations.length === 1 ? "" : "s"} for this site — “${dossier.storeRecommendations[0].name}”.`;
    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "primary";
    viewBtn.textContent = "View in Store";
    viewBtn.addEventListener("click", () => {
      selectTab("store");
      const search = el<HTMLInputElement>("storeSearch");
      if (search) {
        search.value = dossier.storeRecommendations[0].name;
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    rec.append(b, span, viewBtn);
    box.appendChild(rec);
  }
}

async function renderCollections(): Promise<void> {
  v15Followed = await loadFollowedCollections();
  const list = el("collectionList");
  const empty = el("collectionEmpty");
  if (!list) return;
  list.textContent = "";
  let cache: StoreCache | null = null;
  try {
    cache = await loadStoreCache();
  } catch {
    cache = null;
  }
  const resolved = resolveCollections(cache?.index ?? null, v15Followed);
  for (const r of resolved) {
    const li = document.createElement("li");
    li.className = "flow-row";
    const name = document.createElement("strong");
    name.textContent = r.collection.name;
    const meta = document.createElement("span");
    meta.className = "hint";
    meta.textContent = `${r.collection.scriptNames.length} script${r.collection.scriptNames.length === 1 ? "" : "s"}${r.found.length < r.collection.scriptNames.length ? ` · ${r.missing.length} not in the store yet` : ""} — ${r.collection.description}`;
    const followBtn = document.createElement("button");
    followBtn.type = "button";
    followBtn.className = "secondary";
    followBtn.textContent = r.followed ? "Following ✓" : "Follow";
    followBtn.addEventListener("click", async () => {
      v15Followed = toggleCollectionFollow(v15Followed, r.collection.id);
      await saveFollowedCollections(v15Followed);
      await renderCollections();
    });
    li.append(name, meta, followBtn);
    list.appendChild(li);
  }
  if (empty) empty.hidden = cache !== null;
}

function renderViewerSelects(): void {
  const viewerSel = el<HTMLSelectElement>("viewerScript");
  if (viewerSel) {
    const current = viewerSel.value;
    viewerSel.textContent = "";
    for (const s of scripts) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      viewerSel.appendChild(opt);
    }
    if (current) viewerSel.value = current;
  }
  const localSel = el<HTMLSelectElement>("localFileScript");
  if (localSel) {
    const current = localSel.value;
    localSel.textContent = "";
    for (const s of scripts) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      localSel.appendChild(opt);
    }
    if (current) localSel.value = current;
  }
}

// Local-file handle persistence (dashboard page IndexedDB only —
// chrome.storage cannot hold a FileSystemHandle, and a service
// worker cannot re-read one without a user gesture).
function v15LocalDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("hiddengem-flow-localfile", 1);
    req.onupgradeneeded = () => {
      try {
        req.result.createObjectStore("handles");
      } catch {
        // Store already exists.
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("Could not open the local-file store."));
  });
}

async function v15SaveLocalHandle(scriptId: string, handle: unknown): Promise<void> {
  const db = await v15LocalDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, scriptId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("Could not save the file handle."));
  });
}

async function v15LoadLocalHandle(scriptId: string): Promise<unknown> {
  const db = await v15LocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readonly");
    const req = tx.objectStore("handles").get(scriptId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(new Error("Could not read the file handle."));
  });
}

function initDossier(): void {
  el("dossierSite")?.addEventListener("change", () => {
    void renderDossier();
  });
  el("collectionSearch")?.addEventListener("input", () => {
    const query = el<HTMLInputElement>("collectionSearch")?.value ?? "";
    const results = el("collectionSearchResults");
    const empty = el("collectionSearchEmpty");
    if (!results) return;
    results.textContent = "";
    if (!query.trim()) {
      if (empty) empty.hidden = true;
      return;
    }
    const hits = searchStore(storeIndex, query);
    for (const hit of hits.slice(0, 10)) {
      const li = document.createElement("li");
      li.className = "store-row";
      const name = document.createElement("strong");
      name.textContent = hit.name;
      const desc = document.createElement("span");
      desc.className = "hint";
      desc.textContent = hit.description || hit.version;
      const viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.className = "secondary";
      viewBtn.textContent = "View in Store";
      viewBtn.addEventListener("click", () => {
        selectTab("store");
        const search = el<HTMLInputElement>("storeSearch");
        if (search) {
          search.value = hit.name;
          search.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      li.append(name, desc, viewBtn);
      results.appendChild(li);
    }
    if (empty) empty.hidden = hits.length > 0;
  });
  el("viewerInspect")?.addEventListener("click", async () => {
    const scriptId = el<HTMLSelectElement>("viewerScript")?.value ?? "";
    const box = el("viewerResults");
    if (!scriptId || !box) return;
    box.textContent = "";
    v15ShowStatus("viewerStatus", "Reading the page's saved data…");
    const script = scripts.find((s) => s.id === scriptId);
    // Per-script error console (existing errors key).
    const errors = await loadScriptErrors();
    if (errors[scriptId]) {
      const errLine = document.createElement("p");
      errLine.className = "error";
      errLine.textContent = `Registration error: ${errors[scriptId]}`;
      box.appendChild(errLine);
    }
    try {
      const res = (await chrome.runtime.sendMessage({ type: MSG_GM_VALUES_READ, id: scriptId })) as { ok?: boolean; values?: Array<{ key: string; value: string; truncated: boolean }>; error?: string } | null;
      if (!res?.ok) {
        v15ShowStatus("viewerStatus", res?.error ?? "Could not read the saved data.");
        return;
      }
      const values = res.values ?? [];
      if (values.length === 0) {
        v15ShowStatus("viewerStatus", script ? `“${script.name}” has saved no GM values on its site yet.` : "No saved values.");
        return;
      }
      const title = document.createElement("h4");
      title.textContent = script ? `Saved data — ${script.name} (read-only)` : "Saved data (read-only)";
      box.appendChild(title);
      for (const v of values) {
        const row = document.createElement("div");
        row.className = "m-row";
        const k = document.createElement("b");
        k.textContent = v.key;
        const val = document.createElement("span");
        val.className = "val";
        val.textContent = formatGmValue(v);
        row.append(k, val);
        box.appendChild(row);
      }
      v15ShowStatus("viewerStatus", `${values.length} saved value${values.length === 1 ? "" : "s"} — read-only, nothing was changed.`);
    } catch {
      v15ShowStatus("viewerStatus", "Could not read the saved data (background did not answer).");
    }
  });
  el("viewerExportRuns")?.addEventListener("click", async () => {
    const scriptId = el<HTMLSelectElement>("viewerScript")?.value ?? "";
    const script = scripts.find((s) => s.id === scriptId);
    if (!script) return;
    const runs = await loadRuns();
    const data = buildScriptRunExport(script.id, script.name, runs);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`hiddengem-flow-runs-${localFileName(script.name).replace(/\.user\.js$/, "")}-${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
    v15ShowStatus("viewerStatus", `Exported ${data.runs.length} run${data.runs.length === 1 ? "" : "s"} for “${script.name}”.`);
  });
  el("localFileExport")?.addEventListener("click", () => {
    const scriptId = el<HTMLSelectElement>("localFileScript")?.value ?? "";
    const script = scripts.find((s) => s.id === scriptId);
    if (!script) return;
    downloadFile(localFileName(script.name), script.code, "text/javascript");
    v15ShowStatus("localFileStatus", `Exported “${script.name}” as ${localFileName(script.name)} — edit it in your own editor, then re-import it here.`);
  });
  el("localFileImportBtn")?.addEventListener("click", async () => {
    // Prefer the File System Access picker: it returns a HANDLE,
    // which is saved (dashboard IndexedDB only) so "Check file for
    // changes" can re-read the same file later. A plain <input> file
    // has no handle, so the picker path is tried first and the input
    // is only the fallback when the picker API is missing.
    const pickerFn = (window as unknown as { showOpenFilePicker?: (opts?: unknown) => Promise<Array<{ getFile: () => Promise<File> }>> }).showOpenFilePicker;
    if (typeof pickerFn === "function") {
      try {
        const handles = await pickerFn({ types: [{ description: "Userscript", accept: { "text/javascript": [".js", ".user.js"] } }], multiple: false });
        const handle = handles?.[0];
        if (!handle) return;
        const file = await handle.getFile();
        const scriptId = el<HTMLSelectElement>("localFileScript")?.value ?? "";
        if (scriptId) {
          try {
            await v15SaveLocalHandle(scriptId, handle);
          } catch {
            // Handle not saved — the re-import below still works.
          }
        }
        await v15ReimportLocalFile(file);
        return;
      } catch (err) {
        // User cancelled the picker (AbortError) — silent. Any other
        // failure falls through to the plain file input.
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }
    el<HTMLInputElement>("localFileImport")?.click();
  });
  el("localFileImport")?.addEventListener("change", async () => {
    const input = el<HTMLInputElement>("localFileImport");
    const file = input?.files?.[0];
    if (input) input.value = "";
    if (!file) return;
    await v15ReimportLocalFile(file);
  });
  el("localFileCheck")?.addEventListener("click", async () => {
    const scriptId = el<HTMLSelectElement>("localFileScript")?.value ?? "";
    const script = scripts.find((s) => s.id === scriptId);
    if (!script) return;
    // The spike, stated plainly in the UI: this re-reads a file the
    // user picked earlier, on this click only — it is not watching.
    v15ShowStatus("localFileStatus", LOCAL_FILE_SPIKE);
    try {
      const handle = (await v15LoadLocalHandle(scriptId)) as { getFile?: () => Promise<File>; name?: string } | null;
      if (!handle || typeof handle.getFile !== "function") {
        v15ShowError("localFileError", "No file was picked for this script yet — use “Re-import a file…” first, then this button re-reads it.");
        return;
      }
      const file = await handle.getFile();
      await v15ReimportLocalFile(file, true);
    } catch (err) {
      v15ShowError("localFileError", err instanceof Error ? err.message : "Could not re-read that file.");
    }
  });
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === "local" && (changes[TASKS_KEY] || changes[NOTES_KEY] || changes[RUNS_KEY] || changes["hiddengemflow.store.cache.v1"])) {
        if (currentTabName === "dossier") void refreshDossierTab();
      }
    });
  } catch {
    // Storage events unavailable — the tab-switch reload still applies.
  }
  void refreshDossierTab();
}

/** Re-import a local file as an update to the selected script (scan + confirm, like any install). */
async function v15ReimportLocalFile(file: File, fromCheck = false): Promise<void> {
  const scriptId = el<HTMLSelectElement>("localFileScript")?.value ?? "";
  const script = scripts.find((s) => s.id === scriptId);
  if (!script) return;
  let code: string;
  try {
    code = await file.text();
  } catch {
    v15ShowError("localFileError", "Could not read that file.");
    return;
  }
  const check = validateLocalFileReimport(code, script.name);
  if (!check.ok) {
    v15ShowError("localFileError", check.error);
    return;
  }
  // Note: a file from the plain <input> fallback has no handle,
  // so "Check file for changes" only works after a picker pick
  // (the handle is saved in v15SaveLocalHandle above). An <input>
  // re-import still updates the script — it just cannot be
  // re-checked later, and the check button says so honestly.
  if (code === script.code) {
    v15ShowStatus("localFileStatus", fromCheck ? "Checked — the file is unchanged since the installed script." : "That file matches the installed script — nothing to update.");
    return;
  }
  // Update through the normal version-upgrade path (history + scan):
  // the editor's confirm flow is the install gate, so route there.
  const updated = updateScriptCode(scripts, script.id, code);
  const changed = countLinesChanged(script.code, code);
  scripts = updated;
  await saveScripts(scripts);
  v15ShowStatus("localFileStatus", `Updated “${script.name}” from ${file.name} — ${changed} line${changed === 1 ? "" : "s"} changed (v${check.version}). The old code is in the script's version history if you need it back.`);
  v15ShowError("localFileError", "");
  void refreshDossierTab();
}

// ---------------------------------------------------------------------------
// Later (#13/#20/#24) — scheduled scripts, opt-in sync, AI authoring
// ---------------------------------------------------------------------------

let laterScripts: Script[] = [];
let laterSchedules: Record<string, ScheduleEntry> = {};
let laterRuns: ScheduleRunEntry[] = [];
let laterSync: SyncSettings = defaultSyncSettings();
let laterSyncTokensStored: { webdav: boolean; gist: boolean; drive: boolean } = { webdav: false, gist: false, drive: false };

function laterShowStatus(id: string, text: string): void {
  const node = el(id);
  if (node) {
    node.hidden = false;
    node.textContent = text;
  }
}

function laterHideStatus(id: string): void {
  const node = el(id);
  if (node) node.hidden = true;
}

/** Re-read everything the Later tab shows and re-render it. */
async function refreshLaterTab(): Promise<void> {
  try {
    const [loadedScripts, loadedSchedules, loadedRuns, loadedSync, loadedTokens] = await Promise.all([
      loadScripts(),
      loadSchedules(),
      loadScheduleRuns(),
      loadSyncSettings(),
      loadSyncTokens(),
    ]);
    laterScripts = loadedScripts;
    laterSchedules = loadedSchedules;
    laterRuns = loadedRuns;
    laterSync = loadedSync;
    laterSyncTokensStored = {
      webdav: loadedTokens.webdavUser.length > 0 || loadedTokens.webdavPassword.length > 0,
      gist: loadedTokens.gistToken.length > 0,
      drive: loadedTokens.driveToken.length > 0,
    };
  } catch {
    // A failed load leaves the previous render in place.
    return;
  }
  renderSchedList();
  renderSchedRunLog();
  renderSyncCard();
}

// --- Scheduled scripts (#13) -----------------------------------------------

function renderSchedList(): void {
  const list = el("schedList");
  const empty = el("schedEmpty");
  if (!list) return;
  list.innerHTML = "";
  const visible = [...laterScripts].sort((a, b) => a.name.localeCompare(b.name));
  if (empty) empty.hidden = visible.length > 0;
  for (const script of visible) {
    const schedule = laterSchedules[script.id];
    const enabled = schedule?.enabled === true;
    const interval = schedule?.intervalMinutes ?? 30;
    const row = document.createElement("li");
    row.className = "sched-row";
    const info = document.createElement("div");
    info.className = "sched-info";
    const name = document.createElement("b");
    name.textContent = script.name;
    const desc = document.createElement("span");
    const matchCount = script.matches.length;
    desc.textContent =
      (script.archived === true ? "Archived — restore it to run on a schedule. " : "") +
      (matchCount > 0 ? `Runs on ${matchCount} site${matchCount === 1 ? "" : "s"} · ` : "No @match sites — add one to run it. ") +
      (enabled ? `Next run in about ${formatScheduleInterval(interval).replace(/^Every /i, "").toLowerCase()}.` : "Not scheduled.");
    info.append(name, desc);
    row.append(info);
    const chip = document.createElement("span");
    chip.className = "sched-chip";
    chip.textContent = formatScheduleInterval(interval);
    row.append(chip);
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Interval for ${script.name}`);
    select.disabled = script.archived === true;
    for (const minutes of SCHEDULE_INTERVALS) {
      const opt = document.createElement("option");
      opt.value = String(minutes);
      opt.textContent = formatScheduleInterval(minutes);
      if (minutes === interval) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener("change", () => {
      void (async () => {
        const next = Number(select.value);
        try {
          laterSchedules = setSchedule(laterSchedules, script.id, laterSchedules[script.id]?.enabled === true, next);
          await saveSchedules(laterSchedules);
          await chrome.runtime.sendMessage({ type: MSG_SCHEDULES_RESCHEDULE });
          laterShowStatus("schedStatus", `“${script.name}” now runs ${formatScheduleInterval(next).toLowerCase()}.`);
          renderSchedList();
        } catch (err) {
          laterShowStatus("schedStatus", err instanceof Error ? err.message : String(err));
        }
      })();
    });
    row.append(select);
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = enabled;
    toggle.disabled = script.archived === true;
    toggle.setAttribute("aria-label", `Schedule ${script.name}`);
    toggle.addEventListener("change", () => {
      void (async () => {
        if (toggle.checked) {
          // Confirm-first gate: enabling a schedule needs an explicit
          // confirm. A dismissed dialog leaves the schedule OFF.
          const ok = window.confirm(
            `Run “${script.name}” on a timer (${formatScheduleInterval(Number(select.value)).toLowerCase()})?\n\nEach run opens the script's site in a background tab, lets the script run on load, then closes the tab. The script only ever runs on sites you already granted access to. Turn it off any time from this list.`,
          );
          if (!ok) {
            toggle.checked = false;
            return;
          }
        }
        try {
          laterSchedules = setSchedule(laterSchedules, script.id, toggle.checked, Number(select.value));
          await saveSchedules(laterSchedules);
          await chrome.runtime.sendMessage({ type: MSG_SCHEDULES_RESCHEDULE });
          laterShowStatus(
            "schedStatus",
            toggle.checked
              ? `“${script.name}” is scheduled — ${formatScheduleInterval(Number(select.value)).toLowerCase()}. The first run is logged below.`
              : `“${script.name}” is no longer scheduled.`,
          );
          renderSchedList();
        } catch (err) {
          toggle.checked = !toggle.checked;
          laterShowStatus("schedStatus", err instanceof Error ? err.message : String(err));
        }
      })();
    });
    row.append(toggle);
    const runNow = document.createElement("button");
    runNow.type = "button";
    runNow.className = "secondary";
    runNow.textContent = "Run now";
    runNow.disabled = script.archived === true || !script.enabled;
    runNow.addEventListener("click", () => {
      void (async () => {
        runNow.disabled = true;
        laterShowStatus("schedStatus", `Running “${script.name}” now — the log below updates when it finishes (a few seconds).`);
        try {
          const res = (await chrome.runtime.sendMessage({ type: MSG_SCHEDULE_RUN_NOW, id: script.id })) as { ok?: boolean; error?: string } | null;
          if (res?.ok) {
            laterShowStatus("schedStatus", `“${script.name}” ran — see the log below.`);
          } else {
            laterShowStatus("schedStatus", res?.error ?? "The run did not finish — see the log below.");
          }
        } catch (err) {
          laterShowStatus("schedStatus", err instanceof Error ? err.message : String(err));
        } finally {
          runNow.disabled = script.archived === true || !script.enabled;
          await refreshLaterTab();
        }
      })();
    });
    row.append(runNow);
    list.append(row);
  }
}

function renderSchedRunLog(): void {
  const log = el("schedRunLog");
  if (!log) return;
  log.innerHTML = "";
  if (laterRuns.length === 0) {
    log.textContent = "No scheduled runs yet.";
    return;
  }
  for (const entry of laterRuns.slice(0, 10)) {
    const line = document.createElement("div");
    const d = new Date(entry.at);
    const time = document.createElement("span");
    time.className = "tm";
    time.textContent = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} `;
    const mark = document.createElement("span");
    mark.className = entry.status === "ok" ? "ok" : "wr";
    mark.textContent = entry.status === "ok" ? "✓ " : entry.status === "failed" ? "⚠ " : "– ";
    const text = document.createElement("span");
    text.textContent = `${entry.scriptName} — ${entry.detail}`;
    line.append(time, mark, text);
    log.append(line);
  }
}

// --- Opt-in sync (#20) ------------------------------------------------------

function renderSyncCard(): void {
  const toggle = el<HTMLInputElement>("syncToggle");
  if (toggle) toggle.checked = laterSync.enabled === true;
  const provider = laterSync.provider;
  document.querySelectorAll<HTMLElement>("[data-sync-provider]").forEach((chip) => {
    chip.classList.toggle("sel", chip.dataset.syncProvider === provider);
  });
  const webdavFields = el("syncFieldsWebdav");
  const gistFields = el("syncFieldsGist");
  const driveFields = el("syncFieldsDrive");
  if (webdavFields) webdavFields.hidden = provider !== "webdav";
  if (gistFields) gistFields.hidden = provider !== "gist";
  if (driveFields) driveFields.hidden = provider !== "drive";
  const webdavUrl = el<HTMLInputElement>("syncWebdavUrl");
  if (webdavUrl && document.activeElement !== webdavUrl) webdavUrl.value = laterSync.webdavUrl;
  const gistId = el<HTMLInputElement>("syncGistId");
  if (gistId && document.activeElement !== gistId) gistId.value = laterSync.gistId;
  const driveFileId = el<HTMLInputElement>("syncDriveFileId");
  if (driveFileId && document.activeElement !== driveFileId) driveFileId.value = laterSync.driveFileId;
  const auto = el<HTMLSelectElement>("syncAuto");
  if (auto) auto.value = String(laterSync.autoSyncMinutes);
  const gistToken = el<HTMLInputElement>("syncGistToken");
  if (gistToken) gistToken.placeholder = laterSyncTokensStored.gist ? "Saved — leave blank to keep it" : "Paste your Gist token…";
  const driveToken = el<HTMLInputElement>("syncDriveToken");
  if (driveToken) driveToken.placeholder = laterSyncTokensStored.drive ? "Saved — leave blank to keep it" : "Paste your Drive token…";
  const webdavPassword = el<HTMLInputElement>("syncWebdavPassword");
  if (webdavPassword) webdavPassword.placeholder = laterSyncTokensStored.webdav ? "Saved — leave blank to keep it" : "Password (optional)";
  const last = laterSync.lastSync;
  if (last) {
    const when = new Date(last.at);
    const hh = String(when.getHours()).padStart(2, "0");
    const mm = String(when.getMinutes()).padStart(2, "0");
    laterShowStatus("syncStatus", `${last.ok ? "✓" : "⚠"} Last sync ${hh}:${mm} — ${last.message}`);
  } else {
    laterHideStatus("syncStatus");
  }
}

/**
 * Later (#20, audit A-53): make sure the extension may actually
 * REACH the provider. An extension fetch to a host without a host
 * permission is CORS-blocked — the background's fetch would fail
 * with "Failed to fetch" even though the server is up. So the
 * dashboard asks for exactly the provider's origin (the same
 * per-site pattern as script site access) on the user's click
 * gesture. A denial is NOT an error to retry silently — the caller
 * shows it and does not sync. After a fresh Allow, the grant takes
 * up to ~1 s to become visible to contains() (measured live, A-51),
 * so the function polls briefly before returning — the background
 * fetch that follows must not race ahead of the grant landing.
 */
async function ensureSyncHostAccess(settings: SyncSettings): Promise<{ ok: boolean; error?: string }> {
  const pattern = syncOriginPattern(settings.provider, settings);
  if (!pattern) return { ok: false, error: "Add the provider address first." };
  try {
    if (await chrome.permissions.contains({ origins: [pattern] })) return { ok: true };
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      return { ok: false, error: `Access to ${SYNC_PROVIDER_LABELS[settings.provider]} was declined — sync cannot reach it without that one-time grant. Turn sync on again to retry.` };
    }
    for (let i = 0; i < 7; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        if (await chrome.permissions.contains({ origins: [pattern] })) return { ok: true };
      } catch {
        break;
      }
    }
    return { ok: true }; // The request resolved true — the grant is landing.
  } catch (err) {
    return { ok: false, error: `Could not ask for provider access: ${err instanceof Error ? err.message : String(err)}` };
  }
}


/** Read the sync form into settings + token updates (blank token inputs keep the stored token). */
function readSyncForm(): { settings: SyncSettings; tokenUpdates: Partial<SyncTokens> } {
  const provider = (document.querySelector<HTMLElement>("[data-sync-provider].sel")?.dataset.syncProvider ?? laterSync.provider) as SyncProvider;
  const settings: SyncSettings = {
    ...laterSync,
    enabled: el<HTMLInputElement>("syncToggle")?.checked === true,
    provider,
    webdavUrl: el<HTMLInputElement>("syncWebdavUrl")?.value.trim() ?? "",
    gistId: el<HTMLInputElement>("syncGistId")?.value.trim() ?? "",
    driveFileId: el<HTMLInputElement>("syncDriveFileId")?.value.trim() ?? "",
    autoSyncMinutes: Number(el<HTMLSelectElement>("syncAuto")?.value ?? "0") || 0,
  };
  const tokenUpdates: Partial<SyncTokens> = {};
  const webdavUser = el<HTMLInputElement>("syncWebdavUser")?.value ?? "";
  const webdavPassword = el<HTMLInputElement>("syncWebdavPassword")?.value ?? "";
  const gistToken = el<HTMLInputElement>("syncGistToken")?.value ?? "";
  const driveToken = el<HTMLInputElement>("syncDriveToken")?.value ?? "";
  if (webdavUser) tokenUpdates.webdavUser = webdavUser;
  if (webdavPassword) tokenUpdates.webdavPassword = webdavPassword;
  if (gistToken) tokenUpdates.gistToken = gistToken;
  if (driveToken) tokenUpdates.driveToken = driveToken;
  return { settings, tokenUpdates };
}




/** The Detect button needs a provider AND a key (typed in the field, or already stored for that provider). */


/** Show a draft preview (local or cloud). The draft is text only — never installed here. */


function initLater(): void {
  // --- Scheduled scripts: the list re-renders from refreshLaterTab. ---
  // --- Sync: provider chips ---
  document.querySelectorAll<HTMLElement>("[data-sync-provider]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const provider = chip.dataset.syncProvider as SyncProvider | undefined;
      if (!provider) return;
      laterSync = { ...laterSync, provider };
      renderSyncCard();
    });
  });
  // --- Sync: big toggle (default OFF; turning it on saves immediately) ---
  el("syncToggle")?.addEventListener("change", () => {
    void (async () => {
      const { settings } = readSyncForm();
      if (settings.enabled) {
        const check = validateSyncTarget(settings.provider, settings);
        if (!check.ok) {
          const toggle = el<HTMLInputElement>("syncToggle");
          if (toggle) toggle.checked = false;
          laterShowStatus("syncStatus", `Sync stays off: ${check.error}`);
          return;
        }
        // A-53: the provider must be reachable — ask for its origin
        // (one-time, per-site) before turning sync on.
        const access = await ensureSyncHostAccess(settings);
        if (!access.ok) {
          const toggle = el<HTMLInputElement>("syncToggle");
          if (toggle) toggle.checked = false;
          laterShowStatus("syncStatus", `Sync stays off: ${access.error}`);
          return;
        }
      }
      laterSync = settings;
      await saveSyncSettings(laterSync);
      laterShowStatus(
        "syncStatus",
        settings.enabled
          ? `Sync is ON (${SYNC_PROVIDER_LABELS[settings.provider]}, ${formatSyncInterval(settings.autoSyncMinutes).toLowerCase()}). Nothing has been sent yet — press Sync now.`
          : "Sync is OFF — nothing will be sent.",
      );
      renderSyncCard();
    })();
  });
  // --- Sync: save settings + tokens ---
  el("syncSave")?.addEventListener("click", () => {
    void (async () => {
      const { settings, tokenUpdates } = readSyncForm();
      if (settings.enabled) {
        const check = validateSyncTarget(settings.provider, settings);
        if (!check.ok) {
          laterShowStatus("syncStatus", check.error);
          return;
        }
      }
      laterSync = settings;
      await saveSyncSettings(laterSync);
      if (Object.keys(tokenUpdates).length > 0) {
        const current = await loadSyncTokens();
        await saveSyncTokens({ ...current, ...tokenUpdates });
        // Clear the password inputs so the token never sits in the DOM.
        for (const id of ["syncWebdavPassword", "syncGistToken", "syncDriveToken"]) {
          const input = el<HTMLInputElement>(id);
          if (input) input.value = "";
        }
      }
      await refreshLaterTab();
      laterShowStatus("syncStatus", "Sync settings saved. Tokens stay in this browser only — they are never in backups.");
    })();
  });
  // --- Sync: upload now ---
  el("syncNow")?.addEventListener("click", () => {
    void (async () => {
      // A-53: reachability first — the provider origin must be granted
      // or the background fetch is CORS-blocked.
      const access = await ensureSyncHostAccess(laterSync);
      if (!access.ok) {
        laterShowStatus("syncStatus", access.error ?? "Sync cannot reach the provider.");
        return;
      }
      laterShowStatus("syncStatus", "Syncing — uploading to your provider…");
      try {
        const res = (await chrome.runtime.sendMessage({ type: MSG_SYNC_NOW })) as { ok?: boolean; error?: string } | null;
        await refreshLaterTab();
        laterShowStatus("syncStatus", res?.ok ? "✓ Synced — your data is on your provider now. A backup snapshot was saved first." : `⚠ ${res?.error ?? "Sync failed — local data is untouched."}`);
      } catch (err) {
        laterShowStatus("syncStatus", err instanceof Error ? err.message : String(err));
      }
    })();
  });
  // --- Sync: download (confirm-first: it replaces local data) ---
  el("syncPull")?.addEventListener("click", () => {
    void (async () => {
      const ok = window.confirm(
        "Download the provider copy?\n\nThis REPLACES your tasks, scripts and notes in this browser with the copy on your provider. Your current state is saved as a backup snapshot first, so you can restore it — but the download still overwrites what is here now.",
      );
      if (!ok) return;
      // A-53: reachability first — the provider origin must be granted
      // or the background fetch is CORS-blocked.
      const access = await ensureSyncHostAccess(laterSync);
      if (!access.ok) {
        laterShowStatus("syncStatus", access.error ?? "Sync cannot reach the provider.");
        return;
      }
      laterShowStatus("syncStatus", "Downloading from your provider…");
      try {
        const res = (await chrome.runtime.sendMessage({ type: MSG_SYNC_PULL })) as { ok?: boolean; error?: string } | null;
        await refreshLaterTab();
        void loadCounts();
        laterShowStatus("syncStatus", res?.ok ? "✓ Downloaded — your data now matches the provider copy. Your previous state was saved as a snapshot first." : `⚠ ${res?.error ?? "Download failed — local data is untouched."}`);
      } catch (err) {
        laterShowStatus("syncStatus", err instanceof Error ? err.message : String(err));
      }
    })();
  });
  // --- Live refresh: a run log line, a schedule change, or a sync
  // result written while this tab is open re-renders the Later tab. ---
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== "local") return;
      if (changes["hiddengemflow.schedules.v1"] || changes["hiddengemflow.schedules.runs.v1"] || changes["hiddengemflow.sync.v1"]) {
        void refreshLaterTab();
      }
    });
  } catch {
    // Storage events unavailable — the tab still refreshes on switch.
  }
  void refreshLaterTab();
}
