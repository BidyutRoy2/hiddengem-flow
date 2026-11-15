# HiddenGem Flow — Live Test Audit (real Chromium)

Version tested: **1.0.1** · Date: **2026-11-14** (runs on 2026-11-14 ~21:11–21:12 Dhaka, finished 21:12:48Z)
Final run: **29 PASS / 0 FAIL** (harness exit 0) — `live-test4.cjs`, fresh profile `profile-full4`
Screenshots + video: `docs/live-test/` (`preview.mp4`, 4.92 MB, 12fps desktop recording)

## How it was tested (honest method)

Real **Google Chrome for Testing 158.0.8127.18** (`/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`),
headed under **Xvfb :99** (1400×1000), driven by Playwright + **python-xlib XTest real mouse clicks**
(`clicker2.py`). The headless-shell binary does not support extensions, so it was not used;
headless-new was not used either — headed Xvfb is the mode that worked.

- **Extension id** (stable, path-derived): `ipapngeacaeambjbojpfaffneeabeeke`.
- **Toolbar click is REAL:** the gem icon is pinned via the Extensions menu (real clicks on the puzzle icon
  and the pin), then the toolbar gem is clicked with a real X11 mouse click — `chrome.action.onClicked`
  → `activeTab` — not a service-worker simulation. (F6+Tab keyboard navigation to the toolbar does not
  work via CDP; the XTest route is what proved it.)
- **Networking:** VM egress goes through a proxy (`http://hatch-egress-proxy:3128`); Chromium does not
  read env proxies, so a local CONNECT relay (`127.0.0.1:18080`, adds `Proxy-Authorization` from env,
  never logs credentials) + `--ignore-certificate-errors` (MITM cert — test-environment quirk, not an
  extension issue) was used. Relay health was re-checked before each run (200).
- **Allow User Scripts** was toggled with a real click on the `chrome://extensions` Details switch.
- **Grant site access** was accepted with a real click on Chrome's own permission prompt: the Allow pill
  is located by pixels (solid light-blue run detection, `clicker2.py` `allow`) and clicked at (813,270)
  on the final run — a real Chrome UI click, not a Playwright action.
- **Stop All** was tested against a local slow server (`127.0.0.1:19090/slow`, 25s delay) with
  authoritative `chrome.tabs.query` counts (Playwright `pages()` undercounts by design).
- **Playwright per-page video recording saved 0 files** (all runs); the deliverable preview video is the
  ffmpeg x11grab recording of the whole Xvfb desktop (`preview.mp4`), toolbar included.

## Per-test results (final run)

| # | Test | Result | Evidence (what was clicked / observed) | Screenshot |
|---|---|---|---|---|
| 0 | Service worker starts | PASS | SW running: `chrome-extension://ipapngeacaeambjbojpfaffneeabeeke/background.js` | — |
| 1 | chrome://extensions lists 1.0.1, no error badge | PASS | Card shows HiddenGem Flow 1.0.1; SW running | `01-extensions-page.png` |
| 2a | Dashboard loads, 6 tabs, honest 0 counts | PASS | Tabs: Overview \| Daily Tasks \| Scripts \| Find Script \| Logs \| Settings; counts 0/0 | `02-dashboard-overview.png` |
| 2b | All 6 tabs open, no new console/page errors | PASS | Each panel active; 0 new errors during each tab | `03-dashboard-tab-{tasks,scripts,store,logs,settings}.png` |
| 2c | GitHub header button opens the live store repo | PASS | Opened `https://github.com/BidyutRoy2/hiddengem-flow-store`; page shows the repo (live GitHub) | `04-github-store-page.png` |
| 3 | Allow User Scripts OFF at first | PASS | `typeof chrome.userScripts === "undefined"` in SW — toggle OFF (namespace gated by Chrome) | — |
| 4a | REAL toolbar click opens the floating window on example.com | PASS | example.com loaded; real toolbar click injected it; visible at x=944 y=72, 322×508 | `05-floating-window.png` |
| 4b | Drag header ~100px, position changes | PASS | before `{"left":"944px","top":"72px"}` → after `{"left":"844px","top":"132px"}` | `06-floating-after-drag.png` |
| 4c | Dragged position persists after reload + re-click | PASS | stored `{"x":844,"y":132}`; restored `{"left":"844px","top":"132px"}` after reload + real re-click | `07-floating-after-reload.png` |
| 4d | Minimize, close, re-toggle (real click) | PASS | minimize hid body; close removed host; real re-click recreated it | `08-floating-minimized.png` |
| 4e | Floating "Add current site" prefills + saves; footer GitHub link | PASS | prefilled name="Example Domain" url=`https://example.com/`; saved 1 task; GitHub href OK | `09-floating-add-current-site.png` |
| 5a | Dashboard Tasks: task saved from floating appears | PASS | 1 row, shows example.com | `12-dashboard-after-delete.png` (list after delete), `10-dashboard-task-open.png` |
| 5b | Click the task row opens a new tab | PASS | New example.com tab opened (1 new page) | `10-dashboard-task-open.png` |
| 5c | Open All opens the site; Logs records the run | PASS | Open All opened 1 tab; Logs shows 2 runs | `11-dashboard-logs.png` |
| 5d | Delete the task via dashboard UI | PASS | deleted "Delete Example Domain"; list empty; storage empty | `12-dashboard-after-delete.png` |
| 6a | Scripts tab: engine banner shows exact steps while toggle OFF | PASS | Banner visible with exact steps (Allow User Scripts / chrome://extensions / Details) | `13-dashboard-scripts-tab.png` |
| 6b | Enable Allow User Scripts via real Details toggle | PASS | Switch false → true; `typeof chrome.userScripts` now `"object"`; `getScripts()` OK (0 registered) | `14-toggle-allow-user-scripts.png` |
| 6c | Create script, scan, Confirm install | PASS | Scan shown; installed; registered ids=`["script-67e353b4-…-b29a"]`; NO registration error in storage (world fix verified) | `14-script-scan.png`, `15-script-installed.png` |
| 6c2 | BEFORE grant: row warns + Grant button; script does NOT run on a fresh tab | PASS | Row warns "not running yet"; Grant button present; `permissions.contains()==false`; fresh tab NOT run (title "Example Domain"); floating note: "1 installed · 1 match this page · 1 needs site access — Dashboard → Scripts → Grant site access" | `15b-script-needs-access.png`, `15c-floating-needs-access.png` |
| 6c3 | Grant flow: Grant button → Chrome prompt → real Allow click → access granted | PASS | Allow pill rect x 781..846 y 252..289, clicked (813,270); `permissions.contains(https://example.com/*) === true` | `15d-after-grant.png`, `15e-script-access-granted.png` |
| 6c4 | AFTER grant: Grant button + warning disappear | PASS | Row clean: no warning, no Grant button | `15d-after-grant.png` |
| 6d | Script actually runs on example.com | PASS | Title became `HGF-TEST-RAN`; `#hgf-live-test-banner` div present — script ran for real | `16-script-ran-on-example.png` |
| 6e | AFTER grant: floating lists the script, no site-access warning | PASS | Active Scripts lists "HGF Live Test Banner"; note: "1 installed · 1 match this page" | `16b-floating-after-grant.png` |
| 7 | Find Script → Load store: honest not-published message, zero fake scripts | PASS | Message shown; 0 store items; error text: "Could not load the store: The store answered 404." | `17-store-load-result.png` |
| 8 | Stop All with two slow tabs | PASS | Open All opened 2 slow tabs (chrome.tabs.query 9 → 11); Stop All clicked; runs show "stopped"; tabs 11 → 9 | `18-logs-before-stop-all.png`, `19-logs-after-stop-all.png` |

Test script used in 6c–6e: **HGF Live Test Banner v1.0**, `@match https://example.com/*` — sets
`document.title = 'HGF-TEST-RAN'` and appends a green `#hgf-live-test-banner` div.

## Console / service-worker error log (final run)

- **Page errors: 0. Failed network requests: 0.**
- **Console errors: 12** — all the same text, all environmental noise (NOT extension bugs):
  `Failed to load resource: the server responded with a status of 404 ()` / `... 404 (Not Found)`.
  By page: `about:blank` ×6, `dashboard` ×4, `example.com` ×2. These are favicon requests
  (Chrome requesting `favicon.ico` on about:blank/example.com pages and the dashboard's own icon fetch
  racing the page) — no extension code path, no user-visible effect. The dashboard favicon 404 from
  earlier runs (bug #2 below) is fixed; the remaining 404s are browser favicon noise on pages the
  extension does not control.
- **Known environmental noise (not extension bugs):** GitHub `collector.github.com/github/collect`
  `ERR_TIMED_OUT` (GitHub analytics beacon failing through the proxy).

## Errors found — and fixes (all in v1.0.1)

### Bug #1 — `world: "ISOLATED"` broke ALL script execution (HIGH)
`entrypoints/shared/engine.ts` passed `world: "ISOLATED"` to `chrome.userScripts.register()`, which only
accepts `MAIN` or `USER_SCRIPT` (`ISOLATED` belongs to `chrome.scripting`). Live error: *"Value must be
one of MAIN, USER_SCRIPT"* (shown next to the script in the dashboard + persisted in
`hiddengemflow.scripts.errors.v1`). The jsdom smoke tests could not catch it (they mock the API).
**Fix:** `world: "USER_SCRIPT"` + corrected comment. Verified live in 6c (registered, no error).

### Bug #2 — dashboard favicon 404 (cosmetic)
Dashboard had no favicon link → Chrome requested `chrome-extension://<id>/favicon.ico` → 404 on every
load. **Fix:** `<link rel="icon" href="/icons/icon32.png" />` in `entrypoints/dashboard/index.html`.
(Side effect: the dashboard tab now shows the gem favicon — the clicker's gem detector had to be
scoped to the toolbar row only, y 40–90.)

### Bug #3 — scripts registered but never ran: missing host access (HIGH, architectural)
A script registered cleanly (`getScripts()` listed it, no error) yet never executed on a fresh tab.
Proof by experiment: fresh example.com tab, no click → title "Example Domain", banner 0; after one real
toolbar click on that tab (activeTab grant) + reload → title "HGF-TEST-RAN", banner 1. Chrome docs
confirm: user scripts run only on sites the extension can access — `"userScripts"` permission AND
`"host_permissions"` are both needed.
**Fix:** `optional_host_permissions: ["*://*/*"]` in `wxt.config.ts` (optional, per-site — same
trust-first pattern as ScriptSentry; no required host permissions added); `scriptHasHostAccess()` +
`requestHostAccess()` in `entrypoints/shared/engine.ts`; background `MSG_SCRIPTS_STATUS` returns
per-script `hostAccess`; dashboard shows a warning + **"Grant site access"** button on enabled scripts
without access (Chrome's own prompt, needs the click gesture); floating window note says which scripts
need site access. Verified live in 6c2/6c3/6c4/6d (real Allow click → `contains()===true` → script runs).

### Bug #4 — dashboard showed stale tasks/scripts (found during the re-test)
Tasks and scripts were loaded **once at startup**, so a task saved from the floating window never
appeared in the dashboard's Tasks tab (live test: floating saved 1 task, Tasks tab still showed 0 rows)
until the page was reloaded; same for a script toggled from the floating window.
**Fix** (`entrypoints/dashboard/main.ts`): `selectTab` now re-reads storage when switching to the Tasks
or Scripts tab (same pattern Logs/Scripts already used), plus `chrome.storage.onChanged` listeners for
the tasks key and the scripts/errors keys so the lists live-update while the page is open.
Verified live in 5a–5d.

### Bug #5 — floating window's Tasks / Active Scripts sections never refreshed (found during the re-test)
Both sections rendered once at injection and never refreshed, so a script installed in the dashboard
(or site access granted for it) never appeared in an already-open floating window — the live test
injected the floating, installed a script, granted site access, and the floating still listed no scripts.
**Fix** (`entrypoints/floating.ts`): each section registers its re-run (`floatingRefreshers`); refreshers
fire when the window is shown again after being hidden and live on `chrome.storage.onChanged` for the
tasks/scripts/errors keys (listener registered once per tab). The bridge banner is unchanged (one-shot
by design, dismissal persisted).
**Second-order miss caught by the same test:** the first version of this fix still failed 6c2/6e — the
scripts section returned early while "Allow User Scripts" was off, so its refresher was never
registered and the section stayed frozen after the toggle was turned on. The early return is removed;
`refresh()` now re-checks availability on every run (banner + list heal together).
Verified live in 6c2 (floating note live-updated to "…1 needs site access") and 6e (list + clean note).

## Harness bugs fixed along the way (mine, not the extension)

- `clicker2.py`: pixel loop shadowed the geometry variable `g` (`AttributeError`); fixed by renaming.
- Gem detector must scan the toolbar row only (y 40–90) — the dashboard tab's gem favicon (added by
  the favicon fix) sits at y≈18 and caused a misclick that switched tabs.
- `allow` step: the "widest x-cluster" logic merged the whole permission bubble into one 400px cluster
  and clicked its middle (run 4). Replaced with solid-run detection (runs ≥ 40px of light blue,
  merged across rows with a 14-row gap so the dark "Allow" text does not split the pill into two
  too-short bands), with a fallback to the tallest band rect. Verified: rect x 781..846 y 252..289 →
  clicked (813,270) → access granted. The `allow` step now also saves `allow-shot.png` for debugging.
- 6c2 pre-grant check must use a **fresh tab**: reloading the toolbar-clicked tab silently re-uses its
  activeTab grant (reload keeps the grant), so the script ran and the check wrongly failed.
- Test 8's row/tab counts are baseline-relative (leftover tasks must not fail it on their own); the Logs
  check looks for the slow URLs, not the task names (log entries show hostname + URL).

## Open limitations (not hidden)

1. **Store repo is empty** (`BidyutRoy2/hiddengem-flow-store`, created 2026-11-14, size 0). The live
   fetch path is unverified; the failure path (jsDelivr → raw → cache → honest "not published yet"
   message) is verified live (test 7). Only the owner can publish `index.json` — not fixable from code.
2. **Scripts need TWO user grants, not one.** (a) **Allow User Scripts** (`chrome://extensions` →
   HiddenGem Flow → Details → ON, then reload) — the extension cannot flip it; the banner explains it.
   (b) **Site access** for the script's @match sites — Chrome only runs a userscript where the extension
   has host access; granted per site from the Scripts tab ("Grant site access", Chrome's own prompt) or
   wholesale from Details → Site access → "On all sites". Without (b) a registered script is inert,
   and the UI says so.
3. **Not live click-tested in real Chrome on the owner's machine** — the owner's Load Unpacked test
   (README steps 5–11) is still the real end-to-end check on their own machine. Firefox is not built
   (Chrome first by decision).
4. **Real toolbar click was done via XTest mouse click** (not a human hand); the Grant prompt Allow click
   was a pixel-located XTest click. Playwright per-page videos saved 0 files — the preview video is the
   ffmpeg desktop recording.
5. **Test harness** lives in `/tmp/hgf-live-test/` (not in the repo): `live-test4.cjs`, `run-full4.sh`,
   `clicker2.py`, `proxy-relay.cjs`, `slow-server.cjs`, `results4.json`, `run4.log`. The final run's
   profile is `profile-full4` (script installed + site access granted for example.com, toggle ON).

## Run history

| Run | Version | Result | Notes |
|---|---|---|---|
| 1 (`live-test.cjs`) | 1.0.0 | — (not counted) | Found bug #1 (world ISOLATED) + bug #2 (favicon); 4a–5d failed on SW-evaluated injection (harness limitation, no user gesture) |
| 2 (`live-test2.cjs`) | 1.0.1 | 13 PASS / 8 FAIL | World fix verified; 4a–5d failed on the clicker `g`-shadowing bug; found bug #3 (host access) |
| 3 (`live-test3.cjs`) | 1.0.1 | — (not counted) | Real toolbar click proven; host-access grant verified (probe13); 5a failed on the gem-favicon misclick cascade |
| 4 (`live-test3.cjs`) | 1.0.1 | 19 PASS / 10 FAIL | Found bug #4 (dashboard staleness); `allow` click missed (400px cluster); 6c2 used a granted tab |
| 5 (`live-test4.cjs`) | 1.0.1 | — (not counted) | Dashboard fix verified (5a–5d PASS); `allow` detector still missed (text split the pill); `ctx` typo; test-8 log check wrong |
| 6 (`live-test4.cjs`) | 1.0.1 | 27 PASS / 2 FAIL | `allow` fix verified (6c3/6c4/6d PASS); found bug #5 (floating staleness); `EXAMPLE` typo |
| 7 (`live-test4.cjs`) | 1.0.1 | 27 PASS / 2 FAIL | Bug #5's first fix missed the early-return case (6c2/6e failed on stale note/list) |
| **8 (`live-test4.cjs`)** | **1.0.1** | **29 PASS / 0 FAIL** | **Final. All tests pass, including the live floating refresh (6c2/6e).** |
| 9 (`live-test5.cjs`) | 1.0.2 | 4 PASS / 2 FAIL | Harness bugs only (innerText on a Shadow-DOM page; innerText vs CSS-uppercased headings); popup UI itself verified correct in the screenshots |
| 10 (`live-test5.cjs`) | 1.0.2 | 5 PASS / 1 FAIL | Test 1 fixed; test A failed only on popup size (1288×1031) — real bug, see addendum |
| **11 (`live-test5.cjs`)** | **1.0.2** | **6 PASS / 0 FAIL** | **Final. Popup 360×680, no duplicate, regression clean.** |

---

# Addendum — v1.0.2: standalone floating window (no website open)

**Date:** 2026-11-15 (runs 9–11, finished 2026-11-14T21:34:22Z = 2026-11-15 03:34 Dhaka).
**User report:** toolbar click did nothing on a Brave new tab page (screenshot, no site open).
**Root cause (already verified, not re-diagnosed):** the floating window is a content script injected into
the active tab; Chrome forbids injection on `chrome://`, `brave://`, Web Store, `about:blank` and new-tab
pages. No `chrome_url_overrides` — the user's new tab page is never replaced.

## What changed (v1.0.2)

- **New entrypoint `entrypoints/float/`** (`index.html`, `main.ts`, `style.css`), built as `float.html`:
  same floating UI as the in-page window (header + gem logo + "HiddenGem Flow", Daily Tasks with Open All,
  Active Scripts, Open Dashboard, GitHub link to `https://github.com/BidyutRoy2/hiddengem-flow-store`,
  Close button closing the window). Reuses `shared/tasks.ts` / `shared/scripts.ts` — no duplicated storage
  logic. Differences: no Shadow DOM (it is its own page), no internal drag (the OS window drags),
  "Add current site" disabled with the hint "Open a website to add it". Scripts list shows all enabled
  installed scripts (no page URL exists to match against), with an honest note.
- **`entrypoints/background.ts`:** `handleToolbarClick` routes by URL scheme — `http(s)://` keeps the exact
  old behaviour (sendMessage toggle, fallback `executeScript` inject); anything else opens the popup via
  `chrome.windows.create({ url: float.html, type: "popup", width: 360, height: 680, focused: true })`.
  `openFloatPopup` tracks the window id (cleared on `chrome.windows.onRemoved`) and focuses an already-open
  popup instead of duplicating it. Injection failure on an http(s) page falls back to the popup.
  `openDashboard` now targets a normal browser window so the dashboard never opens inside the popup.
- **Permissions unchanged** — still exactly `storage, tabs, scripting, activeTab, userScripts, notifications`
  + optional `*://*/*`; `chrome_url_overrides: None` (verified in the built manifest).

## Bug found live — `chrome.windows.create` bounds ignored under bare Xvfb (real, fixed in code)

Run 10's test A failed only on size: the popup was a real `type: "popup"` window, but 1288×1031 at 0,0
instead of 360×680. A standalone probe (`/tmp/hgf-live-test/probe-windows.cjs`, no extension code in the
call) proved the cause is the environment, not the extension: a plain
`chrome.windows.create({ url: "about:blank", type: "popup", width: 400, height: 500, left: 100, top: 80 })`
still opened at **1280×900, 0,0** (the main window's bounds) and stayed there 1.2 s later — while a
follow-up `chrome.windows.update(id, { left: 920, top: 300, width: 360, height: 680 })` was honoured
immediately. In this environment (Chrome for Testing 158 under Xvfb, no window manager) `create()` bounds
are ignored and `update()` bounds are honoured. Fix (`background.ts`, `enforceFloatPopupSize`): after
creation the background calls `windows.update({ width: 360, height: 680 })`, verifies with
`windows.get`, and retries once after 300 ms. Position is deliberately left to Chrome/OS. On a normal
desktop both calls agree and the update is a no-op. Run 11 then passed 6/6 with the popup at exactly
360×680 (`outerWidth`/`outerHeight` 360×680).

## Per-test results (final run 11, `live-test5.cjs`)

| Test | Result | Evidence |
|---|---|---|
| 0. Service worker starts | PASS | SW running: `chrome-extension://ipapngeacaeambjbojpfaffneeabeeke/background.js` |
| 1. `chrome://extensions` lists HiddenGem Flow 1.0.2, enabled, no error badge | PASS | Card shows 1.0.2; SW running (`01-extensions-page.png`) |
| **A. New-tab page + REAL toolbar click → standalone popup** | **PASS** | NTP=`chrome://new-tab-page/`; popup `type=popup` **360×680** at 0,0, `outer=360×680`; all sections present (header, "No website open", Daily Tasks, Add disabled + hint, Active Scripts + Allow User Scripts banner, Open Dashboard, GitHub link); screenshots `20-float-popup-newtab.png` (360×680) + `20b-desktop-popup.png` (full desktop, popup small at top-left over the NTP) |
| **B. Second toolbar click → NO duplicate, existing popup focused** | **PASS** | Float pages stayed at 1; popup `type=popup`, `focused=true` at 920,300 after the test moved it aside (`21-float-popup-focused.png`) |
| **C. Regression: REAL toolbar click on example.com → in-page floating still opens + drags** | **PASS** | Floating visible at 944,72 (322×508); drag moved it to 844,132 (`22-floating-example-regression.png`) |
| **D. From the popup: Open Dashboard opens a normal window; Close closes the popup** | **PASS** | Dashboard opened in a `type=normal` window; popup closed via its Close button (`23-dashboard-from-popup.png`) |

**Error collectors (final run):** console errors **0**, page errors **0**, failed requests **0**.
(`results5.json`, `run5.log` in `docs/live-test/`; harness `live-test5.cjs` / `run-full5.sh` / `clicker2.py` in
`/tmp/hgf-live-test/`, profile `profile-full5`, desktop recording `docs/live-test/preview-1.0.2.mp4`.)

## Harness bugs fixed along the way (mine, not the extension)

- **Run 9, test 1:** `chrome://extensions` is a Shadow-DOM page — `document.documentElement.innerText`
  is empty there. Replaced with the `shadowText()` walker from `live-test4.cjs`.
- **Run 9, test A:** the float page's headings are uppercased by CSS `text-transform`, so `innerText`
  returns "DAILY TASKS" / "ACTIVE SCRIPTS" and the `/Daily Tasks/` check failed even though the popup was
  correct (visible in `20-float-popup-newtab.png`). Section checks now use `textContent`.
- **Run 10, test A:** Playwright's fixed `viewport: { 1280, 900 }` was suspected of resizing the popup;
  switching to `viewport: null` did **not** change the size (1280×900) — the probe above proved the real
  cause is `chrome.windows.create` bounds being ignored under bare Xvfb. `viewport: null` was kept
  (harmless, and it makes page screenshots the window's true size). Also added an Escape press to dismiss
  a stray NTP "Add shortcut" dialog the pin-flow's neutral click can open (it did not block the click;
  it was still visible behind the popup in one desktop frame).
- **Run 9, test B note:** the move-to-(920,300) silently did nothing while the popup was 1288×1031
  (same ignored-geometry cause); after the `enforceFloatPopupSize` fix the move works and the popup was
  focused at 920,300.

## Open limitations (v1.0.2, not hidden)

1. **Popup placement is Chrome's default** (0,0 under bare Xvfb, covering the main window's left edge).
   On a real desktop Chrome places a new popup near the main window. The extension does not force a
   position — only the 360×680 size.
2. **Not tested on the owner's own Brave** — the owner's Load Unpacked test (README step 12) is the real
   check on their machine, where a real window manager honours `create()` bounds directly.
3. **Store repo is still empty** (from the v1.0.1 audit) — the store's honest "not published yet" path is
   unchanged by this release; only the owner can publish `index.json`.

---

## Dev build 2026-11-15 (pre-final, version 1.0.0) — live-test addendum

**Versioning rule (new, user-set):** the extension is not final yet, so there are no more version bumps. This build — and every pre-final dev build — stays at **1.0.0**; the final release will be **v1.0.0, the first version**. The `1.0.3` number used during this build's development is retired (this is the only place in the repo that still names it, as the record of the retirement): `package.json`, the manifest (via WXT), the dashboard header/Settings/footer, the float popup footer, the in-page floating footer, the background install log, the uploader footer and the README all read `1.0.0`; the CHANGELOG entry for this work is `Unreleased`, not a numbered release. Code comments that marked the changes with that number now say `Unreleased`. (The `1.0.1` / `1.0.2` labels in the older sections above are history — the builds that were actually delivered under those numbers — and are left as-is.)

**What changed in this dev build** (this build's scope, now Unreleased): Phase 2 Daily Tasks fixes (Open All counts via `formatOpenResult`, first-tab-only foreground, duplicate-URL rejection, float-popup manual add); live "User Scripts: ON / OFF" + "Open extension details to enable" button in both floating windows; the **GitHub-connected** Store Uploader (revised spec — see below); any-text-file script import/export incl. `.txt`; the removed product name is gone everywhere (grep 0, see below); copy polish; and Find Script now shows when the store was last fetched (`· fetched <time>` on live loads; cached loads already showed `· cached from <date>`).

### Harness runs (live-test6.cjs — real Chrome for Testing 158, Xvfb, Playwright + XTest clicks)

| Run | Result | Notes |
| --- | --- | --- |
| Run 1 | 5 PASS / 3 FAIL | All 3 failures were harness bugs, not the extension: test 2 asserted the tab list once (a just-created tab reports `url ""` until navigation settles); test 3 read the Polymer details page once (renders late, and the walker picked up `<style>` text); test 4 used a hash-only `goto` on an already-loaded dashboard (no reload, Scripts panel stayed hidden). The extension behaviour in each was verified separately (duplicate rejection + Open All status in screenshots `24`/`25`; popup add + details-page URL in `26`/`27`; see the isolated probe below). Node smoke `/tmp/hgf-smoke6.cjs`: **30/30** (duplicate checks, `formatOpenResult`, `createScript` fallback name, `nonJsExtension`/`fileBaseName`, regressions). |
| Run 2 | 5 PASS / 3 FAIL | Tests 4/5/7 fixed by the harness changes. Test 2: my assertion was wrong, not the code — the dashboard opens in sorted order (newest first), so the first opened tab is `example.net`, and it *was* the active one. Tests 3/6: the XTest `pinflow` click failed once under load (menu rendered late); test 6 cascaded from it (gem never pinned). |
| Run 3 | **7 PASS / 1 FAIL** | Tests 0–2, 4–7 pass (see table below). Only test 3's final text assertion failed: the details tab opened at the correct URL, but the harness poll never found "Allow User Scripts" in that loaded run (Polymer render delayed past the 15 s poll). Closed by probe16 v2 below. |

**Run 3 per-test table** (extension id `ipapngeacaeambjbojpfaffneeabeeke` throughout):

| Test | Result | Evidence |
| --- | --- | --- |
| 0 — service worker starts | PASS | `chrome-extension://…/background.js` |
| 1 — `chrome://extensions` lists HiddenGem Flow 1.0.0, enabled | PASS | Card shows HiddenGem Flow 1.0.0 (screenshot in run log) |
| 2 — Dashboard Tasks: duplicate rejected; Open All counts; exactly one opened tab active (the first) | PASS | Duplicate error "This site is already saved." (`24-dashboard-duplicate.png`); Open All status "Opened 3 tabs." (`25-dashboard-openall.png`); tabs query: `example.net active:true`, `example.org active:false`, `example.com active:false` — net is first because the list is newest-first |
| 3 — Float popup: manual add, duplicate rejected, User Scripts OFF + Details page opens (toggle stays OFF) | FAIL (harness text-read only) | Manual add + duplicate rejection worked; status OFF + button visible; click opened `chrome://extensions/?id=<id>` in a normal window; `chrome.userScripts.getScripts()` still threw (toggle OFF). Only the "Allow User Scripts" string was not found by the poll in that run — see probe16 v2, which closes it. Screenshot `27-extensions-details.png` (list view in that run) |
| 4 — Scripts: `.txt` import (scan + confirm), Export `.user.js` + Export `.txt` | PASS | Imported "Txt Import Test" from `.txt`; exports `Txt_Import_Test.txt` + `Txt_Import_Test.user.js`, identical 295-byte content |
| 5 — Store Uploader (download-only version, since replaced) | PASS (superseded) | Import → `.user.js` (336 bytes) + `index.json` read back correct. **This tested the old download-only uploader** — see probe17 for the revised GitHub-connected one; screenshots `29-store-uploader.png` is the old page |
| 6 — Regression: in-page floating opens/drags, User Scripts OFF, Open All reports the count | PASS | Floating at 944,72 322×678; drag 944,72 → 844,132; status "User Scripts: OFF"; Open All "Opened 4 tabs." (`30-floating-us-off.png`) |
| 7 — grep: zero matches for the removed product name in built output + repo | PASS | 0 matches in `.output/chrome-mv3` and 0 in the repo (source, docs, tools) |

**Pre-test fix (real bug, caught before the live test):** the first version of `openExtensionDetails` used a bare `chrome.tabs.create({url})`, which would have opened the Details tab *inside the popup window* when the popup was focused (same bug class v1.0.2 fixed for the dashboard). Fixed by extracting `createTabInNormalWindow()` in `background.ts`, now shared by `openDashboard()` and `openExtensionDetails()`.

**probe16 v2 — closes run-3 test 3** (`~/workspace/hgf-live-test/probe16.cjs`, screenshot `27b-extensions-details-toggle.png`): opening `chrome://extensions/?id=<id>` directly shows the Details view; the shadow-DOM text contains "Allow User Scripts" (found at 3 s) and the toggle is visibly **OFF** (grey, left) with Chrome's warning text; `chrome.userScripts.getScripts()` still throws. So: the button opens the right page, the toggle is there, and the extension did not and cannot flip it.

**probe14 (isolated, run-1 test-2 reproduction):** `open-urls` returned `{ok:true, opened:3, skipped:0, invalid:0}`; immediately after the response 5 tabs existed (about:blank, dashboard, example.com `active:true`, example.org loading, example.net with `url ""` still loading); after 2 s and 4 s all 3 example tabs existed with example.com `active:true`. Proves the extension code was correct in run 1 — the harness's single non-retried query was the failure.

**Harness bugs fixed along the way (mine, not the extension):** (a) test 2 polls `chrome.tabs.query` until 3 `https://example.*` tabs exist (up to ~12 s) and checks the active flag *before* the dashboard screenshot (screenshotting the dashboard re-activates it); (b) test 3 polls the details-page text up to ~15 s and the walker skips `<style>`/`<script>` nodes; (c) test 4 clicks the Scripts tab button instead of a hash-only `goto`; (d) error collectors de-duplicated with a `WeakSet` (the same error was recorded twice before); (e) `pinflow` retried up to 3 times; (f) the active-tab expectation corrected to the sorted (newest-first) order.

**Error collectors (run 1):** console errors 43 events / 40 unique, page errors **0**, failed requests **0**. The console errors are favicon 404 noise (Google s2 favicon loads + `favicon.ico` requests on example.com/about:blank pages — same class as v1.0.1's 12 favicon 404s), not extension errors. No page error or failed request in any run.

### probe17 — revised GitHub-connected Store Uploader (16/16 PASS)

`~/workspace/hgf-live-test/probe17.cjs`, `file://` in real Chromium, screenshots `31`–`34`. The old download-only uploader was replaced wholesale (spec change); the new page has a GitHub connection section (owner/repo/branch + fine-grained PAT, localStorage only, **Test connection**, **Forget token**), a **Publish** flow (GET fresh `index.json`+sha → PUT `scripts/<slug>.user.js` → PUT updated `index.json` → purge jsDelivr for both files, sha-conflict refetch+retry once), a **Live Scripts** view (TOTAL count + search + upgrade form with suggested version bump), and the no-token download fallback. Entry format is exactly what `shared/store.ts` expects (`name, version, author, description, matches, codeUrl` to the raw file under `scripts/`, `updatedAt`).

| Check | Result |
| --- | --- |
| `slugify("Titan Quick Buy")` → `titan-quick-buy` | PASS |
| `suggestVersionBump("1.0.0")` → `1.0.1` | PASS |
| Purge URL format, index: `https://purge.jsdelivr.net/gh/BidyutRoy2/hiddengem-flow-store@main/index.json` | PASS (exact match, evaluated live in the page) |
| Purge URL format, script: `…/scripts/titan-quick-buy.user.js` | PASS (exact match) |
| Raw `codeUrl` under `scripts/` | PASS (exact match) |
| Import fills name/version/description/@match from pasted userscript | PASS (`31-uploader-import.png`) |
| **Wrong token: Test connection shows a plain error** | PASS — "GitHub said 401 — the token is wrong or expired. Generate a fresh one (steps above) and paste it again." (`32-uploader-wrong-token.png`) |
| Wrong token: token NOT saved to localStorage | PASS (`null` — the page saves only on a successful connection) |
| **Wrong token: Publish shows a plain error** | PASS — "GitHub said 401 — the token is wrong, expired, or has no access to this repo…" |
| **Wrong token: ZERO PUT requests to api.github.com** | PASS — only 2 safe GETs observed (Test connection contents check + Publish's index GET); 0 PUTs |
| Forget token clears field + storage | PASS |
| No-token fallback: Download `.user.js` | PASS — `uploader-test.user.js`, 288 bytes, header + code verified |
| No-token fallback: Download `index.json` | PASS — parses; entry exact: name "Uploader Test", v1.2, `codeUrl` `…/main/scripts/uploader-test.user.js`, matches `["https://example.com/*"]`, `updatedAt` present (`33-uploader-fallback.png`) |
| Live Scripts (no token): honest empty-store message | PASS — "0 script(s) in the store — index.json is not published yet…" (`34-uploader-live-scripts.png`) |
| No page errors on the uploader page | PASS (0) |

Console errors on the uploader page: **3, all expected API answers, not page bugs** — two `401` (the deliberate wrong-token Test connection + Publish GETs) and one `404` (the public jsDelivr index for the empty store). **Honest limit:** no real token was used and no real push was made — the GitHub-push path is verified by code inspection + the failed-auth test + the fallback test only. The owner's first real publish (with his token) is still the live proof. Two harness findings on the way: the sandboxed browser cannot reach the internet directly (direct TLS fails; `curl` works through the egress proxy), so the harness runs a local relay (`~/workspace/hgf-live-test/proxy-relay.cjs`, `127.0.0.1:18080`, CONNECT tunnelled end-to-end, no MITM); the first relay build crashed on a plain-HTTP Chrome-internal request (Node 24 rejects a `Host` header that differs from the request authority) — fixed by not overriding `Host` and by catching handler errors, and verified stable since (relay still answered 200 after the run).

### probe18 — Find Script "Store fetched" line (PASS)

`~/workspace/hgf-live-test/probe18.cjs`, screenshot `35-find-script-fetched.png`. The real store repo is empty, so a successful fetch is impossible against the live network — the jsDelivr index response was **stubbed with `page.route`** (the extension's real fetch/cache/render flow ran; only the store's answer was faked, and this paragraph says so). Results: **0 store requests before the Load store click** (no auto-fetch — the privacy design holds); after the click the meta line reads **"1 script · fetched 11/14/2026, 10:15:10 PM"** with the `jsDelivr` source badge, and the stubbed script is listed. (The date shown is the VM's clock, UTC; on the owner's machine it shows his local time.)

### What is still NOT verified (honest)

1. **The real GitHub push** — no real publish, no real upgrade, no real purge call has ever run (no token here). Wrong-token + fallback + code inspection is the verification that exists. The first publish is the owner's.
2. **Non-JS inspect-only warning, live** — the `.py` "cannot run in a browser page" path was covered only by the Node smoke test (30/30, see run 1 above), not by a live browser check. The smoke file itself (`/tmp/hgf-smoke6.cjs`) was lost in the `/tmp` wipe below; the helpers it covered were re-verified live in runs 1–3 and probe17's in-page checks.
3. **The store repo is still empty** (jsDelivr `index.json` 404, verified again through the relay in this session) — Find Script's live path can only show the honest "not published yet" message until the owner publishes.
4. **`/tmp` wipe (2026-11-15 ~22:09):** the runtime cleared `/tmp` mid-session and destroyed the whole harness (`live-test6.cjs`, `run-full6.sh`, `clicker2.py`, the relay, profiles, `results6.json`/`run6.log`, the smoke test). Results above are the run outputs recorded in the session, not re-runnable from the lost files. A minimal persistent harness was rebuilt under `~/workspace/hgf-live-test/` (playwright-core installed, `proxy-relay.cjs`, `probe16.cjs`, `probe17.cjs`, `probe18.cjs`) so this cannot happen again.
5. **Owner downgrade warning:** the owner currently has the v1.0.2 unpacked build installed. This dev build is version **1.0.0** — lower than 1.0.2. Loading it unpacked over the installed one may make Chrome complain (version downgrade). If it does, the workaround is to remove the old unpacked entry from `chrome://extensions` first and load this build fresh. Nothing was changed in this build because of that; the instruction is to report it honestly, not to hide it.

### Screenshots / video (this dev build)

`24-dashboard-duplicate.png`, `25-dashboard-openall.png`, `26-float-popup-add.png`, `27-extensions-details.png`, `27b-extensions-details-toggle.png` (toggle visibly OFF), `28-txt-import.png`, `29-store-uploader.png` (old download-only page — superseded), `30-floating-us-off.png`, `31-uploader-import.png`, `32-uploader-wrong-token.png`, `33-uploader-fallback.png`, `34-uploader-live-scripts.png`, `35-find-script-fetched.png`, `preview-dev-2026-11-15.mp4` (desktop recording of run 3; renamed under the new versioning rule).

---

## Script Store redesign — dev build 2026-11-15 (pre-final, version 1.0.0) — live-test addendum (probe19 + probe20)

**What changed:** the dashboard tab "Find Script" is now **"Script Store"** everywhere user-facing (dashboard tab, Overview, bridge banner wording + button, floating-window button, uploader, README/docs); storage keys (`hiddengemflow.store.cache.v1` etc.) and code identifiers (`data-tab="store"`, `#store` hash) are unchanged. The listing is now proper **cards** (name, version badge, description, @match sites, Published + Updated dates, **Install** button into the existing scan-then-confirm flow). Header shows the total count and "Store fetched: <time>" on live loads. Sort is Recently updated (default), Latest, or Name A–Z. Index entries gain optional `publishedAt` + `updatedAt`; the uploader sets both on a new publish and keeps `publishedAt` on an upgrade; a missing date shows "Date not listed" (never invented). The bridge sentence changed only in the tab name ("…add it in one click from Script Store."), per the rename instruction. The old Latest/Oldest sort is gone. The float popup has no store-named control (its button is "Open Dashboard"), so nothing there needed renaming.

**Fixtures, stated plainly:** the real store repo is still empty, so there is no real store data to test against. Every listing check below used **3 clearly-marked TEST fixture entries** (seeded into the store cache key, plus one stubbed live fetch): TEST Alpha Script (published 12 Nov 2026, updated 10 Nov 2026, inline code, installable), TEST Beta Script (published 10 Nov 2026, updated 14 Nov 2026, code URL deliberately fake), TEST Gamma Script (no dates at all, no matches). The fixtures were cleared afterwards and the empty state re-verified. No real store script exists yet.

### probe19 — Script Store listing (35 PASS / 2 FAIL)

`~/workspace/hgf-live-test/probe19.cjs`, real Chrome for Testing 158, fresh profile, relay proxy. Screenshots `36`–`41`.

| Step | Result |
| --- | --- |
| Tab label "Script Store", heading "Script Store" | PASS |
| No store request before the Load store click | PASS (0 requests — fetch stays click-only) |
| A: real empty state on Load store (no stub) | PASS — "Could not load the store: The store answered 404." + "The official store repo is not published yet, or it could not be reached right now. No scripts to show — nothing here is fake." + GitHub link (`36-store-empty.png`) |
| B: stubbed live fetch → "Store fetched:" line | PASS — meta "3 scripts · Store fetched: 11/14/2026, 10:42:53 PM", jsDelivr badge, 3 cards, default Recently updated = Beta, Alpha, Gamma (`37-store-cards.png`) |
| C: empty state again after clearing fixtures | PASS |
| D: cached copy renders | PASS — meta "3 scripts · cached from 11/14/2026, 10:43:02 PM" |
| D: 3 cards with version badges + Install buttons | PASS (v2.1.0 / v1.0.0 / v0.5.0) |
| D: Alpha dates "Published 12 Nov 2026 · Updated 10 Nov 2026" | PASS (exact string) |
| D: Beta dates "Published 10 Nov 2026 · Updated 14 Nov 2026" | PASS (exact string) |
| D: Gamma "Published Date not listed · Updated Date not listed" | PASS (exact string) |
| D: Alpha matches line "Runs on https://example.com/*" | PASS |
| D: Gamma matches line says runs nowhere | PASS |
| D: sort Latest (published desc) = Alpha, Beta, Gamma | PASS |
| D: sort Name A–Z = Alpha, Beta, Gamma | PASS |
| D: sort Recently updated (default) = Beta, Alpha, Gamma | PASS |
| D: search "beta" → only Beta; "example.com" (@match) → only Alpha | PASS / PASS |
| D: search no match → "No scripts match your search." | PASS |
| D: clearing search restores 3 cards | PASS |
| D: Alpha Install → detail → scan (inline code) → Add script → Confirm install → installed | PASS — "Installed as “TEST Alpha Script” v1.0.0 — see the Scripts tab."; Scripts tab lists it |
| D: Alpha detail meta shows both dates | PASS |
| D: Beta detail → honest fetch error (fake codeUrl 404) | PASS — "Could not fetch this script's code: The server answered 404." |
| G: floating window injects on example.com | **FAIL — by design, not a bug** (see below) |
| E: empty state again after clearing fixtures + removing the TEST script | PASS (`39-store-empty-after-cleanup.png`) |
| F: new entry sets publishedAt = updatedAt = today | PASS |
| F: upgrade keeps publishedAt, updates updatedAt | PASS |
| F: upgrade of a dateless entry leaves publishedAt empty | **FAIL — real uploader bug, caught by the test** (see below) |
| F: entry preview shows both dates | PASS (`40-uploader-dates.png`) |
| G: all 6 dashboard tabs switch | PASS |
| G: standalone float popup renders | PASS (`41-float-popup.png`) |

**Failure 1 — floating inject refused (expected, same design as v1.0.1 finding #3):** `chrome.scripting.executeScript` from the service worker was refused with "Cannot access contents of url https://example.com/. Extension manifest must request permission to access this host." The extension requests no host permissions (only optional `*://*/*`), so injection without a toolbar click (activeTab grant) or a granted optional permission is correctly blocked. The rename in the floating window is verified instead in the built output: `floating.js` contains "Open Script Store" (1×) and "add it in one click from Script Store", with **0** "Find Script" remaining — plus the live float-popup render and the in-page floating drag regression from run 3 (only a button-label string changed in `floating.ts` since). A live in-page floating check with the new label needs a real toolbar click (the owner's Load Unpacked test, or the XTest clicker, which was lost in the `/tmp` wipe).

**Failure 2 — REAL uploader bug, found by the test and fixed:** `buildEntry(f, cfg, existing)` defaulted `publishedAt` to today whenever the existing entry's `publishedAt` was empty — so upgrading a dateless old entry would have *invented* a publish date, contradicting the spec. Fixed in `tools/store-uploader.html`: when an existing entry is passed in, `publishedAt` is kept exactly as the listed entry has it (even when empty); only a brand-new entry (no existing passed in) gets `publishedAt = today`. Re-verified in **probe20 (6/6 PASS)**: new entry (both dates today), upgrade (keeps 2026-11-10, updatedAt today), upgrade of a dateless entry (publishedAt stays empty), fallback Download index.json with a loaded old index (re-published entry keeps publishedAt 2026-11-10), old index loads, no page errors. The deliverable uploader copy contains the fix; the probe19 F failure no longer applies.

**Error collectors (probe19):** page errors **0**. Console errors **9, all 404 responses, not page bugs**: the jsDelivr + raw `index.json` 404s from the empty store (one pair per real Load store click), Beta's fake code URL 404, and favicon 404 noise. **Store requests seen: 10** — one jsDelivr + one raw per real Load store click (both 404), one stubbed jsDelivr fetch, one raw fetch for Beta's code: no request ever happened before a Load store click.

### Screenshots / video (Script Store redesign)

`36-store-empty.png` (honest empty state), `37-store-cards.png` (cards with dates + Install button), `39-store-empty-after-cleanup.png` (empty again after fixtures cleared), `40-uploader-dates.png` (entry preview with both dates), `41-float-popup.png` (standalone popup). (`38-floating-store-button.png` was not taken — the inject was refused; see failure 1 above.)

### What is still NOT verified (honest)

1. **The real GitHub push** — unchanged from the previous addendum: no real token, no real publish/upgrade/purge has ever run. Push path = code inspection + wrong-token test + fallback test + the date rules verified live in probe20 against local files.
2. **In-page floating window with the new label, live** — see failure 1 above. The label is verified in the built output; the window itself (drag, render) last passed live in run 3.
3. **The real store is still empty** — every listing check used the TEST fixtures above; the first real script must still be published by the owner. **UPDATE 2026-11-15 (probe21, below): the store is now LIVE with one real script — "Markdown Link Copier" v1.0.0 — installed from the live store and run on example.com.**
4. **Owner downgrade warning (unchanged):** this dev build is version **1.0.0**, lower than the v1.0.2 unpacked build the owner has installed — Chrome may complain on Load Unpacked; remove the old unpacked entry first, load fresh.

## GM_notification fix (A-04) — dev build 2026-11-15 (pre-final, version 1.0.0) — live-test addendum (probe21 + probe21b + probe21c)

### The bug (verified live, not guessed)

`GM_notification` never reached the background. In Chrome 158's `chrome.userScripts` USER_SCRIPT world the ONLY chrome API is `chrome.runtime.id` — `chrome.runtime.sendMessage`, `chrome.storage`, `chrome.tabs`, `chrome.notifications` are all `undefined`. The GM shim guarded on `sendMessage` and silently no-opped, so the background `hiddengemflow:gm-notify` handler never fired. Proof: the store script "Markdown Link Copier" copied to the clipboard fine, but `chrome.notifications.getAll()` showed no notification after clicking; a diagnostic userscript in the same world reported `chrome=object, chrome.runtime=object, chrome.runtime.sendMessage=undefined`; the background received zero messages. A direct `chrome.notifications.create` from the service worker DOES work, so the notification plumbing itself was fine — only the GM→background transport was broken.

A 23-path capability probe (`probe-cap.cjs`, same world) confirmed the map exactly: `runtime: object`, `runtime.id: string`, everything else `undefined`; `BroadcastChannel`, `CustomEvent`, `MutationObserver` are functions (standard DOM APIs, available).

`chrome.storage` as a signal transport was ruled out empirically the same way — `chrome.storage` itself is `undefined` in that world, so a storage write from the shim throws and no `onChanged` could ever fire.

### The fix (no new permissions)

- GM shim (`shared/engine.ts` `__notify`): tries `chrome.runtime.sendMessage` first when it exists; otherwise appends a transient signal node (`[data-hgf-gm-notify]`, unique id + title/message as attributes) to the page DOM. A `BroadcastChannel` was deliberately NOT used: it is origin-scoped across tabs, so one tab's signal would be forwarded by the relay in every other tab on the same origin.
- New relay content script (`public/gm-relay.js`, ISOLATED world): drains the node (initial scan + MutationObserver) and forwards it with `chrome.runtime.sendMessage`. Runtime-registered by the background via `chrome.scripting.registerContentScripts` (the `scripting` permission is already held) for exactly the `@match` patterns of enabled scripts — one registration per pattern, so a pattern without host access yet fails alone. Re-attempted on startup, on script register/enable, and on `chrome.permissions.onAdded` (grant). Unregistered when no enabled script needs it.
- Background: dedupes by notification id (in-memory, capped at 200). The notification handler itself is unchanged.
- Note: `chrome.scripting.registerContentScripts` takes file paths for `js`, not `{ code }` objects (a `{ code }` object throws "Invalid type: expected string, found object") — that is why the relay is a plain file in `public/`, shipped verbatim.

### Per-test results (probe21, fresh profile, rebuilt extension, live store)

| Check | Result |
|---|---|
| Allow User Scripts toggle ON | PASS (real click on chrome://extensions details) |
| Dashboard loads (Script Store tab) | PASS |
| Live store loads — "1 script · Store fetched: 11/15/2026, 12:50:22 AM" | PASS (real jsDelivr fetch, no fixture) |
| Live store lists "Markdown Link Copier" | PASS |
| Store detail opens + scan (live code fetched) | PASS |
| Add script → Confirm install → installed message | PASS — "Installed as “Markdown Link Copier” v1.0.0 — see the Scripts tab." |
| Markdown Link Copier listed in Scripts tab | PASS |
| Host access granted (`chrome.permissions.contains`) | PASS (dashboard "Grant site access" + real XTest click on the native Allow button at 817,270) |
| GM relay content script registered for `*://*/*` | PASS — `hgf-gm-relay-5dyr11`, matches `["*://*/*"]` |
| GM round-trip test script registered | PASS |
| "⧉ Copy link" button present on example.com | PASS |
| Notification appears (exactly one, no duplicates) | PASS — `chrome.notifications.getAll()` returns exactly 1 entry |
| Notification title "Markdown Link Copier" / message "Markdown link copied." | PASS — captured the exact `chrome.notifications.create` call in the service worker (probe21c): `{type:"basic", iconUrl:"chrome-extension://…/icons/icon128.png", title:"Markdown Link Copier", message:"Markdown link copied."}` |
| Clipboard holds "[Example Domain](https://example.com/)" | PASS (probes 21b + 21c; see probe21 note below) |
| GM_setValue/GM_getValue round-trip (title HGF-GM-OK) | PASS |
| All 6 dashboard tabs switch | PASS |
| 0 page errors, 0 console errors | PASS |

**Probe21 notes (harness quirks, not extension bugs):**
- `chrome.notifications.getAll()` returns `{id: true}` — booleans, NOT notification objects — so the first title/message checks (which read `.title` off the values) failed while the notification itself existed. There is no `chrome.notifications.get` in the API (`TypeError: chrome.notifications.get is not a function` in the service worker). The title/message were instead proven by wrapping `chrome.notifications.create` in the service worker and capturing the exact options (probe21c).
- Probe21's clipboard read returned `""` once; the same read returned the exact markdown in both follow-up runs (21b, 21c). The copy itself works (the notification's "Markdown link copied." branch only runs after `writeText` resolves); the single empty read was a one-off harness flake.
- The GM round-trip test script (registered directly by the probe, not through the extension's storage) did not run in the 21b/21c sessions: direct `chrome.userScripts.register` calls do not survive a browser restart — only the extension's own storage-backed scripts are re-registered on startup by design. The round-trip result stands from probe21 (in-session, title `HGF-GM-OK`).

**Harness notes (mine, not the extension):** the native permission prompt's Allow button centre is **817,270** on the 1400×1000 test display. Two earlier estimates missed it: 770,273 lands on the right edge of Deny (the pointer sits on the seam), 842,305 lands below-right of the button. A tight 4× crop of the button row settled it. The dashboard "Grant site access" click itself was always fine.

### Screenshots (probe21)

`42-store-md-link-installed.png` (installed message), `43-gm-notification-page.png` (example.com with the Copy link button).

### What is still NOT verified (honest)

1. **The real GitHub push** — unchanged: no real token, no real publish/upgrade/purge has ever run.
2. **Owner's own-machine test** — the Load Unpacked steps on the owner's Brave remain the real end-to-end check.
3. **The relay when host access is granted per-site (not `*://*/*`)** — probe21 granted `*://*/*` via one script; per-pattern registration failure/retry for a single-site grant was not exercised live (the code path is the same `registerContentScripts` call, caught per pattern).

## Probe 22 (2026-11-15): raw-first store fetch (finding A-05)

`~/workspace/hgf-live-test/probe22-rawfirst.cjs`, real Chrome for Testing 158 under Xvfb :99, fresh profile, rebuilt extension (`.output/chrome-mv3`, typecheck clean, `wxt build` OK). The live store now has **4 scripts**; jsDelivr `@main` was verified stale at the same moment (curl: 1 script after 5 "finished" purges) while raw returned all 4 — so a RAW badge plus 4 cards is proof the raw-first path was actually taken, not just code-read.

| Check | Result |
|---|---|
| Dashboard loads (Script Store tab) | PASS |
| Live store loads 4 scripts (Store fetched) | PASS — "4 scripts · Store fetched: 11/15/2026, 1:16:59 AM" (the VM clock is UTC; on the owner's machine it shows his local time) |
| Source badge is raw.githubusercontent (raw-first path taken) | PASS — badge "raw.githubusercontent" (rendered as `RAW.GITHUBUSERCONTENT`) |
| All 4 store scripts listed | PASS — 9Chain Virtual Node Auto, Markdown Link Copier, Titan Exchange Auto Trader Pro by HiddenGem, Universal DOM Diagnostic v2.0 — TM Only (default sort Recently updated) |
| Store detail opens + scan (live code fetched) | PASS — 100/100 · Grade A |
| Add script → Confirm install → installed message | PASS — "Installed as “Markdown Link Copier” v1.0.0 — see the Scripts tab." |
| Markdown Link Copier listed in Scripts tab | PASS |
| 0 page errors, 0 console errors | PASS |

**Probe22 notes (harness, not extension bugs):**
- Run 1 failed 3 checks (empty meta, empty badge, no cards) — the first fetch through the relay in a fresh profile was still in flight at 10 s (the button still said "Loading…"; the fetch completed a few seconds later and the install flow then passed in the same run). The probe now polls the meta line for up to 60 s instead of a fixed sleep. Run 2: **11 PASS / 0 FAIL**.
- The uploader's raw-first change was code-only in this probe (its no-token Live Scripts read was not re-run; the extension path is the verified one). The token path (GitHub API) was untouched by the fix.

### Screenshots (probe22)

`50-store-raw-4-scripts.png` (RAW.GITHUBUSERCONTENT badge + "4 scripts · Store fetched"), `51-store-mdlink-installed-raw.png` (detail: 100/100 Grade A + installed message).

### What is still NOT verified (honest)

1. **The uploader's raw-first Live Scripts read** — the code path changed identically (raw first, jsDelivr fallback), but only the extension's Load store was exercised live in probe22.
2. **Owner's own-machine test** — unchanged: the Load Unpacked steps on the owner's Brave remain the real end-to-end check.
3. **jsDelivr catching up** — irrelevant to the fix now (raw is first), but jsDelivr's own `@main` copy may still show 1 script until its branch cache refreshes on its own schedule.

## Probe 23 (2026-11-15): in-extension update checker (finding A-06)

`~/workspace/hgf-live-test/probe23-update-checker.cjs`, real Chrome for Testing 158 under Xvfb :99, fresh profiles, real GitHub API (no stubbing) via the proxy relay. The live release is `v1.0.0-dev-20261115` (published 2026-11-15T00:03:02Z; zip asset `hiddengem-flow-extension.zip` updated 2026-11-15T01:18:54Z). Typecheck clean, `wxt build` OK. Pure-function smoke (semver, parseRelease, isNewerRelease, shouldCheckNow, isUpdateAvailable): **25/25 PASS** (`~/workspace/hgf-live-test/smoke-updates.ts`, run through esbuild against the current source).

### Phase A — TEST build (`BUILD_DATE` 2026-11-14, older than the live asset): **15 PASS / 0 FAIL**

| Check | Result |
|---|---|
| Floating line shows the real tag | PASS — "Update available: v1.0.0-dev-20261115 — open the Dashboard to download it." |
| Floating line wording | PASS — "open the Dashboard to download it" |
| Dashboard banner appears | PASS — "A newer build is available — v1.0.0-dev-20261115 (updated 15 Nov 2026). Download it from the release page, replace the files in your unpacked extension folder, then press Reload in chrome://extensions. Do not remove the extension — removing deletes your saved tasks and scripts." |
| Banner has the real tag | PASS |
| Banner is honest (Do not remove the extension) | PASS |
| Banner is honest (press Reload in chrome://extensions) | PASS |
| Download opens the real release page | PASS — new tab `https://github.com/BidyutRoy2/hiddengem-flow/releases/tag/v1.0.0-dev-20261115` |
| How to update shows the manual steps | PASS — "1. Click Download the new build and unzip it. 2. In your unpacked extension folder, replace all files with the new ones. 3. Open chrome://extensions and press Reload on HiddenGem Flow. Do not remove the extension — removing deletes your saved tasks and scripts." |
| Dismiss hides the banner | PASS |
| Dismiss persists after reload | PASS |
| Settings shows a fresh Last checked (not never) | PASS — "Last checked: 11/15/2026, 1:29:30 AM" |
| Settings manual check reports available | PASS — "A newer build is available — v1.0.0-dev-20261115. You dismissed the Overview banner for this release — it will show again for a newer one." |
| Settings notes the banner was dismissed | PASS |
| 0 page errors | PASS |
| 0 console errors | PASS |

**Phase A first run: 10 PASS / 5 FAIL — two real extension bugs + one harness block, all fixed before the green re-run:**
- **BUG 1 (real):** after Dismiss, the Settings manual check reported "You are up to date." — `checkForUpdates` returned the dismiss-aware `available`. Fixed: the check returns RAW availability; only the banner / floating line apply the dismiss rule.
- **BUG 2 (real):** the Download `<button>` + `window.open` never opened the release page (tab event timed out, URL empty). Fixed: Download is a real `<a class="primary" target="_blank">` to the release page, href set from the stored record.
- **HARNESS BLOCK:** in a fresh profile the gem starts UNPINNED, so the toolbar template match scored 0.266 at the puzzle icon. The probe now clicks the puzzle icon and the gem inside the extensions menu (menu match 0.984, fires the action); if that still fails, it pins the gem and clicks the toolbar icon. Harness only — no extension change.

### Phase B — DELIVERED build (`BUILD_DATE` 2026-11-15T01:30:00Z, after the live asset): **8 PASS / 0 FAIL**

| Check | Result |
|---|---|
| Background check ran (checkedAt set) | PASS — stored record `{"tag":"v1.0.0-dev-20261115","available":false,"assetUpdatedAt":"2026-11-15T01:18:54Z","checkedAt":1794706227301}` |
| Record says no update available | PASS |
| Record holds the real tag | PASS |
| Dashboard banner stays hidden | PASS |
| In-page floating line hidden | PASS — element exists, `hidden: true` |
| Standalone popup line hidden | PASS — element exists, `hidden: true` |
| Settings manual check reports up to date | PASS — "You are up to date." |
| Settings Last checked is fresh (not never) | PASS — "Last checked: 11/15/2026, 1:30:48 AM" |

**Phase B harness note:** the final dashboard screenshot (`55-update-settings-uptodate.png`) failed once on a Playwright `page.screenshot` fonts-load timeout (30 s) after all 8 checks had passed — a harness flake, not an extension failure. Retaken with a CDP `Page.captureScreenshot` from the same phase-B profile (`~/workspace/hgf-live-test/retake-55.cjs`): Settings shows "You are up to date." with "Last checked: 11/15/2026, 1:32:25 AM". The built chunk was also verified: `BUILD_DATE` `2026-11-15T01:30:00Z` is in `background.js` (the check runs in the background; the dashboard chunk correctly holds only the record helpers — the dashboard asks the background via `MSG_CHECK_UPDATES`, it never fetches the API itself), and the old test date `2026-11-14T00:00:00Z` is absent from the delivered build.

### Screenshots (probe23)

`52-update-banner.png` (banner with the real tag + the three controls), `53-update-floating-line.png` (compact line under the floating header on example.com), `54-update-settings-available.png` (Settings: available + dismissed note), `55-update-settings-uptodate.png` (Settings: "You are up to date." + fresh Last checked), `56-update-no-banner.png` (Overview with no banner — no false positive). All five viewed and confirmed visually.

### What is still NOT verified (honest)

1. **The A-06 self-pointing banner is FIXED (grace window), not just documented** — see the addendum below. The rule itself (an asset updated within 2h of `BUILD_DATE` counts as up to date on the first check) is proven by the 6 pure-function grace cases; a live run against the future uploaded asset is still the owner's to observe (his Brave will not show the banner for the current build after he updates).
2. **Owner's own-machine test** — unchanged: the update banner on his Brave (which still has an older build) is expected to appear once he updates; the replace-files + Reload flow on his machine is still his to run.
3. **Rate-limit path** — the 403/silent-fail + 1 h backoff was verified by code (pure-function smoke) only; the live API never rate-limited during the probes (60/hr/IP, far above one check per 6 h).

### Probe 23 addendum (2026-11-15): A-06 grace-window fix — first-check 2h upload lag

**The flaw:** `BUILD_DATE` is the build time, but the release asset's `updated_at` is its UPLOAD time, always a few minutes later. Every fresh install of the delivered zip compared asset `updated_at` > `BUILD_DATE` and reported an update available pointing at ITSELF — permanently for fresh profiles, not briefly. Dismiss hid it once, but a fresh profile (or cleared storage) showed it again.

**The fix (`entrypoints/shared/updates.ts` only):** `checkForUpdates()` on the first check ever (no release stored yet — a failed check or an empty release list leaves `tag` empty, so the grace still applies on the next attempt) uses the new pure function `isNewerOnFirstCheck()` with `FIRST_CHECK_GRACE_MS` = 2 h: an asset updated at most 2 h after `BUILD_DATE` is the normal upload lag and counts as up to date (the release is stored as seen); only a gap over 2 h counts as a genuinely older build. The semver signal is not graced — a later tag is unambiguous evidence whatever the timestamps say. Later checks keep the plain `isNewerRelease()` rule, so a replaced asset after the first check is still detected. Silent failure + 1 h backoff and the dismiss rule (keyed by tag + asset `updated_at`) are unchanged. No UI change, no new permission, no `chrome.alarms`.

**Verification (same harness, real Chrome 158, real GitHub API, no stubbing):**
- Pure-function smoke (`~/workspace/hgf-live-test/smoke-updates.ts`, esbuild): **31/31 PASS** — 25 existing cases plus 6 new grace cases: gap 5 min → up to date; gap exactly 2 h → up to date (boundary); gap 3 h → update available; asset older than build (delivered build) → up to date; semver bump bypasses the grace window; no-zip release falls back to `published_at`.
- Probe 23 **Phase A re-run** (TEST build `BUILD_DATE` 2026-11-14, gap ~25 h > 2 h): **15 PASS / 0 FAIL** — the change touches the first-check branch, so Phase A was re-run rather than assumed safe: floating line, banner with the real tag, download opens the real release page, How-to, Dismiss hides + persists, Settings reports available + notes the dismissal. 0 page / 0 console errors.
- Probe 23 **Phase B re-run** (DELIVERED build `BUILD_DATE` 2026-11-15T01:30:00Z): **8 PASS / 0 FAIL** — background check ran, record says no update available, real tag stored, banner stays hidden, in-page floating + standalone popup lines hidden, Settings "You are up to date." with a fresh Last checked. 0 page / 0 console errors (verified in the CDP retake, `~/workspace/hgf-live-test/retake-55-grace.cjs` — the probe's final `page.screenshot` timed out twice waiting for fonts to load, the same harness flake as probe23; the screenshot was retaken with `Page.captureScreenshot` from the same phase-B profile).
- The built code was checked directly: the delivered `background.js` contains the grace constant (`7200*1e3`) and the first-check branch (`gap > grace` after the semver check); `BUILD_DATE` `2026-11-15T01:30:00Z` is present, the old test date `2026-11-14T00:00:00Z` is absent.
- **Honest note on what the live runs prove:** the live release asset is still the raw-first build (updated 2026-11-15T01:18:54Z), which is OLDER than the delivered build's `BUILD_DATE` — so Phase B shows no banner under either rule. The grace rule itself is proven by the 6 pure-function cases (a 5-minute gap is the exact upload-lag shape); the live proof against a freshly uploaded asset happens when this build is uploaded as the new release asset and a fresh install checks it.
- Screenshots 52–56 were re-taken by the re-runs (same paths, new build states); 52 (banner, Phase A) and 55 (Settings up to date, Phase B retake) viewed and confirmed.

### Probe 23 addendum 2 (2026-11-15): A-06 later-check self-pointing bug — the OR rule

**The catch:** after the grace fix, the parent's post-upload Phase B (delivered build `BUILD_DATE` 2026-11-15T01:30:00Z, live asset re-uploaded 2026-11-15T01:39:13Z) showed the background first check correctly up to date (record `available:false`, banner hidden, floating lines hidden) — but the Settings manual check reported "A newer build is available — v1.0.0-dev-20261115". The grace window only applied to the first check; later checks used the plain rule (asset `updated_at` vs `BUILD_DATE`), which is always true for the installed build because the upload time is minutes after the build.

**The fix (`entrypoints/shared/updates.ts` only):** new pure function `isNewerThanStored(release, stored, manifestVersion)` — a new tag, a different asset `updated_at` for the same tag, a stored `""` with an asset now present, or a later semver counts as newer; same tag + same asset `updated_at` (or both `""`) counts as up to date. **But the stored rule alone is not the fix:** the first attempt at it made probe23 Phase A fail 13/15 — the banner appeared for the old `BUILD_DATE` 2026-11-14 build, then the manual check said "You are up to date.", because the second check compared the release against the record its own first check had stored and found nothing changed. Later checks therefore OR both rules: the grace rule against `BUILD_DATE` (preserves the installed build's verdict — an old build keeps reporting available, and the verdict clears after an upgrade) OR `isNewerThanStored()` (catches a replaced asset under the same tag within the grace window). Silent failure + 1 h backoff, the dismiss rule, and all UI copy are unchanged. `BUILD_DATE` is now 2026-11-15T01:48:00Z (the rebuild time).

**Verification (same harness, real Chrome 158, real GitHub API, no stubbing):**
- Pure-function smoke (`~/workspace/hgf-live-test/smoke-updates.ts`, esbuild): **40/40 PASS** — 31 existing cases plus 6 new `isNewerThanStored` cases (same tag + same asset → false; different asset → true; different tag → true; stored `""` + asset now present → true; both `""` + same tag → false; semver bump → true) plus 3 new `laterCheck` cases mirroring the branch (old build + same stored record → available; current build + same stored record → up to date — the exact self-pointing bug case; current build + replaced asset within grace → available).
- Probe 23 **Phase B re-run** (DELIVERED build `BUILD_DATE` 2026-11-15T01:48:00Z): **8 PASS / 0 FAIL** — background check ran, record says no update available (`available:false`, tag `v1.0.0-dev-20261115`, asset `2026-11-15T01:39:13Z`), banner stays hidden, in-page floating + standalone popup lines hidden, Settings manual check reports "You are up to date." (the check that caught the bug) with a fresh Last checked. 0 page / 0 console errors (main probe: 8 checks passed, then the known `page.screenshot` fonts-load timeout flake; verified in the CDP retake, `~/workspace/hgf-live-test/retake-55-grace.cjs` — same retake script, re-run against the new build: banner hidden, "You are up to date.", 0 page / 0 console errors).
- Probe 23 **Phase A re-run** (TEST build `BUILD_DATE` 2026-11-14): **15 PASS / 0 FAIL** — floating line, banner with the real tag, download opens the real release page, How-to, Dismiss hides + persists, Settings manual check reports "A newer build is available — v1.0.0-dev-20261115. You dismissed the Overview banner for this release — it will show again for a newer one." 0 page / 0 console errors. (The intermediate stored-rule-only build failed Phase A 13/15 on exactly the two Settings checks — that failure is what proved the OR rule was needed.)
- The built code was checked directly: the delivered `background.js` contains `BUILD_DATE` `2026-11-15T01:48:00Z`; the old test date `2026-11-14T00:00:00Z` is absent from the delivered build; the final build is byte-identical (background.js + all chunks) to the Phase B-tested build.
- Screenshots 52–56 re-taken by these re-runs (same paths); 52 (banner, Phase A) and 55 (Settings up to date, Phase B retake) viewed and confirmed.
- **Honest note:** the live release asset is still the 01:39:13Z upload, which is OLDER than this build's `BUILD_DATE` (01:48) — so Phase B shows no banner under either rule, exactly as the grace fix intends. The live proof against a freshly uploaded asset comes when this build is uploaded as the new release asset and a fresh install checks it (the parent runs one final post-upload Phase B for that).

### Probe 24 (2026-11-15): Daily Tasks export / import (finding A-07)

**What changed:** `entrypoints/shared/tasks.ts` gains pure `buildTasksBackup()` / `parseTasksBackup()` / `mergeTasksBackup()` / `formatImportResult()`; the Daily Tasks tab gains **Export tasks (.json)** / **Import tasks (.json)** buttons (hidden `.json` file input) and a `#taskImportStatus` hint line; invalid files report in the existing `#taskError`. No floating-window controls — dashboard-only, same as the scripts backup. No new permissions, no network, no auto-anything.

**Verification (real Chrome 158, fresh profiles, rebuilt extension):**
- Pure-function smoke (`~/workspace/hgf-live-test/smoke-tasks-export.ts`, esbuild): **36/36 PASS** — backup markers/order/pins/timestamps, parse rejections (wrong app/type/version, non-array, mixed entries refused as a whole, over-500 cap, timestamp fallbacks), merge (round-trip order, normalized-URL duplicate skip, existing rows untouched, duplicate inside the file), format lines.
- Probe 24 (`~/workspace/hgf-live-test/probe24-tasks-export.cjs`): **26 PASS / 1 FAIL**.
  - Profile A: 4 tasks created by hand (Example, MDN, GitHub, Wikipedia), GitHub pinned, Example opened — storage shows `lastOpenedAt` stamped on Example only. Export downloads `hiddengem-flow-tasks-2026-11-15.json`; the file read back has the exact markers, order GitHub (pinned) → Wikipedia → MDN → Example, pins, exact URLs, `lastOpenedAt` only on Example, no ids/favicons; status "Exported 4 tasks to hiddengem-flow-tasks-2026-11-15.json."; file order matches the on-screen list.
  - Profile B (fresh): import → "Imported 4 tasks.", same list/order/pins, stored tasks match the backup field-for-field (ids differ, as designed). Re-import → "Imported 0 tasks — all 4 were already saved.", still 4 rows. `{"hello":"world"}` and a plain-text file → the exact error "That file is not a HiddenGem Flow tasks backup — nothing was imported." with the list unchanged.
  - Profile C (fresh, 0 tasks): export is a valid empty backup (`tasks: []`), status "Exported an empty backup — no tasks saved yet."; importing it → "Imported 0 tasks — the backup was empty.", list still empty.
  - 0 page errors. **The 1 failure is 3 console 404s, not an export/import defect:** Google's favicon service answers 404 for `example.com` (a domain with no favicon), verified directly and through the test proxy; Chrome logs each failed `<img>` load. The extension handles it exactly as designed since Phase 2 — the `<img>` error handler removes the image and the letter tile stays (confirmed in the diagnostic run `~/workspace/hgf-live-test/diag-404.cjs`). See AUDIT.md §7 item 11.
- Screenshots `57-tasks-export-status.png` (export status + pinned list), `58-tasks-imported-list.png` (fresh-profile import, "Imported 4 tasks."), `59-tasks-duplicate-skip.png` (re-import skip counts), `60-tasks-invalid-file.png` (exact error, 4 task sites intact), `61-tasks-empty-export.png` (empty backup) — 57–60 viewed and confirmed; 61 taken by the probe.

### Probe 25 (2026-11-15): Store Uploader script delete (finding A-08)

**What changed:** `tools/store-uploader.html` only — no extension code, no version bump. Each Live Scripts card gains a **Delete** button (two clicks, no `window.confirm()`): first click arms it (red "Confirm delete — removes it from the store" + Cancel link; arming another card moves the arm), second click while armed performs the delete. New `performDelete()` / `ghDeleteFile()` / `filenameFromCodeUrlForDelete()` (strict: the entry's `codeUrl` must be this repo's own raw copy under `scripts/`, checked before any write). Order: token required → codeUrl check → fresh `index.json` → remove only that entry → PUT index ("Remove <name> from store") → DELETE the file with a fresh sha → purge both files (best-effort). Honest outcomes: index failure → "<GitHub's error> Nothing was deleted."; file failure after a successful index PUT → partial-failure line with the manual-delete path; success → "Deleted <name> — removed from the store and its file deleted." The list/count update from the delete result itself (a refresh click would clear `#liveError` first and erase a partial-failure message). The page also states deleting only stops the store listing — installed copies stay — and there is no download-based delete.

**Verification (real Chrome 158, `file://`, probe25 `~/workspace/hgf-live-test/probe25-delete-uploader.cjs`): 21 PASS / 0 FAIL.** No real script deleted, no real token used — dummy token only; every failure path was proven against the live store index (read back from raw, cache-busted) afterwards.
- Live Scripts loads the real store (4 scripts, no token) with a Delete button on every card; the intro explains delete (keeps local copy, needs token).
- Arm/Cancel state machine exact: first click arms (1 armed + 1 Cancel + 3 plain), Cancel disarms (4 plain, no error left), re-arm works after a failed confirm.
- No token: confirm shows the exact message "Add your token above to delete scripts from the store." with ZERO api.github.com requests (request interception — no read, no write) and the list unchanged.
- Dummy token: confirm shows "GitHub said 401 — the token is wrong, expired, or has no access to this repo. … Nothing was deleted."; no PUT/DELETE reached GitHub; the live index verified unchanged via raw (still 4 scripts, Markdown Link Copier v1.0.1 entry intact with its codeUrl); armed state cleared, button back to Delete.
- Foreign codeUrl (synthetic "TEST Fake Script" entry injected into the rendered list only — the real index was never touched): arms like a real one, confirm shows the exact refusal "This script's file is not in this repo — delete it where it lives." with ZERO api.github.com requests, and the live index still unchanged (4 scripts).
- 0 page errors. The only console entry is Chrome's own log of the deliberately failed 401 request — expected, same as the earlier uploader probe.
- Screenshots `62-delete-button-in-card.png` (Delete on every card), `63-delete-armed-confirm.png` (red armed button + Cancel on Markdown Link Copier), `64-delete-no-token-error.png` (exact token message), `65-delete-dummy-token-401.png` (401 + "Nothing was deleted." + delete log), `66-delete-foreign-codeurl.png` (exact refusal for the fake entry) — 63 and 65 viewed and confirmed; the rest taken by the probe.
- **Honest limit: the real-token success path (index PUT + file DELETE + purges) is untested by the agent — only the user can run it with his PAT, like the first real publish.**
