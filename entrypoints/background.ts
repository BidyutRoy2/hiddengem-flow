import { defineBackground } from "wxt/sandbox";
import { checkUserScripts, ensureGmRelayForEnabled, reregisterEnabledFromStorage, scriptHasHostAccess, setScriptEnabled } from "./shared/engine";
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
import {
  MSG_GM_NOTIFY,
  MSG_OPEN_EXTENSION_DETAILS,
  MSG_SCRIPTS_STATUS,
  MSG_TOGGLE_SCRIPT,
  loadScripts,
  scriptsForUrl,
  type Script,
} from "./shared/scripts";
import { MSG_GET_ACTIVE_TAB, MSG_OPEN_URLS, loadTasks, markOpened, normalizeUrl, saveTasks } from "./shared/tasks";
import { MSG_CHECK_UPDATES, checkForUpdates } from "./shared/updates";

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
//
// MV3 service workers are killed after ~30s idle, so nothing stateful
// lives here — all state is in chrome.storage.local.

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

/**
 * Open the standalone floating window as a popup. If one is already
 * open, focus it instead of opening a duplicate. Returns the window id,
 * or null when creation failed.
 */
async function openFloatPopup(): Promise<number | null> {
  if (floatWindowId !== null) {
    try {
      await chrome.windows.get(floatWindowId);
      try {
        await chrome.windows.update(floatWindowId, { focused: true });
      } catch {
        // Focusing failed — the window exists but cannot be focused;
        // still better than opening a duplicate.
      }
      return floatWindowId;
    } catch {
      // Stale id (window closed without the onRemoved event firing
      // first) — fall through and create a fresh popup.
      floatWindowId = null;
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
  const url = typeof tab?.url === "string" ? tab.url : "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    if (typeof tab.id === "number") {
      const ok = await toggleFloating(tab.id);
      if (ok) return;
      // Injection failed on an http(s) page — fall through to popup.
    }
  }
  await openFloatPopup();
}

export default defineBackground(() => {
  chrome.action.onClicked.addListener((tab: { id?: number; url?: string }) => {
    void handleToolbarClick(tab);
  });

  // Forget the popup window id when the user closes the popup, so the
  // next toolbar click creates a fresh one instead of focusing a dead id.
  try {
    chrome.windows.onRemoved.addListener((windowId: number) => {
      if (windowId === floatWindowId) floatWindowId = null;
    });
  } catch {
    // windows events unavailable — openFloatPopup re-validates the id
    // with chrome.windows.get before focusing, so a stale id is safe.
  }

  chrome.runtime.onMessage.addListener(
    (message: { type?: string; urls?: unknown; id?: string; enabled?: boolean; title?: string; message?: string; tab?: string; force?: boolean }, _sender: unknown, sendResponse: (r: unknown) => void) => {
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
      return false;
    },
  );

  chrome.runtime.onInstalled.addListener(() => {
    console.info("[HiddenGem Flow] installed — v1.1.0");
    void reregisterEnabledFromStorage();
    void ensureGmRelayForEnabled();
    // Unreleased: update check on install — gated inside checkForUpdates
    // (at most once per 6h), silent on failure.
    void checkForUpdates().catch(() => {
      // Silent by design — no banner, no error.
    });
  });

  chrome.runtime.onStartup.addListener(() => {
    void reregisterEnabledFromStorage();
    void ensureGmRelayForEnabled();
    void checkForUpdates().catch(() => {
      // Same gate, same silence as on install.
    });
  });

  // Finding A-04: host access granted AFTER a script was registered
  // (dashboard "Grant site access") must re-attempt the GM relay
  // registration for that script's patterns — registration throws
  // while the pattern is ungranted, so the grant event is the retry.
  try {
    chrome.permissions.onAdded.addListener(() => {
      void ensureGmRelayForEnabled();
    });
  } catch {
    // permissions events unavailable — startup/registration retries cover it.
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

  // A queued/running run whose tab closes early becomes "failed".
  // Done runs are untouched — closing a finished tab is normal.
  chrome.tabs.onRemoved.addListener((tabId: number) => {
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
});
