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
import { NOTES_KEY } from "./shared/notes";
import { mountFloatNotes } from "./shared/notes-ui";
import {
  FLOAT_LAYOUT_KEY,
  effectiveDefaultTab,
  loadFloatLayout,
  type FloatLayout,
  type FloatTabId,
} from "./shared/float-layout";
import { applyFloatLayoutToTabs, mountFloatLayoutEditor } from "./shared/float-layout-ui";
import { RELEASES_PAGE_URL, UPDATE_KEY, isUpdateAvailable, loadUpdateRecord } from "./shared/updates";
import { BACKUP_KEY, formatBackupChip, loadBackupState } from "./shared/backup";
import {
  MSG_OPEN_TABS_CHANGED,
  closeOpenTaskTabs,
  createCloseOpenTabsButton,
  createOpenBadge,
  focusOpenTaskTabs,
  openTabsCount,
  requestOpenTabs,
  type OpenTabsMap,
} from "./shared/open-tabs";
import {
  MSG_OPEN_MODE,
  WINDOW_MODE_KEY,
  clearOpenTabHint,
  loadWindowMode,
  readOpenTabHint,
  saveWindowMode,
  windowModeLabel,
  type WindowMode,
} from "./shared/window-mode";

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

// v1.2.0: the float that SET the side-panel mode keeps itself open
// with the hint; every OTHER open float removes itself when the mode
// changes to sidepanel/popup (see the storage listener in
// buildWindow). One-shot: cleared the first time the listener runs.
let suppressModeCloseOnce = false;
// v1.2.0: buildWindow's tab selector, for the show-path (toggleWindow
// + the one-shot open-tab hint) which lives outside buildWindow.
let currentSelectFloatTab: ((name: string) => void) | null = null;
// v1.2.0: the switch menu's document-level closer (registered once).
let currentSwitchMenu: HTMLElement | null = null;
let currentSwitchHost: HTMLElement | null = null;
let switchDocListenerAdded = false;

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

const DOWNLOAD_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;

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
.hgf .download-btn { display: inline-flex; align-items: center; gap: 5px; background: #00D084; color: #06281B; text-decoration: none; font-weight: 700; font-size: 12px; padding: 6px 12px; border-radius: 999px; margin-top: 4px; }
.hgf .download-btn:hover { background: #19E292; }
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
/* v1.2.1: an open task's row gets the emerald border + badge + close. */
.hgf .task-mini li.open { border: 1px solid #00D084; border-radius: 9px; padding: 2px 4px; }
.hgf .task-mini button.open-badge { flex: 0 0 auto; display: inline-block; background: #00D084; color: #06281C; font-size: 11px; font-weight: 800; border: none; border-radius: 20px; padding: 3px 8px; white-space: nowrap; }
.hgf .task-mini button.open-badge:hover { background: #00E08A; }
.hgf .task-mini button.close-btn { flex: 0 0 auto; display: inline-block; background: transparent; color: #FF7A7A; font-size: 11.5px; font-weight: 700; border: 1px solid #E5484D; border-radius: 8px; padding: 4px 8px; white-space: nowrap; }
.hgf .task-mini button.close-btn:hover { background: rgba(229, 72, 77, .15); }
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
.hgf .upd { all: unset; cursor: pointer; display: block; width: 100%; box-sizing: border-box; background: #2A1F0A; border: 1px solid #FFC24B; border-radius: 9px; padding: 8px 10px; font-size: 12px; color: #E8FFF3; text-align: left; }
.hgf .upd:hover { background: #3A2E12; }
.hgf .upd[hidden] { display: none; }
.hgf .bridge-row { display: flex; gap: 6px; }
.hgf .bridge-open { all: unset; cursor: pointer; flex: 1; text-align: center; background: #FFC24B; color: #3A2A00; font-weight: 700; padding: 6px 8px; border-radius: 7px; }
.hgf .bridge-dismiss { all: unset; cursor: pointer; text-align: center; background: transparent; border: 1px solid #2A3B32; color: #E8FFF3; font-weight: 600; padding: 6px 10px; border-radius: 7px; }
/* Tabs (finding A-09 — Notepad). The float shows one page at a time:
   Daily Tasks, Scripts, or Notepad. Panels are hidden, never removed,
   so switching tabs preserves each page's state. */
.hgf .tabs { display: flex; gap: 6px; padding: 0 12px; }
.hgf .tabs button { all: unset; cursor: pointer; flex: 1; text-align: center; padding: 7px 0; font-size: 12.5px; font-weight: 600; color: #9DB8AC; background: #12181A; border: 1px solid #2A3B32; border-radius: 8px; }
.hgf .tabs button.active { color: #06281B; background: #00D084; border-color: #00D084; }
.hgf .tabs button[hidden] { display: none; }
.hgf .tabs button.hidden-tab { opacity: .4; }
.hgf .panel[hidden] { display: none; }
.hgf .edit-layout { display: block; text-align: center; margin-top: 2px; color: #9DB8AC; font-size: 12px; cursor: pointer; text-decoration: none; }
.hgf .edit-layout:hover { color: #00D084; }
/* Edit layout (finding A-10) — same look as the approved design mockup. */
.hgf .layout-panel[hidden] { display: none; }
.hgf .layout-panel h3 { margin: 0 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .8px; color: #00D084; }
.hgf .layout-hint { color: #8A9B91; font-size: 12px; margin: 0 0 10px; line-height: 1.55; }
.hgf .layout-row { display: flex; align-items: center; gap: 10px; background: #12181A; border: 1px solid #2A3B32; border-radius: 9px; padding: 10px 11px; margin-bottom: 8px; }
.hgf .layout-row.off { opacity: .55; }
.hgf .layout-row.dragging { opacity: .5; }
.hgf .layout-row.drop-before { border-top: 2px solid #00D084; }
.hgf .layout-row.drop-after { border-bottom: 2px solid #00D084; }
.hgf .layout-grip { color: #6E8378; font-size: 15px; letter-spacing: 1px; cursor: grab; }
.hgf .layout-name { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 700; }
.hgf .layout-name small { display: block; font-size: 11px; color: #6E8378; font-weight: 400; margin-top: 1px; }
.hgf .layout-eye, .hgf .layout-star { all: unset; cursor: pointer; font-size: 17px; padding: 2px 4px; }
.hgf .layout-star { color: #6E8378; }
.hgf .layout-star.on { color: #FFC24B; }
.hgf .layout-save-row { display: flex; gap: 8px; margin-top: 12px; }
.hgf .layout-save { all: unset; cursor: pointer; flex: 1; text-align: center; background: #00D084; color: #06281B; font-weight: 700; padding: 9px 10px; border-radius: 9px; }
.hgf .layout-save:hover { background: #19E292; }
.hgf .layout-cancel { all: unset; cursor: pointer; text-align: center; background: transparent; border: 1px solid #2A3B32; color: #E8FFF3; font-weight: 600; padding: 9px 12px; border-radius: 9px; }
/* Notepad (finding A-09) — same look as the approved design mockup. */
.hgf .note-search { all: unset; box-sizing: border-box; width: 100%; background: #0A0F0D; border: 1px solid #2A3B32; border-radius: 8px; color: #E8FFF3; padding: 7px 9px; font-size: 13px; }
.hgf .note-search:focus { border-color: #00D084; }
.hgf .note-new { all: unset; cursor: pointer; display: block; width: 100%; box-sizing: border-box; text-align: center; background: #00D084; color: #06281B; font-weight: 700; padding: 8px 10px; border-radius: 9px; margin: 8px 0 10px; }
.hgf .note-new:hover { background: #19E292; }
.hgf .note-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow-y: auto; }
.hgf .note { background: #12181A; border: 1px solid #2A3B32; border-radius: 10px; padding: 9px 10px; }
.hgf .note.pinned { border-color: #FFC24B; }
.hgf .note-top { display: flex; align-items: center; gap: 6px; }
.hgf .note-pin-mark { color: #FFC24B; font-size: 12px; }
.hgf .note-title { font-weight: 700; font-size: 13.5px; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hgf .brand { font-size: 10.5px; font-weight: 700; letter-spacing: .4px; color: #FFC24B; border: 1px solid #FFC24B; border-radius: 20px; padding: 2px 7px; white-space: nowrap; }
.hgf .brand.gem { color: #00D084; border-color: #00D084; }
.hgf .note-tags { display: flex; flex-wrap: wrap; gap: 5px; margin: 7px 0 6px; }
.hgf .note-tag { font-size: 11px; color: #9FD8B8; background: #0A0F0D; border: 1px solid #2A3F33; border-radius: 20px; padding: 2px 8px; }
.hgf .note-body { font-size: 12.5px; line-height: 1.5; color: #C9DCD2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }
.hgf .note-foot { display: flex; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px solid #1B2620; }
.hgf .note-meta { font-size: 11px; color: #6E8378; flex: 1; }
.hgf .note-acts { display: flex; gap: 2px; }
.hgf .note-act { all: unset; cursor: pointer; color: #9DB8AC; font-size: 14px; padding: 4px 6px; border-radius: 6px; }
.hgf .note-act:hover { background: #1E2A24; color: #E8FFF3; }
.hgf .note-act.on { color: #FFC24B; }
.hgf .note-act.del:hover { color: #FF9A8A; }
.hgf .note-act.armed { background: #3A1512; color: #FF9A8A; font-size: 11px; font-weight: 700; padding: 4px 8px; }
.hgf .note-count { font-size: 12px; color: #8A9B91; text-align: center; margin: 2px 0 10px; }
.hgf .note-count[hidden] { display: none; }
.hgf .note-editor[hidden] { display: none; }
.hgf .note-editor label { display: block; font-size: 12px; font-weight: 600; color: #9DB8AC; margin: 10px 0 5px; }
.hgf .note-editor label:first-child { margin-top: 0; }
.hgf .note-title-in, .hgf .note-body-in { all: unset; box-sizing: border-box; width: 100%; background: #0A0F0D; border: 1px solid #2A3B32; border-radius: 8px; color: #E8FFF3; padding: 8px 9px; font-size: 13px; }
.hgf .note-title-in:focus, .hgf .note-body-in:focus { border-color: #00D084; }
.hgf .note-body-in { height: 110px; line-height: 1.55; resize: none; font-family: inherit; }
.hgf .brand-row { display: flex; gap: 6px; }
.hgf .brand-pick { all: unset; cursor: pointer; flex: 1; text-align: center; padding: 7px 0; font-size: 12px; font-weight: 700; border-radius: 20px; border: 1px solid #2A3B32; color: #9DB8AC; background: #12181A; }
.hgf .brand-pick.sel-gem { color: #00D084; border-color: #00D084; background: #0A0F0D; }
.hgf .brand-pick.sel-gold { color: #FFC24B; border-color: #FFC24B; background: #0A0F0D; }
.hgf .tag-edit { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.hgf .tag-edit .note-tag { cursor: pointer; }
.hgf .tag-add { all: unset; box-sizing: border-box; background: #0A0F0D; border: 1px dashed #2A3F33; color: #9DB8AC; border-radius: 20px; padding: 3px 8px; font-size: 11px; width: 92px; }
.hgf .note-save-row { display: flex; gap: 8px; margin-top: 12px; }
.hgf .note-save { all: unset; cursor: pointer; flex: 1; text-align: center; background: #00D084; color: #06281B; font-weight: 700; padding: 9px 10px; border-radius: 9px; }
.hgf .note-save:hover { background: #19E292; }
.hgf .note-cancel { all: unset; cursor: pointer; text-align: center; background: transparent; border: 1px solid #2A3B32; color: #E8FFF3; font-weight: 600; padding: 9px 12px; border-radius: 9px; }
.hgf .note-local { text-align: center; font-size: 11px; color: #6E8378; margin-top: 10px; }

/* v1.4: Markdown notes, due/link chips, checklist-link editor rows. */
.hgf .note-body.has-checklist { display: block; -webkit-line-clamp: unset; overflow: visible; }
.hgf .md-heading { margin: 8px 0 4px; }
.hgf .md-para { margin: 6px 0; }
.hgf .md-list { margin: 6px 0; padding-left: 20px; }
.hgf .md-list li { margin: 2px 0; }
.hgf .md-check { display: flex; gap: 8px; align-items: flex-start; padding: 5px 0; border-bottom: 1px solid #1B2620; font-size: 12.5px; }
.hgf .md-check:last-child { border-bottom: none; }
.hgf .md-check-box { accent-color: #00D084; width: 16px; height: 16px; margin-top: 2px; flex: 0 0 16px; cursor: pointer; }
.hgf .md-check.done .md-check-label { color: #6E8378; text-decoration: line-through; }
.hgf .md-check-link { margin-left: auto; font-size: 11px; color: #00D084; white-space: nowrap; }
.hgf .md-check code, .hgf .md-para code { background: #0A0F0D; border: 1px solid #2A3B32; border-radius: 4px; padding: 0 4px; font-size: 11.5px; }
.hgf .md-para a, .hgf .md-check-label a { color: #8AB4F8; }
.hgf .note-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 7px 0 2px; }
.hgf .note-due-chip { font-size: 11px; font-weight: 800; color: #06281C; background: #FFC24B; border-radius: 20px; padding: 3px 9px; }
.hgf .note-due-chip.overdue { background: #FF9A8A; }
.hgf .note-link-chip { font-size: 11px; font-weight: 700; color: #00D084; border: 1px solid #00D084; border-radius: 20px; padding: 3px 9px; }
.hgf .note-md-hint { font-size: 11px; color: #6E8378; margin: 4px 0 0; line-height: 1.5; }
.hgf .note-due-in, .hgf .note-task-sel { all: unset; box-sizing: border-box; width: 100%; background: #0A0F0D; border: 1px solid #2A3B32; border-radius: 8px; color: #E8FFF3; padding: 8px 9px; font-size: 13px; }
.hgf .note-checklist-head { font-size: 12px; color: #9DB8AC; margin: 10px 0 6px; }
.hgf .note-checklist-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.hgf .note-checklist-label { flex: 1; min-width: 0; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hgf .note-checklist-sel { all: unset; box-sizing: border-box; flex: 0 0 150px; background: #0A0F0D; border: 1px solid #2A3B32; border-radius: 8px; color: #E8FFF3; padding: 6px 8px; font-size: 12px; }

/* v1.2.0: 3-way window-mode switch (⇄ Switch menu in the header). */
.hgf .switch-wrap { position: relative; margin-left: auto; }
.hgf .switch-btn { all: unset; cursor: pointer; font-size: 11.5px; font-weight: 700; color: #FFC24B; border: 1px solid #FFC24B; border-radius: 20px; padding: 3px 9px; white-space: nowrap; }
.hgf .switch-btn:hover { background: #2A1F0A; }
.hgf .switch-menu { position: absolute; top: calc(100% + 8px); right: 0; width: 190px; z-index: 50; background: #1B2620; border: 1px solid #2A3F33; border-radius: 10px; padding: 6px; box-shadow: 0 10px 30px rgba(0,0,0,.55); }
.hgf .switch-menu[hidden] { display: none; }
.hgf .sw-row { all: unset; cursor: pointer; display: block; box-sizing: border-box; width: 100%; padding: 8px 11px; font-size: 12.5px; border-radius: 7px; color: #E8FFF3; text-align: left; }
.hgf .sw-row:hover { background: #223129; }
.hgf .sw-row.sel { background: #00D084; color: #06281C; font-weight: 700; }
.hgf .switch-hint { background: #2A1F0A; border: 1px solid #FFC24B; border-radius: 9px; padding: 8px 10px; font-size: 12px; color: #E8FFF3; margin: 0; }
.hgf .switch-hint[hidden] { display: none; }
/* v1.2.0: backup line in the footer (real values only). */
.hgf .backup-line { font-size: 12px; color: #9DB8AC; margin: 8px 0 0; }
.hgf .backup-line b { color: #00D084; }
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
  // v1.2.1: open-tabs map (taskId → tabIds), read from the background
  // — a content script cannot use chrome.storage.session, so the map
  // is fetched via MSG_OPEN_TABS_GET and refreshed on
  // MSG_OPEN_TABS_CHANGED (see main()).
  let openTabsMap: OpenTabsMap = {};

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
          // v1.2.1: refresh() re-reads the open-tabs map too, so the
          // badge appears on this row (the broadcast lands right after).
          void refresh();
        });
      });
      li.appendChild(btn);
      // v1.2.1: an open task gets its ● Open badge (focuses the tab)
      // and ✕ Close (closes exactly those tabs), and the emerald row
      // border. The background re-broadcasts the map after the action,
      // so the row refreshes itself; the explicit re-render is the
      // fast path when the broadcast has not landed yet.
      const openCount = openTabsCount(openTabsMap, task.id);
      if (openCount > 0) {
        li.classList.add("open");
        li.appendChild(
          createOpenBadge(openCount, () => {
            void focusOpenTaskTabs(task.id).then(() => void refresh());
          }),
        );
        li.appendChild(
          createCloseOpenTabsButton(() => {
            void closeOpenTaskTabs(task.id).then(() => void refresh());
          }),
        );
      }
      list.appendChild(li);
    }
  }

  async function refresh(): Promise<void> {
    tasks = await loadTasks();
    openTabsMap = await requestOpenTabs();
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
      // v1.2.1: refresh() re-reads the open-tabs map too, so every
      // opened task gets its badge (the broadcast lands right after).
      void refresh();
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

/**
 * Extension update line (Unreleased) — one compact line under the
 * header, only when a newer build was found. Reads the STORED check
 * record only (loadUpdateRecord) — the floating window never fetches
 * on its own; the background checks on startup/install and the
 * dashboard asks. Clicking opens the dashboard, where the banner has
 * the download link. Dismissing in the dashboard hides this line too
 * (same record, same dismiss key) until a newer release appears.
 */
async function initFloatingUpdate(win: HTMLElement): Promise<void> {
  const q = <T extends HTMLElement>(sel: string): T | null => win.querySelector(sel) as T | null;
  const line = q<HTMLButtonElement>("[data-update]");
  if (!line) return;
  const lineEl: HTMLButtonElement = line; // keeps the null-guard inside refresh()
  line.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "hiddengemflow:open-dashboard" });
  });

  async function refresh(): Promise<void> {
    let record: Awaited<ReturnType<typeof loadUpdateRecord>> = null;
    try {
      record = await loadUpdateRecord();
    } catch {
      record = null;
    }
    if (!record || !isUpdateAvailable(record)) {
      lineEl.hidden = true;
      lineEl.textContent = "";
      return;
    }
    lineEl.textContent = `Update available: ${record.tag} — open the Dashboard to download it.`;
    lineEl.hidden = false;
  }

  floatingRefreshers.push(refresh);
  await refresh();
}

/**
 * Window-mode switch menu (v1.2.0) — in-page floating window side.
 *
 * The menu lists the three modes with the current one checked. The
 * honest constraint: choosing Side Panel from HERE cannot open the
 * panel directly — Chrome needs a user gesture and a page click's
 * gesture does not survive the message to the background. So the
 * menu sets the mode, shows the hint ("click the toolbar icon once
 * to dock"), and keeps this window open. Choosing Popup asks the
 * background to open the popup window and closes this window.
 * Choosing Floating (already here) just closes the menu.
 */
async function initFloatingSwitch(win: HTMLElement, host: HTMLElement): Promise<void> {
  const q = <T extends HTMLElement>(sel: string): T | null => win.querySelector(sel) as T | null;
  const menu = q<HTMLElement>("[data-switch-menu]");
  const hint = q<HTMLElement>("[data-switch-hint]");
  const btn = q<HTMLButtonElement>('[data-act="switch"]');
  if (!menu || !btn) return;
  const menuEl: HTMLElement = menu;
  currentSwitchMenu = menuEl;
  currentSwitchHost = host;

  function hideMenu(): void {
    menuEl.hidden = true;
  }
  function showHint(message: string): void {
    if (!hint) return;
    hint.textContent = message;
    hint.hidden = !message;
  }
  async function refreshMenu(): Promise<void> {
    let current: WindowMode = "floating";
    try {
      current = await loadWindowMode();
    } catch {
      current = "floating";
    }
    menuEl.querySelectorAll<HTMLElement>("[data-mode]").forEach((row) => {
      const mode = row.dataset.mode as WindowMode;
      const isCurrent = mode === current;
      row.classList.toggle("sel", isCurrent);
      const label = windowModeLabel(mode);
      row.textContent = isCurrent ? `${label} ✓` : label;
    });
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuEl.hidden = !menuEl.hidden;
    if (!menuEl.hidden) void refreshMenu();
  });
  menuEl.querySelectorAll<HTMLElement>("[data-mode]").forEach((row) => {
    row.addEventListener("click", async (e) => {
      e.stopPropagation();
      hideMenu();
      const target = row.dataset.mode as WindowMode;
      let current: WindowMode = "floating";
      try {
        current = await loadWindowMode();
      } catch {
        current = "floating";
      }
      if (target === current) return;
      if (target === "floating") {
        // This window is already open — switching back just means
        // the toolbar opens floats again. Save the mode and clear
        // the hint (deep audit A-19: this row used to do nothing at
        // all when the mode was sidepanel/popup — a dead menu item).
        await saveWindowMode("floating");
        showHint("");
        return;
      }
      if (target === "sidepanel") {
        // Gesture rule (see the module header): this page click
        // cannot open the panel — set the mode, keep this window
        // open, and tell the user the one extra step. The suppress
        // flag stops this window's own storage listener from
        // removing it on the mode change.
        suppressModeCloseOnce = true;
        await saveWindowMode(target);
        showHint("Mode set to Side Panel — click the toolbar icon once to dock.");
        return;
      }
      if (target === "popup") {
        await saveWindowMode(target);
        try {
          await chrome.runtime.sendMessage({ type: MSG_OPEN_MODE, mode: target });
        } catch {
          // Background unreachable — the mode is saved, so the
          // toolbar icon opens the popup next time.
        }
        host.remove();
        return;
      }
    });
  });
  // Clicking anywhere else on the page closes the menu. The shadow
  // root never sees page clicks, so the page document listens — once
  // per tab, closing whichever menu is current. A click inside the
  // shadow tree retargets to the host element, which contains() the
  // host, so menu clicks never close it from here.
  if (!switchDocListenerAdded) {
    switchDocListenerAdded = true;
    document.addEventListener("pointerdown", (e) => {
      if (!currentSwitchMenu || currentSwitchMenu.hidden) return;
      const target = e.target as HTMLElement | null;
      if (target && currentSwitchHost?.contains(target)) return;
      currentSwitchMenu.hidden = true;
    });
  }

  floatingRefreshers.push(refreshMenu);
  await refreshMenu();
}

/**
 * Backup line in the footer (v1.2.0) — the real last-backup time
 * from storage, never invented. Re-reads on show / storage change
 * like the other sections.
 */
async function initFloatingBackup(win: HTMLElement): Promise<void> {
  const q = <T extends HTMLElement>(sel: string): T | null => win.querySelector(sel) as T | null;
  const line = q<HTMLElement>("[data-backup-line]");
  if (!line) return;
  const lineEl: HTMLElement = line;
  async function refresh(): Promise<void> {
    try {
      const state = await loadBackupState();
      lineEl.textContent = formatBackupChip(state);
    } catch {
      lineEl.textContent = "";
    }
  }
  floatingRefreshers.push(refresh);
  await refresh();
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
        // v1.2.0: switching the mode away from floating closes open
        // floats — except the float that set the mode itself (it stays
        // open with the hint; see initFloatingSwitch).
        if (changes[WINDOW_MODE_KEY]) {
          const mode = changes[WINDOW_MODE_KEY].newValue;
          if (mode === "sidepanel" || mode === "popup") {
            if (suppressModeCloseOnce) {
              suppressModeCloseOnce = false;
            } else {
              document.getElementById("hiddengem-flow-root")?.remove();
              return;
            }
          }
        }
        if (changes[TASKS_KEY] || changes[SCRIPTS_KEY] || changes[SCRIPT_ERRORS_KEY] || changes[UPDATE_KEY] || changes[NOTES_KEY] || changes[FLOAT_LAYOUT_KEY] || changes[BACKUP_KEY] || changes[WINDOW_MODE_KEY]) {
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
      <span class="switch-wrap">
        <button type="button" class="switch-btn" data-act="switch" title="Switch window mode" aria-label="Switch window mode">⇄ Switch</button>
        <span class="switch-menu" data-switch-menu hidden>
          <button type="button" class="sw-row" data-mode="floating">▣ Floating window</button>
          <button type="button" class="sw-row" data-mode="sidepanel">▤ Side Panel</button>
          <button type="button" class="sw-row" data-mode="popup">▢ Popup window</button>
        </span>
      </span>
      <button type="button" data-act="min" title="Minimize" aria-label="Minimize">–</button>
      <button type="button" data-act="close" title="Close" aria-label="Close">✕</button>
    </header>
    <div class="body">
      <button type="button" class="upd" data-update hidden></button>
      <p class="switch-hint" data-switch-hint hidden></p>
      <div class="bridge" data-bridge hidden>
        <p>${BRIDGE_MESSAGE}</p>
        <div class="bridge-row">
          <button type="button" class="bridge-open" data-act="bridge-open">Open Script Store</button>
          <button type="button" class="bridge-dismiss" data-act="bridge-dismiss">Dismiss</button>
        </div>
      </div>
      <div class="site" data-site></div>
      <div class="tabs" data-tabs>
        <button type="button" data-float-tab="tasks" class="active">Daily Tasks</button>
        <button type="button" data-float-tab="scripts">Scripts</button>
        <button type="button" data-float-tab="notes">Notepad</button>
      </div>
      <section class="panel" data-panel="tasks">
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
      <section class="panel" data-panel="scripts" hidden>
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
      <div class="foot">HiddenGem Flow v2.1.1<br><a class="download-btn" href="${RELEASES_PAGE_URL}" target="_blank" rel="noopener noreferrer" title="Download the latest HiddenGem Flow build">${DOWNLOAD_SVG} Download HiddenGem Flow</a><p class="backup-line" data-backup-line></p></div>
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

  // --- Extension update line (Unreleased) ---
  void initFloatingUpdate(win);

  // --- Window-mode switch menu + backup line (v1.2.0) ---
  void initFloatingSwitch(win, host);
  void initFloatingBackup(win);

  // --- Tabs + Notepad (finding A-09) + Edit layout (finding A-10) ---
  // One page at a time; panels are hidden, never removed, so switching
  // tabs preserves each page's state (an open editor, a search query,
  // an armed delete) instead of rebuilding it. The tab order, hidden
  // tabs and default tab come from the stored layout (finding A-10);
  // the default when nothing is stored is Daily Tasks, as before.
  let currentLayout: FloatLayout = { order: ["tasks", "scripts", "notes"], hidden: [], defaultTab: "tasks" };
  let currentFloatTab: FloatTabId = "tasks";
  let layoutEditing = false;
  const tabBtns = Array.from(win.querySelectorAll<HTMLElement>("[data-float-tab]"));
  function selectFloatTab(name: string): void {
    currentFloatTab = name as FloatTabId;
    tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.floatTab === name));
    win.querySelectorAll<HTMLElement>("[data-panel]").forEach((p) => {
      p.hidden = layoutEditing || p.dataset.panel !== name;
    });
    const layoutPanel = win.querySelector<HTMLElement>("[data-layout-panel]");
    if (layoutPanel) layoutPanel.hidden = !layoutEditing;
  }
  function renderFloatTabs(): void {
    const active = applyFloatLayoutToTabs(win, currentLayout, currentFloatTab, layoutEditing);
    selectFloatTab(active);
  }
  tabBtns.forEach((b) =>
    b.addEventListener("click", () => {
      // While editing, tab clicks are ignored — exit via Save/Cancel
      // so edits are never discarded by accident.
      if (layoutEditing) return;
      selectFloatTab(b.dataset.floatTab ?? "tasks");
    }),
  );
  const notesHandle = mountFloatNotes(win, () => {
    void chrome.runtime.sendMessage({ type: "hiddengemflow:open-dashboard", tab: "notes" });
  });
  floatingRefreshers.push(notesHandle.refresh);
  const layoutHandle = mountFloatLayoutEditor(win, {
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
  floatingRefreshers.push(layoutHandle.refresh);
  void loadFloatLayout().then((loaded) => {
    currentLayout = loaded;
    currentFloatTab = effectiveDefaultTab(loaded);
    renderFloatTabs();
    // v1.2.0: one-shot open-tab hint (quick-note, Alt+Shift+N) — open
    // the hinted tab once, then clear it so the next open is normal.
    void readOpenTabHint().then((hint) => {
      if (!hint) return;
      void clearOpenTabHint();
      if (hint === "tasks" || hint === "scripts" || hint === "notes") selectFloatTab(hint);
    });
  });
  // v1.2.0: the show-path (toggleWindow / hiddengemflow:show) needs
  // this window's tab selector after buildWindow returns.
  currentSelectFloatTab = selectFloatTab;

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
    if (wasHidden) {
      runFloatingRefreshers();
      applyOpenTabHint();
    }
    return;
  }
  document.documentElement.appendChild(buildWindow());
}

/** v1.2.0: read the one-shot open-tab hint (quick-note) and select that tab, then clear it. */
function applyOpenTabHint(): void {
  void readOpenTabHint().then((hint) => {
    if (!hint) return;
    void clearOpenTabHint();
    if (hint === "tasks" || hint === "scripts" || hint === "notes") currentSelectFloatTab?.(hint);
  });
}

/** v1.2.0: show the window (never hide it) — for commands like quick-note, where toggling it off would be wrong. */
function showWindow(): void {
  const existing = document.getElementById("hiddengem-flow-root");
  if (existing) {
    if (existing.style.display === "none") {
      existing.style.display = "";
      runFloatingRefreshers();
    }
    applyOpenTabHint();
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

    chrome.runtime.onMessage.addListener((message: { type?: string }, _sender: unknown, sendResponse: (r: unknown) => void) => {
      if (message?.type === "hiddengemflow:toggle") toggleWindow();
      // v1.2.0: "show" never hides — commands (quick-note) open the
      // window on the hinted tab instead of toggling it off.
      if (message?.type === "hiddengemflow:show") showWindow();
      // v1.3 (A-33): ping — the background asks whether the float is
      // injected in this tab. A live float proves the tab granted
      // activeTab when it was injected (the float is only ever
      // injected through an activeTab gesture), which
      // chrome.permissions.contains() does NOT report — so the ping
      // is the second half of the host-access check for run-script
      // and self-test. It answers synchronously; no other tab or
      // page can fake it (only this tab's injected float listens).
      if (message?.type === "hiddengemflow:ping") {
        sendResponse({ ok: true, hasFloat: true });
        return true;
      }
      // v1.2.0 deep audit (A-20): the side panel opening closes open
      // floats — switching surfaces closes the one being left.
      if (message?.type === "hiddengemflow:close") {
        document.getElementById("hiddengem-flow-root")?.remove();
      }
      // v1.2.1: the open-tabs map changed (a tab opened, closed or
      // navigated) — re-read it and re-render the task rows. The
      // tasks refresher fetches the map from the background.
      if (message?.type === MSG_OPEN_TABS_CHANGED) {
        runFloatingRefreshers();
      }
    });

    // First inject opens the window immediately.
    toggleWindow();
  },
});
