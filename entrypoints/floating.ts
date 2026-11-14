import { defineContentScript } from "wxt/sandbox";
import {
  ALLOW_USER_SCRIPTS_STEPS,
  MSG_OPEN_EXTENSION_DETAILS,
  MSG_SCRIPTS_STATUS,
  MSG_TOGGLE_SCRIPT,
  SCRIPTS_KEY,
  SCRIPT_ERRORS_KEY,
  scriptsForUrl,
  type Script,
} from "./shared/scripts";
import {
  BRIDGE_MESSAGE,
  dismissBridgeForHostname,
  findStoreScriptsForUrl,
  hostnameOf,
  isBridgeDismissed,
  loadBridgeDismissed,
  loadStoreCache,
} from "./shared/store";
import {
  MSG_GET_ACTIVE_TAB,
  TASKS_KEY,
  buildFaviconUrl,
  createTask,
  formatOpenResult,
  letterFor,
  loadTasks,
  openUrlsViaBackground,
  saveTasks,
  sortTasks,
  type Task,
} from "./shared/tasks";

// HiddenGem Flow — floating window (Phase 4: + Smart Notification Bridge).
//
// Injected ONLY on demand: the background service worker loads this file
// into the active tab with chrome.scripting.executeScript when the user
// clicks the toolbar icon. It is registered with `registration: "runtime"`,
// so it never appears in the manifest and the extension needs no host
// permissions.
//
// The whole UI lives in a Shadow DOM, so the host page's CSS and JS cannot
// break it (and it cannot break the host page). Position is saved in
// chrome.storage.local and restored on the next inject.
//
// Phase 2 adds Daily Tasks to the window: "Add current site" (the active
// tab's title + URL come from the background, because a content script
// cannot call chrome.tabs), a top-5 pinned-first list, and Open All.
// Every tab open goes through the background, which staggers the tabs.
//
// Phase 3 adds Active Scripts: the enabled scripts whose @match patterns
// match this tab's URL, each with a toggle. The window cannot call
// chrome.userScripts itself, so status + toggles go through the
// background; when "Allow User Scripts" is off, the guidance banner
// shows instead of the list.

declare const chrome: any;

const FLAG = "__hiddenGemFlowLoaded";
const POS_KEY = "hiddengemflow.floating.pos";
const WIDTH = 320;

// LIVE TEST FIX (v1.0.1, bug #4): section refreshers + storage listener.
// The Daily Tasks and Active Scripts sections were rendered once at
// injection and never refreshed: a script installed in the dashboard (or
// a task saved there, or site access granted) never appeared in an
// already-open floating window until the page was reloaded. The live
// test injected the floating, installed a script, granted site access,
// and the floating still listed no scripts. Each section registers its
// re-run here; the refreshers fire (a) when the window is shown again
// after being hidden (toggleWindow) and (b) live, on storage changes
// (listener registered once in buildWindow).
const floatingRefreshers: Array<() => Promise<void>> = [];
let floatingStorageListenerAdded = false;

function runFloatingRefreshers(): void {
  for (const refresh of floatingRefreshers) {
    refresh().catch(() => {
      // Refresh is best-effort — a failed re-read must not break the window.
    });
  }
}

interface Pos {
  x: number;
  y: number;
}

const GEM_SVG = `<svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true"><path d="M16 2 28 12 16 30 4 12Z" fill="#00D084"/><path d="M16 2 22 12 16 30 10 12Z" fill="#0AAE74"/><path d="M16 2 28 12 16 12Z" fill="#5FE3B0"/><path d="M13 4C15 9 20 13 20 18s-5 8-7 10" fill="none" stroke="#FFC24B" stroke-width="2" stroke-linecap="round"/></svg>`;

const GITHUB_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`;
const GITHUB_URL = "https://github.com/BidyutRoy2/hiddengem-flow-store";

const CSS = `
:host { all: initial; }
.hgf { position: fixed; width: ${WIDTH}px; z-index: 2147483647; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 14px; line-height: 1.45; color: #E8FFF3; background: #12181A; border: 1px solid #2A3B32; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.55); overflow: hidden; }
.hgf header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #0A0F0D; cursor: grab; user-select: none; touch-action: none; }
.hgf header:active { cursor: grabbing; }
.hgf header .title { font-weight: 700; font-size: 14px; letter-spacing: .2px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hgf header button { all: unset; cursor: pointer; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; color: #9DB8AC; font-size: 15px; line-height: 1; }
.hgf header button:hover { background: #1E2A24; color: #E8FFF3; }
.hgf .body { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.hgf .body.min { display: none; }
.hgf .site { font-size: 12px; color: #9DB8AC; word-break: break-all; }
.hgf section h3 { margin: 0 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .8px; color: #00D084; }
.hgf section p { margin: 0; color: #C9DCD2; }
.hgf section .phase { color: #8A9B91; font-size: 12px; }
.hgf .dash { all: unset; cursor: pointer; text-align: center; background: #00D084; color: #06281B; font-weight: 700; padding: 9px 12px; border-radius: 9px; }
.hgf .dash:hover { background: #19E292; }
.hgf .foot { font-size: 11px; color: #6E8378; text-align: center; }
.hgf .gh { display: inline-flex; align-items: center; gap: 5px; color: #9DB8AC; text-decoration: none; font-weight: 600; }
.hgf .gh:hover { color: #00D084; }
.hgf .mini-add { all: unset; cursor: pointer; display: block; width: 100%; text-align: center; background: transparent; border: 1px solid #2A3B32; color: #E8FFF3; font-weight: 600; padding: 7px 10px; border-radius: 9px; box-sizing: border-box; }
.hgf .mini-add:hover { border-color: #00D084; }
.hgf .mini-form { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.hgf .mini-form[hidden] { display: none; }
.hgf .mini-form input { all: unset; box-sizing: border-box; width: 100%; background: #0A0F0D; border: 1px solid #2A3B32; border-radius: 8px; color: #E8FFF3; padding: 7px 9px; font-size: 13px; }
.hgf .mini-form input:focus { border-color: #00D084; }
.hgf .mini-err { color: #FF9A8A; font-size: 12px; }
.hgf .mini-err[hidden] { display: none; }
.hgf .mini-row { display: flex; gap: 6px; }
.hgf .mini-save { all: unset; cursor: pointer; flex: 1; text-align: center; background: #00D084; color: #06281B; font-weight: 700; padding: 7px 10px; border-radius: 8px; }
.hgf .mini-cancel { all: unset; cursor: pointer; text-align: center; background: transparent; border: 1px solid #2A3B32; color: #E8FFF3; font-weight: 600; padding: 7px 10px; border-radius: 8px; }
.hgf .task-mini { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 164px; overflow-y: auto; }
.hgf .task-mini li { display: flex; align-items: center; gap: 8px; }
.hgf .task-mini button { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; padding: 4px 6px; border-radius: 7px; }
.hgf .task-mini button:hover { background: #1A2620; }
.hgf .task-mini .fav { position: relative; flex-shrink: 0; width: 22px; height: 22px; display: grid; place-items: center; background: #1E2A24; color: #00D084; font-weight: 700; font-size: 12px; border-radius: 6px; overflow: hidden; }
.hgf .task-mini .fav img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #1E2A24; }
.hgf .task-mini .nm { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hgf .task-mini .pin { color: #FFC24B; flex-shrink: 0; font-size: 12px; }
.hgf .open-all { all: unset; cursor: pointer; display: block; width: 100%; box-sizing: border-box; text-align: center; background: transparent; border: 1px solid #00D084; color: #00D084; font-weight: 700; padding: 7px 10px; border-radius: 9px; margin-top: 8px; }
.hgf .open-all:hover { background: #123B2C; }
.hgf .open-all:disabled { opacity: .45; cursor: not-allowed; }
.hgf .open-status { color: #8A9B91; font-size: 12px; margin: 6px 0 0; }
.hgf .open-status[hidden] { display: none; }
.hgf .us-status { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 12px; flex-wrap: wrap; }
.hgf .us-status .on { color: #00D084; font-weight: 700; }
.hgf .us-status .off { color: #FFC24B; font-weight: 700; }
.hgf .us-enable { all: unset; cursor: pointer; background: transparent; border: 1px solid #FFC24B; color: #FFC24B; font-weight: 700; padding: 5px 9px; border-radius: 7px; white-space: nowrap; }
.hgf .us-enable:hover { background: #2A1F0A; }
.hgf .us-enable[hidden] { display: none; }
.hgf .view-all { display: block; text-align: center; margin-top: 6px; color: #9DB8AC; font-size: 12px; cursor: pointer; text-decoration: none; }
.hgf .view-all:hover { color: #00D084; }
.hgf .empty { color: #8A9B91; font-size: 12px; margin-top: 6px; }
.hgf .script-mini { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 164px; overflow-y: auto; }
.hgf .script-mini li { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 7px; }
.hgf .script-mini li:hover { background: #1A2620; }
.hgf .script-mini .nm { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.hgf .script-mini .ver { color: #9DB8AC; font-size: 12px; flex-shrink: 0; }
.hgf .script-mini input { accent-color: #00D084; width: 15px; height: 15px; flex-shrink: 0; cursor: pointer; }
.hgf .script-banner { background: #2A1F0A; border: 1px solid #FFC24B; border-radius: 9px; padding: 8px 10px; font-size: 12px; color: #E8FFF3; margin-top: 6px; }
.hgf .script-banner[hidden] { display: none; }
.hgf .script-note { color: #8A9B91; font-size: 12px; margin-top: 6px; }
.hgf .bridge { background: #2A1F0A; border: 1px solid #FFC24B; border-radius: 9px; padding: 10px; font-size: 12px; color: #E8FFF3; }
.hgf .bridge[hidden] { display: none; }
.hgf .bridge p { margin: 0 0 8px; }
.hgf .bridge-row { display: flex; gap: 6px; }
.hgf .bridge-open { all: unset; cursor: pointer; flex: 1; text-align: center; background: #FFC24B; color: #3A2A00; font-weight: 700; padding: 6px 8px; border-radius: 7px; }
.hgf .bridge-dismiss { all: unset; cursor: pointer; text-align: center; background: transparent; border: 1px solid #2A3B32; color: #E8FFF3; font-weight: 600; padding: 6px 10px; border-radius: 7px; }
`; 

function clampPos(pos: Pos): Pos {
  const maxX = Math.max(0, window.innerWidth - WIDTH - 8);
  const maxY = Math.max(0, window.innerHeight - 60);
  return {
    x: Math.min(Math.max(8, pos.x), maxX),
    y: Math.min(Math.max(8, pos.y), maxY),
  };
}

async function loadPos(): Promise<Pos> {
  const fallback: Pos = { x: window.innerWidth - WIDTH - 16, y: 72 };
  try {
    const data = await chrome.storage.local.get(POS_KEY);
    const saved = data?.[POS_KEY];
    if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
      return clampPos(saved);
    }
  } catch {
    // Storage unavailable (rare) — fall back to the default corner.
  }
  return clampPos(fallback);
}

async function savePos(pos: Pos): Promise<void> {
  try {
    await chrome.storage.local.set({ [POS_KEY]: pos });
  } catch {
    // Non-fatal: the window just won't remember its spot this time.
  }
}

/**
 * Daily Tasks inside the floating window (Phase 2).
 *
 * The window shows the top 5 saved tasks (pinned first). "Add current
 * site" asks the background for the active tab (a content script cannot
 * call chrome.tabs) and prefills an inline mini-form. Every open goes
 * through the background, which staggers the tabs.
 */
async function initFloatingTasks(win: HTMLElement): Promise<void> {
  const q = <T extends HTMLElement>(sel: string): T | null => win.querySelector(sel) as T | null;
  const list = q<HTMLUListElement>('[data-list="tasks"]');
  const empty = q<HTMLElement>('[data-empty="tasks"]');
  const openAllBtn = q<HTMLButtonElement>('[data-act="open-all"]');
  const openStatus = q<HTMLElement>('[data-status="open"]');
  const addBtn = q<HTMLButtonElement>('[data-act="add-current"]');
  const viewAll = q<HTMLElement>('[data-act="view-all"]');
  const form = q<HTMLElement>('[data-form="add-task"]');
  const nameInput = q<HTMLInputElement>('[data-in="name"]');
  const urlInput = q<HTMLInputElement>('[data-in="url"]');
  const errBox = q<HTMLElement>('[data-err="add-task"]');
  const saveBtn = q<HTMLButtonElement>('[data-act="save-task"]');
  const cancelBtn = q<HTMLButtonElement>('[data-act="cancel-task"]');

  let tasks: Task[] = [];

  function showFormError(message: string): void {
    if (!errBox) return;
    if (message) {
      errBox.textContent = message;
      errBox.hidden = false;
    } else {
      errBox.textContent = "";
      errBox.hidden = true;
    }
  }

  /** Unreleased: show the open result ("Opened 3 tabs." / "Opened 50 tabs. 10 skipped (50 open at a time)."). */
  function showOpenStatus(message: string): void {
    if (!openStatus) return;
    if (message) {
      openStatus.textContent = message;
      openStatus.hidden = false;
    } else {
      openStatus.textContent = "";
      openStatus.hidden = true;
    }
  }

  function render(): void {
    if (!list) return;
    const top = sortTasks(tasks).slice(0, 5);
    if (empty) empty.hidden = tasks.length !== 0;
    if (openAllBtn) openAllBtn.disabled = tasks.length === 0;
    list.innerHTML = "";
    for (const task of top) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = `Open ${task.name} in a new tab`;

      const fav = document.createElement("span");
      fav.className = "fav";
      fav.textContent = letterFor(task.name);
      const favUrl = task.favicon ?? buildFaviconUrl(task.url);
      if (favUrl) {
        const img = document.createElement("img");
        img.src = favUrl;
        img.alt = "";
        img.addEventListener("error", () => img.remove());
        fav.appendChild(img);
      }

      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = task.name;
      btn.append(fav, nm);
      if (task.pinned) {
        const pin = document.createElement("span");
        pin.className = "pin";
        pin.textContent = "★";
        btn.append(pin);
      }
      btn.addEventListener("click", () => {
        void openUrlsViaBackground([task.url]).then(async (result) => {
          showOpenStatus(result.ok ? formatOpenResult(result) : "Could not open the tab — try again.");
          tasks = await loadTasks();
          render();
        });
      });
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  async function refresh(): Promise<void> {
    tasks = await loadTasks();
    render();
  }

  addBtn?.addEventListener("click", async () => {
    showFormError("");
    let tab: { ok?: boolean; title?: string; url?: string; error?: string } | null = null;
    try {
      tab = await chrome.runtime.sendMessage({ type: MSG_GET_ACTIVE_TAB });
    } catch {
      tab = null;
    }
    if (!tab?.ok || !tab.url) {
      showFormError(tab?.error ? String(tab.error) : "Could not read the current tab.");
      if (form) form.hidden = false;
      return;
    }
    if (nameInput) nameInput.value = tab.title ?? tab.url;
    if (urlInput) urlInput.value = tab.url;
    if (form) form.hidden = false;
    nameInput?.focus();
    nameInput?.select();
  });

  saveBtn?.addEventListener("click", async () => {
    try {
      // Unreleased: the current list is passed, so a URL that is already
      // saved is rejected with "This site is already saved."
      const task = createTask(nameInput?.value ?? "", urlInput?.value ?? "", Date.now(), undefined, tasks);
      tasks = [...tasks, task];
      await saveTasks(tasks);
    } catch (err) {
      showFormError(err instanceof Error ? err.message : "That URL does not look valid.");
      return;
    }
    if (form) form.hidden = true;
    if (nameInput) nameInput.value = "";
    if (urlInput) urlInput.value = "";
    showFormError("");
    render();
  });

  cancelBtn?.addEventListener("click", () => {
    if (form) form.hidden = true;
    showFormError("");
  });

  openAllBtn?.addEventListener("click", () => {
    void openUrlsViaBackground(sortTasks(tasks).map((t) => t.url)).then(async (result) => {
      showOpenStatus(result.ok ? formatOpenResult(result) : "Could not open the tabs — try again.");
      tasks = await loadTasks();
      render();
    });
  });

  viewAll?.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "hiddengemflow:open-dashboard" });
  });

  await refresh();
  // Live-test fix (v1.0.1, bug #4): re-run on show / on storage change.
  floatingRefreshers.push(refresh);
}

/**
 * Active Scripts inside the floating window (Phase 3).
 *
 * The floating window cannot call chrome.userScripts itself, so it asks
 * the background for the status (is "Allow User Scripts" on?) and the
 * installed scripts, then shows the enabled ones whose @match patterns
 * match this tab's URL. Toggles go back through the background, which
 * registers/unregisters that one script.
 */
async function initFloatingScripts(win: HTMLElement): Promise<void> {
  const q = <T extends HTMLElement>(sel: string): T | null => win.querySelector(sel) as T | null;
  const list = q<HTMLUListElement>('[data-list="scripts"]');
  const empty = q<HTMLElement>('[data-empty="scripts"]');
  const banner = q<HTMLElement>('[data-banner="userscripts"]');
  const note = q<HTMLElement>('[data-note="scripts"]');
  // Unreleased: live "User Scripts: ON / OFF" status + a button that opens
  // the extension's Details page, where the user flips the toggle.
  const usText = q<HTMLElement>('[data-us-text]');
  const usEnable = q<HTMLButtonElement>('[data-act="us-enable"]');
  if (!list) return;
  const listEl: HTMLUListElement = list; // keeps the null-guard inside refresh()

  // The button only OPENS the Details page — no extension can flip the
  // toggle itself (Chrome requires a human click). Wired once here, not
  // in refresh(), so it survives re-renders.
  usEnable?.addEventListener("click", async () => {
    try {
      const res = (await chrome.runtime.sendMessage({ type: MSG_OPEN_EXTENSION_DETAILS })) as { ok?: boolean; error?: string } | null;
      if (res?.ok) return;
      throw new Error(res?.error ?? "Could not open the extensions page.");
    } catch {
      if (usEnable) {
        usEnable.disabled = true;
        usEnable.textContent = "Could not open — open chrome://extensions yourself";
      }
    }
  });

  interface StatusResponse {
    ok?: boolean;
    available?: boolean;
    error?: string;
    scripts?: Script[];
    // Live-test fix (v1.0.1): per-script host access, from the
    // background. A matching script without site access is registered
    // but never runs — the note below says so instead of pretending.
    hostAccess?: Record<string, boolean>;
  }
  let res: StatusResponse | null = null;
  try {
    res = (await chrome.runtime.sendMessage({ type: MSG_SCRIPTS_STATUS })) as StatusResponse;
  } catch {
    res = null;
  }

  const all: Script[] = Array.isArray(res?.scripts) ? (res!.scripts as Script[]) : [];

  // Live-test fix (v1.0.1, bug #4): the previous version returned early
  // here while "Allow User Scripts" was off, so the refresher (registered
  // at the end of this function) was never registered and the section
  // stayed frozen — empty list, empty note — even after the toggle was
  // turned on and a script was installed. The early return is gone:
  // refresh() re-checks availability on every run, so a later refresh
  // heals the banner and the list together.
  async function refresh(): Promise<void> {
    let fresh: StatusResponse | null = null;
    try {
      fresh = (await chrome.runtime.sendMessage({ type: MSG_SCRIPTS_STATUS })) as StatusResponse;
    } catch {
      fresh = null;
    }
    const nowAvailable = fresh?.ok === true && fresh?.available === true;
    if (banner) banner.hidden = nowAvailable;
    // Unreleased: the status line re-checks on every refresh (show-toggle
    // and storage changes), so flipping the toggle and coming back
    // heals it without a page reload.
    if (usText) {
      usText.textContent = nowAvailable ? "User Scripts: ON" : "User Scripts: OFF";
      usText.className = nowAvailable ? "on" : "off";
    }
    if (usEnable) usEnable.hidden = nowAvailable;
    if (!nowAvailable) {
      listEl.innerHTML = "";
      if (empty) {
        empty.hidden = false;
        empty.textContent = "Scripts are paused until user scripts are allowed.";
      }
      if (note) note.hidden = true;
      return;
    }
    const scripts: Script[] = Array.isArray(fresh?.scripts) ? (fresh!.scripts as Script[]) : all;
    const matching = scriptsForUrl(scripts.filter((s) => s.enabled), location.href);
    const installed = scripts.length;
    listEl.innerHTML = "";
    for (const script of matching) {
      const li = document.createElement("li");
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = script.name;
      nm.title = script.matches.join(", ");
      const ver = document.createElement("span");
      ver.className = "ver";
      ver.textContent = `v${script.version}`;
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = true;
      toggle.title = `Disable ${script.name} on this page`;
      toggle.setAttribute("aria-label", `Enable ${script.name}`);
      toggle.addEventListener("change", async () => {
        try {
          await chrome.runtime.sendMessage({ type: MSG_TOGGLE_SCRIPT, id: script.id, enabled: toggle.checked });
        } catch {
          toggle.checked = !toggle.checked;
        }
        await refresh();
      });
      li.append(toggle, nm, ver);
      listEl.appendChild(li);
    }
    if (empty) {
      empty.hidden = matching.length !== 0;
      empty.textContent =
        installed === 0
          ? "No scripts installed yet."
          : "No scripts match this page.";
    }
    if (note) {
      note.hidden = installed === 0;
      const needsAccess = matching.filter((s) => fresh?.hostAccess?.[s.id] === false);
      const base = installed > 0 ? `${installed} installed · ${matching.length} match${matching.length === 1 ? "" : "es"} this page` : "";
      note.textContent =
        needsAccess.length > 0
          ? `${base} · ${needsAccess.length} need${needsAccess.length === 1 ? "s" : ""} site access — Dashboard → Scripts → Grant site access`
          : base;
    }
  }

  // Re-run on show / on storage change (bug #4). The early return that
  // used to sit above this line (while "Allow User Scripts" was off)
  // skipped this push — the refresh function now handles the paused
  // state itself, so this line is always reached.
  floatingRefreshers.push(refresh);
  await refresh();
}

/**
 * Smart Notification Bridge (Phase 4) — floating window side.
 *
 * Reads the CACHED store index only (loadStoreCache) — no network
 * fetch on every page. If a store script's @match patterns match this
 * tab's URL and the banner was not dismissed for this hostname, the
 * banner shows at the top of the floating body. It never installs
 * anything: "Open Script Store" opens the dashboard to the Script Store
 * tab, and Dismiss stores the hostname in
 * hiddengemflow.bridge.dismissed.v1 (survives reload).
 */
async function initFloatingBridge(win: HTMLElement): Promise<void> {
  const q = <T extends HTMLElement>(sel: string): T | null => win.querySelector(sel) as T | null;
  const banner = q<HTMLElement>('[data-bridge]');
  if (!banner) return;
  const url = location.href;
  const hostname = hostnameOf(url);
  if (!hostname) return;
  let dismissed: Record<string, number> = {};
  try {
    dismissed = await loadBridgeDismissed();
  } catch {
    dismissed = {};
  }
  if (isBridgeDismissed(dismissed, hostname)) return;
  let cache: Awaited<ReturnType<typeof loadStoreCache>> = null;
  try {
    cache = await loadStoreCache();
  } catch {
    cache = null;
  }
  if (!cache) return; // No cached store yet — no banner, no network fetch.
  const matched = findStoreScriptsForUrl(cache.index.scripts, url);
  if (matched.length === 0) return;
  banner.hidden = false;

  const openBtn = q<HTMLButtonElement>('[data-act="bridge-open"]');
  const dismissBtn = q<HTMLButtonElement>('[data-act="bridge-dismiss"]');
  openBtn?.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "hiddengemflow:open-dashboard", tab: "store" });
  });
  dismissBtn?.addEventListener("click", async () => {
    try {
      await dismissBridgeForHostname(hostname);
    } catch {
      // Non-fatal: the banner still hides for this open.
    }
    banner.hidden = true;
  });
}

function buildWindow(): HTMLElement {
  // Live-test fix (v1.0.1, bug #4): a fresh window for this tab — drop
  // the previous window's refreshers (they render into a removed DOM
  // tree) and keep a single storage listener for the tab's lifetime.
  floatingRefreshers.length = 0;
  if (!floatingStorageListenerAdded) {
    floatingStorageListenerAdded = true;
    try {
      chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
        if (areaName !== "local") return;
        if (changes[TASKS_KEY] || changes[SCRIPTS_KEY] || changes[SCRIPT_ERRORS_KEY]) {
          runFloatingRefreshers();
        }
      });
    } catch {
      // Storage events unavailable — the show-toggle refresh still applies.
    }
  }

  const host = document.createElement("div");
  host.id = "hiddengem-flow-root";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = CSS;
  shadow.appendChild(style);

  const win = document.createElement("div");
  win.className = "hgf";
  win.innerHTML = `
    <header>
      ${GEM_SVG}
      <span class="title">HiddenGem Flow</span>
      <button type="button" data-act="min" title="Minimize" aria-label="Minimize">–</button>
      <button type="button" data-act="close" title="Close" aria-label="Close">✕</button>
    </header>
    <div class="body">
      <div class="bridge" data-bridge hidden>
        <p>${BRIDGE_MESSAGE}</p>
        <div class="bridge-row">
          <button type="button" class="bridge-open" data-act="bridge-open">Open Script Store</button>
          <button type="button" class="bridge-dismiss" data-act="bridge-dismiss">Dismiss</button>
        </div>
      </div>
      <div class="site" data-site></div>
      <section>
        <h3>Daily Tasks</h3>
        <button type="button" class="mini-add" data-act="add-current">＋ Add current site</button>
        <div class="mini-form" data-form="add-task" hidden>
          <input type="text" data-in="name" placeholder="Name" autocomplete="off" maxlength="120" aria-label="Site name" />
          <input type="text" data-in="url" placeholder="URL" autocomplete="off" inputmode="url" maxlength="2048" aria-label="Site URL" />
          <p class="mini-err" data-err="add-task" hidden></p>
          <div class="mini-row">
            <button type="button" class="mini-save" data-act="save-task">Save</button>
            <button type="button" class="mini-cancel" data-act="cancel-task">Cancel</button>
          </div>
        </div>
        <ul class="task-mini" data-list="tasks"></ul>
        <p class="empty" data-empty="tasks">No task sites saved yet — add your first one above.</p>
        <button type="button" class="open-all" data-act="open-all">Open All</button>
        <p class="open-status" data-status="open" hidden></p>
        <a class="view-all" data-act="view-all">View all in Dashboard →</a>
      </section>
      <section>
        <h3>Active Scripts</h3>
        <div class="us-status" data-us-status>
          <span data-us-text>User Scripts: checking…</span>
          <button type="button" class="us-enable" data-act="us-enable" hidden>Open extension details to enable</button>
        </div>
        <p class="script-banner" data-banner="userscripts" hidden><strong>Allow User Scripts</strong> is off — scripts are saved but never run. Enable it: ${ALLOW_USER_SCRIPTS_STEPS}</p>
        <ul class="script-mini" data-list="scripts"></ul>
        <p class="empty" data-empty="scripts">No scripts installed yet.</p>
        <p class="script-note" data-note="scripts" hidden></p>
      </section>
      <button type="button" class="dash">Open Dashboard</button>
      <div class="foot">HiddenGem Flow v1.0.0<br><a class="gh" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">${GITHUB_SVG} GitHub — hiddengem-flow-store</a></div>
    </div>
  `;
  shadow.appendChild(win);

  // AUDIT A-01 (v1.0.0): the site line used to be interpolated into
  // win.innerHTML. location.hostname cannot contain markup, but the
  // location.href fallback could — and markup here would run in the
  // extension's isolated world. Set it as text instead.
  const siteEl = win.querySelector("[data-site]");
  if (siteEl) siteEl.textContent = `On: ${location.hostname || location.href}`;

  const header = win.querySelector("header") as HTMLElement;
  const body = win.querySelector(".body") as HTMLElement;
  const minBtn = win.querySelector('[data-act="min"]') as HTMLElement;
  const closeBtn = win.querySelector('[data-act="close"]') as HTMLElement;
  const dashBtn = win.querySelector(".dash") as HTMLElement;

  // --- Drag (Pointer Events on the header only) ---
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let baseX = 0;
  let baseY = 0;

  function posOf(): Pos {
    return {
      x: Number.parseInt(win.style.left || "0", 10) || 0,
      y: Number.parseInt(win.style.top || "0", 10) || 0,
    };
  }

  header.addEventListener("pointerdown", (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const p = posOf();
    baseX = p.x;
    baseY = p.y;
    header.setPointerCapture(e.pointerId);
  });
  header.addEventListener("pointermove", (e: PointerEvent) => {
    if (!dragging) return;
    const next = clampPos({ x: baseX + (e.clientX - startX), y: baseY + (e.clientY - startY) });
    win.style.left = `${next.x}px`;
    win.style.top = `${next.y}px`;
  });
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    try {
      header.releasePointerCapture(e.pointerId);
    } catch {
      // Already released — harmless.
    }
    void savePos(posOf());
  };
  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);

  // --- Buttons ---
  minBtn.addEventListener("click", () => {
    const hidden = body.classList.toggle("min");
    minBtn.textContent = hidden ? "+" : "–";
  });
  closeBtn.addEventListener("click", () => {
    host.remove();
  });
  dashBtn.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "hiddengemflow:open-dashboard" });
  });

  // --- Daily Tasks (Phase 2) ---
  void initFloatingTasks(win);

  // --- Active Scripts (Phase 3) ---
  void initFloatingScripts(win);

  // --- Smart Notification Bridge (Phase 4) ---
  void initFloatingBridge(win);

  // Restore saved position, then show.
  void loadPos().then((pos) => {
    win.style.left = `${pos.x}px`;
    win.style.top = `${pos.y}px`;
  });

  return host;
}

function toggleWindow(): void {
  const existing = document.getElementById("hiddengem-flow-root");
  if (existing) {
    // Already injected: show if hidden, hide if visible. Showing
    // re-reads storage first (bug #4 fix): the Tasks and Scripts
    // sections were rendered at inject time and would otherwise stay
    // stale after a dashboard change (script installed, site access
    // granted, task saved) until the page was reloaded.
    const wasHidden = existing.style.display === "none";
    existing.style.display = wasHidden ? "" : "none";
    if (wasHidden) runFloatingRefreshers();
    return;
  }
  document.documentElement.appendChild(buildWindow());
}

export default defineContentScript({
  // Runtime registration: this file is built to content-scripts/floating.js
  // but is NOT listed in the manifest. The background injects it on demand
  // (activeTab), so no host permissions are needed.
  registration: "runtime",
  matches: ["https://*/*", "http://*/*"],
  main() {
    const w = window as unknown as Record<string, unknown>;
    // Injected twice (double-click)? Keep a single listener and one window.
    if (w[FLAG]) return;
    w[FLAG] = true;

    chrome.runtime.onMessage.addListener((message: { type?: string }) => {
      if (message?.type === "hiddengemflow:toggle") toggleWindow();
    });

    // First inject opens the window immediately.
    toggleWindow();
  },
});
