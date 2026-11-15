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
  TASKS_KEY,
  buildFaviconUrl,
  createTask,
  deleteTask,
  formatOpenResult,
  letterFor,
  loadTasks,
  openUrlsViaBackground,
  saveTasks,
  searchTasks,
  sortTasks,
  togglePin,
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

declare const chrome: any;

const SCRIPTS_KEY = "hiddengemflow.scripts.v1";
const POS_KEY = "hiddengemflow.floating.pos";

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

async function loadCounts(): Promise<void> {
  let tasks = 0;
  let scripts = 0;
  try {
    const data = await chrome.storage.local.get([SCRIPTS_KEY]);
    scripts = countOf(data?.[SCRIPTS_KEY]);
    tasks = (await loadTasks()).length;
  } catch {
    // Outside the extension context: stay at honest zeros.
  }
  const t = document.getElementById("stat-tasks");
  const s = document.getElementById("stat-scripts");
  const f = document.getElementById("footCount");
  if (t) t.textContent = String(tasks);
  if (s) s.textContent = String(scripts);
  if (f) f.textContent = `${tasks} task sites · ${scripts} scripts`;
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
  if (!VALID_TABS.includes(name)) name = "overview";
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
      renderScripts();
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
let editingId: string | null = null;
let searchQuery = "";
const selected = new Set<string>();

// Phase 4 state that initTabs() may touch during module evaluation
// (selectTab on a #hash calls refreshLogs / refreshScriptBridgeBanner
// before the section declarations below run), so it lives up here.
const VALID_TABS = ["overview", "tasks", "scripts", "store", "logs", "settings"];
let currentTabName = "overview";
let logsTimer: number | null = null;
let bridgeHostname: string | null = null;

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
  const visible = sortTasks(searchTasks(tasks, searchQuery));
  const list = el("taskList");
  const empty = el("taskEmpty");
  const count = el("taskCount");
  const selectAll = el<HTMLInputElement>("selectAllTasks");
  const openSelected = el<HTMLButtonElement>("openSelected");
  const openAll = el<HTMLButtonElement>("openAllTasks");

  if (count) {
    count.textContent =
      tasks.length === 0
        ? ""
        : searchQuery
          ? `${visible.length} of ${tasks.length} task sites`
          : `${tasks.length} task site${tasks.length === 1 ? "" : "s"}`;
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

    li.append(check, openBtn, pinBtn, editBtn, delBtn);
    list.appendChild(li);
  }

  if (visible.length === 0 && tasks.length > 0 && empty) {
    empty.hidden = false;
    empty.textContent = "No task sites match that search.";
  } else if (tasks.length === 0 && empty) {
    empty.textContent = "No task sites saved yet — add your first one above.";
  }
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
  if (cancelBtn) cancelBtn.hidden = true;
  if (saveBtn) saveBtn.textContent = "Save task";
  showError("");
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

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput?.value ?? "";
    const url = urlInput?.value ?? "";
    try {
      if (editingId) {
        tasks = updateTask(tasks, editingId, { name, url });
      } else {
        // Unreleased: createTask gets the current list, so a URL that is
        // already saved is rejected with "This site is already saved."
        tasks = sortTasks([...tasks, createTask(name, url, Date.now(), undefined, tasks)]);
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
    const visible = sortTasks(searchTasks(tasks, searchQuery));
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

  void loadTasks().then((loaded) => {
    tasks = loaded;
    refreshUI();
    void loadCounts();
  });

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
    });
  } catch {
    // Storage events unavailable — the tab-switch reload still applies.
  }
}

initTabs();
initReset();
initUpdateChecker();
initTasks();
initScripts();
initStore();
initLogs();
void loadCounts();

// ---------------------------------------------------------------------------
// Scripts — Script Manager (Phase 3)
// ---------------------------------------------------------------------------

let scripts: Script[] = [];
let scriptErrors: Record<string, string> = {};
let editingScriptId: string | null = null;
let pendingScriptSource: ScriptSource = "manual";
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
  const meta = parseMetadata(code);
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
  if (meta.updateURL) lines.push(`<strong>Update URL:</strong> <code>${escapeHtml(meta.updateURL)}</code>`);
  if (meta.downloadURL) lines.push(`<strong>Download URL:</strong> <code>${escapeHtml(meta.downloadURL)}</code>`);
  box.innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
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
    count.textContent =
      scripts.length === 0
        ? ""
        : `${scripts.length} installed · ${scripts.filter((s) => s.enabled).length} enabled`;
  }
  if (empty) empty.hidden = scripts.length !== 0;
  if (!list) return;
  list.innerHTML = "";
  for (const script of scripts) {
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

    li.append(head, metaLine);

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

    actions.append(editBtn, histBtn, updateBtn, expJsBtn, expTxtBtn, delBtn);
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
  await unregisterScript(script.id);
  await persistScripts();
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
  if (scanBox) {
    scanBox.hidden = true;
    scanBox.innerHTML = "";
  }
  if (confirmBtn) confirmBtn.hidden = true;
  showScriptEditorError("");
  card.hidden = false;
  renderMeta(editor.value);
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
      if (editingScriptId) {
        scripts = updateScriptCode(scripts, editingScriptId, code);
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
        const created = createScript(code, pendingScriptSource, Date.now(), undefined, pendingFallbackName ?? undefined);
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

  urlBtn?.addEventListener("click", async () => {
    const raw = (urlInput?.value ?? "").trim();
    if (!raw) {
      showScriptImportError("Enter a script URL first.");
      return;
    }
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      showScriptImportError("That URL does not look valid.");
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      showScriptImportError("Only http(s) URLs can be fetched.");
      return;
    }
    showScriptImportError("");
    try {
      const res = await fetch(url.href);
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
      const code = await res.text();
      if (!code.trim()) throw new Error("The URL returned an empty file.");
      loadCodeIntoEditor(code, "import");
    } catch (err) {
      showScriptImportError(`Could not fetch that URL: ${err instanceof Error ? err.message : String(err)}`);
    }
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
  renderScripts();
  if (editor) renderMeta(editor.value);
  await refreshScriptEngineBanner();

  // Live-test fix (v1.0.1, bug #3) — same staleness as tasks: a script
  // toggled from the floating window (or installed elsewhere) while this
  // page is open must show up without a reload. Listener + tab-switch
  // reload in selectTab, mirroring the tasks fix above.
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== "local") return;
      if (changes[SCRIPTS_KEY] || changes[SCRIPT_ERRORS_KEY]) {
        void (async () => {
          scripts = await loadScripts();
          scriptErrors = await loadScriptErrors();
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
