import { defineConfig } from "wxt";

// HiddenGem Flow — Unreleased (Chrome MV3; Official Store + Bridge + Logs).
// Firefox comes later; the config is written so the Firefox target can be
// added with a browser flag, no code changes.
export default defineConfig({
  // v2.1.0: a build-time flag selects which optional modules are
  // included. The flag is a Vite `define`, so the bundler replaces
  // it with a literal and drops the dead branch — including the
  // optional module's dynamic import — from the shipped bundle.
  // The acceptance test is a grep of the built output for the
  // module's display name: zero hits.
  vite: () => ({
    define: {
      __HGF_OWNER_BUILD__: JSON.stringify(process.env.HGF_OWNER_BUILD === "1"),
    },
  }),
  manifest: {
    name: "HiddenGem Flow",
    description:
      "Draggable floating window + dashboard for your daily task websites and userscripts. Save sites, open them in one click, manage scripts from one place.",
    // Version comes from package.json (3.0.0).
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
    // v1.4 (#5/#6/#16) adds it back WITH the feature: task reminders,
    // the daily pinned-task nudge, scheduled Open All, scheduled
    // Flows and note due dates all run on chrome.alarms. It carries
    // no install warning (same as sidePanel/contextMenus).
    // v1.2.0 adds two no-warning permissions, both requested by the
    // feature and both with no install warning: "sidePanel" (the
    // docked side-panel mode, chrome.sidePanel) and "contextMenus"
    // (the right-click menu). Keyboard shortcuts need no permission —
    // manifest "commands" is not a permission entry.
    permissions: ["storage", "tabs", "scripting", "activeTab", "userScripts", "notifications", "sidePanel", "contextMenus", "alarms"],
    // v1.4 (#18): omnibox keyword "flow" — type `flow` + Tab in the
    // address bar to search tasks, scripts and notes. A manifest key
    // only: no permission, no install warning, and the query is never
    // executed as code (see shared/omnibox.ts).
    omnibox: { keyword: "flow" },
    // v1.5+ (#10) HAD a new-tab dashboard — STRICTLY opt-in — but it
    // is REMOVED in v2.0.3: the override itself is a manifest key, so
    // Chrome keeps the new tab even when the dashboard is OFF (the
    // page then shows only a minimal enable screen), and there is NO
    // API to hand the new tab back at runtime. The owner asked for
    // Brave's default new tab back, so the override is gone entirely:
    // no chrome_url_overrides key at all, the newtab page is deleted,
    // and the dashboard is reached only from the toolbar icon,
    // Alt+Shift+D, or Open Dashboard. Only disabling the extension
    // used to restore the default tab; now the extension never takes
    // the new tab in the first place.
    // v1.5+ (#14/#15): tabGroups is OPTIONAL — requested at first use
    // of grouping (smart Open All / session restore), never required.
    // A denial degrades honestly to plain tabs and the UI says so.
    optional_permissions: ["tabGroups"],
    commands: {
      // Toggle Flow — opens the current window mode (same as the toolbar click).
      "toggle-flow": {
        suggested_key: { default: "Alt+Shift+F", mac: "Alt+Shift+F" },
        description: "Toggle HiddenGem Flow (open the current window mode)",
      },
      // Add the current site as a Daily Task.
      "add-current-site": {
        suggested_key: { default: "Alt+Shift+T", mac: "Alt+Shift+T" },
        description: "Add the current site as a Daily Task",
      },
      // Open the Dashboard.
      "open-dashboard": {
        suggested_key: { default: "Alt+Shift+D", mac: "Alt+Shift+D" },
        description: "Open the HiddenGem Flow Dashboard",
      },
      // Quick note — opens Notepad in the current window mode.
      "quick-note": {
        suggested_key: { default: "Alt+Shift+N", mac: "Alt+Shift+N" },
        description: "Quick note (open Notepad)",
      },
    },
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
