// HiddenGem Flow — standalone floating window page (v1.0.2, float.html).
//
// WHY THIS PAGE EXISTS: the in-page floating window is a content script
// injected into the active tab, and Chrome forbids injection on
// chrome://, brave://, the Web Store, about:blank and new-tab pages —
// so a toolbar click there did nothing at all. The background opens
// THIS page as a popup window (chrome.windows.create, type "popup",
// 360x680) when the active tab is not an http(s) page — and, since
// v1.2.0, whenever the window mode is "popup". No chrome_url_overrides
// — the user's new tab page is never replaced.
//
// The UI lives in the shared module (shared/float-page.ts) — the same
// module the side panel uses. This file only picks the popup options.
import { mountFloatPage } from "../shared/float-page";

mountFloatPage(document, {
  surface: "popup",
  siteLine: "No website open — this is the standalone window.",
  addCurrentSite: false,
  showClose: true,
});
