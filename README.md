# HiddenGem Flow

Draggable floating window + dashboard for your daily task websites and userscripts.

![HiddenGem Flow wordmark](public/logo-v2-wordmark.png)

**Version:** 1.0.0 (pre-final dev build — the final release will also be v1.0.0, the first version; no version bumps until then) · **All phases complete** · Chrome first, Firefox later · MIT license

## What works in the current dev build (Unreleased — added on top of the v1.0.2 dev build)

- **Daily Tasks — honest Open All.** Opening tabs now reports what actually happened: *"Opened 3 tabs."*, or *"Opened 50 tabs. 10 skipped (50 open at a time)."* when the 50-at-a-time cap drops some. And only the **first** tab opens in the foreground — the rest open in the background, so opening 10 tabs no longer steals focus 10 times. The result line shows in the dashboard, the floating window, and the standalone popup alike.
- **Daily Tasks — no duplicate sites.** Saving a URL that is already saved is rejected with *"This site is already saved."* (compared on the normalized URL, so `example.com` and `https://example.com/` count as the same site). Editing a site to a URL another task already has is rejected the same way.
- **Standalone popup can add tasks by hand.** The float popup (new tab) still cannot "Add current site" — there is no site there — but it now has a **＋ Add a task** form (Name + URL, same validation and duplicate check as the dashboard). Saved tasks appear in the list right away.
- **"User Scripts: ON / OFF" in both floating windows — with a one-click way to the toggle.** The in-page floating window and the standalone popup now show a live status line. When it is OFF, an **Open extension details to enable** button opens this extension's Details page directly — the button only opens the page; **no extension can flip the "Allow User Scripts" toggle by itself**, Chrome requires a human click there (the same limit applies to every userscript manager). After you flip it and come back, the status reads ON. The dashboard Scripts banner has the same button, next to its step-by-step text.
- **Script import/export — any text file, including .txt.** The Scripts tab file picker no longer filters to `.user.js` only: `.js`, `.user.js`, `.txt` and any other text file can be picked. A file with a `==UserScript==` block imports as before; a file without one still loads into the editor, and installs under the file's base name unless you add an `@name` line. A file in another language (e.g. Python) can be opened to inspect it, but the import says plainly it cannot run in a browser page — only JavaScript userscripts run, and a script with no `@match` runs nowhere. Per installed script there are now two export buttons: **Export .user.js** and **Export .txt** (same content, different extension — the text round-trip works both ways).
- **Private Store Uploader page.** `tools/store-uploader.html` is a single standalone file (open it from your computer — no server; your browser talks directly to `api.github.com`). Create a fine-grained Personal Access Token on GitHub (Contents read/write on `hiddengem-flow-store` only — the exact steps are on the page), paste it, and **Test connection** verifies it before anything is published. The token is stored only in that page's localStorage, with a **Forget token** button, and is never written into the file. **New Script**: fill in Name / Version / Description / Author / @match, paste code or choose a file, click **Import** to read the details from the code, then **Publish to the store** — it reads the current `index.json`, uploads the script to `scripts/<name>.user.js`, updates the index, and clears the jsDelivr cache for both files. **Live Scripts**: lists every published script (total count + search) and upgrades any of them — the version field suggests a bump (1.0.0 → 1.0.1, editable) and **Publish upgrade** uploads the new file and updates the index entry. No token? The **Download .user.js** / **Download index.json** / **Copy index.json entry** fallback still works, and you publish the two files on github.com by hand. After a publish, Script Store → **Load store** lists the script (and now shows when the store was fetched).
- **Script Store redesign.** The dashboard tab is now called **Script Store** (was "Find Script" — renamed everywhere in the UI: tab, Overview, bridge banner, floating window, uploader; storage keys and code identifiers unchanged). The listing is proper store cards instead of plain rows, with a total count, a "Store fetched: <time>" line, search (name + description + @match sites), and sort Recently updated / Latest / Name A–Z (default Recently updated). Index entries now carry optional `publishedAt` and `updatedAt` dates — the uploader sets both on a new publish and keeps `publishedAt` on an upgrade; an entry without dates shows "Date not listed".
- **No third-party product name anywhere.** All user-facing text, docs and code comments say "userscript manager" / "userscript" — the code was always original. All dashboard copy was also reworked: the Overview card is now a plain "What this extension does" summary, and the tab intros, banner and Settings page are shorter, clearer and keep every honest limit.
- **Permissions unchanged** (still exactly `storage, tabs, scripting, activeTab, userScripts, notifications` + optional `*://*/*`).

## What works in v1.0.2 (added on top of Phases 1–4)

- **Floating window works with no website open.** Clicking the toolbar icon on a new-tab page, `chrome://`, `brave://`, the Web Store or `about:blank` now opens the same floating UI as a standalone popup window (`float.html`, 360×680) — header + gem logo, Daily Tasks with Open All, Active Scripts, Open Dashboard, GitHub link, Close. Clicking the icon again focuses the open popup instead of opening a duplicate. On an `http(s)` site the click still opens the in-page draggable window exactly as before.
- **"Add current site" handles having no site.** In the standalone popup the button is disabled with the hint *"Open a website to add it"* — it is never a broken button. Tasks and scripts are the same shared storage as the dashboard and the in-page window, so everything stays in sync.
- **No new-tab replacement, no new permission.** The fix does not use `chrome_url_overrides` (your new tab page is untouched), and `chrome.windows.create` for an extension page needs no extra permission — the manifest is unchanged.

## What works in Phase 4 (added on top of Phases 1–3)

- **Official Store — Script Store tab.** Click **Load store** (the store is *never* fetched automatically — not on dashboard open, not on floating-window open). The index is fetched from jsDelivr first (`https://cdn.jsdelivr.net/gh/BidyutRoy2/hiddengem-flow-store@main/index.json`), falling back to raw.githubusercontent (`https://raw.githubusercontent.com/BidyutRoy2/hiddengem-flow-store/main/index.json`) on any failure (network error, non-2xx, bad JSON, bad shape). A successful fetch is cached in `chrome.storage.local` (`hiddengemflow.store.cache.v1`); if both sources fail but a cache exists, the cached list is shown labelled "cached from <date>". Malformed entries are skipped and counted — one bad entry never kills the whole index. **The store repo may not exist yet** — in that case the tab says so honestly ("The official store repo is not published yet…") with a GitHub link, and shows zero fake scripts.
- **Store — search, sort, detail.** Search matches name, description, author and match patterns; sort Recently updated (updated date, the default), Latest (published date) or Name A–Z. Each script is a card: name, version badge, description, @match sites, published date and last-updated date ("Date not listed" when the entry has no date — never invented). Clicking a script's **Install** opens a detail view: full description, match sites, both dates — and its code is fetched once (user-triggered, on detail-open; inline `code` in the index needs no fetch), then shown with the same heuristic security scan as manual installs. If the code fetch fails, the error is shown and installing stays disabled.
- **Store — install, confirm only.** **Add script** reveals a **Confirm install** button — nothing ever installs without that confirm. Installing saves the script with source `store`, takes the store entry's `@updateURL`/`@downloadURL` when present (falling back to the code URL so "Check for updates" has something to fetch), and registers it through the same `chrome.userScripts` engine as a manual script. Auto-upgrade is OFF by default on install.
- **Store — per-script auto-upgrade (offer only).** Each installed store script has an **Auto-upgrade** toggle (default OFF) in the Scripts tab. When ON, the dashboard offers a new version once per load (fetches `@updateURL`/`@downloadURL`, shows old → new version, lines changed and a scan, then needs **Confirm**) — it never installs silently. **Check for updates** on a store script does the same on demand.
- **Smart Notification Bridge.** When the site you are on already has an official script, a dismissible banner appears — in the floating window (top of the body) and at the top of the dashboard Scripts tab — with exactly: *"This site already has an official script — add it in one click from Script Store."* **Open Script Store** opens the dashboard to the Script Store tab (`dashboard.html#store`); **Dismiss** stores the hostname in `hiddengemflow.bridge.dismissed.v1` and the banner stays hidden for that site across reloads (other sites unaffected). The bridge reads the **cached** store index only — it never fetches on its own, so if no store has ever been loaded, no banner appears. The banner never installs anything.
- **Multi-tab parallel execution + live Logs.** Every tab opened through the background (Open All / Open Selected / single click) gets a run entry in `hiddengemflow.runs.v1` (last 50 kept): URL, hostname, the installed+enabled script ids whose `@match` patterns match it, and a status — `queued` → `running` while the tab is open, `done` when the tab finishes loading, `failed` when the URL was invalid, the tab could not be created, or the tab closed before finishing. The Logs tab shows the live list (refreshes every 2s while visible, plus on storage change), with script names and timestamps, and a **Stop All** button (disabled when nothing is running) that marks running runs `stopped` and best-effort closes only the tabs this extension opened in those runs. Honest limits, stated in the UI: `chrome.userScripts` registration is per-extension, not per-tab — "running" means the matching scripts are registered and the tab was opened by this extension; it does not claim to control other tabs, and it does not track tabs you opened yourself.
- **Dashboard open-to-tab.** `dashboard.html#store` (and `#tasks`, `#scripts`, `#logs`, `#settings`) selects that tab on load; clicking a tab updates the hash.

## What works in Phase 3

- **Script Manager — create.** Write a script in the Dashboard's Scripts tab (monospace editor, Tab inserts spaces). Metadata (`@name`, `@version`, `@description`, `@match`/`@include`, `@grant`, `@updateURL`, `@downloadURL`, `@namespace`, `@author`) is parsed live and shown under the editor.
- **Scan before install.** Saving runs a heuristic security scan first (score 0–100, grade A–F): `eval` / `new Function`, `GM_xmlhttpRequest`, `document.cookie`, `unsafeWindow` / `@grant *` are high; `innerHTML`, `document.write`, `fetch`/XHR/WebSocket, `localStorage`/`sessionStorage` and unsupported GM calls are medium; `GM_setValue`/`GM_getValue` is a low informational note. The scan is a **warning, never a block** — even an F can be installed, but only after an explicit **Confirm install** button.
- **Import.** From a `.js`, `.user.js` or `.txt` file (any text file — the picker has no extension filter), pasted code, or a fetched URL (user-triggered only, fetch errors shown). Every import lands in the editor for a scan + confirm — nothing installs straight from a file, paste or URL. A file without an `@name` line installs under the file's base name. A file in another language can be inspected but cannot run in a browser page — only JavaScript userscripts run.
- **Run.** Scripts register through Chrome's `chrome.userScripts` API, one at a time, in the **USER_SCRIPT** world (not MAIN — the page cannot read or overwrite the GM shim). On install/startup the background re-registers every enabled script, one at a time; a registration failure is saved per script (`hiddengemflow.scripts.errors.v1`) and shown next to the script in the dashboard.
- **GM functions — only four, honestly.** `GM_setValue` / `GM_getValue` (synchronous, backed by the page origin's `localStorage` under `hgf:gm:<scriptId>:<key>` — the page's own JavaScript can read those keys, so never store secrets), `GM_notification` (a real `chrome.notifications` notification via the background — not a DOM toast), `GM_addStyle` (injects a `<style>` element), plus the `GM.*` object form of the same four. `GM_xmlhttpRequest`, `GM_openInTab`, `GM_download`, `GM_setClipboard`, `unsafeWindow` and everything else are **not** implemented — a script that calls one gets a scanner warning and a runtime error, never a fake.
- **Enable / disable, edit, history, delete.** Toggle a script to register/unregister just that one. Editing saves a new version into history (last 10 kept); each saved version has a **Rollback** button that restores the code and keeps the history. Delete asks for `confirm()` first, then removes the script and unregisters it.
- **Backup / restore.** Export all scripts (code + history) as one JSON file; restore merges by id (backup copy wins on the same id, everything else stays) after a `confirm()`.
- **Version upgrade.** For a script with `@updateURL` / `@downloadURL`, **Check for update** fetches it (user-triggered), compares versions, and — when newer — shows old → new version, lines-changed count and a scan of the new code, then requires **Confirm** before applying (new history entry). Without an update URL the button says **Re-import to update** and opens the import flow.
- **Floating window — Active Scripts.** The window lists the enabled scripts whose `@match` patterns match the current tab, each with a toggle (via the background).
- **"Allow User Scripts" guard.** The `userScripts` permission alone does not run scripts — Chrome also needs a per-extension toggle (`chrome://extensions` → HiddenGem Flow → Details → **Allow User Scripts** ON). The dashboard and the floating window both show that exact guidance until the toggle is on; nothing fails silently.
- **Site access — the second gate.** Registering alone still does not run a script: Chrome only runs a userscript where the extension has *host* access ("host_permissions for sites you want to run scripts on"). The extension requests no *required* host permissions, so site access is an *optional* permission (`*://*/*`) granted per site — click **Grant site access** on the script in the Scripts tab (Chrome's own prompt), or set Site access → On all sites in the extension details. Until granted, the script row and the floating window say the script is registered but not running yet. (Proved by the 2026-11-15 live test: a registered script never ran on a fresh tab, then ran after a toolbar click + reload gave the tab access.)

## What works in Phase 2

- **Daily Tasks — save sites.** In the Dashboard's Daily Tasks tab, add a site by name + URL (URL validation inline; `https://` is added when missing, non-http(s) URLs are rejected).
- **Daily Tasks — open.** Click a site to open it in a new tab; select several with checkboxes and **Open selected**; or **Open All**. Every open goes through the background, which opens the tabs one by one ~350 ms apart and stamps `lastOpenedAt` on the tasks it opened. Only the first tab opens in the foreground; the rest open in the background. The result is shown as a count ("Opened 3 tabs." — or how many were skipped by the 50-at-a-time cap), never silently dropped.
- **Pin, edit, delete, search.** Pin a site to the top (pinned first, then newest), edit inline via the same form (Save/Cancel), delete with a `confirm()`, and filter the list by name or URL.
- **Floating window tasks.** The floating window has **Add current site** (prefills name + URL from the tab you are on, both editable), shows your top 5 tasks pinned-first, and an **Open All** button — plus a **View all in Dashboard** link. The list scrolls; the window stays compact.
- **Honest empty state.** With nothing saved, both the dashboard and the floating window say "No task sites saved yet — add your first one above." — no fake tasks.
- **Favicons, best-effort.** Each task shows a favicon from Google's s2 favicon service; if it fails to load, a letter tile shows instead. That is the only external request in Phase 2 — no analytics, no telemetry.

## What works in Phase 1

- **Toolbar click → floating window.** Click the HiddenGem Flow icon on any website and a draggable floating window opens. Click again to hide it, again to show it.
- **Draggable, position saved.** Drag the window by its header. Its position is stored in `chrome.storage.local` (`hiddengemflow.floating.pos`) and restored on the next open.
- **Minimize / Close.** Minimize collapses the body; Close removes the window (the next toolbar click re-opens it).
- **Shadow DOM.** The window lives in a Shadow DOM, so the host site's CSS and JS cannot break it — and it cannot break the site.
- **Dashboard.** A full-page dashboard (Overview, Daily Tasks, Scripts, Script Store, Logs, Settings). Overview shows live counts from storage — honestly `0` until something is actually saved. Settings has a working "Reset floating window position" button.
- **No fake data.** Everywhere a feature is not built yet, the UI says so plainly instead of showing demo tasks, scripts or stats.

## What is intentionally NOT in the current dev build

- **Firefox build** — later, after Chrome is proven.
- **Daily reminders** — the `alarms` permission was removed in the v1.0.0 audit (it was never used); reminders would need it added back with the feature.

See [docs/AUDIT.md](docs/AUDIT.md) for the full deep audit (findings A-01–A-03 and T-01–T-02 fixed, open limitations listed).

## Permissions — and why each one

| Permission | Why (v1.0.2 — unchanged since v1.0.0) |
|---|---|
| `storage` | Save the floating window position, the Daily Tasks list (`hiddengemflow.tasks.v1`), installed scripts (`hiddengemflow.scripts.v1`) and per-script registration errors (`hiddengemflow.scripts.errors.v1`). |
| `tabs` | Open the dashboard in a new tab; message the active tab; open task sites; read the active tab's title/URL for "Add current site". |
| `scripting` | Inject the floating window into the active tab on click. |
| `activeTab` | Temporary access to the tab you clicked in — this is what lets the extension ask for **no host permissions at all**. |
| `alarms` | **Removed in v1.0.0 (audit A-02)** — requested since Phase 1 but never used; no `chrome.alarms` call existed anywhere. |
| `userScripts` | Register / unregister userscripts (Phase 3). Chrome additionally needs the **Allow User Scripts** toggle on for this extension: `chrome://extensions` → HiddenGem Flow → Details → Allow User Scripts (ON), then reload the page. |
| `notifications` | Only used by `GM_notification` from a running userscript — the background shows a real system notification. Nothing else notifies. |

There is deliberately **no `default_popup`**: the toolbar click toggles the floating window, it does not open an action popup. There are no *required* host permissions: the floating script is built but not registered in the manifest (`registration: "runtime"`); it is injected only on demand. Site access for userscripts is an *optional* host permission (`*://*/*`), granted per site only when the user asks a script to run (see "Site access — the second gate" above). The v1.0.2 standalone window is a `chrome.windows.create({ type: "popup" })` **window**, not an action popup — and it needs no extra permission (verified in the built manifest).

## Tech

- [WXT](https://wxt.dev/) + TypeScript, Manifest V3, plain CSS (no framework) to keep the build reliable.
- All code is original, written for this project.

## Develop

```bash
npm install
npm run dev      # WXT dev mode (Chrome)
npm run typecheck
npm run build    # output in .output/chrome-mv3/
```

Requires Node 22+.

## Test it in Chrome (Load Unpacked)

1. Build it: `npm install && npm run build`
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select the `.output/chrome-mv3/` folder
5. Go to any `https://` site and click the **HiddenGem Flow** toolbar icon — the floating window should appear
6. Drag it by the header, reload the page, click the icon again — the window should come back where you left it
7. Click **Open Dashboard** in the window (or open `chrome-extension://<id>/dashboard.html`) — the dashboard opens with all six tabs; Overview shows `0` tasks / `0` scripts
8. In Settings, **Reset floating window position** clears the saved spot
9. In the **Daily Tasks** tab, add a site (try a bare domain like `example.com` — `https://` is added for you) and a bad URL like `notaurl` — the bad one shows an inline error and is not saved. Add the same site again — it is rejected with "This site is already saved." Click the saved row to open it (the status line says "Opened 1 tab."), pin it, edit it, then delete it
10. In the **Scripts** tab, the banner shows **Open extension details to enable** — click it and the extension's Details page opens; turn **Allow User Scripts** ON there (no extension can flip it for you), then reload the dashboard (the amber banner disappears when the toggle is on). Click **Create new script**, leave the example as-is, click **Scan & review** (it should scan clean), then **Confirm install**. Reload `https://example.com` — the floating window's Active Scripts should list it and show "User Scripts: ON"; toggle it off and on from the window. Import a `.txt` file with a userscript in it — it loads into the editor the same as a `.js` file; an installed script has **Export .user.js** and **Export .txt** buttons
11. In the **Script Store** tab, click **Load store**. If the store repo is not published yet, the tab says so honestly with a GitHub link and shows no scripts. If it is published, search/sort the list, open a script, read its scan, click **Add script** then **Confirm install** — the script appears in the Scripts tab with source "store". In the **Logs** tab, open a task with **Open All** and watch the run go Queued → Running → Done; **Stop All** is disabled once nothing is running
12. Open a **new tab** (nothing loaded) and click the toolbar icon — the standalone floating window should open as a small popup (360×680) with the same Daily Tasks / Active Scripts UI; **Add current site** is disabled there with an "Open a website to add it" hint, but **＋ Add a task** lets you add a site by hand (Name + URL). Click the icon again — the same popup comes to the front, no duplicate. Its **Open Dashboard** opens the dashboard in a normal tab; its **✕** closes the popup
13. Open `tools/store-uploader.html` in the browser (double-click the file — it works from `file://`, no server). Create a fine-grained token on GitHub (Contents read/write on `hiddengem-flow-store` only — the page lists the exact steps), paste it and click **Test connection** (it must say connected before you publish). Paste a userscript, click **Import** (the name, version and @match lines fill in), then **Publish to the store** — the log shows the index read, the script upload to `scripts/`, the index update, and the jsDelivr purge; check **Load store** in Script Store lists it. With no token, **Download .user.js** and **Download index.json** still work — upload both files on github.com by hand instead (script to `scripts/`, index to the repo root). A deliberately wrong token must fail the connection test plainly and publish nothing — never use a real token in a test

## Known limits of Phase 4

- Live click-tested in real Chrome for Testing (v1.0.1: 29/29, v1.0.2: 6/6 — see `docs/LIVE_TEST_AUDIT.md`), and the dashboard was checked by the owner on his own Brave (v1.0.2). The store fetch itself is still unverified — the store repo is empty, so **Load store** only ever shows the honest "not published yet" path until the owner publishes `index.json` there.
- The Official Store repo (`BidyutRoy2/hiddengem-flow-store`) may not exist yet, so the live fetch is unverified — the store tab handles that honestly, but no real store script has been installed from it.
- The bridge banner in the dashboard Scripts tab checks the tab the dashboard itself is open in — a `chrome-extension://` URL never matches a store script, so that banner shows there only in the sense the spec defines; the floating-window banner (which sees the real page URL) is the one that fires in practice.
- Run status is honest but limited: "running" means the matching scripts are registered and the tab was opened by this extension — it cannot prove the scripts executed inside the tab, and a tab that fails to load still fires `complete` in some error cases, so a "done" run is "finished loading", not "script verified running".
- Auto-upgrade offers are checked once per dashboard load for scripts with the toggle ON; nothing checks in the background while the dashboard is closed.

## Known limits of Phase 3

- Live click-tested in real Chrome for Testing (v1.0.1: the example script ran on example.com after the grants; v1.0.2 on the owner's Brave dashboard). The owner still needs to flip **Allow User Scripts** (step 10) on his own Brave before any script runs there.
- Scripts do nothing until the owner flips **Allow User Scripts** (step 10) — that toggle is a Chrome requirement, not something the extension can flip itself.
- The scanner is a regex heuristic over the source text: it strips comments and strings first, so it can miss obfuscated code and can flag a pattern used safely. It is a warning, never proof of safety.
- `GM_setValue` / `GM_getValue` values live in the page origin's localStorage, namespaced per script — visible to the page's own JavaScript. Never store secrets with GM_*.
- Only the four GM functions listed above exist. Scripts written for other userscript managers that rely on `GM_xmlhttpRequest`, `unsafeWindow` or other grants will warn at install and fail at runtime.
- A script with no `@match` patterns is saved but never registered — the dashboard says so next to the script.
- Import-from-URL fetches the URL from the dashboard page; the server sees a normal browser fetch.

## Known limits of Phase 2

- The floating window cannot be *injected* on `chrome://`, Web Store, or other restricted pages — Chrome forbids it. Since v1.0.2 the click there no longer does nothing: it opens the standalone popup window instead (see "What works in v1.0.2").
- The wordmark image is square, so in the dashboard header it renders small; the gem-only icon is used for the toolbar (text would be unreadable at 16px).
- The background service worker is stateless by MV3 design; all state lives in `chrome.storage.local`.
- The only external request is the best-effort favicon image (Google s2 favicon service); if it fails, a letter tile shows instead. No analytics, no telemetry.

## Project layout

```
entrypoints/
  background.ts            # toolbar click, inject/toggle, open dashboard, open-urls + get-active-tab (Phase 2), script bridge + startup re-register (Phase 3), run log + Stop All (Phase 4), standalone-popup routing + size enforcement (v1.0.2)
  floating.ts              # floating window (Shadow DOM, drag, save position, Daily Tasks mini-UI, Active Scripts mini-UI, Smart Notification Bridge banner — Phase 4)
  float/                   # standalone floating page (v1.0.2): index.html, main.ts, style.css — same UI as the in-page window, no tab needed
    index.html  main.ts  style.css
  shared/tasks.ts          # Daily Tasks types + pure helpers (normalize/sort/search/CRUD) + storage wrappers
  shared/scripts.ts        # Script Manager types + pure helpers (parseMetadata, @match, securityScan, history, version compare) + storage wrappers
  shared/engine.ts         # chrome.userScripts engine: GM shim, register/unregister one at a time, per-script errors
  shared/store.ts          # Official Store types + pure helpers (validate/sort/search/bridge dismissal) + fetch (jsDelivr → raw → cache) + code fetch
  shared/runs.ts           # multi-tab run log types + pure helpers (prune/update/stop) + storage wrappers
  dashboard/
    index.html  main.ts  style.css
tools/
  store-uploader.html      # private store publisher (dev build 2026-11-15): single standalone file, no server — GitHub PAT (localStorage only) → Test connection → Publish new script / upgrade live scripts (scripts/ + index.json, jsDelivr purge); no-token download fallback
public/
  icons/icon{16,32,48,128}.png   # gem-only icons (toolbar / manifest)
  logo-v2-wordmark.png           # wordmark (dashboard / store)
assets/
  logo-512.png  logo-v2-wordmark.png  icons/   # source artwork
```

## License

MIT — see [LICENSE](LICENSE).
