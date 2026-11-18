// HiddenGem Flow — shared floating-page UI (v1.2.1).
//
// ONE module mounts the 3-tab floating UI (Daily Tasks / Scripts /
// Notepad) into any extension page: the standalone popup window
// (entrypoints/float) AND the native side panel (entrypoints/
// sidepanel). The two surfaces share this module — the UI is not
// duplicated. The in-page floating window (entrypoints/floating.ts,
// Shadow DOM + drag + bridge) keeps its own rendering: it runs in a
// page's Shadow DOM, not in an extension page, so sharing its DOM
// code would mean abstracting over two different hosts for no gain.
// What IS shared everywhere: the data modules (tasks, scripts,
// notes, float-layout, backup, window-mode) and the notes + layout
// UI modules (shared/notes-ui.ts, shared/float-layout-ui.ts).
//
// The DOM is built from a template string (same pattern as
// floating.ts) and wired here. All user text is set with textContent
// (AUDIT A-01 rule) — the only innerHTML is the static template,
// which contains no user data.
//
// Differences between the surfaces, passed as options:
//  * popup: "Add current site" is disabled (there is no site to add
//    from a standalone window — same as v1.0.2); ✕ closes the window.
//  * sidepanel: "Add current site" WORKS — the panel is docked next
//    to a real tab, and the active tab is read with chrome.tabs.query
//    from this extension page. The Scripts tab matches scripts
//    against that tab's URL. There is no in-UI ✕: Chrome's own panel
//    header provides the close button, and there is no
//    chrome.sidePanel.close() API to call — the design mockup's ✕ is
//    the native one. Switching away closes the panel via the
//    background (setOptions disable/re-enable, best-effort).

import "./float-page.css";
import {
  MSG_OPEN_EXTENSION_DETAILS,
  MSG_SCRIPTS_STATUS,
  MSG_TOGGLE_SCRIPT,
  SCRIPTS_KEY,
  SCRIPT_ERRORS_KEY,
  scriptsForUrl,
  type Script,
} from "./scripts";
import {
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
} from "./tasks";
import { BACKUP_KEY, formatBackupChip, loadBackupState } from "./backup";
import { NOTES_KEY } from "./notes";
import {
  OPEN_TABS_KEY,
  closeOpenTaskTabs,
  createCloseOpenTabsButton,
  createOpenBadge,
  focusOpenTaskTabs,
  loadOpenTabs,
  openTabsCount,
} from "./open-tabs";
import { mountFloatNotes } from "./notes-ui";
import {
  FLOAT_LAYOUT_KEY,
  effectiveDefaultTab,
  loadFloatLayout,
  type FloatLayout,
  type FloatTabId,
} from "./float-layout";
import { applyFloatLayoutToTabs, mountFloatLayoutEditor } from "./float-layout-ui";
import { UPDATE_KEY, isUpdateAvailable, loadUpdateRecord } from "./updates";
import {
  MSG_OPEN_MODE,
  OPEN_TAB_HINT_KEY,
  WINDOW_MODE_KEY,
  clearOpenTabHint,
  loadWindowMode,
  openSidePanelForCurrentWindow,
  readOpenTabHint,
  saveWindowMode,
  windowModeLabel,
  type WindowMode,
} from "./window-mode";
import { RELEASES_PAGE_URL } from "./updates";

declare const chrome: any;

export interface FloatPageOptions {
  /** Which surface this page is. */
  surface: "popup" | "sidepanel";
  /** The line under the header (what this surface is). */
  siteLine: string;
  /** "Add current site" enabled? Popup: no. Side panel: yes (active tab). */
  addCurrentSite: boolean;
  /** Show the ✕ close button? Popup: yes (window.close). Side panel: no (Chrome's panel header has it). */
  showClose: boolean;
}

const GEM_SVG = `<svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true"><path d="M16 2 28 12 16 30 4 12Z" fill="#00D084"/><path d="M16 2 22 12 16 30 10 12Z" fill="#0AAE74"/><path d="M16 2 28 12 16 12Z" fill="#5FE3B0"/><path d="M13 4C15 9 20 13 20 18s-5 8-7 10" fill="none" stroke="#FFC24B" stroke-width="2" stroke-linecap="round"/></svg>`;

const DOWNLOAD_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;

/** The static page markup — no user data in this template (AUDIT A-01). */
function pageTemplate(opts: FloatPageOptions): string {
  const badge = opts.surface === "sidepanel" ? `<span class="mode-badge">SIDE PANEL</span>` : "";
  const closeBtn = opts.showClose
    ? `<button type="button" data-act="close" title="Close" aria-label="Close">✕</button>`
    : "";
  const addCurrent = opts.addCurrentSite
    ? `<button type="button" class="mini-add" data-act="add-current">＋ Add current site</button>`
    : `<button type="button" class="mini-add" data-act="add-current" disabled>＋ Add current site</button>
          <p class="hint">No website is open here, so “Add current site” is off — add one by hand below, or open a website and click the toolbar icon again.</p>`;
  return `
    <div class="hgf-page">
      <header>
        ${GEM_SVG}
        <span class="title">HiddenGem Flow</span>
        ${badge}
        <span class="switch-wrap">
          <button type="button" class="switch-btn" data-act="switch" title="Switch window mode" aria-label="Switch window mode">⇄ Switch</button>
          <span class="switch-menu" data-switch-menu hidden>
            <button type="button" class="sw-row" data-mode="floating">▣ Floating window</button>
            <button type="button" class="sw-row" data-mode="sidepanel">▤ Side Panel</button>
            <button type="button" class="sw-row" data-mode="popup">▢ Popup window</button>
          </span>
        </span>
        ${closeBtn}
      </header>
      <div class="body">
        <button type="button" class="upd-line" data-update hidden></button>
        <p class="switch-hint" data-switch-hint hidden></p>
        <div class="site">${opts.siteLine}</div>
        <div class="tabs" data-tabs>
          <button type="button" data-float-tab="tasks" class="active">Daily Tasks</button>
          <button type="button" data-float-tab="scripts">Scripts</button>
          <button type="button" data-float-tab="notes">Notepad</button>
        </div>
        <section class="panel" data-panel="tasks">
          <h3>Daily Tasks</h3>
          ${addCurrent}
          <button type="button" class="mini-add" data-act="add-task">＋ Add a task</button>
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
          <p class="empty" data-empty="tasks">No task sites saved yet — add one above, or from the Dashboard.</p>
          <button type="button" class="open-all" data-act="open-all">Open All</button>
          <p class="open-status" data-status="open" hidden></p>
          <a class="view-all" data-act="view-all">View all in Dashboard →</a>
        </section>
        <section class="panel" data-panel="scripts" hidden>
          <h3>Active Scripts</h3>
          <div class="us-status" data-us-status>
            <span data-us-text>User Scripts: checking…</span>
            <button type="button" class="us-enable" data-act="us-enable" hidden>Open extension details to enable</button>
          </div>
          <p class="script-banner" data-banner="userscripts" hidden><strong>Allow User Scripts</strong> is off — scripts are saved but never run. Enable it: chrome://extensions → HiddenGem Flow → Details → Allow User Scripts (toggle ON), then reload the page.</p>
          <ul class="script-mini" data-list="scripts"></ul>
          <p class="empty" data-empty="scripts">No scripts installed yet.</p>
          <p class="script-note" data-note="scripts" hidden></p>
        </section>
        <section class="panel" data-panel="notes" hidden>
          <h3>Notepad</h3>
          <div data-notes-list-view>
            <input type="text" class="note-search" data-notes-search placeholder="Search notes… (title, text, or tag)" autocomplete="off" aria-label="Search notes" />
            <button type="button" class="note-new" data-notes-new>＋ New note</button>
            <ul class="note-list" data-notes-list></ul>
            <p class="empty" data-notes-empty>No notes yet — tap + New note to write your first one.</p>
            <p class="note-count" data-notes-count hidden></p>
            <a class="view-all" data-notes-viewall>View all in Dashboard →</a>
          </div>
          <div class="note-editor" data-notes-editor hidden>
            <h3 data-notes-editor-title>New note</h3>
            <label>Title</label>
            <input type="text" class="note-title-in" data-notes-title placeholder="Title" autocomplete="off" maxlength="120" aria-label="Note title" />
            <label>Note</label>
            <textarea class="note-body-in" data-notes-body rows="5" placeholder="Write it down…" aria-label="Note text"></textarea>
            <p class="note-md-hint">Markdown works here: # heading, **bold**, [text](https://…), - bullet, - [ ] checklist. Ticking a linked checklist item completes its task.</p>
            <label>Due date (optional — feeds reminders)</label>
            <input type="datetime-local" class="note-due-in" data-notes-due aria-label="Note due date" />
            <label>Linked task (optional)</label>
            <select class="note-task-sel" data-notes-task aria-label="Task this note is attached to"></select>
            <div class="note-checklist-links" data-notes-checklist-links></div>
            <label>Brand</label>
            <div class="brand-row" data-notes-brand>
              <button type="button" class="brand-pick" data-brand="HiddenGem">◆ HiddenGem</button>
              <button type="button" class="brand-pick" data-brand="Personal">Personal</button>
              <button type="button" class="brand-pick" data-brand="Work">Work</button>
            </div>
            <label>Tags</label>
            <div class="tag-edit" data-notes-tags>
              <input type="text" class="tag-add" data-notes-tag-input placeholder="+ add a tag" autocomplete="off" maxlength="20" aria-label="Add a tag" />
            </div>
            <div class="note-save-row">
              <button type="button" class="note-save" data-notes-save>Save note</button>
              <button type="button" class="note-cancel" data-notes-cancel>Cancel</button>
            </div>
            <p class="note-local">Saved on this browser only — notes never leave your computer.</p>
          </div>
        </section>
        <div class="layout-panel" data-layout-panel hidden></div>
        <a class="edit-layout" data-act="edit-layout">✎ Edit layout</a>
        <button type="button" class="dash">Open Dashboard</button>
        <div class="foot">HiddenGem Flow v3.0.0<br><a class="download-btn" href="${RELEASES_PAGE_URL}" target="_blank" rel="noopener noreferrer" title="Download the latest HiddenGem Flow build">${DOWNLOAD_SVG} Download HiddenGem Flow</a><p class="backup-line" data-backup-line></p></div>
      </div>
    </div>
  `;
}

/** The active tab of this window (side panel only — the popup has no real tab). Null when unavailable. */
async function getActiveTab(): Promise<{ title: string; url: string } | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    if (!tab || typeof tab.url !== "string" || !tab.url) return null;
    return { title: typeof tab.title === "string" && tab.title ? tab.title : tab.url, url: tab.url };
  } catch {
    return null;
  }
}

function q<T extends HTMLElement>(root: Document | HTMLElement, sel: string): T | null {
  return root.querySelector(sel) as T | null;
}

/**
 * Mount the floating-page UI into `root` (usually `document`).
 * Builds the DOM, wires every control, and starts the live refresh
 * (storage changes + focus). Call once per page.
 */
export function mountFloatPage(root: Document | HTMLElement, opts: FloatPageOptions): void {
  const host = document.createElement("div");
  host.innerHTML = pageTemplate(opts);
  const page = host.firstElementChild as HTMLElement | null;
  if (!page) return;
  (root === document ? document.body : root).appendChild(page);

  // --- Tabs + Notepad + Edit layout (findings A-09 + A-10) ---
  let currentLayout: FloatLayout = { order: ["tasks", "scripts", "notes"], hidden: [], defaultTab: "tasks" };
  let currentFloatTab: FloatTabId = "tasks";
  let layoutEditing = false;

  function selectFloatTab(name: string): void {
    currentFloatTab = name as FloatTabId;
    root.querySelectorAll<HTMLElement>("[data-float-tab]").forEach((b) => {
      b.classList.toggle("active", b.dataset.floatTab === name);
    });
    root.querySelectorAll<HTMLElement>("[data-panel]").forEach((p) => {
      p.hidden = layoutEditing || p.dataset.panel !== name;
    });
    const layoutPanel = q<HTMLElement>(root, "[data-layout-panel]");
    if (layoutPanel) layoutPanel.hidden = !layoutEditing;
  }

  function renderFloatTabs(): void {
    const active = applyFloatLayoutToTabs(root, currentLayout, currentFloatTab, layoutEditing);
    selectFloatTab(active);
  }

  root.querySelectorAll<HTMLElement>("[data-float-tab]").forEach((b) => {
    b.addEventListener("click", () => {
      if (layoutEditing) return;
      selectFloatTab(b.dataset.floatTab ?? "tasks");
    });
  });

  const notesHandle = mountFloatNotes(root, () => {
    void chrome.runtime.sendMessage({ type: "hiddengemflow:open-dashboard", tab: "notes" }).catch(() => {
      // Dashboard open failed — nothing else to do from here.
    });
  });

  const layoutHandle = mountFloatLayoutEditor(root, {
    onOpen: () => {
      layoutEditing = true;
      renderFloatTabs();
    },
    onClose: (applied, saved) => {
      layoutEditing = false;
      if (applied) {
        currentLayout = saved;
        currentFloatTab = effectiveDefaultTab(saved);
      }
      renderFloatTabs();
    },
    onExternalChange: (changed) => {
      currentLayout = changed;
      renderFloatTabs();
    },
  });

  void loadFloatLayout().then((loaded) => {
    currentLayout = loaded;
    currentFloatTab = effectiveDefaultTab(loaded);
    renderFloatTabs();
    // One-shot open-tab hint (quick-note, Alt+Shift+N): open the
    // hinted tab once, then clear it so the next open is normal.
    void readOpenTabHint().then((hint) => {
      if (!hint) return;
      void clearOpenTabHint();
      if (hint === "tasks" || hint === "scripts" || hint === "notes") selectFloatTab(hint);
    });
  });

  // --- Daily Tasks ---
  let tasks: Task[] = [];

  function showOpenStatus(message: string): void {
    const status = q<HTMLElement>(root, '[data-status="open"]');
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
  }

  async function renderTasks(): Promise<void> {
    const list = q<HTMLUListElement>(root, '[data-list="tasks"]');
    const empty = q<HTMLElement>(root, '[data-empty="tasks"]');
    const openAllBtn = q<HTMLButtonElement>(root, '[data-act="open-all"]');
    if (!list) return;
    try {
      tasks = await loadTasks();
    } catch {
      tasks = [];
    }
    const sorted = sortTasks(tasks);
    if (empty) empty.hidden = tasks.length !== 0;
    if (openAllBtn) openAllBtn.disabled = tasks.length === 0;
    // v1.2.1: open-tabs map — which tasks have tabs open right now
    // (session storage; this is an extension page, so it is readable
    // here directly).
    const openMap = await loadOpenTabs();
    list.innerHTML = "";
    for (const task of sorted) {
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
        void openUrlsViaBackground([task.url]).then((result) => {
          showOpenStatus(result.ok ? formatOpenResult(result) : "Could not open the tab — try again.");
        });
      });
      li.appendChild(btn);
      // v1.2.1: an open task gets its ● Open badge (focuses the tab)
      // and ✕ Close (closes exactly those tabs), and the emerald row
      // border. Both re-render after the action; the session onChanged
      // listener below refreshes the row either way.
      const openCount = openTabsCount(openMap, task.id);
      if (openCount > 0) {
        li.classList.add("open");
        li.appendChild(
          createOpenBadge(openCount, () => {
            void focusOpenTaskTabs(task.id).then(() => void renderTasks());
          }),
        );
        li.appendChild(
          createCloseOpenTabsButton(() => {
            void closeOpenTaskTabs(task.id).then(() => void renderTasks());
          }),
        );
      }
      list.appendChild(li);
    }
    if (openAllBtn) {
      openAllBtn.onclick = () => {
        void openUrlsViaBackground(sorted.map((t) => t.url)).then((result) => {
          showOpenStatus(result.ok ? formatOpenResult(result) : "Could not open the tabs — try again.");
        });
      };
    }
  }

  // --- Active Scripts ---
  async function renderScripts(): Promise<void> {
    const list = q<HTMLUListElement>(root, '[data-list="scripts"]');
    const empty = q<HTMLElement>(root, '[data-empty="scripts"]');
    const banner = q<HTMLElement>(root, '[data-banner="userscripts"]');
    const note = q<HTMLElement>(root, '[data-note="scripts"]');
    if (!list) return;
    interface StatusResponse {
      ok?: boolean;
      available?: boolean;
      error?: string;
      scripts?: Script[];
      hostAccess?: Record<string, boolean>;
    }
    let res: StatusResponse | null = null;
    try {
      res = (await chrome.runtime.sendMessage({ type: MSG_SCRIPTS_STATUS })) as StatusResponse;
    } catch {
      res = null;
    }
    const available = res?.ok === true && res?.available === true;
    const usText = q<HTMLElement>(root, "[data-us-text]");
    const usEnable = q<HTMLButtonElement>(root, '[data-act="us-enable"]');
    if (usText) {
      usText.textContent = available ? "User Scripts: ON" : "User Scripts: OFF";
      usText.className = available ? "on" : "off";
    }
    if (usEnable) usEnable.hidden = available;
    if (banner) banner.hidden = available;
    if (!available) {
      list.innerHTML = "";
      if (empty) {
        empty.hidden = false;
        empty.textContent = "Scripts are paused until user scripts are allowed.";
      }
      if (note) note.hidden = true;
      return;
    }
    const scripts: Script[] = Array.isArray(res?.scripts) ? (res!.scripts as Script[]) : [];
    const enabled = scripts.filter((s) => s.enabled);
    // Side panel: there IS a page open (the active tab) — show the
    // scripts that match it, like the in-page window does. Popup: no
    // website open, so list every enabled script and say so.
    let shown: Script[] = enabled;
    let matchNote = "";
    if (opts.surface === "sidepanel") {
      const tab = await getActiveTab();
      if (tab) {
        shown = scriptsForUrl(enabled, tab.url);
        matchNote = `${scripts.length} installed · ${shown.length} match${shown.length === 1 ? "" : "es"} the open tab`;
      } else {
        matchNote = `${scripts.length} installed · ${enabled.length} enabled — no tab to match against`;
      }
    } else {
      matchNote = `${scripts.length} installed · ${enabled.length} enabled — no website open, so scripts are listed, not matched to a page`;
    }
    list.innerHTML = "";
    for (const script of shown) {
      const li = document.createElement("li");
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = true;
      toggle.title = `Disable ${script.name}`;
      toggle.setAttribute("aria-label", `Enable ${script.name}`);
      toggle.addEventListener("change", async () => {
        try {
          await chrome.runtime.sendMessage({ type: MSG_TOGGLE_SCRIPT, id: script.id, enabled: toggle.checked });
        } catch {
          toggle.checked = !toggle.checked;
        }
        await renderScripts();
      });
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = script.name;
      nm.title = script.matches.join(", ");
      const ver = document.createElement("span");
      ver.className = "ver";
      ver.textContent = `v${script.version}`;
      li.append(toggle, nm, ver);
      list.appendChild(li);
    }
    if (empty) {
      empty.hidden = shown.length !== 0;
      empty.textContent =
        scripts.length === 0 ? "No scripts installed yet." : opts.surface === "sidepanel" ? "No scripts match the open tab." : "No scripts enabled.";
    }
    if (note) {
      note.hidden = scripts.length === 0;
      const needsAccess = shown.filter((s) => res?.hostAccess?.[s.id] === false);
      note.textContent =
        needsAccess.length > 0
          ? `${matchNote} · ${needsAccess.length} need${needsAccess.length === 1 ? "s" : ""} site access — Dashboard → Scripts → Grant site access`
          : matchNote;
    }
  }

  // --- Extension update line (same as the in-page window) ---
  async function renderUpdateLine(): Promise<void> {
    const line = q<HTMLButtonElement>(root, "[data-update]");
    if (!line) return;
    let record: Awaited<ReturnType<typeof loadUpdateRecord>> = null;
    try {
      record = await loadUpdateRecord();
    } catch {
      record = null;
    }
    if (!record || !isUpdateAvailable(record)) {
      line.hidden = true;
      line.textContent = "";
      return;
    }
    line.textContent = `Update available: ${record.tag} — open the Dashboard to download it.`;
    line.hidden = false;
  }

  // --- Backup line (v1.2.0): real last-backup time, never invented ---
  async function renderBackupLine(): Promise<void> {
    const line = q<HTMLElement>(root, "[data-backup-line]");
    if (!line) return;
    try {
      const state = await loadBackupState();
      line.textContent = formatBackupChip(state);
    } catch {
      line.textContent = "";
    }
  }

  // --- Switch menu (v1.2.0): current mode ✓, one setting, three modes ---
  const switchMenu = q<HTMLElement>(root, "[data-switch-menu]");
  const switchHint = q<HTMLElement>(root, "[data-switch-hint]");

  function hideMenu(): void {
    if (switchMenu) switchMenu.hidden = true;
  }

  function showSwitchHint(message: string): void {
    if (!switchHint) return;
    switchHint.textContent = message;
    switchHint.hidden = !message;
  }

  async function refreshModeMenu(): Promise<void> {
    if (!switchMenu) return;
    const current = await loadWindowMode();
    switchMenu.querySelectorAll<HTMLElement>("[data-mode]").forEach((row) => {
      const mode = row.dataset.mode as WindowMode;
      const isCurrent = mode === current;
      row.classList.toggle("sel", isCurrent);
      const label = windowModeLabel(mode);
      row.textContent = isCurrent ? `${label} ✓` : label;
    });
  }

  function closeSurface(): void {
    if (opts.surface === "popup") {
      try {
        window.close();
      } catch {
        // Already closing — nothing to do.
      }
    }
    // Side panel: no close API exists for the panel itself. The
    // background closes it (setOptions disable/re-enable) when the
    // stored mode changes away from "sidepanel" — see background.ts.
  }

  async function onSwitchMode(target: WindowMode): Promise<void> {
    hideMenu();
    const current = await loadWindowMode();
    if (target === current) return;
    if (target === "sidepanel") {
      // Extension page: this click IS a user gesture, so the panel
      // can be opened directly (the float's page click cannot).
      await saveWindowMode(target);
      const res = await openSidePanelForCurrentWindow();
      if (!res.ok) {
        showSwitchHint("Could not open the side panel — click the toolbar icon once to dock.");
      }
      return;
    }
    // Floating / popup: the background opens it (this surface closes).
    // Save the mode FIRST: the background's handleToolbarClick reads
    // the stored mode, so sending before saving would reopen the OLD
    // mode (the popup would close and no float would appear — caught
    // by probe27a). The message is fire-and-forget: this surface
    // closes right after (and the background closes it on the mode
    // change too), so its response would never arrive — awaiting it
    // would only surface a "port closed" error. The message itself
    // is delivered; the mode is saved, so the toolbar icon opens the
    // new mode next time even if the message is lost.
    await saveWindowMode(target);
    try {
      void chrome.runtime.sendMessage({ type: MSG_OPEN_MODE, mode: target }).catch(() => {
        // Background unreachable — the mode is saved, so the toolbar
        // icon opens the new mode next time.
      });
    } catch {
      // Same as above, synchronous failure.
    }
    closeSurface();
  }

  q<HTMLElement>(root, '[data-act="switch"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!switchMenu) return;
    switchMenu.hidden = !switchMenu.hidden;
    if (!switchMenu.hidden) void refreshModeMenu();
  });
  switchMenu?.querySelectorAll<HTMLElement>("[data-mode]").forEach((row) => {
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      void onSwitchMode(row.dataset.mode as WindowMode);
    });
  });
  document.addEventListener("click", (e) => {
    if (!switchMenu || switchMenu.hidden) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("[data-switch-menu], [data-act='switch']")) return;
    hideMenu();
  });

  function refreshAll(): void {
    void renderTasks().catch(() => {
      // Best-effort refresh — a failed re-read must not break the window.
    });
    void renderScripts().catch(() => {
      // Same as above.
    });
    void renderUpdateLine().catch(() => {
      // Same as above.
    });
    void renderBackupLine().catch(() => {
      // Same as above.
    });
    void refreshModeMenu().catch(() => {
      // Same as above.
    });
    void notesHandle?.refresh().catch(() => {
      // Same as above.
    });
    void layoutHandle?.refresh().catch(() => {
      // Same as above.
    });
  }

  // --- Buttons ---
  q<HTMLButtonElement>(root, '[data-act="close"]')?.addEventListener("click", () => {
    window.close();
  });
  q<HTMLButtonElement>(root, ".dash")?.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "hiddengemflow:open-dashboard" }).catch(() => {
      // Dashboard open failed — nothing else to do from here.
    });
  });
  q<HTMLElement>(root, '[data-act="view-all"]')?.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "hiddengemflow:open-dashboard" }).catch(() => {
      // Same as above.
    });
  });
  q<HTMLButtonElement>(root, '[data-act="add-task"]')?.addEventListener("click", () => {
    const form = q<HTMLElement>(root, '[data-form="add-task"]');
    if (form) form.hidden = false;
    q<HTMLInputElement>(root, '[data-in="name"]')?.focus();
  });
  q<HTMLButtonElement>(root, '[data-act="save-task"]')?.addEventListener("click", async () => {
    const errBox = q<HTMLElement>(root, '[data-err="add-task"]');
    const nameInput = q<HTMLInputElement>(root, '[data-in="name"]');
    const urlInput = q<HTMLInputElement>(root, '[data-in="url"]');
    const showErr = (msg: string): void => {
      if (!errBox) return;
      errBox.textContent = msg;
      errBox.hidden = !msg;
    };
    try {
      const task = createTask(nameInput?.value ?? "", urlInput?.value ?? "", Date.now(), undefined, tasks);
      await saveTasks([...tasks, task]);
    } catch (err) {
      showErr(err instanceof Error ? err.message : "That URL does not look valid.");
      return;
    }
    if (nameInput) nameInput.value = "";
    if (urlInput) urlInput.value = "";
    showErr("");
    const form = q<HTMLElement>(root, '[data-form="add-task"]');
    if (form) form.hidden = true;
    await renderTasks();
  });
  q<HTMLButtonElement>(root, '[data-act="cancel-task"]')?.addEventListener("click", () => {
    const form = q<HTMLElement>(root, '[data-form="add-task"]');
    if (form) form.hidden = true;
    const errBox = q<HTMLElement>(root, '[data-err="add-task"]');
    if (errBox) {
      errBox.textContent = "";
      errBox.hidden = true;
    }
  });

  // "Add current site" — side panel only (the popup's button is
  // disabled in the template, so it has no handler on purpose).
  if (opts.addCurrentSite) {
    q<HTMLButtonElement>(root, '[data-act="add-current"]')?.addEventListener("click", async () => {
      const errBox = q<HTMLElement>(root, '[data-err="add-task"]');
      const showErr = (msg: string): void => {
        if (!errBox) return;
        errBox.textContent = msg;
        errBox.hidden = !msg;
      };
      showErr("");
      const tab = await getActiveTab();
      const form = q<HTMLElement>(root, '[data-form="add-task"]');
      const nameInput = q<HTMLInputElement>(root, '[data-in="name"]');
      const urlInput = q<HTMLInputElement>(root, '[data-in="url"]');
      if (!tab) {
        showErr("Could not read the current tab.");
        if (form) form.hidden = false;
        return;
      }
      if (nameInput) nameInput.value = tab.title;
      if (urlInput) urlInput.value = tab.url;
      if (form) form.hidden = false;
      nameInput?.focus();
      nameInput?.select();
    });
  }

  // The "Open extension details to enable" button. It only OPENS the
  // Details page; the toggle itself still needs a human click there.
  q<HTMLButtonElement>(root, '[data-act="us-enable"]')?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement | null;
    try {
      const res = (await chrome.runtime.sendMessage({ type: MSG_OPEN_EXTENSION_DETAILS })) as { ok?: boolean; error?: string } | null;
      if (res?.ok) return;
      throw new Error(res?.error ?? "Could not open the extensions page.");
    } catch {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Could not open — open chrome://extensions yourself";
      }
    }
  });

  q<HTMLButtonElement>(root, "[data-update]")?.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "hiddengemflow:open-dashboard" }).catch(() => {
      // Dashboard open failed — nothing else to do from here.
    });
  });

  // Re-check when the page regains focus — the user may have just
  // flipped the toggle on the Details page and come back.
  window.addEventListener("focus", () => {
    refreshAll();
  });

  // Live-update while the page stays open (same pattern as the dashboard).
  try {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      // v1.2.1: the open-tabs map lives in storage.session — a tab
      // opened, closed or navigated elsewhere refreshes every row.
      if (areaName === "session" && changes[OPEN_TABS_KEY]) {
        void refreshAll();
        return;
      }
      if (areaName !== "local") return;
      // v1.2.0: one-shot open-tab hint (quick-note while this page is
      // already open) — select the hinted tab once, then clear it.
      if (changes[OPEN_TAB_HINT_KEY]) {
        void readOpenTabHint().then((hint) => {
          if (!hint) return;
          void clearOpenTabHint();
          if (hint === "tasks" || hint === "scripts" || hint === "notes") selectFloatTab(hint);
        });
      }
      if (
        changes[TASKS_KEY] ||
        changes[SCRIPTS_KEY] ||
        changes[SCRIPT_ERRORS_KEY] ||
        changes[UPDATE_KEY] ||
        changes[NOTES_KEY] ||
        changes[FLOAT_LAYOUT_KEY] ||
        changes[BACKUP_KEY] ||
        changes[WINDOW_MODE_KEY]
      ) {
        refreshAll();
      }
    });
  } catch {
    // Storage events unavailable — the initial render still applies.
  }

  void refreshAll();
}
