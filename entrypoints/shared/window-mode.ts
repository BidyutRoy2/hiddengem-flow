// HiddenGem Flow — window mode (v1.2.0).
//
// ONE setting picks which surface the toolbar icon opens: the
// draggable floating window, the native side panel, or the standalone
// popup window. The three surfaces share the same data and the same
// 3-tab UI; only the host differs. Same split as shared/tasks.ts:
//  * PURE half (up to the "Storage" section): no `chrome` APIs, no
//    DOM, no Date.now() hidden inside the logic — all inputs are
//    parameters. Unit-testable in plain Node.
//  * Storage / chrome half: thin wrappers around chrome.storage.local
//    and the sidePanel API. Only the background, the dashboard and the
//    floating surfaces import these.
//
// GESTURE RULE (the one honest constraint of the 3-way switch, told
// to the user before the build): chrome.sidePanel.open() needs a real
// user gesture. A click inside an extension page (dashboard, side
// panel, popup window) IS one, so those pages call
// openSidePanelForCurrentWindow() directly in their own click
// handler. A click inside the in-page floating window is a page
// click — the gesture does not survive the message to the background
// — so the float only SETS the mode and shows a hint ("click the
// toolbar icon once to dock"). The toolbar click itself is a gesture
// (via setPanelBehavior openPanelOnActionClick). A keyboard shortcut
// is NOT one Chrome accepts for sidePanel.open() — verified live
// (probe27d, finding A-13) — so the background's command handler
// notifies the user to click the toolbar icon once instead of
// failing silently. (Deep audit A-21: an earlier version of this
// comment wrongly claimed a shortcut WAS a gesture.)

export type WindowMode = "floating" | "sidepanel" | "popup";

export const WINDOW_MODE_KEY = "hiddengemflow.window.mode.v1";

/** One-shot hint: which float tab to open next ("notes" for quick-note). Cleared after it is read. */
export const OPEN_TAB_HINT_KEY = "hiddengemflow.float.openTab.v1";

/** Ask the background to open a mode (floating / popup). The side panel
 *  is opened directly by extension pages (gesture rule above), never
 *  through this message. */
export const MSG_OPEN_MODE = "hiddengemflow:open-mode";

/** Ask the background to close every open in-page float — sent by the
 * side panel when it opens (switching surfaces closes the one being
 * left; deep audit A-20). */
export const MSG_CLOSE_FLOATS = "hiddengemflow:close-floats";

/** The three modes, in the order the Dashboard card shows them. */
export const WINDOW_MODES: Array<{ id: WindowMode; label: string; hint: string }> = [
  { id: "floating", label: "Floating window", hint: "Draggable, on top of any page." },
  { id: "sidepanel", label: "Side Panel", hint: "Docked at the side, stays open across tabs." },
  { id: "popup", label: "Popup window", hint: "Separate 360×680 window, works with no site open." },
];

export function isWindowMode(value: unknown): value is WindowMode {
  return value === "floating" || value === "sidepanel" || value === "popup";
}

/** Unknown or missing values fall back to "floating" — existing users see no change. Pure. */
export function sanitizeWindowMode(raw: unknown): WindowMode {
  return isWindowMode(raw) ? raw : "floating";
}

/** The label for a mode ("Floating window" / "Side Panel" / "Popup window"). Pure. */
export function windowModeLabel(mode: WindowMode): string {
  return WINDOW_MODES.find((m) => m.id === mode)?.label ?? "Floating window";
}

// ---------------------------------------------------------------------------
// Storage wrappers (chrome.storage.local only — not part of the pure half)
// ---------------------------------------------------------------------------

declare const chrome: any;

function storageAvailable(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome?.storage?.local;
  } catch {
    return false;
  }
}

/** Load the saved mode; "floating" when nothing is saved or storage is unavailable. */
export async function loadWindowMode(): Promise<WindowMode> {
  if (!storageAvailable()) return "floating";
  try {
    const data = await chrome.storage.local.get(WINDOW_MODE_KEY);
    return sanitizeWindowMode(data?.[WINDOW_MODE_KEY]);
  } catch {
    return "floating";
  }
}

/** Persist the mode. Every surface and the background read it from storage. */
export async function saveWindowMode(mode: WindowMode): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [WINDOW_MODE_KEY]: sanitizeWindowMode(mode) });
}

/** Read the one-shot open-tab hint (null when none), without clearing it. */
export async function readOpenTabHint(): Promise<string | null> {
  if (!storageAvailable()) return null;
  try {
    const data = await chrome.storage.local.get(OPEN_TAB_HINT_KEY);
    const raw = data?.[OPEN_TAB_HINT_KEY];
    return raw === "tasks" || raw === "scripts" || raw === "notes" ? raw : null;
  } catch {
    return null;
  }
}

/** Set the one-shot open-tab hint ("notes" for quick-note). */
export async function setOpenTabHint(tab: string): Promise<void> {
  if (!storageAvailable()) return;
  if (tab !== "tasks" && tab !== "scripts" && tab !== "notes") return;
  await chrome.storage.local.set({ [OPEN_TAB_HINT_KEY]: tab });
}

/** Clear the one-shot open-tab hint (after the opening surface has read it). */
export async function clearOpenTabHint(): Promise<void> {
  if (!storageAvailable()) return;
  try {
    await chrome.storage.local.remove(OPEN_TAB_HINT_KEY);
  } catch {
    // Non-fatal: the next read treats a stale hint as a fresh one.
  }
}

/** Context menu on/off (v1.2.0) — the right-click menu can be turned off from Settings. Default true. Lives here because both the background (menu builder) and the dashboard Settings need it. */
export const CONTEXT_MENU_KEY = "hiddengemflow.contextMenu.v1";

/** Is the right-click menu on? True when nothing is saved. */
export async function loadContextMenuEnabled(): Promise<boolean> {
  if (!storageAvailable()) return true;
  try {
    const data = await chrome.storage.local.get(CONTEXT_MENU_KEY);
    const raw = data?.[CONTEXT_MENU_KEY];
    return raw === false ? false : true;
  } catch {
    return true;
  }
}

/** Persist the right-click menu on/off. */
export async function saveContextMenuEnabled(enabled: boolean): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [CONTEXT_MENU_KEY]: enabled === true });
}

// ---------------------------------------------------------------------------
// Side panel open (chrome.sidePanel — extension pages + background)
// ---------------------------------------------------------------------------

/**
 * Open the side panel for the browser window the user is looking at.
 * Must be called in a user gesture (a click in an extension page, a
 * toolbar click, or a keyboard shortcut) — Chrome refuses it
 * otherwise. Picks the focused normal window, else the first normal
 * window, else the current window (a popup window is never a target:
 * a side panel belongs to a normal browser window, not to the
 * standalone popup). Returns { ok } or { ok:false, error }.
 */
export async function openSidePanelForCurrentWindow(): Promise<{ ok: boolean; error?: string }> {
  try {
    if (typeof chrome === "undefined" || !chrome?.sidePanel?.open || !chrome?.windows?.getAll) {
      return { ok: false, error: "The side panel API is not available in this browser." };
    }
    let windowId: number | null = null;
    try {
      const wins = await chrome.windows.getAll();
      const list = Array.isArray(wins) ? wins : [];
      const target =
        list.find((w) => w?.focused && w?.type === "normal" && typeof w.id === "number") ??
        list.find((w) => w?.type === "normal" && typeof w.id === "number");
      if (target) windowId = target.id;
    } catch {
      // Fall through to getCurrent below.
    }
    if (windowId === null) {
      try {
        const current = await chrome.windows.getCurrent();
        if (current && typeof current.id === "number") windowId = current.id;
      } catch {
        // No window id at all — open() below will fail with a clear error.
      }
    }
    if (windowId === null) {
      return { ok: false, error: "Could not find a browser window to dock the panel in." };
    }
    await chrome.sidePanel.open({ windowId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}
