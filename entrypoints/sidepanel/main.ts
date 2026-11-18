// HiddenGem Flow — native side panel (v1.2.0).
//
// The same 3-tab floating UI as the standalone popup window, docked
// at the side of the browser instead of floating over a page. The UI
// lives in the shared module (shared/float-page.ts) — this file only
// picks the side-panel options.
//
// Differences from the popup (see shared/float-page.ts): "Add current
// site" works here (the panel is docked next to a real tab, and the
// active tab is read with chrome.tabs.query from this extension
// page); the Scripts tab matches scripts against that tab's URL; and
// there is no in-UI ✕ — Chrome's own panel header provides the close
// button, and there is no chrome.sidePanel.close() API to call.
import { mountFloatPage } from "../shared/float-page";
import { MSG_CLOSE_FLOATS } from "../shared/window-mode";

declare const chrome: any;

mountFloatPage(document, {
  surface: "sidepanel",
  siteLine: "Docked — stays open while you switch tabs.",
  addCurrentSite: true,
  showClose: false,
});

// v1.2.0 deep audit (A-20): opening the panel closes any open in-page
// floating windows — switching surfaces closes the one being left.
// The background fans the message out to every tab; tabs without a
// float ignore it. Without this, the float that set the mode would
// stay open with a stale "click the toolbar icon once to dock" hint
// (the background never sees the toolbar click that opens the panel).
try {
  void chrome.runtime.sendMessage({ type: MSG_CLOSE_FLOATS }).catch(() => {
    // Background unreachable — the floats stay; the user closes them.
  });
} catch {
  // Same as above, synchronous failure.
}
