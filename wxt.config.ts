import { defineConfig } from "wxt";

// HiddenGem Flow — Unreleased (Chrome MV3; Official Store + Bridge + Logs).
// Firefox comes later; the config is written so the Firefox target can be
// added with a browser flag, no code changes.
export default defineConfig({
  manifest: {
    name: "HiddenGem Flow",
    description:
      "Draggable floating window + dashboard for your daily task websites and userscripts. Save sites, open them in one click, manage scripts from one place.",
    // Version comes from package.json (1.0.0).
    // v1.0.2 adds entrypoints/float (float.html) — a standalone popup
    // window for the floating UI on pages where content scripts cannot
    // be injected (new tab, chrome://, about:blank). It needs NO new
    // permission: chrome.windows.create for an extension page is
    // allowed without one, and no chrome_url_overrides are used — the
    // user's new tab page is never replaced.
    // Phase 4 adds no permissions: the store is fetched user-triggered
    // from the dashboard page, the bridge reads the cached copy, and
    // the run log only uses storage + tabs (already granted).
    // NOTE (audit A-02, v1.0.0): "alarms" was requested since Phase 1 but
    // never used — no chrome.alarms call exists anywhere — so it was
    // removed. Least privilege: if daily reminders ever need it, add it
    // back with the feature, not before.
    permissions: ["storage", "tabs", "scripting", "activeTab", "userScripts", "notifications"],
    // LIVE TEST FIX (v1.0.1, 2026-11-15): chrome.userScripts only runs a
    // script where the extension has HOST access — registering alone is
    // not enough. The extension requests NO required host permissions
    // (the floating window is injected on demand via activeTab), so
    // scripts were registered but inert on every site. This OPTIONAL
    // permission lets the user grant access per site (dashboard Scripts
    // tab → "Grant site access" on a script, or chrome://extensions →
    // Details → Site access → "On all sites") — granted only when they
    // ask for it, revocable any time. Same pattern as ScriptSentry.
    optional_host_permissions: ["*://*/*"],
    // No host_permissions in Phase 1: the floating window is injected only
    // into the active tab, on the user's toolbar click, via the activeTab
    // permission. No default_popup — the toolbar click toggles the floating
    // window, it does not open a popup.
    action: { default_title: "HiddenGem Flow" },
    icons: {
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },
  },
});
