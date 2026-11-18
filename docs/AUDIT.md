# HiddenGem Flow — Full Deep Audit (v1.0.0)

**Date:** 2026-11-15 · **Audited version:** 1.0.0 · **Auditor:** build coordinator (Phase 5)
**Scope:** whole repo as built — Phases 1–4, `entrypoints/` (background, floating,
dashboard, shared/), `wxt.config.ts`, `package.json`, built output
`.output/chrome-mv3/`. Every finding below was fixed in this version unless it is
listed under Open limitations.

## 1. Build & typecheck

| Check | Result |
|---|---|
| `npm run typecheck` (wxt prepare + `tsc --noEmit`) | **Clean, 0 errors** |
| `npm run build` (WXT 0.19.29, Vite 6.4.6) | **Succeeds** — 1.3 MB total output |
| Built manifest read | name `HiddenGem Flow`, version `1.0.0`, MV3, background service worker `background.js`, `dashboard.html` present |
| Icons in built output (PIL-verified) | 16×16, 32×32, 48×48, 128×128 — all correct dimensions |
| GitHub link in built output | `dashboard.html` ×7, `floating.js` ×2 — `https://github.com/BidyutRoy2/hiddengem-flow-store` |
| Bridge sentence in built output | "already has an official script" — `floating.js` ×1, `dashboard.html` ×2 |
| Runs key in built background | `hiddengemflow.runs.v1` present; `hiddengemflow:stop-all` handler present |

## 2. Manifest / permissions audit

Final permissions: `storage`, `tabs`, `scripting`, `activeTab`, `userScripts`,
`notifications`. No *required* host permissions. No `default_popup` (toolbar click toggles
the floating window). **v1.0.1 adds one OPTIONAL host permission**
(`optional_host_permissions: ["*://*/*"]`) — site access for userscripts,
granted per site only when the user asks (see §7.3); it is not requested at
install and grants nothing by itself.

| Permission | Justified by | Verdict |
|---|---|---|
| `storage` | Position, tasks, scripts, errors, store cache, bridge dismissals, runs — 28 `chrome.storage.local` call sites | KEEP |
| `tabs` | Open dashboard, open task sites, read active tab for "Add current site", run tracking | KEEP |
| `scripting` | Inject floating window on toolbar click only; **Unreleased (A-04):** also runtime-registers `public/gm-relay.js` as a content script for enabled scripts' `@match` patterns — no new permission, runs only where host access is already granted | KEEP |
| `activeTab` | Temporary access to the clicked tab — this is what keeps *required* host permissions at zero | KEEP |
| `optional_host_permissions: *://*/*` | **v1.0.1.** Site access for userscripts (Chrome runs a userscript only where the extension has host access). Optional, per-site, user-granted only; nothing is granted at install | KEEP |
| `userScripts` | Script Manager registration (Phase 3). Requires the separate Chrome toggle "Allow User Scripts" — the UI guards and explains it | KEEP |
| `notifications` | `GM_notification` from a running userscript, plus reminders / scheduled Open All / note due dates / menu & shortcut confirmations | KEEP |
| `alarms` | **Removed (finding A-02)** — requested since Phase 1, zero `chrome.alarms` calls anywhere | REMOVED |

## 3. Security audit

- **No remote code execution** outside the `chrome.userScripts` API. The only
  `eval`-like execution path is Chrome registering a user-confirmed script.
  No `eval(`, no `new Function` in extension source (the strings appear only
  inside the scanner's rule list and documentation).
- **No auto-install.** Every install path (manual create, file import, paste,
  URL import, store install, version upgrade, auto-upgrade offer) ends in an
  explicit user Confirm. Grep-verified: no `registerScript` call is reachable
  without a preceding confirm step in the dashboard flows; the bridge banner
  never installs anything.
- **User data rendering.** Task/script/store/run lists are built with
  `createElement` + `textContent`. The two `innerHTML` paths that interpolate
  data (`renderMeta`, `scanHtml`) pass every value through `escapeHtml`
  (verified by reading both functions). Finding A-01 was the one exception
  (see below) — fixed.
- **Store data is untrusted input.** Store index fields (name, description,
  author, matches) are rendered with `textContent` in the detail view; the
  index is validated (malformed entries skipped + counted); code is fetched
  only on detail-open and always scanned before any install.
- **GM shim (USER_SCRIPT world).** Page JS cannot read/overwrite the shim.
  GM_setValue/GM_getValue are synchronous, backed by per-script namespaced
  page-origin `localStorage` — documented in UI/docs as page-visible, never
  for secrets. Only 4 GM functions exist; anything else throws at runtime
  and is flagged by the scanner. GM_notification goes through the background
  as a real notification.
- **No exfiltration.** Network calls in the whole extension (verified by
  grepping every `fetch(`): (1) Google s2 favicon, best-effort, per task site;
  (2) user-triggered script import from a URL; (3) user-triggered store index
  fetch (jsDelivr → raw.githubusercontent); (4) user-triggered store script
  code fetch. No other network traffic. No analytics, no telemetry.
  (Note, 2026-11-16/17: later phases added four more fetch paths — the
  update checker (api.github.com, automatic, at most once per 6 h), the
  cloud LLM (prompt + key to the chosen provider, opt-in), sync (backup
  payload + token to the user's WebDAV/Gist/Drive, opt-in), and
  GM_xmlhttpRequest (script-driven fetches to @connect hosts) — so the
  four-path list above is the v1.0.0 picture only.)
- **Storage keys (all in `chrome.storage.local`):**
  `hiddengemflow.floating.pos`, `hiddengemflow.tasks.v1`,
  `hiddengemflow.scripts.v1`, `hiddengemflow.scripts.errors.v1`,
  `hiddengemflow.store.cache.v1`, `hiddengemflow.bridge.dismissed.v1`,
  `hiddengemflow.runs.v1`. No secrets are stored anywhere.

## 4. Code review

- **Error handling:** every `chrome.storage` / `chrome.tabs` / `chrome.scripting`
  / `chrome.userScripts` call site is wrapped in try/catch or a rejection
  handler (verified by reading background.ts, engine.ts, main.ts, floating.ts);
  failures surface in the UI (registration errors per script, fetch errors in
  the store tab) instead of failing silently.
- **Duplication:** one shared module per domain (`shared/tasks.ts`,
  `shared/scripts.ts`, `shared/engine.ts`, `shared/store.ts`,
  `shared/runs.ts`); dashboard and floating both use them — `urlMatches`
  is defined once and reused by the engine, the floating Active Scripts list
  and the bridge. Finding A-03 removed one duplicated literal.
- **Dead code:** an export-usage scan found 3 exported constants with no
  in-repo caller — `GM_STORAGE_PREFIX` (fixed by wiring it into the shim,
  A-03), `UNSUPPORTED_GRANTS_NOTE` and `STORE_REPO_URL` (public module
  constants, referenced by the test suites; kept intentionally and noted
  here, not removed).
- **UI audit:** every `id` in `dashboard/index.html` has a handler in
  `main.ts` (checked mechanically — no dead buttons found). Every button's
  label matches what it does; disabled states are real (e.g. Open selected
  disabled with 0 selected, Stop All disabled with nothing running, store
  Install disabled until code is fetched + scanned). Empty states are honest
  ("No task sites saved yet", "No scripts installed yet", "No runs yet",
  "The official store repo is not published yet") — no demo data anywhere.

## 5. Smoke tests — 181 passed, 0 failed

| Suite | What it covers | Result |
|---|---|---|
| Phase 1 jsdom floating (`/tmp/hgf-test/smoke-floating.cjs`) | host created, Shadow DOM, host page untouched, toggle/minimize/close, drag + position save, dashboard button, honest empty states | **18/18** |
| Phase 1 jsdom dashboard (`/tmp/hgf-test/smoke-dashboard.cjs`) | live counts from seeded storage, tab switching, position reset | **9/9** |
| Phase 2 pure functions (`/tmp/hgf-phase2-test/test.mjs`) | normalizeUrl (13 cases), CRUD, pinned-first sort, search, favicon, markOpened | **34/34** |
| Phase 3 pure functions (`/tmp/hgf-phase3-test/test.cjs`) | parseMetadata, urlMatches, securityScan, history/rollback, versions/diff, GM shim surface | **73/73** |
| Phase 4 pure functions (`/tmp/hgf-phase4-test/test.mjs`) | store index validation, sort/search, bridge match + dismissal, run pruning/stop | **47/47** |
| **Total** | | **181 passed, 0 failed** |

## 6. Findings — all fixed in v1.0.0

| ID | Severity | Finding | Fix applied |
|---|---|---|---|
| A-01 | High | `floating.ts`: the site line `On: ${location.hostname \|\| location.href}` was interpolated into `win.innerHTML`. Hostname cannot contain markup, but the `location.href` fallback could, and markup there would execute in the extension's isolated world. | Replaced with a `[data-site]` element whose `textContent` is set after insertion. Verified in the rebuilt `floating.js`. |
| A-02 | Medium | `alarms` permission requested since Phase 1 but never used — zero `chrome.alarms` calls anywhere in the codebase. | Removed from `wxt.config.ts`; manifest now has 6 permissions; README + dashboard Settings text updated to say so. |
| A-03 | Low | `GM_STORAGE_PREFIX` exported in `engine.ts` but the GM shim hardcoded the literal `"hgf:gm:"` — the two could diverge. | Shim now interpolates the constant (`JSON.stringify(GM_STORAGE_PREFIX)`). |
| A-04 | High | `GM_notification` never reached the background: in Chrome 158's `chrome.userScripts` USER_SCRIPT world the ONLY chrome API is `chrome.runtime.id` — `chrome.runtime.sendMessage`, `chrome.storage`, `chrome.tabs` are all `undefined` (verified live with a 23-path capability probe). The shim guarded on `sendMessage` and silently no-opped, so the background `hiddengemflow:gm-notify` handler never fired. A store script ("Markdown Link Copier") copied to the clipboard fine but `chrome.notifications.getAll()` showed no notification. `chrome.storage` as a signal transport was also ruled out empirically — `chrome.storage` itself is `undefined` in that world. | Two-transport shim + relay (no new permissions): the shim still tries `sendMessage` first when it exists, otherwise appends a transient signal node (`[data-hgf-gm-notify]`, unique id, title/message as attributes) to the page DOM. New `public/gm-relay.js` — an ISOLATED-world content script runtime-registered by the background (`chrome.scripting.registerContentScripts`, `scripting` permission already held) for exactly the `@match` patterns of enabled scripts — drains the node (initial scan + MutationObserver) and forwards it with `sendMessage`, which exists in the isolated world. A `BroadcastChannel` was deliberately NOT used: it is origin-scoped across tabs, so one tab's signal would be forwarded by every other tab on the same origin. The background dedupes by notification id (in-memory, capped at 200) and re-attempts relay registration on startup, on script register/enable, and on `chrome.permissions.onAdded` (grant). Verified live 2026-11-15 — see `docs/LIVE_TEST_AUDIT.md` (GM_notification live test): Markdown Link Copier installed from the live store, "⧉ Copy link" clicked, notification appears with the right title/message, clipboard still correct. |
| A-05 | High | Script Store showed a stale script list: jsDelivr caches the `@main` branch→commit resolution and a purge does not clear it. Verified 2026-11-15: after 4 scripts were published to `hiddengem-flow-store`, jsDelivr `@main` still served the old 1-script index even after 5 purge calls (all "finished") and 30+ s of waiting, while `raw.githubusercontent.com` already returned all 4; jsDelivr pinned to the latest commit (`258aacd…`) returned all 4, proving the staleness is the branch→commit cache, not the file. The extension fetched jsDelivr first, so Script Store kept showing 1 script. | Fetch order swapped to raw first, jsDelivr fallback (`entrypoints/shared/store.ts` `fetchStoreIndex()`; the `StoreSource` badge now reads "raw.githubusercontent" on the fresh path). Same order in the uploader's no-token public-index read (`tools/store-uploader.html`, new `rawIndexUrl` helper; the token path through the GitHub API is untouched). Dashboard copy + README updated to say raw first. Verified live 2026-11-15 — see `docs/LIVE_TEST_AUDIT.md` (probe22): Load store shows "4 scripts · Store fetched" with the RAW.GITHUBUSERCONTENT badge and all 4 cards; install flow unchanged. No new permissions, no auto-fetch, no new endpoints. |
| A-06 | Medium | Update checker design + two live-test bugs. (1) The checker's `available` answer was dismiss-aware: after a user dismissed the banner, a forced Settings check reported "You are up to date." while a newer build existed — a lie by omission. (2) The banner's Download control was a `<button>` calling `window.open`, which never opened the release page in the live test (no new tab, empty URL). Both found by probe23, not by code review. | (1) `checkForUpdates()` now returns RAW availability (a newer build exists); only the banner renderer and the floating line apply the dismiss rule via `isUpdateAvailable()`; the Settings result reports the raw answer plus a "You dismissed the Overview banner for this release" note. (2) Download is now a real `<a class="primary" target="_blank" rel="noopener noreferrer">` whose href is set from the stored record (static fallback = the current release page), with `a.primary` CSS mirroring `button.primary`. Verified live 2026-11-15 — see `docs/LIVE_TEST_AUDIT.md` (probe23): TEST build 15/15, DELIVERED build 8/8, 0 page/console errors in both. **Fixed (grace window, same day):** the asset's `updated_at` is its UPLOAD time, a few minutes later than `BUILD_DATE`, so before the fix a fresh install of the delivered build reported an update available pointing at itself — permanently for fresh profiles, not briefly. `checkForUpdates()` on the first check ever (no release stored yet) now uses `isNewerOnFirstCheck()` with a 2h grace window (`FIRST_CHECK_GRACE_MS`): an asset updated within 2h of `BUILD_DATE` is the normal upload lag and counts as up to date (the release is stored as seen); only a gap over 2h counts as a genuinely older build; the semver signal is not graced. Later checks keep the plain rule, so a replaced asset after the first check is still detected. (A failed check or an empty release list leaves `tag` empty, so the grace still applies on the next attempt.) Verified: pure-function smoke 31/31 (6 new grace cases) + probe23 re-run Phase A 15/15, Phase B 8/8, 0 page/console errors. **Second bug in the same area (same day, caught by the parent's post-upload Phase B):** the grace window only applied to the FIRST check. Later checks used the plain rule (asset `updated_at` vs `BUILD_DATE`), which is always true for the installed build — so the background first check was correctly up to date, but every later check (the Settings manual check, or any check after 6 h) permanently reported an update pointing at itself. The first attempted fix — later checks comparing ONLY against the stored record (`isNewerThanStored()`: new tag, or a different asset `updated_at`, or a later semver) — swung too far the other way: it forgot an old build's verdict the moment a second check ran, and probe23 Phase A caught it (banner appeared, then the manual check said "You are up to date.", 13/15). **Final rule: later checks OR both** — the grace rule against `BUILD_DATE` (preserves the installed build's verdict and clears it after an upgrade) OR `isNewerThanStored()` (catches a replaced asset under the same tag within the grace window). New pure function `isNewerThanStored(release, stored, manifestVersion)`: same tag + same asset `updated_at` → false; different asset → true; stored `""` + asset now present → true; both `""` → semver only. Verified: smoke 40/40 (6 new stored cases + 3 new later-check cases) + probe23 re-run Phase A 15/15, Phase B 8/8, 0 page/console errors. `BUILD_DATE` is now 2026-11-15T01:48:00Z. Also see §7 item 10. |
| A-07 | Feature | Daily Tasks had no backup: the list lived only in `chrome.storage.local`, so a new profile (or a cleared browser) meant re-adding every site by hand. This was the deferred Phase 2 improvement #5. | Export / import in the Daily Tasks tab, dashboard-only (no floating-window controls, same as the scripts backup). New pure functions in `entrypoints/shared/tasks.ts`: `buildTasksBackup()` (one JSON file `{ app: "hiddengem-flow", type: "tasks", version: 1, exportedAt, tasks: [{ name, url, pinned, createdAt, lastOpenedAt }] }`, in display order — pinned first, then newest; ids and favicons left out, regenerated on import), `parseTasksBackup()` (strict on the app/type markers, version 1 when present, and on every entry — non-empty name, valid http(s) URL; a file with partly unusable entries is refused as a whole, like the scripts backup; over 500 tasks is refused with the cap stated), `mergeTasksBackup()` (merge only, never replace — a URL already saved under the existing normalized-URL duplicate rule is skipped, everything else is appended with a fresh id and the merged list returns in display order), `formatImportResult()` (one honest line: "Imported 5 tasks. 1 skipped — already saved." / "Imported 0 tasks — all 4 were already saved." / "Imported 0 tasks — the backup was empty."). The dashboard wires `Export tasks (.json)` / `Import tasks (.json)` buttons (file name `hiddengem-flow-tasks-YYYY-MM-DD.json`) plus a `#taskImportStatus` hint line; errors go to the existing `#taskError`. No confirm dialog — a merge deletes nothing, so there is nothing to confirm. No new permissions, no network, no auto-anything. Verified live 2026-11-15 — see `docs/LIVE_TEST_AUDIT.md` (probe24): 4-task export read back field-for-field, import into a fresh profile reproduces the same list/order/pins, re-import skips all 4 with exact counts, invalid files error with the list unchanged, empty export/import round-trips. Pure-function smoke 36/36. |
| A-08 | Feature | The Store Uploader could publish and upgrade scripts but never remove one — a bad or abandoned script could only be deleted by hand on GitHub. | Delete in Live Scripts (`tools/store-uploader.html`, no extension change): each card has a **Delete** button — two clicks, no `window.confirm()` (first click arms it: red "Confirm delete — removes it from the store" + Cancel; arming another card moves the arm; Cancel disarms). Flow, in order: token required (no token → exact message, zero requests); the entry's `codeUrl` must match this repo's own raw copy under `scripts/` (new strict `filenameFromCodeUrlForDelete()` — the upgrade path's `filenameFromCodeUrl()` stays deliberately looser because it only reads); a fresh `index.json` is fetched and ONLY that entry is removed, then the index is PUT back ("Remove <name> from store"); then the file is DELETE'd with a freshly fetched sha (new `ghDeleteFile()`); then jsDelivr is purged for both files (best-effort). Index-first is deliberate: a failed file delete leaves only a harmless orphan in `scripts/` while the store never points at a missing file. The codeUrl check runs BEFORE any write — the spec's step order lists it with the file delete, but its refusal ("delete NOTHING") is only true if it runs first, so it does. Failure reporting is honest: index-update failure → "<GitHub's error> Nothing was deleted."; file-delete failure after a successful index PUT → "Removed <name> from the store, but the file could not be deleted — <GitHub's error>. You can delete scripts/<file> manually on GitHub."; success → "Deleted <name> — removed from the store and its file deleted." The list/count update from the delete result itself (not a refresh click — the refresh handler clears `#liveError` first and would erase a partial-failure message). The upgrade card hides if its script was just deleted. The page says deleting only stops the store listing the script — installed copies stay. Verified live 2026-11-15 — see `docs/LIVE_TEST_AUDIT.md` (probe25): 21/21 PASS with a dummy token only — the real-token success path is untested by the agent (only the user can run it with his PAT). |
| A-09 | Feature | The floating window had one fixed page (Daily Tasks, then Scripts below it) and no place for quick notes — the user asked for a Notepad page in the floating window (new note, branding, tags, copy/edit/pin/delete), designed first, built only after he approved the design. | New `entrypoints/shared/notes.ts` (pure half + storage half, same split as tasks.ts; key `hiddengemflow.notes.v1`; `createNote`/`updateNote`/`deleteNote`/`toggleNotePin` — pin does NOT stamp updatedAt —/`sortNotes` (pinned first, then updatedAt desc)/`searchNotes` (title+body+tags, case-insensitive)/`formatEditedDate`/`noteClipboardText`; validate: empty title falls back to the first body line or "Untitled note" at display time, brand must be HiddenGem/Personal/Work default HiddenGem, tags trimmed, max 20 chars each, max 10 per note, deduped case-insensitively; ids `crypto.randomUUID()` with a Date.now()+random fallback; stored values sanitized on read) + `entrypoints/shared/notes-ui.ts` (ONE shared UI for both floats and the dashboard; createElement + textContent only, A-01 rule; two-step delete with click-elsewhere disarm; Copy via navigator.clipboard with execCommand fallback, button briefly shows ✓/✕; refresh() re-reads storage but never clobbers an open editor). Both floating forms gained a tab bar — Daily Tasks | Scripts | Notepad, active tab emerald (panels hidden, never removed, so switching preserves state; default Daily Tasks). Dashboard gained a 7th tab "Notepad" after Script Store (same key, same UI, wider layout); the float's "View all in Dashboard →" opens `dashboard.html#notes`. No network, no sync. Verified live 2026-11-15 — see `docs/LIVE_TEST_AUDIT.md` (probe26): 3 notes created by hand in the float, order/pins/brands/tags/previews/edited-dates exact; search by title, body word and tag; Copy clipboard exact; Edit, Pin/Unpin, Delete arm/abandon/confirm; persistence across reload; dashboard create syncs to the float. Pure-function smoke 63/63 (notes + layout). |
| A-10 | Feature | The three float pages were fixed in order (Daily Tasks, Scripts, Notepad), always opened on Daily Tasks, and there was no way to arrange them as the user likes ("nijer moto kore sajano"), designed first, built only after he approved the edit-layout design. | New `entrypoints/shared/float-layout.ts` (pure + storage; key `hiddengemflow.float.layout.v1`: `{ order, hidden, defaultTab }`, defaults `['tasks','scripts','notes']`, `[]`, `'tasks'`; sanitize drops unknown ids, dedupes, fills missing tabs, default must be visible else first visible) + `entrypoints/shared/float-layout-ui.ts` (ONE shared editor UI for both floats). Footer "✎ Edit layout" link opens the panel: hint line, one row per page (⋮⋮ grip, name + subtitle with live counts, eye toggle, star), Save layout + Cancel. Drag reorder is HTML5 drag-and-drop on the grip — verified live with REAL mouse drags, so no ↑ ↓ fallback was needed; eye toggles hidden (row greyed, tab bar shows it faded while editing); star sets the default; Save persists + applies immediately; Cancel discards. A hidden tab's page is unreachable from the tab bar until restored from Edit layout — the footer link stays visible. The layout is shared by both floats (one key); the dashboard always shows all 7 tabs. Verified live 2026-11-15 — see `docs/LIVE_TEST_AUDIT.md` (probe26): real-mouse drag reorders, hide + star + Save applies, fresh float opens on the new default, restore brings all 3 back, Cancel discards, layout persists in storage. |
| T-01 | Test | Phase 1 jsdom floating tests expected the old placeholder wordings ("No tasks saved yet.") — Phase 2/3 changed the honest empty-state copy. | Updated the two assertions to the v1.0.0 wording/behaviour (incl. the "Scripts are paused" state when user scripts are off). |
| T-02 | Test | Phase 1 jsdom dashboard test seeded tasks as `{name:"a"}` — invalid under Phase 2's schema, so `loadTasks()` correctly filtered them to 0 and the count assertions failed. | Seeded valid tasks (`id`, `name`, `url`). The filter behaviour is correct, not a bug. |

## 7. Open limitations (not hidden — the owner should know)

1. **Live-tested in real Chrome 2026-11-15 (v1.0.1)** — see
   `docs/LIVE_TEST_AUDIT.md`: real toolbar click via XTest, drag + position
   persistence, tasks, script registration + execution, store message,
   Logs + Stop All. Four real bugs found and fixed in v1.0.1 (wrong
   userScripts `world`, missing host access for scripts, dashboard showing
   stale tasks/scripts saved from the floating window, floating window's
   Tasks/Active Scripts sections never refreshing after injection). The
   owner's Load Unpacked test (README steps 5–11) is still the real
   end-to-end check on their own machine.
2. **Store repo is live since 2026-11-15** (`BidyutRoy2/hiddengem-flow-store`, now four real scripts — "Titan Exchange Auto Trader Pro by HiddenGem" v2.0, "Universal DOM Diagnostic v2.0 — TM Only" v2.0.0, "9Chain Virtual Node Auto" v2.0.0, and "Firstprint Daily Streak Auto-Claim" v1.0.2 (added, updatedAt 2026-11-17); "Markdown Link Copier" was deleted by the owner on 2026-11-15 via the uploader). The live fetch path is verified end to end (probe21: Load store → card → scan → install → the script ran on example.com; probe22: Load store shows all 4 scripts with the raw.githubusercontent badge after the raw-first fix, A-05 — fetch order is raw.githubusercontent first, jsDelivr as fallback). The failure path (raw → jsDelivr → cache → honest "not published yet" message) was verified earlier, on the empty store, in the old jsDelivr-first order.
3. **Scripts need TWO user grants, not one.** (a) **Allow User Scripts**
   (`chrome://extensions` → HiddenGem Flow → Details → ON, then reload) —
   the extension cannot flip it; the banner explains it. (b) **Site access**
   for the script's @match sites — Chrome only runs a userscript where the
   extension has host access. Access is an *optional* permission, granted
   per site from the Scripts tab ("Grant site access", Chrome's own prompt)
   or wholesale from Details → Site access → "On all sites". Without (b) a
   registered script is inert, and the UI says so. The per-script prompt's
   accept-click IS automatable in the live test after all: Chrome's
   permission bubble is browser UI, not page content, but a real XTest
   mouse click on its Allow button works (button centre 817,270 on the
   1400×1000 test display — the first estimates at 770,273 and 842,305
   missed the button's edges; verified live via
   `chrome.permissions.contains()` after the click, 2026-11-15).
4. **Scanner is a regex heuristic** (comments/strings stripped first). It can
   miss obfuscated code and can flag a safely-used pattern. It is a warning,
   never proof of safety.
5. **Run status semantics:** "running" means matching scripts are registered
   and the tab was opened by this extension; it cannot prove a script executed
   inside the tab. "Done" means the tab finished loading, which some
   load-error cases also fire.
6. **GM_setValue/GM_getValue values are page-visible** (page-origin
   localStorage, namespaced per script). Never store secrets with GM_*.
7. **Dashboard Scripts-tab bridge banner is near-inert by construction:**
   when the dashboard is the active tab, `get-active-tab` returns the
   dashboard's own `chrome-extension://` URL, which never matches a store
   script. The floating-window banner (real page URL) is the one that fires
   in practice.
8. **Auto-upgrade offers are checked once per dashboard load** for opted-in
   scripts; nothing checks in the background while the dashboard is closed.
9. **Firefox build is not done** — Chrome first by decision; the config is
   written so a Firefox target can be added later.
10. **Update checker: first-check grace window + later-check OR rule (A-06 fix).** The check compares `BUILD_DATE`
    (the build's time, set by hand in `entrypoints/shared/updates.ts`) with
    the release zip asset's `updated_at` — which is the asset's UPLOAD time,
    a few minutes after the build. On the FIRST check ever (no release stored
    yet) a 2h grace window applies (`isNewerOnFirstCheck`): an asset updated
    within 2h of `BUILD_DATE` is the normal upload lag and counts as up to
    date; only a bigger gap counts as a genuinely older build. Later checks
    OR both rules: the grace rule against `BUILD_DATE` (preserves the
    installed build's verdict — an old build keeps reporting available, and
    the verdict clears after an upgrade) OR `isNewerThanStored()` (a new
    tag, a different asset `updated_at` for the same tag, or a later semver
    counts as newer; same tag + same asset counts as up to date). The
    plain rule alone made every later check self-point (the asset's upload
    time is always after the build); the stored rule alone forgot an old
    build's verdict on the second check (probe23 Phase A caught it,
    13/15). (Before the grace fix, a fresh install of the delivered build
    reported an update available pointing at itself, permanently for fresh
    profiles.) The checker also only
    *notices* — updates stay manual (replace files + Reload); real
    auto-update needs the Chrome Web Store, which is not done (promo tiles /
    screenshots pack not built). The GitHub API check is at most once per 6 h
    (plus on manual check); a 403/rate-limit fails silently with a 1 h
    backoff and no banner.
11. **Task favicons are best-effort, and Google answers 404 for sites
    with no favicon.** A task row loads its favicon from Google's s2
    service; for a domain with no favicon (e.g. `example.com`) Google
    answers 404 (verified direct and through the test proxy — the 404
    is Google's real answer, not a harness artifact), and Chrome logs
    it as a console error. The extension handles it exactly as
    designed: the `<img>` error handler removes the image and the
    letter tile stays. So a dashboard with such a task shows console
    404s while nothing is actually broken — probe24 saw 3 of them
    (one per profile that rendered the Example row) with 0 page
    errors and every functional check passing. Fixing the log would
    mean changing the favicon system itself, which is out of scope.
12. **Store Uploader delete: the codeUrl check runs before any write
    (A-08).** The delete's step order is index first, then the file —
    but the foreign-codeUrl refusal ("delete NOTHING") is only true
    if the codeUrl is validated before the index PUT, so
    `filenameFromCodeUrlForDelete()` runs right after the token check.
    Also: the Live Scripts refresh handler clears `#liveError` first,
    so after a delete the list/count are updated from the delete
    result itself instead of a refresh click — otherwise a
    partial-failure message would be erased in the same handler. The
    real-token success path (index PUT + file DELETE + purges) is
    untested by the agent; only the user can run it with his PAT.
13. **Edit layout: hiding ALL three tabs is allowed, and recoverable
    (A-10).** `sanitizeFloatLayout` keeps an all-hidden layout as-is
    (hidden list intact, default falls back to "tasks"). The tab bar
    is then empty, but the footer "✎ Edit layout" link stays visible
    and the stored-default panel still shows — so the user can always
    open Edit layout and restore a tab. Nothing is unrecoverable.
14. **Probe26 harness notes (not extension defects).** The note row
    buttons are `button[data-note-act="copy|edit|pin|delete"]` —
    the first probe run used the wrong selectors, which made the pin,
    copy, edit and delete checks fail in cascade (and a click on a
    hidden editor's Save created one phantom empty note — normal DOM
    behaviour for a programmatic click on a hidden button, unreachable
    by a real user). A hash goto on an already-loaded dashboard page
    does not switch tabs (initTabs reads the hash once, at load) —
    the background always opens a NEW dashboard tab, so the float's
    "View all in Dashboard →" is unaffected. `requestHostAccess`
    requests the clicked script's own @match patterns, so a grant must
    target that script's row; the native Allow click is flaky and was
    retried with a `permissions.contains` check after each attempt.

15. **Notepad Copy copies only the note body (user rule, 2026-11-15); footer Download button points at the releases page.** The owner reported that Copy was putting the title and the note together on the clipboard; `noteClipboardText` now returns only `note.body` — the title is never included, in the float and the dashboard (one shared UI). The dashboard and both floating windows' footers no longer show the plain "GitHub — hiddengem-flow-store" text link; they show a green **⬇ Download HiddenGem Flow** pill button pointing at `https://github.com/BidyutRoy2/hiddengem-flow/releases` (the releases list page, newest build on top — deliberately not one tag's page, so the link works before a new release is published as well as after). The Script Store repo is still linked from the Overview store card and the Script Store tab; the dashboard header button now links the main repo (`BidyutRoy2/hiddengem-flow`) instead — changed 2026-11-15 at the owner's request (verified live, screenshot 76). Verified live in probe26's re-run (footer href + click-through) — see `docs/LIVE_TEST_AUDIT.md`.

---

# v1.2.0 audit — 2026-11-16

**Audited version:** 1.2.0 · **Scope:** the v1.2.0 delta only — Side Panel mode,
automatic versioned backup + restore, context menus, keyboard shortcuts,
3-way window-mode switch, dashboard Backup/Window-mode/Shortcuts/Right-click
cards. The v1.0.0/v1.1.0 findings above still apply; nothing in them was
re-opened. Build: `npm run typecheck` clean, `npm run build` clean (1.46 MB);
built manifest version 1.2.0, permissions exactly `storage, tabs, scripting,
activeTab, userScripts, notifications, sidePanel, contextMenus`, no
`host_permissions`, `side_panel.default_path: sidepanel.html`, 4 commands
with the designed suggested keys. Smoke suites: updates 40/40, tasks-export
36/36, notes-layout 63/63, backup-mode 70/70. Live probes 27a–27u in real
Chrome for Testing 158 (screenshots 78–122 in `docs/live-test/`).

**A-11. Save-before-send ordering (probe27a bug, FIXED).** `float-page.ts`
`onSwitchMode` sent `MSG_OPEN_MODE` to the background BEFORE saving the new
mode — and the background's `handleToolbarClick` reads the mode from storage.
Popup → Floating therefore closed the popup and opened nothing (the mode was
still "popup" when the background acted). Fix: save the mode FIRST, then send
the message fire-and-forget (`void chrome.runtime.sendMessage(...).catch(...)`
— the surface closes right after, so awaiting the response would only surface
a "port closed" error; the message is delivered and the saved mode means the
toolbar icon opens the new mode next time even if it is lost). Verified fixed
in probe27b (popup ⇄ → Floating reopens the float, popup closes).

**A-12. Chrome does not auto-assign Alt+Shift+T / Alt+Shift+N (platform
fact, NOT a code bug).** `chrome.commands.getAll()` and the
`chrome://extensions/shortcuts` page both show toggle-flow = Alt+Shift+F ✓
and open-dashboard = Alt+Shift+D ✓, but add-current-site and quick-note =
"Not set" — Chrome does not auto-assign those two suggested keys on install
(verified twice, fresh profiles, screenshot 88). Both keys are valid:
manual assignment on the shortcuts page ACCEPTED them and they stayed set
(probe27c). The Dashboard Settings card and CHANGELOG now state this
honestly (one-time manual set); the manifest still declares all four
suggested keys.

**A-13. `sidePanel.open()` refuses the service-worker call from a keyboard
command (platform fact, handled).** A real Alt+Shift+F reaches Chrome (the
command fires — with mode=popup the popup opens, probe27e), but with
mode=sidepanel the panel does NOT open: `chrome.sidePanel.open()` called
from the service worker throws *"`sidePanel.open()` may only be called in
response to a user gesture."* (probe27d). Fix: `handleCommand` toggle-flow
and quick-note catch the failed open and show a notification ("Side Panel
needs one toolbar-icon click — Chrome will not open a panel from a keyboard
shortcut") instead of failing silently — verified in probe27g (live
notification id after Alt+Shift+F in sidepanel mode, no panel opened). The
toolbar click still opens the panel natively (`openPanelOnActionClick:
true`). From Dashboard / Side Panel / Popup, switching to Side Panel works
in one direct click — the extension page calls `sidePanel.open()` in its own
click handler, which IS a real gesture (`float-page.ts` `onSwitchMode`,
verified in probes 27b/27c). From the in-page float, choosing Side Panel
sets the mode and shows the honest hint instead ("Mode set to Side Panel —
click the toolbar icon once to dock.", probe27b).

**A-14. Temp userScripts registration lifecycle (LIVE-VERIFIED).**
`runScriptOnce` (background.ts): unregister-before-register (idempotent),
register the temp entry (`hgf-temp-<scriptId>`, match pattern = tab URL
origin + path + `*`, query/fragment stripped), reload the tab, unregister
after 15 s; `cleanupTempScripts` also unregisters stale `hgf-temp-*` entries
on startup/install. Live-verified end to end in probe27u (with "Allow User
Scripts" ON): the tab reloaded, the script EXECUTED (`document.title`
changed to `HGF-PROBE27-RAN`), and `chrome.userScripts.getScripts()` 18 s
later returned `[]` — no leaked entries. Two gates, both honest:
`checkUserScripts()` (`shared/engine.ts`) returns available:false with
"User scripts are not enabled" when Chrome's own "Allow User Scripts" toggle
is off, and `scriptHasHostAccess()` returns an ok:true + warning ("Running
<name> — but this site needs site access first…") instead of claiming a run.
Related platform fact (probes 27k/27u): the `chrome.userScripts` namespace is
UNDEFINED in the service worker until that toggle is flipped on — the API is
gated on the toggle, not on the manifest permission. The extension never
assumes it exists: every call site guards with `chrome?.userScripts?.getScripts`
(`checkUserScripts`, `cleanupTempScripts`) and returns a readable error
instead of throwing.

**A-15. Restore snapshot-first guarantee (LIVE-VERIFIED).** The
`MSG_RESTORE_BACKUP` handler (background.ts) does `takeSnapshot()` FIRST,
then sets `suppressAutoSnapshotUntil = Date.now() + 10000` (so the restore's
own writes do not snapshot the just-restored state), then
`writeBackupData(clean)`. Invalid restore data is refused with "That backup
data is not usable — nothing was restored." Probe27a verified it live:
restoring an older snapshot reverted tasks 3→2 AND the newest snapshot held
the pre-restore 3-task state (snapshot-first proven, exact status line).
`parseFullBackup` is strict like the A-07 tasks import: identity markers +
version 1 + every entry usable, or the whole file is refused (exact error
"That file is not a HiddenGem Flow full backup — nothing was imported.";
partly-usable files are refused with the usable/unusable counts). Auto-
snapshot is debounced 2 s, skips when the data is identical to the newest
snapshot (`isSameData`), and is capped at 3 snapshots; one snapshot is also
taken before an extension update (`onInstalled` with `previousVersion`).

**A-16. Context-menu data handling (LIVE-VERIFIED).** Page data
(`linkUrl`, `linkText`, `selectionText`, tab title/URL) flows ONLY into
`createTask` / `createNote`, never into `innerHTML` — the new code builds
its DOM from a static template (`float-page.ts`, A-01 rule) and renders
lists with `textContent`. `createTask` validates: empty name throws,
`normalizeUrl` requires http(s), duplicate URL throws ("This site is already
saved."); `createNote` trims the title, sanitizes the brand
(`sanitizeBrand`), normalizes tags. Live evidence: probe27k — "Save selection
as note" created a real note with the exact selected text, title "Example
Domain", brand Personal; probe27o — clicking "Save to Daily Tasks" on the
already-saved example.com produced the exact duplicate notification ("Could
not save this site"), proving the handler + validation run. Chrome filters
submenu contents by context (correct platform behaviour, not a missing item):
a selection right-click shows only "Save selection as note"; a plain page
right-click shows "Save to Daily Tasks" + "Run script on this page ▸"
(screenshots 94, 101, 102). The run-script submenu lists installed scripts
("Probe27 Test Script", screenshots 107/110) and the click-through is
verified by A-14.

**A-17. In-session extension reload breaks the extension in Chrome for
Testing (HARNESS property, NOT a v1.2.0 regression).** `chrome.runtime.reload()`
AND the chrome://extensions UI Reload button both leave the extension
disabled in this harness (no service worker after 8–20 s, dashboard
`net::ERR_BLOCKED_BY_CLIENT`), in probes 27a, 27c, 27d, 27e, 27f, 27g — with
Developer Mode OFF and ON, and with the UI button. Screenshot 91 shows the
card with "Turn on developer mode to use this extension" and the toggle OFF.
CONTROL (probe27i Part A): the SHIPPED v1.1.0 build breaks IDENTICALLY in
the same harness (service worker none, dashboard blocked) — so the breakage
is a property of this Chrome-for-Testing + `--load-extension` environment,
not of v1.2.0. Browser restart restores the extension (probe27g: mode +
tasks persist). The user's real Brave flow (replace files + Reload in
`brave://extensions`) is unaffected — he has reloaded this extension many
times across v1.0.0 → v1.1.0. Related harness fact (proved by
`diag-load.cjs`): WITHOUT `--disable-extensions-except`, the extension does
not load at all in this Chrome for Testing (extensions page empty, no
service workers) — the flag is required to load, so it cannot be removed as
a discriminator. Probe checklist item (g) "mode persists after extension
reload" is therefore verified by BROWSER RESTART (probe27f/g), not by
in-session reload.

---

# v1.2.0 deep audit (rebuild) — 2026-11-16

**Audited version:** 1.2.0 (rebuild) · **Scope:** the WHOLE extension, not
just the v1.2.0 delta — every entrypoint and every shared module re-read,
plus re-verification of A-01..A-10 in the current code. The user installed
the first v1.2.0 zip in his Brave and confirmed it works ("kaj korche"),
then asked for a full rebuild per plan + a deep audit + a fresh zip for
his final test. Source verified UNCHANGED since the delivered zip before
this audit (current `.output/chrome-mv3` byte-identical to the delivered
zip contents; every source mtime ≤ the 01:01 build time).

**Re-verified, still holding:** A-01 (all `innerHTML` with data goes
through `escapeHtml` — `renderMeta`, `scanHtml`; the floating site line
is `textContent`; `float-page.ts` template is static), A-02 (no
`chrome.alarms` call anywhere — only the comment noting its removal),
A-03 (`GM_STORAGE_PREFIX` interpolated into the shim), A-04 (GM relay
intact, node drained + removed), A-05 (raw-first store fetch), A-06
(update checker: first-check 2h grace + later-check OR rule + dismiss
keyed by tag + asset), A-07 (tasks backup strict parse — file refused
whole), A-08 (uploader DELETE rules intact in `tools/store-uploader.html`:
`filenameFromCodeUrlForDelete`, two-step confirm, `ghDeleteFile`),
A-09/A-10 (notes + layout modules unchanged in behaviour, textContent
rendering only). No `eval(` / `new Function` in extension source (the
strings appear only in the scanner's rule list and one comment); the
owner-banned word appears nowhere (code, UI, README, comments).

## Findings — all fixed in this rebuild (probes 28a–28p)

| ID | Severity | Finding | Fix applied |
|---|---|---|---|
| A-18 | Medium | Popup window id was in-memory only (`background.ts`: `let floatWindowId`). MV3 service workers are killed after ~30 s idle, and the popup page uses only short-lived `sendMessage` calls — nothing keeps the worker alive while the popup is open. After a restart the id was null, so the next toolbar click in popup mode opened a SECOND popup instead of focusing the existing one — contradicting the "focus instead of duplicate" rule. | The id is now ALSO persisted in `chrome.storage.local` (`hiddengemflow.popup.windowId.v1` — deliberately NOT in `BACKUP_DATA_KEYS`: ephemeral, not user data). `openFloatPopup` resolves the id from memory OR storage and validates it with `windows.get` before focusing; creation, `onRemoved`, and `closeFloatPopupWindow` (including its persisted-fallback branch) all keep both copies in sync. Verified in probe28 (restart the browser with the popup open → toolbar click focuses it, no duplicate). |
| A-19 | Medium-Low | The in-page float's switch menu offered "Floating window" as a live row, but the click handler (`floating.ts` `initFloatingSwitch`) only branched for sidepanel/popup — choosing Floating while the mode was sidepanel/popup did nothing at all (menu closed, mode unchanged, no feedback). A dead menu item. | Added the floating branch: save the mode, clear the hint (this window is already open — switching back just means the toolbar opens floats again). Verified in probe28. |
| A-20 | Low | The float that set sidepanel mode stayed open after the panel opened natively, with a stale "click the toolbar icon once to dock" hint. The background never sees the toolbar click that opens the panel (`setPanelBehavior` intercepts it), so no code path closed the float. | The side panel now asks the background to close floats when it mounts (`MSG_CLOSE_FLOATS`, `sidepanel/main.ts`), the background fans a `hiddengemflow:close` message to every tab, and `floating.ts` removes its host on it. Tabs without a float ignore the message. Verified in probe28. |
| A-21 | Low | `window-mode.ts` header comment wrongly claimed "a keyboard shortcut is one [a user gesture] too, so the background's command handler may call sidePanel.open() as well" — the opposite of A-13, which probe27d proved live (commands are NOT accepted gestures; the handler notifies instead). The code was correct; the comment misled future maintainers. | Comment corrected to state the A-13 rule. No behaviour change. |
| A-22 | Low | `public/gm-relay.js` `seen` set grew without limit for the page's lifetime (one entry per notification id, never pruned) — a script notifying in a loop would grow memory. The background's own dedupe set is capped at 200; the relay's was not. | Capped at 200 (oldest key deleted first, same pattern as the background). |
| A-23 | Low | `parseTasksBackup` partly-usable error said "the rest were skipped" — but the function returns `ok:false`: NOTHING was imported. The full-backup parser says "nothing was imported" (correct); the tasks one misdescribed its own refusal. | Wording fixed to "nothing was imported. Check the file before importing." Smoke expectations in `smoke-tasks-export.ts` (lines 63–64) updated to the corrected string. |
| A-24 | Low | `runScriptOnce` checked host access AFTER registering and reloading the tab — so a script without site access still caused a pointless tab reload, and only then did the warning appear. | Host access is now checked BEFORE registering/reloading; without it the function returns the honest warning with no reload. |
| A-25 | Low | `setupContextMenus` could interleave on rapid storage changes (e.g. toggling several scripts): two concurrent runs could `removeAll`/create out of order and leave a partial menu until the next trigger. | Rebuilds are now serialized through a promise chain (`setupContextMenus` wrapper → `setupContextMenusInner`). |
| A-26 | Low (deferred) | `updates.ts` `RELEASE_PAGE_URL` still points at the v1.1.0 pre-release tag (`v1.1.0-dev-20261115`). Currently correct — the latest published release IS v1.1.0-dev, and the checker's semver/timestamp rules correctly report a v1.2.0 build as up to date against it; the constant is only a fallback when the API omits `html_url` (never in practice). | NO code change in this rebuild. MUST be updated to the v1.2.0 tag when v1.2.0 is published (see §7 item 21). |
| A-27 | Low-Medium | After granting site access, an enabled script whose registration had failed for lack of host access stayed unregistered until the next service-worker restart. Cause: `chrome.permissions.onAdded` (background.ts) only retried the GM relay (`ensureGmRelayForEnabled`, A-04); nothing re-registered the scripts themselves, and the dashboard's Grant handler only calls `requestHostAccess` + `renderScripts()`. The dashboard copy says "Grant it once and the script runs on every visit" — true only after a restart. Found live in probe28o: script seeded with the toggle ON but no access → `getScripts()` was `[]` even after the grant succeeded (`permissions.contains` true). | The `onAdded` handler now also calls `reregisterEnabledFromStorage()` (same idempotent re-register that runs on install/startup), so a grant takes effect immediately. Verified in probe28p. |

## v1.2.1 audit — open-tabs tracking (probes 29a–29c)

Scope: new module `entrypoints/shared/open-tabs.ts` (pure helpers +
session-storage wrappers + message helpers + badge/close DOM helpers);
background tracking in `openUrls()` + `MSG_OPEN_TABS_*` handlers +
`tabs.onRemoved`/`onUpdated` + `storage.onChanged` (tasks) +
`onStartup` clear; badge/close rendering in `float-page.ts`
(popup + side panel), `floating.ts` (in-page float), `dashboard/main.ts`
+ summary chip; version 1.2.1 + `BUILD_DATE` 2026-11-16T02:25:46Z.
Re-verified: A-01 (createElement + textContent only in the new DOM
helpers; the count is a number, never user text), no `eval(` /
`new Function` in the new or changed files, the owner-banned word
appears nowhere in the repo (grep clean, including CHANGELOG/AUDIT —
two historical "the word appears nowhere" mentions were reworded so
the shipped zip greps clean), manifest permissions unchanged
(`storage, tabs, scripting, activeTab, userScripts, notifications,
sidePanel, contextMenus`; no host_permissions), `OPEN_TABS_KEY`
(`hiddengemflow.tasks.open.v1`) is NOT in `BACKUP_DATA_KEYS`
(verified by grep + a smoke regression guard — a snapshot can never
carry tabIds and a restore can never resurrect them).

| ID | Severity | Finding | Fix applied |
|---|---|---|---|
| A-28 | Low-Medium | `siteHost()` (new, `shared/open-tabs.ts`) returned a host for non-http(s) URLs: `new URL("chrome://extensions/").hostname` is `"extensions"`, so a tracked tab navigating to a `chrome://` page could KEEP its badge if a task existed on that bare host — the URL-aware rule would silently fail for exactly the navigation that should drop the badge. Found by the new smoke test (`smoke-open-tabs.ts`: `siteHost("chrome://extensions/")` returned `"extensions"`, expected `null`). | `siteHost()` now returns `null` for any non-http(s) protocol before reading the hostname. Smoke 56/56 (the case is now `null`, and `sameSite` against a task URL is `false`). |
| A-29 | Medium | First version of the background mutation path read the map OUTSIDE the serialized chain: the `tabs.onUpdated` URL listener and `reconcileOpenTabs()` loaded the map, computed a new map, then called `mutateOpenTabs(() => next)` — the chain re-loaded the map but discarded it, so two concurrent mutations (e.g. a tab navigating away while Open All was tracking) could clobber each other and lose tracked tabs. The chain serialized the writes but not the reads. | `mutateOpenTabs` now takes an async function that runs INSIDE the chain against the freshly loaded map (`fn: (map) => OpenTabsMap \| Promise<OpenTabsMap>`); the URL listener and `reconcileOpenTabs()` do their tab checks inside it. `mutateOpenTabs` also skips the save + broadcast when nothing changed (JSON compare), so closing an untracked tab stays silent instead of fanning a no-op map to every tab. |
| A-30 | Low (residual, accepted) | Per-task tracking cap: `trackOpenTab` caps each task at 50 tabIds (oldest dropped first, same cap as opening at once). Past 50 opens of ONE task in a session, the oldest tab stays open but untracked — its badge count under-reports and Close no longer closes it. | Accepted: 50 opens of a single task in one session is outside normal use, and the cap bounds the session map. Documented here; no code change. |
| A-31 | Low (residual, accepted) | A tab closed in the instant between `chrome.tabs.create` returning and the tracking write lands a dead tabId in the map (milliseconds). | Accepted: healed automatically — `tabs.onRemoved` untracks it at once, `reconcileOpenTabs` drops it on the next task change, and every focus/close call tolerates missing tabs (`tabs.get`/`tabs.remove` errors are caught and the id is dropped). No code change. |
| A-32 | Low (residual, accepted) | `MSG_OPEN_TABS_GET` returns the whole map to any extension-context sender. The map holds only taskIds + tabIds (no URLs, no page content), and web pages cannot send runtime messages to the background (no `externally_connectable`), so the exposure is the extension's own surfaces. A forged focus/close message could at most focus/close tabs the extension itself opened. | Accepted: taskId is validated as a non-empty string in the handler AND inside `focusTaskTabs`/`closeTaskTabs`; focus tries newest-first and drops dead ids; close is by tabId only and tolerates missing tabs. No code change. |

## 7. Open limitations / residual risks (v1.2.0 additions)

16. **Side panel has no in-UI ✕ button (no API exists).** There is no
    `chrome.sidePanel.close()`; Chrome's native panel header provides the
    close button. The background closes the panel best-effort when the mode
    changes away from "sidepanel" (`setOptions({enabled:false})` then
    `{enabled:true}`) — verified: the sidepanel CDP target is gone after
    switching away (probes 27b/27c).
17. **Keyboard shortcuts: two keys need a one-time manual assignment
    (A-12), and Alt+Shift+F cannot open the side panel (A-13).** The
    notification fallback covers the panel case; the Settings card tells
    the user where to set the keys (`chrome://extensions/shortcuts`).
18. **"Run script on this page" needs the user's "Allow User Scripts"
    toggle ON (Chrome's own toggle — no API can flip it) plus site access
    for the script (A-14).** Without either, the menu item notifies
    honestly instead of running. On the owner's Brave the toggle is
    currently OFF, so the first run-script use will show the "not enabled"
    notification until he flips it once in `brave://extensions` — the
    Dashboard Scripts tab already explains this.
19. **In-session reload in Chrome for Testing is broken for every build
    (A-17).** The v1.2.0 live probes therefore verify persistence by
    browser restart, not by in-session reload. The user must keep using
    the normal replace-files + Reload flow in Brave, which is his
    established flow and is unaffected by this harness property.
20. **Context-menu submenu geometry is Chrome's, not ours (probe
    finding, not a defect).** The native menu opens submenus to the side
    with room, flips them when clipped, and aligns rows differently per
    context (selection vs plain page) — the probe click-throughs needed
    scout screenshots to land the clicks (probes 27i–27u). A real user
    clicks what they see; nothing in the extension depends on the
    geometry.
21. **Publish-time follow-up (deep audit A-26): `RELEASE_PAGE_URL` in
    `shared/updates.ts` still points at the v1.1.0 pre-release tag
    (`v1.1.0-dev-20261115`).** That is correct while v1.2.1 is
    unpublished (the latest release IS v1.1.0-dev, and the checker
    correctly reports a v1.2.1 build as up to date against it). When
    v1.2.1 is published, update the constant to the v1.2.1 tag in the
    same build — otherwise the fallback download URL (used only when
    the API omits `html_url`) would point at the old pre-release.
    (v1.2.1 supersedes v1.2.0 as the publish candidate; the v1.2.0 tag
    named in the earlier version of this item is no longer the target.)
22. **Open-tabs tracking is session-only by design (v1.2.1, A-30/A-31).**
    A browser restart resets every badge (verified in probe29c: map
    `null`, no badges, chip hidden, tasks untouched). Tabs restored by
    Chrome after a restart are NOT re-tracked — they were opened in a
    previous session, so the extension correctly treats them as
    ordinary tabs until the user opens the task again. The per-task cap
    is 50 tabIds (A-30) and a tab closed in the instant between
    `tabs.create` and the tracking write leaves a dead id that heals
    itself (A-31).
23. **The badge is site-level, not URL-level (v1.2.1).** A tracked tab
    keeps its badge while it stays on the task's host (same hostname,
    `www.` stripped, http/https treated the same) — navigating to
    another path on the same site keeps the badge; navigating to
    another host drops it (verified in probe29b (g)). A same-host
    redirect never drops the badge; a cross-host redirect does.
24. **Probe harness note (v1.2.1, not a defect): Playwright's
    `context.pages()` does NOT list side-panel pages in Chrome for
    Testing 158** — the panel IS a CDP target of type `"page"`
    (verified via `Target.getTargets` and `/json/list`), but
    `pages()` omits it, so probe29a reads the real docked panel's DOM
    over a raw CDP WebSocket on `--remote-debugging-port=9222`
    (probe29dbg). The popup page IS listed by `pages()` and was read
    that way. The dashboard "Open the selected mode now" button opens
    the float on the ACTIVE tab (by design — `getActiveTabOfNormalWindow`)
    and cannot open the side panel from an evaluate click (no user
    gesture); the probes therefore open the float/panel with real XTest
    toolbar clicks while the site tab is front (probe28f pattern).

---

# v1.3 audit — script-manager core (probes 30a–30b)

**Audited version:** 1.3 (in development, unreleased — package stays
1.2.1, `BUILD_DATE` untouched per the build brief) · **Scope:** the
v1.3 delta only — built-in editor (`shared/editor.ts`: lint,
highlight preview, extended metadata, new-from-page template),
folders/tags/bulk/archive (`shared/folders.ts`, dashboard sidebar +
bulk bar + Archived section, `FOLDERS_KEY` in backups), install
from URL (`validateFetchedScript` + preview + Confirm Install),
onboarding helper (`MSG_SELF_TEST` + dashboard card), GM API
start (`GM_xmlhttpRequest` @grant + @connect gated, `GM_setClipboard`),
GM relay XHR/clipboard draining, background `MSG_GM_XHR` handler,
and the A-33/A-34/A-35 fixes below. The v1.0.0–v1.2.1 findings
above still apply; nothing in them was re-opened except where noted.
Build: `npm run typecheck` clean, `npm run build` clean (1.53 MB);
built manifest version 1.2.1, permissions exactly `storage, tabs,
scripting, activeTab, userScripts, notifications, sidePanel,
contextMenus`, no `host_permissions`, no new permissions at all.
Smoke suites: baseline 265 (updates 40/40, tasks-export 36/36,
notes-layout 63/63, backup-mode 70/70, open-tabs 56/56) + new
smoke-v13 95/95 (editor lint/highlight/metadata/template,
folders/bulk/archive, install validation, @connect allow/block,
shim grant gating, scanner, backup folders, host-access widening).
Live probes 30a (27/27, screenshots 192–197) and 30b (21/21,
screenshots 198–202) in real Chrome for Testing 158; probe29a
re-run 23/23 (open-tabs tracking unregressed on all four surfaces).

Re-verified, still holding: A-01 (new DOM uses `createElement` +
`textContent`; the two `innerHTML` paths with data are the escaped
highlight preview — every character escaped before any span is
added — and the pre-existing `renderMeta`/`scanHtml` escapeHtml
paths), no `eval(` / `new Function` in extension source (the
strings appear only in the scanner's rule list), the owner-banned
word appears nowhere, A-26 stays DEFERRED (`RELEASE_PAGE_URL`
untouched).

| ID | Severity | Finding | Fix applied |
|---|---|---|---|
| A-33 | High | `chrome.permissions.contains()` does NOT report activeTab grants at all — verified live in probe30b (diag): after a real toolbar click opened the float on the page, `getAll()` listed no origins and `contains()` was false for `/*`, `/page.html*` and `/page.html` alike — yet the engine still ran the installed script there (clipboard proof). So the run-script/self-test host-access gate (A-24) falsely refused every script whose only grant was activeTab. Same false negative for a persistent `/*` grant checked against a narrow `@match` path (`/foo/*`). | Three-layer check (`hasHostAccessForTab`, background.ts): (1) `scriptHasHostAccess` now also tries origin-widened patterns (`scheme://host/*` per @match) — a `/*` grant covers a `/foo/*` script. (2) The background records activeTab grants itself: every injection through an activeTab gesture (toolbar click, showFloating, context-menu click) records `tabId → origin`; cleared when the tab closes or navigates to another origin (a same-origin reload keeps it, matching Chrome). (3) A live float ping (`hiddengemflow:ping`, floating.ts answers synchronously) proves the current document granted access — the float is only ever injected through activeTab. Only when all three are false do run-script/self-test warn instead of reloading. Verified in probe30b: self-test passes with toggle ON + toolbar-click grant, and the editor script still runs after reload. |
| A-34 | Medium | Dashboard storage-listener race clobbered archive/delete: `onArchiveScript`/`onDeleteScript` unregistered FIRST (which writes the errors key), the `onChanged` listener reloaded scripts from storage BEFORE `persistScripts()` saved, and the save then persisted the reverted list — Archive clicked, storage still `archived:false` (probe30a, 26/27). | Handlers persist FIRST, then unregister (archive, delete, bulk handlers already did); the listener is split so an errors-key write reloads only the errors, not the scripts. Verified in probe30a re-run (27/27) and the isolated diag (stored `archived:true`, Archived section lists it). |
| A-35 | Medium | Cross-origin `redirect:"manual"` is unusable from a service worker: Chrome returns an opaque response with no readable Location header, so same-host and cross-origin redirects both failed with no error text (probe30b: `ERR:Request failed`). | The handler now fetches with `redirect:"manual"` and handles a readable same-origin redirect directly; an opaque redirect (or a 3xx with no readable Location) is re-fetched with redirects followed and the FINAL URL is checked against @connect. A redirect to an unlisted host still fetches one credential-less GET, but its body is discarded and the script gets a refusal naming @connect — never the response. A follow-fetch that throws (e.g. the target's CORS policy) refuses the same way: unverifiable means refused. Verified in probe30b: same-host redirect follows (200 + JSON), evil redirect refused with the @connect reason. |
| A-36 | Low (residual, accepted) | The GM XHR/clipboard DOM-signal transport is page-readable by design (same class as A-04's notification signal): a hostile page could read a request node's id and forge a `[data-hgf-gm-xhr-resp]` node, feeding fake data to that script's `GM_xmlhttpRequest` callback — or forge a `[data-hgf-gm-clipboard]` node and get its text copied. No secret can fix it: any DOM channel is page-readable, and the relay has no private channel to the shim. | Accepted: the impact is confined to the running script's own callback data (a page can already lie to a script through its own DOM) and to clipboard text the page could set itself; no extension state is ever written from a GM response (the background never trusts response content — it only returns it), and the @connect/grant gates still hold (a forged response cannot fetch anything). Documented here; no code change. |
| A-37 | Low (residual, accepted) | GM_xmlhttpRequest to a @connect-listed host that sends no CORS headers fails in the background fetch (the service-worker fetch is CORS-bound) — the script gets a network error, not the response. The @connect gate is authorization, not a CORS bypass, and the extension holds no host permission that would change that. | Accepted: documented in the dashboard GM hint and here. Scripts that need a CORS-closed API should use a host that allows it or fetch through the page's own context. No code change. |

## v1.3 open limitations (not hidden)

25. **Live GreasyFork / OpenUserJS search is not built in.** Those
    sites do not send CORS headers the extension page can use, and
    v1.3 adds no host permission for them (by design). The "Find
    scripts for this site" panel shows installed + Official Store
    scripts that match the current site, plus a manual URL field,
    and says so plainly (`EXTERNAL_SEARCH_NOTE`) instead of faking
    results. Install from URL itself is fully implemented (fetch on
    click only → validate → preview → Confirm Install).
26. **The editor is textarea-based, not Monaco/CodeMirror.** A
    plain editor with a highlighted read-only preview + lint was
    chosen deliberately (no network dependency, no large bundle, the
    build stays offline-clean) and is stated honestly in the UI and
    in `shared/editor.ts`. No code folding, no autocomplete.
27. **GM_xmlhttpRequest responses are capped at 1 MB and GM_setClipboard text at 100 KB.** A redirect chain over 3 manual hops is refused. `GM_download` and `GM_openInTab` are NOT in this build (per the brief).
28. **The self-test runs on the active tab of a normal window.** If
    the dashboard itself is the active tab, it fails honestly
    ("Self-test only runs on http(s) pages") — bring the site tab
    forward first. The temp entry (`hgf-selftest`) is unregistered
    after the check; the page title is left as `HGF-SELF-TEST-OK`
    until the next load.
29. **`@require` lines are parsed and shown, not fetched.** A script
    declaring `@require` gets the URL listed in its metadata box,
    but the extension never fetches or executes the required file
    (that would be remote code loading). This is deliberate.


# v1.4 audit — routines (probes 30c–30e + clamp probe)

**Audited version:** 1.4 (in development, unreleased — package stays
1.2.1, `BUILD_DATE` untouched per the build brief) · **Scope:** the
v1.4 delta only — task reminders + scheduled Open All
(`shared/reminders.ts`, `alarms` permission back with the feature,
one-shot alarms re-created after firing), Flows (`shared/flows.ts`,
dashboard Flows tab, `MSG_FLOW_RUN`, `runFlow` in the background),
notes upgrade (`shared/markdown.ts` safe renderer, checklists with
explicit per-item task links, note due dates, note↔task linking),
omnibox (`shared/omnibox.ts`, keyword `flow`, `MSG_OMNIBOX_TEST`
diagnostic), backups extended with `FLOWS_KEY` + `REMINDERS_KEY`
(8 keys), and the A-38/A-39/A-40 fixes below. The v1.0.0–v1.3
findings above still apply; nothing in them was re-opened except
where noted. Build: `npm run typecheck` clean, `npm run build` clean
(1.61 MB); built manifest: version 1.2.1, permissions exactly
`["storage","tabs","scripting","activeTab","userScripts","notifications","sidePanel","contextMenus","alarms"]`
(v1.2.1's 8 + `alarms` only), `omnibox: {"keyword":"flow"}`,
4 commands. No `host_permissions`, no new permission besides
`alarms`. The owner-banned word appears nowhere in `entrypoints/`;
no `eval` / `new Function` execution anywhere (the 3 grep hits are
the scanner's own rule strings that *flag* `eval()` in user
scripts, plus one comment).

**Audit checklist — all verified (code + live probe, see below):**
every new message handler validates its inputs (`MSG_FLOW_RUN`
requires a non-empty string id; `MSG_OMNIBOX_TEST` requires a string
query; `MSG_REMINDERS_*` take no ids); every alarm branch
re-validates its id against storage before acting, and unknown
`hgf-` alarm names are inert; a scheduled Flow can never install
anything (`runFlow` only opens tasks via `openUrls` and reports
scripts that match an opened page through the existing
`chrome.userScripts` registration); notification clicks open only
the target the id names (`handleNotificationClicked` re-validates
the task/note/flow against storage — a deleted target opens
nothing); the Markdown renderer cannot inject HTML/script (DOM
nodes + `textContent` only, hostile body renders as inert text —
verified live); a checklist tick cannot complete a task it isn't
linked to (the link is an explicit per-item taskId, validated to
exist and not already completed — verified live, including the
unlinked-tick negative control); scheduled Open All goes through
the same `openUrls` funnel as manual Open All (50-tab cap +
open-tabs tracking); omnibox input is never executed as code
(`parseOmniboxInput` only accepts the `task:`/`script:`/`note:`
content keys, and the entered text is never evaluated).

| ID | Severity | Finding | Fix applied |
|---|---|---|---|
| A-38 | Medium | Dashboard notes list did not live-refresh on storage change while the tab was open — unlike tasks, which got the live-update listener in v1.0.1 (bug #3). A note saved or changed from another surface (floating window, background checklist tick) only appeared after a tab switch. Found by probe30c: a note seeded via storage never appeared in the list, and screenshots 205/206 came out byte-identical. | `initNotes` now registers a `chrome.storage.onChanged` listener for `NOTES_KEY` that calls `notesHandle.refresh()` (which never clobbers an open editor — only the list re-renders). Verified in the probe30c re-run (33/33; the hostile note renders after seeding, all 6 screenshots unique). |
| A-39 | Medium | Dashboard checklist checkboxes were invisible: `.note-body.has-checklist` (0,2,0) loses to `#panel-notes .note-body` (1,1,0), so the 2-line clamp stayed on and hid the checkboxes in the dashboard Notepad list (the float and side panel/popup were fine — their unclamp selectors win). The probe's DOM click still ticked them, so the functional checks passed while a real user could neither see nor click them. Found by viewing screenshot 205. | `#panel-notes .note-body.has-checklist` in `entrypoints/dashboard/style.css`. Verified by probe30c-clamp (4/4: computed `line-clamp: none`, all 3 checkboxes inside the card and hit-testable, a real Playwright mouse click on the visible checkbox completes the linked task; screenshot 215 viewed — ticked item struck through with "→ Titan Exchange done ✓"). |
| A-40 | High | A Flow run claimed its scripts were "running on the opened pages" on URL match alone. Chrome only executes user scripts on pages the extension has host access for, and a flow-opened tab carries no activeTab grant (there is no gesture on it) — so without a persistent site-access grant the script never executes, but the status said it did. Found by probe30d v2: status "1 script running on the opened pages (Probe Flow Script)" while both page titles stayed "Probe Page". | `runFlow` now checks `scriptHasHostAccess` (persistent grant, origin-widened, the A-33 helper) per URL-matched script; only granted scripts count as running. The rest are named in the result — `formatFlowRunResult` gained a `noAccessNames` part ("1 script matches the opened pages but has no site access — grant it from the Scripts tab (Probe Flow Script)."), carried in the background notification AND the dashboard status line (the first probe30e run caught that the dashboard rebuilt the string without forwarding `noAccessNames` — fixed in the same pass). Verified by probe30e (13/14): with a seeded persistent grant the status says running AND both flow-opened tabs' titles really become `HGF-FLOW-RAN`; without a grant the status names the no-access script and the titles stay "Probe Page". Smoke: +1 check (142/142). |

## v1.4 open limitations (not hidden)

30. **Notifications-blocked degradation is UNVERIFIED live.** The
    harness cannot force `chrome.notifications.getPermissionLevel()`
    to "denied" for the extension in this environment: the
    `default_content_setting_values.notifications = 2` pref (written
    to the correct `Default/Preferences` path, value kept by Chrome)
    governs websites, not the extension's level, and
    `--disable-notifications` also leaves it "granted". The code path
    is the same `getPermissionLevel()` call whose "granted" branch is
    verified live (probe30c: dashboard "Reminders are on"), and the
    "denied" branch (dashboard "Reminders are OFF" + nudge "NOT
    sent — notifications are blocked") is code-reviewed only. The
    owner can verify it on a real machine by blocking notifications
    for the extension in Chrome settings.
31. **Notification-click routing is code-reviewed, not live-clicked.**
    `handleNotificationClicked` re-validates every id against storage
    (deleted targets open nothing; `hgf-n-task-` opens the task,
    `hgf-n-note-` opens Notepad, `hgf-n-flow-` opens Flows,
    `hgf-n-nudge` opens Tasks), but OS notification bubbles cannot
    be clicked via CDP/XTest reliably in this harness, so no live
    click was performed. The fires themselves are proven live
    (probe30d: `hgf-n-task-*` and `hgf-n-note-*` seen in
    `chrome.notifications.getAll()`).
32. **Omnibox live typing cannot be simulated via Playwright/CDP.**
    Verified via the manifest keyword (`flow`), the read-only
    `MSG_OMNIBOX_TEST` diagnostic (which runs the same
    `searchOmnibox` function `onInputChanged` uses — real matches,
    tasks first), and Node ranking smokes. Real address-bar typing
    is still the owner's to try.
33. **Scheduled Open All opens the same set as manual Open All**
    (pinned or all, including completed tasks — no completed
    exclusion).
34. **A checklist tick stamps the note's `updatedAt`** (it is an
    edit) and may re-sort the note to the top. Unticking never
    un-completes a task.
35. **A reminder for a completed task is skipped by design;**
    un-completing re-enables it via the storage-change reschedule.
36. **Flow scripts run only with a persistent site-access grant**
    (A-40); the run status now says so and names the script. Grant
    it from the Scripts tab ("Grant site access").
37. **Alarms are one-shot, re-created after firing** (a
    weekday-only schedule cannot be expressed with
    `periodInMinutes`). `rescheduleAlarms()` clears and re-creates
    all `hgf-` alarms on install/startup/storage-change/after-fire;
    two concurrent reschedules converge (both derive the same set
    from storage).
38. **Probe30d screenshots 210/212 are byte-identical** (same
    Flows-tab view — nothing visible changes between the
    reminder-fired and note-due-fired moments) and are not reported
    as distinct evidence; the fires are proven by the `getAll()`
    polling, not those frames.

# v1.5+ audit — surfaces & depth (probes 30f–30g + group probe)

**Audited version:** 1.5+ (in development, unreleased — package stays
1.2.1, `BUILD_DATE` untouched per the build brief) · **Scope:** the
v1.5+ delta only — new-tab dashboard (`chrome_url_overrides`,
opt-in default OFF), sessions (`shared/sessions.ts`, auto-save on
window close), Smart Open All (`shared/smart-open.ts`, skip
duplicates, tab grouping, discard-suspend), userstyles
(`shared/userstyles.ts`, `public/style-injector.js`,
`chrome.scripting` registration), scratchpad
(`shared/scratchpad.ts`), site dossier (`shared/dossier.ts`),
store collections (`shared/collections.ts`), storage viewer
(`shared/storage-viewer.ts`), local-file workflow
(`shared/local-file.ts`), snooze queue (`shared/snooze.ts`),
backups extended with sessions/userstyles/snoozes/followed
collections/smart-open/new-tab (14 keys), and the A-41…A-52 fixes
below. The v1.0.0–v1.4 findings above still apply; nothing in them
was re-opened except where noted. Build: `npm run typecheck`
clean, `npm run build` clean (1.71 MB); built manifest: version
1.2.1, permissions exactly
`["storage","tabs","scripting","activeTab","userScripts","notifications","sidePanel","contextMenus","alarms"]`
(v1.4's 9, no new required permission),
`optional_permissions: ["tabGroups"]` only,
`chrome_url_overrides: {"newtab": "newtab.html"}`,
`omnibox: {"keyword":"flow"}`, 4 commands. No `host_permissions`.
The owner-banned word appears nowhere in `entrypoints/`; no `eval`
/ `new Function` execution anywhere.

**Audit checklist — all verified (code + live probe, see below):**
every new message handler validates its inputs
(`MSG_SESSION_SAVE` requires a non-empty string name,
`MSG_SESSION_RESTORE`/`MSG_SESSION_DELETE` require a non-empty
string id that exists in storage, `MSG_SMART_OPEN` requires a scope
in all/pinned/missed, `MSG_USERSTYLES_SYNC` takes no ids,
`MSG_SCRATCHPAD_RUN` requires a string code ≤100 KB and a kind in
js/css, `MSG_GM_VALUES_READ` requires a non-empty string script id
that exists); session restore only ever calls `windows.create` —
it cannot close any existing tab (verified live: page count grew
4 → 6, original tabs untouched); Smart Open All discard only ever
calls `chrome.tabs.discard` on tabs it opened and never viewed, and
never closes (code + the suspend alarm is re-created from the
pending list, never from a close); userstyle CSS cannot exfiltrate
(`validateUserStyleCss` rejects any `@import` and any `url()` that
is not a `data:` URL, re-validated at registration time — a
hand-edited stored style can never smuggle one in); scratchpad code
runs only on the active tab of a normal window, only when the user
clicks Run, and is never persisted (verified live: title changed on
the site tab, no script and no scratchpad key in storage
afterwards); the storage viewer is read-only — `readGmValues`
executes a static function that only copies `localStorage` keys,
and there is no write path anywhere in the viewer; a snooze alarm
only removes the snooze and notifies — it never opens anything
(`fireSnoozeAlarm` has no open call; verified live: the 1-minute
snooze returned the task and delivered `hgf-n-snooze-*`, no tab
opened); the new-tab opt-in can only be flipped from extension
pages (Dashboard Settings toggle, new-tab enable button) — web
pages cannot write extension storage, and the page shows only the
minimal enable screen while OFF (verified live before/after in the
same browser); optional-permission denial degrades honestly
(grouping → plain tabs with the status saying so, userstyles →
"needs site access" + Grant button).

| ID | Severity | Finding | Fix applied |
|---|---|---|---|
| A-41 | High | `syncUserStyles` called `chrome.scripting.registerContentScripts` with a single object — the API takes an **array**. Chrome threw "No matching signature", the catch swallowed it as "skipped", and no userstyle was ever registered; the dashboard still said "it applies on its site now". Found by a debug probe: `getRegisteredContentScripts()` returned `[]` after a save. | Call with an array (`[{...}]`). Verified by the debug probe (registered list shows the style) and probe30f (h1 turns red live). |
| A-42 | High | `registerContentScripts` takes CSS as **file paths**, not inline CSS text — passing a style's raw CSS as the `css` entry would have made Chrome try to load a file named `h1 { color: ... }`. The first implementation did exactly that (masked by A-41). | A shared injector script (`public/style-injector.js`, copied to the extension root by WXT) is registered per style with that style's match patterns; it reads the styles from storage and injects the matching ones as `<style>` elements, re-applies on storage change and on a `hiddengemflow:styles-apply` message. Verified live in probe30f (red h1 on reload; back to default when disabled). |
| A-43 | High | A dynamically registered content script only **runs** on hosts the user granted (optional host permission). Registration succeeds for an ungranted host but the script never executes — so a saved style silently did nothing while the UI claimed it applied. Same two-grant trap as userscripts (A-40), found the same way: the trivial control script did not run until the site-access grant was seeded. | `syncUserStyles` skips ungranted hosts and reports `needsGrant`; the dashboard shows "needs site access" per style with a **Grant site access** button (requests `*://<host>/*` on the click gesture), and the save status says so instead of claiming it applies. The Styles panel copy states the rule. Verified live: with the grant the style applies (probe30f), and the grant check is host-by-host (A-46). |
| A-44 | Medium | `styleMatchPatterns` added a `www.` variant for every host — including IP addresses (`www.127.0.0.1`) and `localhost`, which are not hosts any page has. | No `www.` variant for IP hosts or `localhost` (smoke: `styleMatchPatterns("127.0.0.1")` → one pattern). |
| A-45 | Low | `cleanStyleHost` silently stripped the port from a host (`127.0.0.1:18081` → `127.0.0.1`) — correct semantics (match patterns ignore ports) but nothing told the user the port was dropped. | Documented in the function comment; smoke test pins the strip (`cleanStyleHost("127.0.0.1:18081")` → `"127.0.0.1"`). |
| A-46 | Medium | `chrome.permissions.contains()` with a broad pattern returns **false** even when a narrower grant for the same host exists (verified live: grant `http://127.0.0.1:18081/*` held, `contains({origins:["*://127.0.0.1/*"]})` false, `contains({origins:["http://127.0.0.1/*"]})` false). Any grant check built on `contains` with a pattern would always read "not granted". | `styleHostGranted` compares `chrome.permissions.getAll()` origins host-by-host (`hostOfOriginPattern` drops scheme/port/`www.`). Smoke: a narrower origin grants the host; another host does not. |
| A-47 | High | The dashboard asked for `tabGroups` with a bare `await chrome.permissions.request(...)` on the click handler. From a non-gesture context (e.g. an automated click) the request shows the prompt and **waits forever** — the restore/smart-open handler never proceeded (probe30f regressed to 21/26: restore never ran, status stayed empty). | The request is raced against a 5 s timeout: if the user has not answered, the action proceeds ungrouped (a later Allow still grants it for next time). Verified in probe30f (denial path completes; grouped path still works on a real click + Allow). |
| A-48 | High | Local-file "Check file for changes" could never work: the re-import used a plain `<input>`, which yields a `File` but **no `FileSystemHandle`**, and the code referenced `showOpenFilePicker` without calling it — so no handle was ever stored and the check button always errored. Found during the build's own verification pass. | "Re-import a file…" now tries the File System Access picker first (returns a handle, saved in dashboard IndexedDB under `hiddengem-flow-localfile`), falling back to the plain input; the check button re-reads the saved handle, and honestly says "No file was picked … yet" when there is none. Verified live in probe30g (check-without-pick errors honestly; re-import of a bumped file updates the script to v1.1). |
| A-49 | Info (spike) | **MV3 file-watching feasibility spike — NOT POSSIBLE.** A service worker cannot re-read a local file without a user gesture, and Chrome has no file-watching API for extensions; a `FileSystemHandle` can only be re-read from a page context (the dashboard) after the user picked it, and only while that handle's permission grant lasts. | The build ships **export + manual re-import only** (export downloads a real `.user.js`; re-import validates `@name` against the installed script and routes through the normal version-upgrade path with history). It never pretends to watch: the spike result is stated in `LOCAL_FILE_SPIKE` (`shared/local-file.ts`), in the Dossier panel's local-file card, and here. Verified live: export downloads the real script, re-import updates it, the check button without a picked file says so. |
| A-50 | High | `tabGroups` was requested from the **background service worker**, which has no user activation — the request can never show its prompt, so grouping was always declined in practice. | The background only ever checks `contains()` (A-51); the dashboard asks on the click gesture (A-47). The denial path still degrades honestly. |
| A-51 | High | The grant is **not visible to `contains()` the instant the user clicks Allow** — the request promise resolves first and the grant lands up to ~1 s later (measured live: a check 400 ms after Allow still read false). A fresh Allow therefore always read as a denial, because the dashboard sends the message the moment the prompt closes. | `ensureTabGroupsPermission` polls `contains()` every 200 ms for up to 1.4 s before returning false. The tabs are already open by then, so the only cost of a real denial is a later status line. Verified live in the group probe (status flips to "into the Morning Flow group" on the same run). |
| A-52 | High | **`chrome.tabGroups.group` does not exist.** Grouping is `chrome.tabs.group()`; the `chrome.tabGroups` namespace only has `get`/`query`/`update`/`move`. The guard in `ensureTabGroupsPermission` (`!chrome?.tabGroups?.group`) therefore returned false on every run, and both grouping call sites would have thrown — grouping was **unreachable**, and every smart-open/restore silently degraded. Found by probing the live namespaces after a grant: `typeof chrome.tabGroups.group` is `undefined` while `typeof chrome.tabs.group` is `function` (both contexts). | Guard and both call sites (`smartOpen`, `restoreSession`) now use `chrome.tabs.group()`; `chrome.tabGroups.update()` (which exists) still sets the title. Verified live in probe30f: "Opened 1 tab into the “Morning Flow” group", the new tab's `groupId` ≥ 0, and `tabGroups.query({title:"Morning Flow"})` returns the group. Smoke does not cover this (it needs the live API); the probe is the evidence. |

## v1.5+ open limitations (not hidden)

1. **Snooze filtering applies to the dashboard task list, the new-tab page, and Smart Open All; the in-page floating window's task list does not filter snoozed tasks.** The float was not changed (its list is rendered from the same storage but without the snooze filter). A snoozed task still shows in the float until it returns.
2. **Scratchpad JS needs Chrome's "Allow User Scripts" toggle ON** (same as any userscript); the CSS path tries `insertCSS` first (no toggle needed) and falls back to the temp-userScripts path. A scratchpad run on a page without the toggle reports the honest error from the background.
3. **Userstyle live preview registers the style while the form's preview toggle is on; dark-hours styles register only inside their window** (hourly alarm re-checks). A style whose window is closed shows as "dark hours …" rather than active.
4. **Session restore grouping requests the optional `tabGroups` permission at restore time** (dashboard, on the click gesture); a denial restores tabs ungrouped with an honest message. The restore itself never waits on the prompt (5 s race, A-47).
5. **The new-tab override is kept by Chrome even when the opt-in is OFF** — the page then shows only the minimal enable screen, by design. Turning the setting off does not restore Chrome's default new-tab page (only disabling the extension or removing the override key would). **Resolved in v2.0.3** — the override key was removed (see the v2.0.3 audit), so new tabs are the browser's default again.
6. **Omnibox live typing cannot be simulated via Playwright/CDP** (known from v1.4, item 32) — not in v1.5+ scope.
7. **Notifications-blocked degradation is unverified live in this harness** (v1.4 item 30) — code path only.
8. **Local-file "Check file for changes" only works after a picker pick** (A-48/A-49): a file re-imported through the plain `<input>` fallback has no handle, so it updates the script but cannot be re-checked later; the button says so. File-watching is not possible in MV3 (A-49).
9. **Smart Open All's suspend poll adds up to ~1.4 s before the status line lands when ungrouped** (A-51); the tabs themselves open immediately — only the grouping decision waits.
10. **A-26 stays DEFERRED:** `RELEASE_PAGE_URL` in `shared/updates.ts` still points at the v1.1.0 pre-release tag — not touched.

## Later (v2.0.0 final phase — in development, NOT released, package stays 1.2.1)

Scheduled scripts (`shared/schedules.ts`, per-script opt-in default
OFF, confirm-first gate, visible run log capped at 50, `hgf-sched-*`
alarms), opt-in sync (`shared/sync.ts`, WebDAV / GitHub Gist /
Google Drive, default OFF, tokens in `chrome.storage.local` only
under a separate key that backups explicitly exclude, snapshot-first
in both directions), AI authoring (`shared/ai-author.ts`, 5 built-in
local templates, draft preview only, cloud LLM = Groq BYOK opt-in
only), all surfaced in the dashboard Later tab (all 4 surfaces keep
working; the Later tab is dashboard-only by design). Backups extended
with schedules/sync settings/AI settings (3 keys); token keys and
the run-log key are NOT in `BACKUP_DATA_KEYS`. Build: `npm run
typecheck` clean, `npm run build` clean (1.77 MB); built manifest:
version 1.2.1, permissions exactly
`["storage","tabs","scripting","activeTab","userScripts","notifications","sidePanel","contextMenus","alarms"]`
(the same 9, no new required permission),
`optional_permissions: ["tabGroups"]` only,
`optional_host_permissions: ["*://*/*"]` (unchanged — the sync
provider origin is requested from that set, A-53),
`chrome_url_overrides: {"newtab": "newtab.html"}`,
`omnibox: {"keyword":"flow"}`, 4 commands. No `host_permissions`,
no `identity`. The owner-banned word appears nowhere in
`entrypoints/`; no `eval` / `new Function` execution anywhere
(the only mentions are comments and the cloud system-prompt string
that bans them).

**Audit checklist — all verified (code + live probe, see below):**
every new message handler validates its inputs
(`MSG_SCHEDULE_RUN_NOW` requires a non-empty string script id,
`MSG_SCHEDULES_RESCHEDULE` / `MSG_SYNC_NOW` / `MSG_SYNC_PULL` /
`MSG_SYNC_STATUS` take no ids; schedule set/remove validate the
interval against the allowlist and drop schedules for deleted
scripts; sync validates the provider, the target
(`validateSyncTarget`) and the host (`syncHostAllowed`) BEFORE any
token is attached; the AI prompt path validates host, selector and
text, and the cloud path requires opt-in + provider + key);
scheduled runs re-validate everything at fire time — script still
exists/enabled/unarchived, engine on, persistent host access
(`scriptHasHostAccess`, no activeTab grant on a scheduled run),
AND the script is actually registered (A-55); sync tokens are never
logged, never in backups, never in snapshots, and never sent except
to the chosen provider endpoint (the host allowlist is checked
before the token is attached; Gist tokens only to api.github.com,
Drive tokens only to *.googleapis.com; the fake-token smoke test and
the live probe both assert the token string appears NOWHERE in the
uploaded body, the snapshots, or the backup state); AI drafts are
never executed before Save — the draft is text in dashboard memory
only, and Save routes through the normal v1.3 editor + scan +
confirm + version history (verified live: 0 installed scripts after
generating a draft, 0 after loading it into the editor, 1 only after
Confirm install); template matching cannot inject code (static
template strings with validated host/selector slots only;
user-supplied text goes through `JSON.stringify`, never string
concatenation into code); sync conflict handling never deletes local
data without a snapshot (snapshot-first both directions, verified
live with createdAt timing windows against the PUT/GET; a bad
download payload is refused as a whole and local data is untouched);
**offscreen document: evaluated and NOT used** — a userscript
cannot execute in an extension-origin offscreen document (wrong
DOM/origin, no GM shim), and injecting user code there would be
eval-equivalent in a privileged context. A scheduled run therefore
opens the script's @match site in a BACKGROUND tab (active:false),
lets the already-registered script run on load, waits for load + a
5 s grace, then closes the tab. This is a stated deviation from the
plan's "alarms + offscreen" sketch.

| ID | Severity | Finding | Fix applied |
|---|---|---|---|
| A-53 | High | **An extension fetch to a provider host is CORS-blocked without a host permission.** The first sync implementation fetched from the service worker with no grant, so every provider call failed with "Failed to fetch" even though the server was up and the credentials were right — the status line blamed the server. Found by probe30h-sync (11/20: PUT never arrived, only an OPTIONS preflight). | The dashboard asks for exactly the provider's origin on the user's click gesture (`syncOriginPattern`: WebDAV = the user's URL origin, Gist = `api.github.com`, Drive = `*.googleapis.com` — never a blanket pattern), via `ensureSyncHostAccess` (checks `contains()` first, requests on toggle-ON / Sync now / Download, polls `contains()` up to 1.4 s after Allow per A-51). A denial keeps sync off with an honest message and syncs nothing. The Sync card copy states the grant. Verified live in probe30h-sync (20/20): the prompt appears ("Read and change your data on 127.0.0.1", screenshot `docs/live-test/232b-sync-permission-prompt.png`), Allow grants the origin, the PUT arrives with the auth header. |
| A-54 | Medium | `syncDownload`'s doc comment said "snapshot-first, then strict-parse" but the code fetched + parsed first, snapshotted second, then wrote — so the probe's [click, GET) snapshot window failed (the protecting snapshot landed 3 ms AFTER the GET). No data was ever at risk (the snapshot always preceded the WRITE, the same order as a backup restore), but the comment misstated the contract. | Comment corrected to the actual order (fetch + strict-parse → snapshot → write; "snapshot-first" means before the write that replaces local state); the probe window corrected to (GET, restoredAt]. Verified live in probe30h-sync (20/20). |
| A-55 | High | **`urlFromMatchPattern` appended a trailing slash to every path** — `page.html` became `page.html/`. The opened tab's URL no longer matched the script's `@match`, so the script silently never ran, while the run log claimed "ok" ("the script ran on load"). The server 404'd on `/page.html/`. Found by debug probes: a foreground load ran the script (title + server hit), the scheduled tab loaded as a 404 with its title unchanged. | Exact path, no appended slash (smoke: +4 regression tests pinning exact file/nested/bare paths, 161/161). `fireScheduleRun` now verifies the script is actually registered at fire time (one re-register attempt from storage, else an honest failed log and NOTHING opened). The ok log wording now states only what was verified ("page loaded, script registered for this site, tab closed after 5 s"). Verified live in probe30h-schedules (23/23): manual + alarm runs each produce a server hit and the `HGF-SCHED-RAN` title. |
| A-56 | Medium | **`.row { display: flex }` beats the UA stylesheet's `[hidden]` rule**, so the AI draft Save/Discard buttons stayed visible after an error or a Discard even though `clearAiDraft()` hid them. The Save click was a guarded no-op (`if (!laterDraftCode) return`), so nothing could be saved — a UI bug, not a data bug. Found by reading screenshot 235. | `.row[hidden] { display: none; }` (the same targeted pattern as the existing `[hidden]` overrides). Verified in the re-run probe30h-ai 235 screenshot (buttons gone after the error). |
| A-57 | Low | Password inputs (`type="password"`) were not covered by the dashboard's dark input rule (only `text`/`search`), so the sync credential and Groq key fields rendered as white boxes on the dark UI. Found by reading screenshots 230/232. | `input[type="password"]` added to the base and focus rules. Verified in the re-run screenshots (dark fields, 230/232/233/235). |
| A-58 | Info | Sync status messages said "1 tasks" (no singular/plural). | Inline singular/plural in both the upload and download messages. |

## Later open limitations (not hidden)

1. **A scheduled run opens the script's site in a background tab — there is no literal no-page execution.** A userscript can only run inside a page, so the tab is open ~6 s (load + 5 s grace) and then closes. A script whose @match has no openable URL (bare host wildcard, `*`, `<all_urls>`) cannot be scheduled — the run logs an honest failure instead.
2. **The cloud LLM call is verified live for Groq + Gemini with fake keys (probe31, v2.0.1)** — Groq refused with HTTP 401 and Gemini with HTTP 400 ("API key not valid"), proving URL + request shape reach the real endpoints; the mock Custom call proved the full draft path end to end. A real-key call that returns a usable draft is still open (no real key in the harness); the other six providers are covered by smoke tests (request building) + live UI checks, not by live calls.
3. **A sync provider must be reachable from the extension** — turning sync on asks once for that provider's origin (A-53); a denial keeps sync off. A provider behind a VPN/proxy the browser does not use, or a WebDAV server that refuses the PUT/GET, fails honestly and leaves local data untouched.
4. **A run-log "ok" means the page loaded, the script was registered for that site, and the tab stayed open 5 s** — the script's own effects are the execution proof (the probe's server hit). The background cannot observe a userscript's effects directly.
5. **A-26 stays DEFERRED:** `RELEASE_PAGE_URL` in `shared/updates.ts` still points at the v1.1.0 pre-release tag — not touched.

# v2.0.1 audit — multi-provider Cloud LLM (probe31-ai-providers)

Scope: the Cloud LLM panel (Later tab) went from Groq-only to nine providers — Groq, Google Gemini, NVIDIA NIM, OpenRouter, Together AI, Hugging Face, Cerebras, Mistral, plus Custom (user-typed base URL). Each provider has its own fixed endpoint, default free model, and its own API key (one key per provider, all under `hiddengemflow.ai.tokens.v1`, never in backups/logs). The Model field is user-editable. `buildCloudCall` (`shared/ai-author.ts`) is the single place a key meets an endpoint. Smokes 851/851 (Later 241/241, incl. 80 provider tests); probe31-ai-providers 56/56 live in real Chrome 158; screenshots 237–241.

| ID | Severity | Finding | Fix applied |
|---|---|---|---|
| A-59 | Medium | **The Custom Base URL row stayed visible for EVERY provider.** `.form-row label { display: flex }` beats the UA stylesheet's `[hidden]` rule — the same trap as A-56 (which fixed `.row[hidden]`). The `hidden` property was true, so the probe's property check passed while the row was visibly rendered. Found by reading screenshot 240 from the first probe31 run (Base URL row visible under a Gemini selection). | `.form-row label[hidden] { display: none; }` in `dashboard/style.css`. The probe now asserts the COMPUTED style (`getComputedStyle(...).display === 'none'` for Groq, `'flex'` for Custom), not just the property. Verified in the probe31 re-run (56/56) + screenshots 237/240. |
| A-60 | Low (residual, accepted) | **The Gemini key travels as a `?key=` query parameter in the request URL** (Google's documented browser approach). A key in a URL is more exposed than a header if anything ever logged the URL. | Documented decision, not a defect to fix: the URL is built only inside `buildCloudCall`, is never logged, stored, or displayed anywhere (status lines use the provider label only), and is sent only to `generativelanguage.googleapis.com`. The `x-goog-api-key` header alternative was considered; `?key=` is Google's documented approach for browser calls. Smoke-pinned (the Gemini URL contains the key only as the query param) + live-verified (Google answered 400 "API key not valid", proving the key arrived). |
| A-61 | Low-Medium (documented decision) | **Custom base URLs allow plain http:// for loopback only.** The task brief said "reject http://" with no exception — but it also required the live probe to point Custom at a local mock server on `http://127.0.0.1:18081`, which is impossible under a blanket http ban. | Deliberate, documented interpretation: `validateCustomBaseUrl` rejects remote http:// ("your API key would travel in the clear") and allows http:// ONLY for localhost / 127.0.0.1 / ::1 — the same rule the sync WebDAV target already uses and that was audited there, because a loopback request never travels over a network. The UI note states it, the code comment states it, and smoke tests pin both sides (remote http rejected, loopback http accepted, `javascript:`/`file:`/userinfo/query/fragment rejected). If the owner wants a blanket ban, the loopback allowance is one line to remove — but the mock probe would then need a TLS mock. |
| A-62 | Low (residual, accepted) | **First contact to a real provider through the sandbox egress proxy took >15 s** (Gemini and Groq both) — the dashboard shows "Asking …" with no timeout, which reads as a hang. The first probe31 run failed both checks on a 15 s poll; the calls completed (Gemini 400, Groq 401) and the re-run with a 45 s poll passed. | Accepted: no timeout was added — a timeout could kill a legitimately slow call on a real connection, and the status line is honest while waiting. The slowness is the sandbox proxy's first-contact cost, not the extension (the second contact to the same host answered fast). Real usage on a normal connection answers in seconds. |
| A-63 | Low | **The cloud button read "Generate with Custom (OpenAI-compatible) (cloud)"** — double parentheses from using the full dropdown label in a tight spot. | `shortLabel` added to the provider table ("Custom" for Custom, same as the label elsewhere) and used for the button text and the `buildCloudCall` provider label ("Asking Custom…", "Custom refused…"). Verified in the probe31 re-run (button text "Generate with Custom (cloud)"). |

## v2.0.1 open limitations (not hidden)

1. **Only Groq + Gemini + Custom (mock) were called live.** OpenRouter, Together AI, Hugging Face, Cerebras, Mistral and NVIDIA were verified by smoke tests (endpoint + model + request shape + Bearer header) and live UI checks (label, model default, "sent only to" copy, save flow), not by live calls — the harness has no real keys for them. A wrong default model or a provider-side CORS surprise would surface as an honest "refused the request" status, never as a silent install.
2. **A real-key cloud call that returns a usable draft is still open** — the fake-key calls prove transport + shape, not a successful draft. The draft path itself (preview → editor → scan → confirm) is proven end to end by the mock Custom call.
3. **The host-access fallback (fetch first, ask once on network failure, retry once) was not exercised live** — the mock and the real providers all send CORS headers, so no permission prompt appeared. The code path mirrors `ensureSyncHostAccess` (A-53), which was exercised live for sync.
4. **A-26 stays DEFERRED:** `RELEASE_PAGE_URL` in `shared/updates.ts` still points at the v1.1.0 pre-release tag — it must be updated to the v2.0.1 tag at publish time (the v2.0.0 target in the old note is superseded).

# v2.0.2 audit — Cloud LLM model auto-detection (probe32-ai-models)

Scope: the Cloud LLM panel (Later tab) gains a "Detect models" button next to the Model field. After a provider + key are present, it fetches that provider's model list with the key and shows it as a dropdown; the current/default model stays selected if it is in the list, otherwise the first model; a "Type manually" button restores the text field — typing is never taken away. Only the SELECTED model is saved (same storage as today); the fetched list is memory-only and re-fetched on next open. `buildModelsCall` + `parseModelsResponse` + `orderModels` (`shared/ai-author.ts`) are the pure core; the dashboard (`dashboard/main.ts`) renders the picker. Smokes 890/890 (Later 280/280, incl. 39 new model tests); probe32-ai-models 32/32 live in real Chrome 158; screenshots 242–246.

| ID | Severity | Finding | Fix applied |
|---|---|---|---|
| A-64 | Low | **Re-picking the SAME provider in the dropdown wiped the model back to the provider default and cleared the detected list.** The provider-change handler ran unconditionally on every `change` event — including a re-selection of the already-shown provider. Found by probe32's first run (25/28): the probe re-selected `custom` while it was already selected, the model reset to `""`, and the saved-model / Type-manually checks then failed. | `aiProviderShown` (set at the end of `renderAiProviderFields`) tracks the rendered provider; the change handler now short-circuits when `picked === aiProviderShown` and re-renders with the model field's CURRENT value, keeping the detected list. Switching to a DIFFERENT provider still resets the model to the new default and clears the list (that is the intended behaviour). Verified in the probe32 re-run (32/32), including the explicit check "the model is preserved when re-picking the same provider". |
| A-65 | Low (residual, accepted) | **Gemini models whose `supportedGenerationMethods` is missing or not an array are EXCLUDED from the dropdown** (the brief says keep only `generateContent` models; a model without the field cannot be proven to support it). A model Google returns without that field is therefore undetectable. | Documented, not fixed: the user can still type such a model manually — the manual fallback is exactly for unlisted models — and the exclusion is smoke-pinned (missing / non-array field → left out, no crash, no throw). Unknown extra fields in the Gemini response are tolerated (only `name` and `supportedGenerationMethods` are read). |
| A-66 | Low | **Key routing for the models call.** A new fetch path is a new chance to send a key to the wrong endpoint. | Verified, no defect: `buildModelsCall` is the single place a key meets a models endpoint, reusing the same per-provider endpoint table as `buildCloudCall` (Gemini `?key=` to `generativelanguage.googleapis.com`, named providers Bearer to their fixed `/models` URL, Custom to the validated base URL + `/models`). The live mock recorded exactly one `GET /v1/models` with the typed Bearer key and no request to any other endpoint; the bad-key run sent the bad key only to the same mock endpoint. The key is never logged, never stored anywhere new (the fetched list is memory-only), and the models call reuses the `ensureAiHostAccess` fetch-first / ask-once / retry-once pattern. |
| A-67 | Low | **Dropdown rendering — model ids are page data from the provider.** A malicious or weird model id (e.g. containing markup) must never become HTML. | Verified, no defect: options are built with `textContent` only (`renderAiModelPicker`); there is no `innerHTML` anywhere in the picker path. The live mock ids render as plain text. |
| A-68 | Low | **Cap / truncation honesty.** A provider with >100 models could silently show only the first 100. | Verified, no defect: `orderModels` caps at 100 and returns `{ total, truncated }`; the status line says "showing 100 of {total} — type the rest manually" when truncated. Smoke-pinned (150-id list → 100 entries, `truncated: true`, `total: 150`). Sorting is smoke-pinned too: Gemini keeps provider order with the default model first if present, OpenRouter free (`:free`) first then alphabetical, others alphabetical; duplicates are removed before ordering. |
| A-69 | Low | **Probe artifact, not an extension bug — the first probe32 "reopen" never reloaded the page.** `page.goto()` to the identical URL is a same-document navigation, so the detected list survived the "reopen" and the session-only claim was untested (the check failed with the text field still hidden). | Probe fixed: the reopen now uses `page.reload()`. The re-run proves the list is dropped on a real reload (text field visible again, `flex`) while the saved model persists (`mock-model-b`), and that re-detecting with the STORED key re-lists the models with the saved model selected. |
| A-70 | Low (accepted) | **A failed fetch never clears the saved model — but it also leaves the STALE detected list showing** (the handler returns early on error without touching `aiDetectedModels`). A stale list could show models the provider no longer offers. | Accepted: clearing the list on failure would destroy the user's working selection for a transient network blip, and the saved model — the thing that matters — is untouched (probe-verified: storage and field both still `mock-model-b` after the 401). The status line says the fetch was refused, so the user is not misled into thinking the list is fresh. |

## v2.0.2 open limitations (not hidden)

1. **Only Custom (mock) + Gemini (HTTP 400) were called live.** Groq, OpenRouter, Together AI, Hugging Face, Cerebras, Mistral and NVIDIA model lists are smoke-tested only (endpoint URL + Bearer header + OpenAI-shape parsing + ordering + cap). A real-key successful detection for any provider is still unverified — the harness has no real keys. A provider-side surprise would surface as an honest status line ("refused the request", "models ana jayni"), never as a silent wrong model.
2. **The host-access fallback for the models call was not exercised live** — the mock and Google both send CORS headers, so no permission prompt appeared. The code path mirrors the cloud-generate call (probe31) and `ensureSyncHostAccess` (A-53), which were exercised live.
3. **A-26 stays DEFERRED:** `RELEASE_PAGE_URL` in `shared/updates.ts` still points at the v1.1.0 pre-release tag — it must be updated to the v2.0.2 tag at publish time (the v2.0.1 target in the old note is superseded).

# v2.0.3 audit — new-tab override removed (probe33-newtab-removed)

Scope: the v1.5+ opt-in new-tab dashboard (#10) is REMOVED at the owner's request (2026-11-17, with screenshots): with the dashboard OFF, new tabs still showed the extension's minimal enable screen instead of Brave's default new tab — a Chrome fact, not a page bug, because `chrome_url_overrides` is manifest-static and there is NO API to hand the new tab back at runtime. Removed: the `chrome_url_overrides` key from `wxt.config.ts`, `entrypoints/newtab/` (page + script), `entrypoints/shared/newtab.ts`, the Dashboard Settings "New-tab dashboard" card + checkbox, and the `newtab` field from the backup payload + `BACKUP_DATA_KEYS`. The dashboard is reached only from the toolbar icon, Alt+Shift+D, or Open Dashboard. Everything else is unchanged from v2.0.2. This also RESOLVES the §7 open limitation recorded in the v1.5+ audit ("The new-tab override is kept by Chrome even when the opt-in is OFF — only disabling the extension or removing the override key would [restore the default tab]") — the override key is now removed. Smokes 887/887 (v15 105/105: 5 new-tab tests + 1 backup-newtab assertion removed, 3 removal tests added — a v2.0.2 backup's `newtab` key still parses, the key is dropped, and it is out of BACKUP_DATA_KEYS); probe33-newtab-removed 22/22 live in real Chrome 158; screenshots 247–252.

| ID | Severity | Finding | Fix applied |
|---|---|---|---|
| A-71 | Low (probe artifact, fixed) | **First probe33 run was 19/22 — the 3 fails were a harness bug, not the extension.** After the first real toolbar click, the mouse pointer stayed parked ON the gem icon; Chrome's hover ring dropped the template-match score below 0.7, so `clickToolbarDirect()` returned false for the panel and popup clicks and the panel/popup checks failed without ever clicking. | Probe fixed with the probe29a pattern: `findGemIcon()` now parks the pointer on empty page area via `xtest_move.py` (its docstring states exactly this trap) and waits 0.4 s before screenshotting. Re-run 22/22. No extension change. |
| A-72 | Low | **Completeness of the removal.** A leftover reference (dead import, a link, a setting read) would break the build or silently keep the override behaviour. | Verified by grep + typecheck + build: no `chrome_url_overrides` in the built manifest, no `newtab.html` in the built output, no `newtab`/`NEWTAB` import anywhere in `entrypoints/` (only intentional mentions remain: historical AUDIT/CHANGELOG/README entries describing what v1.5+/v2.0.0 contained, the v2.0.3 removal notes, the `background.ts`/`float/main.ts` comments "No chrome_url_overrides — the user's new tab page is never replaced" which are true again, and generic "open in a new tab" task-open copy). Omnibox, Flows and Smart Open All never referenced the new-tab page. `npm run typecheck` clean, build clean. |
| A-73 | Low (accepted) | **The stored `hiddengemflow.newtab.v1` key from v2.0.2 stays in the user's storage, unread.** No migration deletes it — the removal deliberately does not touch user data. | Accepted, documented: nothing reads the key any more, snapshots never collect it, restores never write it back (smoke-pinned: a v2.0.2 backup's `newtab` key parses and is dropped). It is inert bytes. Clearing the extension's site data would remove it, but that would also wipe tasks/scripts — never worth it for a dead key. |

## v2.0.3 open limitations (not hidden)

1. **The new-tab dashboard feature is gone, not toggleable.** There is no setting to bring it back — restoring it would mean re-adding the override, which recreates the exact problem the owner reported (OFF still shows the extension's page). If the owner ever wants a dashboard on new tabs again, that needs a different design, not the override.
2. **A-26 stays DEFERRED:** `RELEASE_PAGE_URL` in `shared/updates.ts` still points at the v1.1.0 pre-release tag — it must be updated to the v2.0.3 tag at publish time (the v2.0.2 target in the old note is superseded).

# v2.1.0 audit — Script Studio, two builds (probe34-owner + probe34-public)

Scope: the owner-only **Script Studio** (Dashboard tab: Generate / Test / Publish to store) ships as **TWO builds from one codebase** — an owner build (all v2.0.3 features + Studio) and a public build (all v2.0.3 features, no Studio code at all). The Later tab's "AI authoring — draft only, never installs" section + NEW badge are removed entirely (its contents moved into the Studio). Version 2.1.0 in both builds, same BUILD_DATE `2026-11-17T19:02:08Z` (2026-11-18 01:02 Dhaka). Typecheck clean, both builds clean. Smokes **984/984** (tasks-export 36, open-tabs 56, notes-layout 63, backup-mode 70, v13 95, v14 142, v15 105, updates 50 — was 40, +10 variant tests — later 280, studio 87 new); live probes **probe34-owner 23/23** and **probe34-public 21/21** in real Chrome 158; screenshots 253–263. Zips: `hiddengem-flow-v2.1.0-20261118.zip` (public, 1,257,868 B) and `hiddengem-flow-v2.1.0-owner-20261118.zip` (owner, 1,284,771 B).

| ID | Severity | Finding | Fix applied |
|---|---|---|---|
| A-74 | Medium (fixed) | **Static HTML leaked "Script Studio" into the public build.** The Settings storage-key lines and the Network paragraph in `entrypoints/dashboard/index.html` were static text naming the Studio, so the first public build grepped exactly 1 hit (`dashboard.html`) — the acceptance test failed on the first build. | Static HTML now says "(AI authoring)" and carries no Studio key lines; the Studio module rewrites the two AI-key labels to "(Script Studio)" and appends the 3 Studio key lines at runtime (owner only, `initStudio`). The phrase was also scrubbed from comments in `main.ts`, `variant.ts`, `store-publish.ts`, `studio-protocol.ts` and `background.ts`, so the guarantee does not depend on the minifier stripping comments. Verified: public built output AND packaged zip grep zero hits for "Script Studio"; owner build carries the Studio only in `chunks/studio-*.js` (its own dynamic-import chunk). |
| A-75 | Low (verified; residual accepted) | **Variant separation is real — with one documented residual.** The compile-time `__HGF_OWNER_BUILD__` flag + dynamic import genuinely excludes the Studio module from the public bundle: no studio chunk, no "Script Studio" strings, no studio tab/panel, and the live public probe confirms the tab list is exactly the v2.0.3 set with no Studio keys in Settings. | Verified, no defect in the separation itself. **Residual (accepted):** the background's Studio test engine + the `hiddengemflow:studio-*` message types ARE present in the public `background.js` — `background.ts` has no build-flag split. It is unreachable: only the Studio module sends those message types and the public bundle has no sender; the engine also requires the temp-registration flow that only the Studio drives. The public grep test (the acceptance criterion) is about the Studio name and the Studio module, both of which are absent. Splitting `background.ts` by variant would be a bigger refactor for zero reachable difference. |
| A-76 | Low (verified) | **Later removal left no dead imports/handlers.** A leftover `ai-author` import, an AI listener, or a storage-listener condition would break the build or leave a dead button. | Verified by grep + typecheck + build: `main.ts` has zero hits for `ai-author`, `aiGenerate`, `aiProvider`, `aiCloud`, `renderAiCard`, `laterAi`, `AiSettings`, `AiProviderId`, `aiKeyFor`, `generateAiDraft`, `buildCloudCall` (the `ai-author` module itself stays — `backup.ts` still imports its types/defaults for the backup payload, and it contains no Studio strings, so it may remain in the public bundle). The `hiddengemflow.ai.v1` condition is out of the storage listener. `npm run typecheck` clean, both builds clean. |
| A-77 | Low (verified) | **Auto-fill reads only metadata — no code execution from a script.** The Publish form auto-fills from a script's `==UserScript==` block; a hostile script must not get its code run by being pasted. | Verified, no defect: `parseStoreMeta` → `parseMetadata` regex-parses only `@name`/`@version`/`@description`/`@author`/`@match`; the code body is never executed, never evaluated, and never trusted beyond those lines. Smoke-pinned: all five fields read; a script without `@description` leaves Description null (blank field, still editable); a script with no header yields all nulls. Fields stay editable after auto-fill. |
| A-78 | Low (verified live for Stop; rest code-reviewed) | **The temp test registration must always unregister — stop / tab-close / finish / timeout.** A leaked `hgf-studio-test-*` registration would keep running the draft on its site after the test ends. | Verified live for Stop: after clicking Stop test, `chrome.userScripts.getScripts()` shows no `hgf-studio-test-*` ids, and the test history records the run ("stopped"). The tab-close path (`chrome.tabs.onRemoved` → `onStudioTestTabRemoved`), the finish path, and the 180 s hard timeout all call the same unregister path in code — see open limitation 1: those three paths are wired and reviewed, not live-proven. The draft is never added to the installed scripts store (probe: storage scripts list empty after the test). |
| A-79 | Low (verified) | **The store PAT must reach no host except api.github.com, and never backups/logs.** A new token flow is a new chance to leak the token. | Verified, no defect: `ghHeaders` puts the token only in the `Authorization` header for the api.github.com calls (`ghGetFile`/`ghPutFile`/`ghDeleteFile`/`testStoreConnection`); the jsDelivr purge is an unauthenticated GET with no token. `parseFullBackup` refuses a backup file carrying a `storeToken` field whole (smoke-pinned); the key is out of `BACKUP_DATA_KEYS` (commented, like the sync/AI tokens). Live: a WRONG token is honestly refused with GitHub 401 ("the token is wrong or expired") — no real PAT was ever in the harness. |
| A-80 | Low (verified) | **The update checker must pick the right asset per variant.** An owner build watching the public zip (or vice versa) would report the wrong build as newer. | Verified, no defect: `assetNameForVariant` / `pickReleaseAssetUpdatedAt` / `parseRelease(raw, variant)` are smoke-pinned — owner pattern matches only the `-owner-` zip, public pattern only the plain zip, the legacy `hiddengem-flow-extension.zip` counts for both, and a release carrying only the OTHER variant's asset reads as empty for this variant. The 6 h throttle and dismiss rules are unchanged. `RELEASE_PAGE_URL` is intentionally NOT changed (A-26 deferred). |
| A-81 | Low (fixed) | **Two type errors in the new Studio code, caught by typecheck before any build.** (1) `res = (await ...) as typeof res` narrowed `res` to `null` (it was just initialised to `null`), so `res.ok` / `res.tabId` errored "Property does not exist on type 'never'". (2) `ghDeleteFile(..., scriptFile.sha, ...)` passed `string \| null` where `string` was required. | Fixed: a named `StudioTestStartResult` type used for both the declaration and the cast; the delete path treats a null sha as "file already gone". Typecheck clean after. |
| A-82 | Low (probe artifacts, fixed) | **The first probe34 runs failed on harness bugs, not the extension.** (a) The mock base URL was `http://127.0.0.1:18081` without `/v1`, so the mock answered 404 to `/chat/completions` and no draft appeared. (b) `navigator.clipboard.readText()` pops a permission bubble and BLOCKS until answered — the first owner run hung on it for 5 minutes. (c) The Test flow's host-access prompt needs a REAL click: a synthetic click leaves the prompt open and `startTest` pending forever (status stays empty). | Probe fixed: (a) base URL `http://127.0.0.1:18081/v1` (probe31 pattern); (b) the clipboard read is raced with a 2.5 s timeout and the bubble's Allow is clicked at (385,215) when it appears; (c) "Test in extension" is real-clicked via screen-point conversion and the prompt's Allow is clicked at (814,268) only when the status shows the request is still pending. Re-runs: owner 23/23, public 21/21. No extension change for any of the three. |
| A-83 | Low (accepted) | **The `hiddengemflow.ai.v1` / `ai.tokens.v1` keys remain in storage in the public build, with no UI reading them.** The Later AI UI is gone in both builds; the keys belong to the Studio (owner build). | Accepted, documented: like the v2.0.3 new-tab key (A-73), they are inert legacy bytes in the public build — no migration deletes user data. The Settings card still lists them as "(AI authoring)" — accurate in the owner build (relabeled "(Script Studio)" at runtime) and a plain storage-keys diagnostic in the public build. If the owner ever wants them gone from a public install, clearing the extension's site data removes them (and everything else with it). |

## v2.1.0 open limitations (not hidden)

1. **Temp-test unregistration on tab-close / finish / 180 s timeout is wired and code-reviewed, not live-proven.** Only Stop was verified live (probe34-owner: no `hgf-studio-test-*` ids after Stop). The `onRemoved` listener, the finish path and the timeout call the same unregister function, but a live tab-close-during-test run was not done.
2. **Publish / Upgrade / Delete success paths are NOT live-verified.** The harness never holds a real PAT, so only the wrong-token 401 refusal was proven live. The 4-step flow (index → script file → index → jsDelivr purge) and the three no-token Download fallbacks are smoke-tested at the pure-function level only (`buildStoreEntry`/`buildStoreHeader`/`buildStoreUserJs`, `gh*` helpers uncalled live). A real publish must be verified by the owner with his own token before relying on it.
3. **Only the Custom (mock) provider was called live.** The other 8 providers' cloud calls are smoke-tested only (same standing limitation as v2.0.1/v2.0.2). A real-key successful generate for any provider is still unverified — the harness has no real keys.
4. **The background Studio test engine is present in the public `background.js`** (unreachable — see A-75). The public grep acceptance test is about the Studio name and module, both absent.
5. **A-26 stays DEFERRED:** `RELEASE_PAGE_URL` in `shared/updates.ts` still points at the v1.1.0-dev tag — it must be updated to the v2.1.0 tag at publish time (the v2.0.3 target in the old note is superseded).

# v2.1.1 audit — tolerant Studio draft extraction (probe35-owner + probe35-public)

Scope: fix the live NVIDIA NIM failure the owner reported 2026-11-18 ~03:53 Dhaka: Studio → Generate on Wikipedia (search history → elon musk → binance, 5 s apart) answered "NVIDIA NIM answered, but the reply had no usable script in it. Nothing was installed." Root cause: `extractCloudDraft` only accepted `choices[0].message.content` as a plain string, and only stripped a fence when the ENTIRE reply was one fence (anchored regex); the same brittleness existed in `extractGeminiDraft`. A normal chatty reply (prose + fenced script + prose) returned null. Also: `max_tokens`/`maxOutputTokens` 2000 could cut a full script off, and `askCloud` gave no diagnosis — null was the whole story. Changes: tolerant extraction in `ai-author.ts` (content as a string or an array of text parts, `reasoning_content` fallback when the content is empty, first fenced block anywhere with javascript/js → ==UserScript== → JS-looking preference, header-marker fallback, 100 KB cap kept), diagnosable failure in `studio.ts` (`describeDraftFailure`, scrubbed truncated excerpt), caps 2000 → 4000. Version 2.1.1 in both builds, same BUILD_DATE `2026-11-17T21:55:06Z` (2026-11-18 03:55 Dhaka). Typecheck clean, both builds clean. Smokes **1016/1016** (studio 119/119 — was 87, +32 extractor/diagnostic/cap tests; rest unchanged); live probes **probe35-owner 23/23** and **probe35-public 21/21** in real Chrome 158; screenshots 264–269e. Zips: `hiddengem-flow-v2.1.1-20261118.zip` (public, 1,257,870 B) and `hiddengem-flow-v2.1.1-owner-20261118.zip` (owner, 1,285,480 B).

| ID | Severity | Finding | Fix applied |
|---|---|---|---|
| A-84 | High (fixed) | **Live failure: chatty LLM replies were dropped.** `extractCloudDraft` required the content to be a string and the whole reply to be a single fence (`/^```(?:javascript\|js)?\s*\n([\s\S]*?)\n```\s*$/i`); anything else — prose around the fence, an array of content parts, an empty content — returned null. The owner's NVIDIA NIM reply was exactly the chatty shape. `extractGeminiDraft` had the same anchored fence. | Rewrote both extractors around shared pure helpers (`readOpenAiReplyText` / `readGeminiReplyText` / `extractCodeFromText` / `findFencedCode`): content as a string or an array of parts (text fields joined in order), `reasoning_content` fallback when the content is empty, first fenced block ANYWHERE in the text (```javascript/```js preferred, else a fence holding a ==UserScript== header, else a JS-looking fence), header-marker fallback with no fence, prose with no code and no header still returns null. Live-proven: probe35-owner's mock chatty reply (the exact failing shape) now produces the draft preview with the script only (screenshot 265b), and the array-content reply does too (266). Smokes: 32 new extractor tests in smoke-studio (fence-only, prose+fence+prose, array parts, reasoning fallback, empty choices, prose-no-code, header-no-fence, >100 KB, both shapes). |
| A-85 | Medium (fixed) | **The failure was undiagnosable.** `askCloud` returned one fixed string for every null extraction, and the reply itself was never logged or shown anywhere — the next failure would have been just as opaque. | `describeDraftFailure(responseText, shape)` in `ai-author.ts` reports WHAT the reply contained from the parsed reply only: "the reply was empty", "the reply had no choices" / "no candidates", "the reply had no text in it", "the reply had no code block — it began: '<first ~120 chars>'". The excerpt is truncated and scrubbed by `safeReplyExcerpt` (URLs → [link], Bearer/Basic credentials → [credentials], key/token/secret/password assignments → [key]); the reply itself is never logged or stored. The status line renders via `textContent` (`showStatus`), so the excerpt cannot inject HTML — verified by reading the call site. Live-proven: probe35-owner's empty reply shows "Custom answered, but the reply was empty. Nothing was installed." (screenshot 267b). Smoke-pinned: all five failure phrases + the scrubbing rules. |
| A-86 | Low (verified; residual accepted) | **Fence search vs a ``` inside a string literal.** A ``` inside a JS string literal cuts the first fence short. The scan extends to the next closing fence only when the body opens a ==UserScript== header without closing it. | Verified by smoke: a fence cut by a ``` inside a string before the header closes is extended to the real close and returns the full script. **Residual (accepted):** a ``` inside a string literal AFTER the header already closed still truncates the fence — detecting that would need a JS parser, not a fence scan. Generated userscripts essentially never contain triple backticks in a string, and the draft is previewed, so a truncation would be visible, never silent. No smoke pins the truncating case (it would pin a known limitation as correct behaviour). |
| A-87 | Low (verified) | **The 100 KB cap must hold on every new path** (fenced, header-marker, reasoning fallback, array parts) — a cap that only applied to the old single-fence path would let a huge reply through. | Verified: the cap is applied once, in `extractCodeFromText`, to the final extracted code on every path. Smoke-pinned: >100 KB fenced replies return null for both shapes. |
| A-88 | Low (verified) | **The token-cap raise must change no other provider's request shape.** `max_tokens`/`maxOutputTokens` are per-provider body fields; a wrong edit could have touched the model, temperature, or the Gemini body structure. | Verified: only the two numeric fields changed (2000 → 4000 in `buildCloudRequestBody` and `buildGeminiRequestBody`). Smoke-pinned: both bodies assert 4000; all existing provider/body smokes still pass (smoke-later 280/280). Live-proven: probe35-owner's recorded request body carries `max_tokens: 4000`. |

## v2.1.1 open limitations (not hidden)

1. **A-26 stays DEFERRED:** `RELEASE_PAGE_URL` in `shared/updates.ts` still points at the v1.1.0-dev tag — it must be updated to the v2.1.1 tag at publish time (the v2.1.0 target in the old note is superseded).
2. **Only the Custom (mock) provider was called live.** The mock reproduces the reply SHAPE (chatty / array / empty) that failed live, not NVIDIA's real endpoint. A real-key Generate with NVIDIA NIM — the provider that failed — is still unverified; the harness has no real keys. Same standing limitation as v2.0.1/v2.0.2.
3. **The v2.1.0 A-75 residual is unchanged:** the public `background.js` still contains the Studio test-engine message types and `gm-relay.js` the studio-step handler (unreachable dead code). This patch did not touch the variant split.

# v2.1.2 audit — update-checker self-point fix, A-26, A-86 fix, uploader + docs

Scope: full-repo audit of v2.1.1 (source + docs + uploader + live verification) and the v2.1.2 fix round. The live verification of v2.1.1 found one substantive issue: a fresh install of the shipped v2.1.1 public build reported "A newer build is available — v2.1.1-dev-20261118" pointing at itself (A-89). The audit also re-checked every open item (A-26, A-75, A-61, A-86, §7 limitations), the store uploader, and every README/CHANGELOG/AUDIT claim against the source. Version 2.1.2 in both builds, same BUILD_DATE `2026-11-18T00:54:35Z`. Typecheck clean, both builds clean. Smokes **1026/1026** (updates 55/55 — was 50, +5 A-89 grace tests; studio 124/124 — was 119, +5 A-86 tests; rest unchanged). Live probes on the v2.1.2 zips (real Chrome 158): probe35-public **21/21** (first run 19/21 — a one-off flaky side-panel pair: the float switch reported `mode=undefined` and no side-panel target; immediate rerun on a fresh profile was 21/21, both logs kept); probe35-owner **23/23**; probe36-store-upd **11/11** — A-89 verified live: `BANNER-ON-OPEN: hidden=true`, `UPDATE-CHECK-RESULT: "You are up to date."`, `BANNER-AFTER-CHECK: hidden=true`, no banner anywhere; grace constant `1440*60*1e3` (= 24h) in both `background.js` files, and the release asset (updated 2026-11-18T00:17:02Z) is older than BUILD_DATE (00:54:35Z); A-26 verified: `RELEASE_PAGE_URL` = `v2.1.1-dev-20261118` in `background.js` + `dashboard.html`, both builds, old v1.1.0 tag absent. probe34-owner **23/23** (Test-in-extension + wrong-token Publish refusal; the v2.1.1-era 22/23 was a stale probe expectation). R8: `docs/install-guide/05-extension-loaded.png` was re-shot at v2.1.2 (sha256 `cac10a82…54612`, shows Version 2.1.2, Developer mode ON). Screenshots 271–284 (+284b). Logs: `hgf-live-test/verification-20261118/probe35-public-v212*.log`, `probe35-owner-v212.log`, `probe36-v212.log`, `probe34-owner-v212.log`. **Superseded before delivery:** the v2.1.2 zips were verified live but never delivered to the owner and never published — the v2.1.3 round (A-98 label fix) rebuilt them under a new version per the standing versioning rule. The v2.1.2 probe evidence stands for everything except the three Settings label lines that A-98 changed. Zips: `hiddengem-flow-v2.1.2-20261118.zip` (public, 1,257,500 B, sha256 `61a36aad6a2d9912f81ff806ae44a3a996ab92163505bd4d99a383107405fb94`) and `hiddengem-flow-v2.1.2-owner-20261118.zip` (owner, 1,285,592 B, sha256 `ae2fe673242b5b4b2e6d7c3d5f65dafe5f57755845dd9647d53b001b0c896a33`). NOT published.

| ID | Severity | Finding | Fix applied |
|---|---|---|---|
| A-89 | High (fixed) | **Fresh installs of v2.1.1 reported an update pointing at itself.** `isNewerOnFirstCheck` (`updates.ts`) gave a first install a 2h grace window: a release asset uploaded more than 2h after BUILD_DATE counted as newer. v2.1.1 was built 2026-11-17T21:55:06Z but its asset was uploaded 2026-11-18T00:17:02Z — 2h 22m later, just outside the window. The published asset is byte-identical to the shipped build (sha256 verified), so the "newer build" was the same build. Live-proven on v2.1.1 (probe36-store-upd): the dashboard-open check and manual "Check for updates" both showed "A newer build is available — v2.1.1-dev-20261118". Anyone installing that exact public build saw the banner. | First-check grace 2h → **24h** (`FIRST_CHECK_GRACE_MS`, `updates.ts`), with a rewritten comment stating the trade-off: a same-tag asset re-upload within 24h of BUILD_DATE is missed on a FIRST check, but a rebuild always gets a new version (semver signal, ungraced) and `isNewerThanStored` still catches a replaced asset on later checks; a genuinely older build is days older, so 24h still separates the two. The publish workflow spans hours (v2.1.1's real lag was 2h 22m), so the false positive was certain and the miss is hypothetical. All "2h grace" references in the file updated to 24h; the historical "2h 22m" mentions kept as history. Smoke-pinned (smoke-updates +5): the v2.1.1 live numbers (2h 22m → up to date), the exactly-24h boundary (→ up to date), 25h (→ available), laterCheck with the v2.1.1 numbers + same stored record (→ up to date — the self-point case), and an old build + same record (→ still available). The old 3h-gap test was updated to a 25h gap for the new window. The README quirk sentence is kept with a "(Fixed in v2.1.2 — …)" note. |
| A-90 | Medium (fixed) | **A-26: RELEASE_PAGE_URL still pointed at the v1.1.0-dev tag** (`updates.ts:82`) and the same href in `dashboard/index.html:49` — while README said v2.1.1 was published. Impact was fallback-only (`downloadUrl \|\| RELEASE_PAGE_URL`; the API normally supplies `html_url`), but the deferral's trigger (publish) had happened, so this was overdue, not merely deferred. Related: the `dashboard/main.ts:449–451` comment claimed "the static href in the HTML is the same release page as a fallback" — no longer true — and the `updates.ts:148` doc example still used the v1.1.0 tag. | `RELEASE_PAGE_URL` → `https://github.com/BidyutRoy2/hiddengem-flow/releases/tag/v2.1.1-dev-20261118` (the current published release; v2.1.2 is not published yet, so pointing at a future tag would 404) and the same href in `dashboard/index.html:49`; the `main.ts` comment now says the static href is the latest published release page as a fallback and must be updated to the current publish tag on every release; the doc example updated to the v2.1.1 tag. Verified in both built zips (×1 in `background.js`, ×1 in `dashboard.html` each). Standing rule going forward: the URL moves to the new publish tag at publish time — when v2.1.2 is published it must move to the v2.1.2 tag. |
| A-91 | Low (fixed) | **A-86 residual: a ``` inside a string literal AFTER the closed ==UserScript== header truncated the draft.** `findFencedCode` (`ai-author.ts`) only extended the fence while the body contained an unclosed header; once the header closed, the close was the first ``` anywhere — so a ``` inside a JS string/template after the header cut the draft short. The truncated body then won candidate selection, and `extractCodeFromText` returned it as the draft. | Added `scanModeAt()` — a pure lexical scanner (strings with escapes, template literals with `${...}` nesting, line/block comments, regex literals via the classic prev-token heuristic: `/` after an operator/opener/keyword/start opens a regex; after an identifier, `)`, `]`, or a number it is division; documented limits: `)` before a regex is read as division, a template is treated as opaque outside `${...}`). The extend loop now extends while the header is unclosed **OR** the closing fence falls inside a string/template/comment. Each pass moves the close forward, so the loop always terminates. Deliberately extends ONLY on the string/template/comment signal, NOT on unbalanced braces — extending on braces could swallow a second code block. Smoke-pinned (smoke-studio +5): ``` in a string after the closed header (OpenAI + Gemini), ``` in a template literal, a regex holding a quote (stops at the real close — no false extension), two complete js fences (first block only, no swallowing). The draft is still previewed as full text before anything runs, so any future truncation stays visible. |
| A-92 | Low (fixed) | **Store uploader findings U1–U9** (`tools/store-uploader.html`, 1,263 lines). U1: sha-conflict retry re-PUT the stale index body, silently clobbering a concurrent edit. U2: publish/upgrade silently dropped `@grant` (non-none), `@connect`, `@updateURL`/`@downloadURL`, `@run-at` — a script needing `GM_xmlhttpRequest` lost its grants with no warning. U3: the upgrade path had no repo guard, unlike delete. U4/U5: no-token Live Scripts / `openUpgrade` raw reads had no jsDelivr fallback on a network throw. U6: publish warned but proceeded with no `@match`; upgrade hard-errored — inconsistent gating. U7: footer version stamp stale (v1.0.0). U9: "shows the new index right away" ignored raw's ~5-min cache. U8 (info): the token is saved on any successful publish/upgrade/delete/Test with no "token saved" message on the publish path. | All fixed in the uploader (now 1,422 lines): U1 — on a sha conflict the index is re-read and the change re-merged onto the fresh copy instead of re-PUTting the stale body; U2 — `@grant`/`@connect`/`@updateURL`/`@downloadURL`/`@run-at` lines are preserved verbatim from the source header (a `@grant none` line is not duplicated) and any other dropped header line is listed in a warning; U3 — the same strict repo prefix check as delete now guards upgrade before loading/writing; U4/U5 — no-token raw reads fall back to jsDelivr on a thrown fetch; U6 — publish now hard-errors on no `@match`, like upgrade; U7 — footer reads v2.1.2; U9 — the honest-limits copy now says raw caches for about 5 minutes. One follow-up comment was fixed after the main round: the `btnRefreshLive` no-token comment still said raw "is already fresh (finding A-05)" — it now says raw itself caches for about 5 minutes. U8 unchanged (info only — the save is disclosed in the steps). Verified by re-reading every edited section + `node --check` on the extracted inline script (53,836 bytes). No real token was used; the publish/upgrade/delete success paths are still live-unverified (see open limitations). |
| A-93 | Low (fixed) | **12 dead imports + duplicate storage-key constants + stale comments.** Verified by direct grep (each name occurred only on its import line): `background.ts` (`GM_VALUE_PREVIEW_MAX`, `loadScheduleRuns`, `saveScheduleRuns`), `dashboard/main.ts` (`BUILTIN_COLLECTIONS`, `MAX_INSTALL_SIZE_BYTES`, `formatBytes`, `setScriptTags`, `syncTokenStored`), `shared/studio.ts` (`defaultAiTokens`, `defaultStoreConfig`, `jsdelivrIndexUrl`, `rawIndexUrl`). Also `SCRIPTS_KEY` re-declared in `dashboard/main.ts:282` and `POS_KEY` (`hiddengemflow.floating.pos`) in both `floating.ts:93` and `dashboard/main.ts:283` — drift risk. Stale comments: `scripts.ts:406` "supported four" (the code correctly uses six), `studio-protocol.ts:3–5` (claimed the background "must stay free of Studio strings" — false since v2.1.0, see A-96), `public/gm-relay.js:141` carried a `v2.1.0` version stamp (ships verbatim, would go stale again). | All 12 imports removed (typecheck clean after — the exports still exist for their real users). `SCRIPTS_KEY` is now imported from `../shared/scripts` in the dashboard; `FLOAT_POS_KEY` is exported from `shared/float-layout.ts` and imported (as `POS_KEY`) by both `floating.ts` and `dashboard/main.ts` — the local duplicate constants are deleted. Comments fixed: "supported six", the protocol comment now states the background answers Studio messages in both builds by design, and the relay comment drops the version stamp. Harmless before (tree-shaken / comment-only), fixed as hygiene so the next audit does not re-find them. |
| A-94 | Low (fixed) | **Docs corrections R1–R9, C1–C4, AUDIT §7/§3.** README: the `notifications` row said GM_notification only (code also uses it for reminders / scheduled Open All / note due dates / menu & shortcut confirmations); Privacy read as an exhaustive external-traffic list but omitted the opt-in flows (cloud LLM, sync, GM XHR); v2.1.1 was framed as the public build's fix though the extractor fix is owner-only; the tab list omitted Flows/Sessions/Styles/Dossier; `public/` was misdescribed (it also holds `gm-relay.js` + `style-injector.js`); two store script names were shortened; "three window modes" conflated toggle with mode-switch; the step-5 install screenshot is v1.0.0; the Alt+Shift+T/N one-time-assignment caveat was missing. CHANGELOG: v2.1.1 still said "not published yet" with no release record; no record of the README-fix commit `5d847cf1`; no BUILD_DATE/zips line; v2.1.0's "not published yet" was permanently true. AUDIT §7 item 2 said "three real scripts" (live store has 4) with a stale jsDelivr-first note; v1.5+ item 5 had no "resolved" marker; §3's network list named only 4 fetch types (predates the update checker, cloud LLM, sync, GM XHR); §2's notifications row was stale since v1.4. | All applied locally (README, CHANGELOG, AUDIT) and verified by grep against the source/live data — **NOT pushed; awaiting the owner's approval.** Exact replacements used throughout (e.g. the notifications row now reads "`GM_notification` from a running userscript, plus reminders / scheduled Open All / note due dates / menu & shortcut confirmations."; the v2.1.1 Status line adds "The extractor fix lives in the owner-only Studio; the public build is otherwise identical to v2.1.0."; the v2.1.1 CHANGELOG header now reads "Published 2026-11-18 as public pre-release `v2.1.1-dev-20261118` (`hiddengem-flow-v2.1.1-20261118.zip`, 1,257,870 B)"). The step-5 screenshot was re-shot at v2.1.2 in the live-probe round (`docs/install-guide/05-extension-loaded.png` replaced, sha256 `cac10a82…54612`, shows Version 2.1.2 with Developer mode ON) and the README step-5 caption was updated for it in v2.1.3 (the v1.0.0 annotation removed, alt text now reads "version 2.1.2 shown"). |
| A-95 | Medium (fixed; process) | **The first v2.1.2 owner zip built this round was actually the public build.** `npm run zip` (`wxt zip`) rebuilds the extension itself and does not inherit the shell's `HGF_OWNER_BUILD=1` unless it is set on the zip command too — so `HGF_OWNER_BUILD=1 npm run build` followed by a plain `npm run zip` produced a public build and zipped that. | Caught by zip-content verification before delivery (identical file lists, identical size 1,257,500 B, no studio chunk in the "owner" zip). Rebuilt with `HGF_OWNER_BUILD=1` on BOTH commands; the owner zip is now 1,285,592 B with `chunks/studio-DOLz7_Of.js`. Rule for every future build: the env var goes on the zip command too, and every zip is verified by content (studio chunk present/absent, "Script Studio" count, BUILD_DATE, banned-word grep) before delivery — a matching size or hash alone proves nothing. |
| A-96 | Low (evaluated, no change) | **A-75 re-evaluated on v2.1.2: the public `background.js` still contains the Studio test-engine message types, and `gm-relay.js` the studio-step handler.** Measured again in the extracted public build: 5 `"studio"` occurrences in `background.js` (the four message types `hiddengemflow:studio-test-start/-stop/-steps`, `studio-step`, plus the `hgf-studio-test-` id prefix) — the identical count in the owner build. The `studio-protocol.ts:3–5` comment claimed the opposite ("the background bundle must stay free of Studio strings in the PUBLIC build") — false in letter since v2.1.0, though the acceptance test (grep `"Script Studio"` → 0) still passes. | **Decision: DO NOT split.** The background answers these messages in BOTH builds by design (documented at `background.ts:2746–2749`): the messages carry no Studio UI, no public UI sends them, the manifest has no `externally_connectable` (verified in the built manifest) so web pages cannot `sendMessage` to the background, `MSG_STUDIO_STEP` is dropped when no live test exists, and `MSG_STUDIO_TEST_START` (the only handler with a side effect — registers a temp userscript + opens a tab) is reachable only from the extension's own pages. The fix would touch the 4,204-line `background.ts` router, the ~215-line test engine, and `gm-relay.js` (which ships verbatim to both builds and backs the GM notify/XHR/clipboard path every script relies on) — moderate risk for ~nil benefit. Only the misleading `studio-protocol.ts` comment was reworded to match reality (A-93). Revisit only if a variant-split build step for `public/` files is introduced for another reason. |

## v2.1.2 open limitations (not hidden)

1. **A-26's next step:** `RELEASE_PAGE_URL` now points at `v2.1.1-dev-20261118` (the current published release). v2.1.2 was superseded before delivery, so the URL must move to the v2.1.3 tag when v2.1.3 is published — the same one-release-behind-until-publish rule as before.
2. **Real-key Generate with NVIDIA NIM still unverified.** The v2.1.1 extractor fix is proven only against mock reply shapes (chatty / array / empty). The owner's own test cases (Wikipedia multi-search + the-internet.herokuapp.com add/remove elements, given 2026-11-18 05:39) have no reported result yet.
3. **Publish / Upgrade / Delete success paths still NOT live-verified** (uploader + Studio port). The harness never holds a real PAT, so only the wrong-token 401 refusal was proven live. The U1–U9 uploader fixes are verified by code read + `node --check` only. A real publish must be verified by the owner with his own token before relying on it.
4. **Temp-test unregistration on tab-close / finish / 180 s timeout is wired and code-reviewed, not live-proven.** Only Stop was verified live (probe34-owner: no `hgf-studio-test-*` ids after Stop).
5. **Cache-buster still NOT applied** (pending the owner's word — offered before, left pending). `store.ts` fetches the index and script code with a plain `fetch(url)`; raw.githubusercontent caches ~5 min, so after a publish + jsDelivr purge, Load store can still show the old list for up to ~5 min. Exact fix is one line in `fetchIndexFrom` + one in `fetchStoreCode` (`cache: "no-store"`).
6. **A-61 loopback-http allowance unchanged** (open user question since 2026-11-16: blanket ban vs loopback allowance; the dead `"[::1]"` branch in `validateCustomBaseUrl` noted). **License MIT vs GPL-3.0 unchanged** (open since v1.0.0).
7. **The v2.1.0 A-75 residual is unchanged except for the corrected comment** (see A-96). The public grep acceptance test is about the Studio name and module, both absent.

# v2.1.3 audit — public-UI label fix (A-98), provider-name residual (A-97), zip-output trap (A-99)

Scope: the v2.1.2 zips were verified live (see v2.1.2 section) but superseded before delivery by this round, per the standing versioning rule (every rebuild is a new version under a distinct versioned filename). The only code change is A-98: the public Dashboard Settings no longer shows the AI-authoring storage-key rows or the Cloud LLM network item. Version 2.1.3 in both builds, same BUILD_DATE `2026-11-18T01:02:30Z`. Typecheck clean, both builds clean. Smokes **1026/1026** (unchanged — no new smoke cases; the label fix is DOM-level, covered live by the new probe37-labels). Live probes on the v2.1.3 zips (real Chrome 158): probe35-public **21/21** (first try — the v2.1.2 flaky side-panel pair did not recur); probe35-owner **23/23**; probe36-store-upd **11/11** (4th run — runs 1–2 hit the shared-IP `api.github.com` 403 rate limit, ~50% of calls; run 3 hit a pre-existing probe wait-loop bug reading "Checking…"; the extension correctly reported unreachable on a 403 with no banner); probe37-labels **16/16** (first run 15/16 — the probe expected ≥5 "(Script Studio)" mentions, the shipped owner build has 4 by design: 3 suffixed key rows + the network item; the expectation was corrected to ≥4 with the composition documented, re-run 16/16); probe34-owner **23/23**. A-89 holds: `BANNER-ON-OPEN: hidden=true`, `UPDATE-CHECK-RESULT: "You are up to date."`, `BANNER-AFTER-CHECK: hidden=true`. Screenshots 285–308 (22 files; 293/299 absent by design — retry branches that never ran; 303/304 byte-identical, a pre-existing probe artifact, same as v2.1.2's 280/281). Logs: `hgf-live-test/verification-20261118/probe35-public-v213.log`, `probe35-owner-v213.log`, `probe36-store-upd-v213-rerun3.log`, `probe37-labels-v213.log`, `probe34-owner-v213.log`. Zips: `hiddengem-flow-v2.1.3-20261118.zip` (public, 1,257,297 B, sha256 `a49d2cc11cd88e7c42fbf67aeadd590fbef82bb285189f874df169a3f5facff0`) and `hiddengem-flow-v2.1.3-owner-20261118.zip` (owner, 1,285,599 B, sha256 `7a707ab3e2bc8bce522303a06cd9683f3430582581565d3ed9bfc81f5b707098`). NOT published — delivered for the owner's live test.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| A-97 | Low (evaluated, no change) | **The public `background.js` still contains the 9 cloud-LLM provider names + endpoints** (measured in the extracted v2.1.3 public build: `Groq` ×2, `api.groq.com` ×2, same pattern for the other eight providers, in `background.js` and `chunks/notes-ui-*.js`). They ride in with `ai-author.ts`, imported by `backup.ts:49` for `loadAiSettings` / `saveAiSettings` / `sanitizeAiSettings` — the backup sanitizer MUST know the AI keys to exclude them from backups, which is a live privacy function in the public build (backup/restore is a public feature). The cloud-call builders (`buildCloudRequestBody` / `buildCloudCall`) are tree-shaken out: 0 hits in every public file. So the provider list is dead data in the public build — no caller, no network path — while the sanitizer is live. Same family as A-75 / A-96. | **Decision: DO NOT split.** Removing the import would mean `backup.ts` could not strip the AI keys from backups. The acceptance tests still pass: grep `"Script Studio"` / `"AI authoring"` / `"Cloud LLM"` → 0 in the whole extracted public tree — the provider names are code identifiers and endpoint strings in `background.js`, never displayed anywhere in the public build. Revisit only if the backup sanitizer is ever reworked for another reason. |
| A-98 | Medium (fixed) | **The public build's Dashboard Settings described a feature that does not exist in the public build.** The static HTML listed the AI-authoring storage-key rows (`hiddengemflow.ai.v1`, `hiddengemflow.ai.tokens.v1`, labelled "(AI authoring)") and the Cloud LLM network item (5) in the Network paragraph (`dashboard/index.html:901, 902, 916`). Later AI authoring was removed for users in v2.1.0 and the keys are inert in the public build (A-83), so the labels were user-visible text about a non-public feature — against the owner's 2026-11-18 rule that only the public version is described. The static HTML deliberately said "(AI authoring)" instead of "(Script Studio)" (old `studio.ts:2186` comment) so the public build contained no Studio strings — but that only hid the Studio's name, not the feature. | The three items are gone from static `index.html`. The owner build injects them at runtime from `studio.ts`: after the new `#keySyncTokens` anchor, the two key rows + the three Studio keys, all labelled "(Script Studio)"; the Network item (5) into the new `#netCloudLlmSlot` span, which sits empty in the public build (the static sentence now ends "...with the token you pasted." and the owner fill prepends "; (5) ..."). The old runtime relabel code (replace "(AI authoring)" → "(Script Studio)") is deleted and the `studio.ts:2186` comment rewritten to the new design. Verified by content: public `dashboard.html` + whole public tree grep 0 for "AI authoring" / "Cloud LLM" / "Script Studio"; the strings live only in the owner chunk `chunks/studio-CL4xuQP9.js`; live probe37-labels **16/16** (new, `hgf-live-test/probe37-labels.cjs`) checks both variants' Settings — first run 15/16 on a probe-expectation miss (expected ≥5 "(Script Studio)" mentions, the shipped owner build has 4 by design: 3 suffixed key rows + the network item; the template/tests rows say "Script Studio" in prose with no suffix), expectation corrected to ≥4 with the composition documented, re-run 16/16. Also in this round: the stale `studio.ts:99` template-path comment fixed (→ `hgf-studio-design/master-prompt-template.md`); the README step-5 caption updated for the fresh v2.1.2 screenshot (v1.0.0 annotation removed, alt text now "version 2.1.2 shown"); the store-uploader footer bumped to v2.1.3. |
| A-99 | Medium (fixed; process) | **`wxt zip` writes both variants to the SAME output file** (`.output/hiddengem-flow-2.1.3-chrome.zip`) — the owner zip overwrote the public zip in `.output`, and the first copy into `github-repos/` was the owner build misnamed as the public zip (1,285,599 B, sha256 `8072f265…`). A second instance of the A-95 family (same tool, different failure: A-95 was the missing env var; this is the shared output path). | Caught immediately by the size check (the "public" copy was 1,285,599 B, not the expected 1,257,297 B) before any verification ran on it. Redone correctly: zip public → copy to its versioned name immediately → zip owner → copy to its versioned name. The misnamed file was deleted, never delivered. New rule alongside A-95: copy each zip to its distinct versioned filename BEFORE building the other variant; never let two variants share one output path unrenamed. |

## v2.1.3 open limitations (not hidden)

1. **A-26's next step:** `RELEASE_PAGE_URL` still points at `v2.1.1-dev-20261118` (the current published release). When v2.1.3 is published it must move to the v2.1.3 tag — the same one-release-behind-until-publish rule as before.
2. **Real-key Generate with NVIDIA NIM still unverified.** The v2.1.1 extractor fix is proven only against mock reply shapes (chatty / array / empty). The owner's own test cases (Wikipedia multi-search + the-internet.herokuapp.com add/remove elements, given 2026-11-18 05:39) have no reported result yet.
3. **Publish / Upgrade / Delete success paths still NOT live-verified** (uploader + Studio port). The harness never holds a real PAT, so only the wrong-token 401 refusal was proven live. The U1–U9 uploader fixes are verified by code read + `node --check` only. A real publish must be verified by the owner with his own token before relying on it.
4. **Temp-test unregistration on tab-close / finish / 180 s timeout is wired and code-reviewed, not live-proven.** Only Stop was verified live (probe34-owner: no `hgf-studio-test-*` ids after Stop).
5. **Cache-buster still NOT applied** (pending the owner's word — offered before, left pending). `store.ts` fetches the index and script code with a plain `fetch(url)`; raw.githubusercontent caches ~5 min, so after a publish + jsDelivr purge, Load store can still show the old list for up to ~5 min. Exact fix is one line in `fetchIndexFrom` + one in `fetchStoreCode` (`cache: "no-store"`).
6. **A-61 loopback-http allowance unchanged** (open user question since 2026-11-16: blanket ban vs loopback allowance; the dead `"[::1]"` branch in `validateCustomBaseUrl` noted). **License MIT vs GPL-3.0 unchanged** (open since v1.0.0).
7. **The v2.1.0 A-75 residual is unchanged** (see A-96), and the A-97 provider-name residual is the same family (dead strings in the public `background.js`, live backup sanitizer). The public grep acceptance tests are about the Studio name/module and the AI-authoring/Cloud-LLM labels, all absent.

# v3.0.0 audit — final release (version bump only, no code changes)

Scope: full-repo audit of v3.0.0 (source + manifest + docs + uploader + live release/store state + pushed-source check), 2026-11-18 ~15:30 Dhaka. Version 3.0.0 in `package.json`, the built manifest, the dashboard/footer strings and `BUILD_DATE` `2026-11-18T09:16:30Z` (`updates.ts:144`) — all consistent. **No code changed since v2.1.3**: the only source differences from the v2.1.3 round are the version strings and `BUILD_DATE`. Typecheck / rebuild NOT re-run (no code to re-check; the v2.1.3 typecheck and both builds stand). Smokes **1026/1026** — re-verified by counting the kept log `hgf-live-test/verification-20261118/smoke-20261118-v300.log` (1026 `PASS` lines, 0 `FAIL` lines; subtotals 70 + 280 + 63 + 56 + 124 + 105, the remaining suites print no subtotal). Live probes on the v3.0.0 public zip (real Chrome 158, kept logs): probe35-public **21/21** (`probe35-public-v300.log`, `PROBE35-PUBLIC-V300 RESULT: 21/21 PASS, 0 FAIL`); probe36-store-upd **12/12** (`probe36-store-upd-v300.log`, `PROBE36-PUBLIC-STORE-UPD-V300 RESULT: 12/12 PASS, 0 FAIL` — A-89 holds: `UPDATE-CHECK-RESULT: "You are up to date."`, `BANNER-AFTER-CHECK: hidden=true`; the store rendered all 4 live scripts). probe37-labels was **NOT** re-run on v3.0.0 (no `probe37-*-v300` log exists); its v2.1.3 16/16 stands because the label fix is unchanged by a version bump. No live Chrome re-run was done in this audit round: nothing in the extension changed, so the kept logs + fresh spot-checks below are the evidence. Zips: `hiddengem-flow-v3.0.0-20261118.zip` (public, 1,257,299 B, sha256 `f61b1f86cf6c58b5edc0a29b7c236679412fd5604ce854a7ff0d9838a9d16f37`); the v2.1.3 owner zip is untouched on disk (sha256 `7a707ab3e2bc8bce522303a06cd9683f3430582581565d3ed9bfc81f5b707098`, re-verified). The local `.output/chrome-mv3/` tree is byte-identical to the delivered v3.0.0 zip (per-file sha256 compare, 0 diffs). The v3.0.0 release itself did not exist at audit time (created by the parent via browser after this audit started) — its asset byte-match is **PENDING**, not verified.

| ID | Severity | Finding | Fix / recommendation |
|---|---|---|---|
| A-100 | Medium (doc) | **CHANGELOG v3.0.0 entry and the release-notes draft misstate the v3.0.0 verification numbers.** Both say "live probes 21/21, 11/11 and 16/16". The v3.0.0 round actually ran probe35 **21/21** and probe36 **12/12** (probe36 gained a check since v2.1.3's 11/11); probe37-labels **16/16** is the v2.1.3 number and was never re-run on v3.0.0. The "same verification" wording is therefore wrong as written. | Correct both texts before/at publish: "smokes 1026/1026; live probes probe35 21/21, probe36 12/12; probe37-labels 16/16 inherited from v2.1.3 (label fix unchanged, no code change)". Doc-only fix, no rebuild. |
| A-101 | Medium (doc) | **README still describes v2.1.1 everywhere** (0 mentions of v3.0.0): badge `version-2.1.1`, Download link → `v2.1.1-dev-20261118` + `hiddengem-flow-v2.1.1-20261118.zip`, "This is v2.1.1, published as a pre-release", Status section has no v3.0.0 / v2.1.2 / v2.1.3 entry at all. Everything else in the README checked out against the source and live data (permissions table = the 9 manifest permissions + optional `tabGroups`; six GM functions; store count 4 with the exact live names incl. "Universal DOM Diagnostic v2.0 — TM Only v2.0.0"; layout matches the tree; honest limits accurate). | Step-3 doc fix at publish time: badge → 3.0.0, Download link → the v3.0.0 tag + zip name, Status → new v3.0.0 entry (v2.1.2/v2.1.3 noted as superseded dev builds). Until the v3.0.0 release exists the v2.1.1 link is still the correct live download — update it only when the release is live. |
| A-102 | High (record) | **No stable v1.0.0 release exists live.** The public releases API (`api.github.com/repos/BidyutRoy2/hiddengem-flow/releases`, crawled 2026-11-18 09:28 UTC) lists exactly **3 releases, all pre-releases**: `v2.1.1-dev-20261118`, `v1.1.0-dev-20261115`, `v1.0.0-dev-20261115`. Tag `v1.0.0` returns 404. The v2.1.1-dev asset is byte-identical to the delivered v2.1.1 public zip (live digest `sha256:9f7437f176ef797c97a8405c99ecfdd3399ad0ee0140db898a68edc84754e905` = local zip sha256 exactly). No owner asset exists in any release (v2.1.1-dev: 1 asset, the public zip; v1.1.0-dev: 1 asset; v1.0.0-dev: 2 assets — zip + `install.mp4`). But the "v1.0.0 is the stable Latest release — verify it is untouched" expectation does NOT match live state: there is no stable v1.0.0 to verify. README Status says "v1.0.0 was the final first version" while the v1.0.0-dev body itself says "the final v1.0.0 release is still to come". | Owner decision needed: either create the stable v1.0.0 release (then it becomes the Latest), or correct the record (README + this audit) to say v1.0.0 stable was never published and the pre-release line is the whole release history. Do not claim a stable v1.0.0 exists until one does. |
| A-103 | Low (known, live) | **The live v2.1.1-dev release still says "(public build)"** — title `HiddenGem Flow v2.1.1-dev (public build)`, body names the owner build / Script Studio ("This is the public build: every feature, no Script Studio. The Studio is owner-only…", plus the "Cloud LLM: 9 providers" bullet). Re-confirmed live 2026-11-18 09:28 UTC. | Rewording needs the owner's approval (editing a published release). Offered before, still pending. The v3.0.0 release draft already avoids the phrase (proposed title "HiddenGem Flow v3.0.0", body with no forbidden phrase). |
| A-104 | Medium (pre-existing, boundary) | **Forbidden phrases are 0 in the built public extension and user-facing docs — but NOT 0 in repo source.** Verified: built v3.0.0 zip grep 0 for all six ("Cloud LLM", "public build", "owner build", "Script Studio", "AI authoring", "Tampermonkey"); README 0, CHANGELOG 0, `tools/store-uploader.html` 0, `dashboard/index.html` 0, all other `docs/` 0. But the source tree still carries them: `entrypoints/shared/studio.ts` (24 hits), `ai-author.ts` (12 "AI authoring", 43 "Cloud LLM" across source), `variant.ts`, `wxt.config.ts` comments, `dashboard/main.ts` comments — and live `main` already contains `studio.ts` + `ai-author.ts` (verified via `get_file_contents`, `studio.ts` SHA `676528aee773c7a9937016230c5e3c1cdb03d673`), pushed at v2.1.1 (commit `bf4edf8c`). `docs/AUDIT.md` itself has "Cloud LLM" ×11, "public build" ×10, "owner build" ×8, "Script Studio" ×10, "AI authoring" ×6 ("Tampermonkey" 0); `docs/LIVE_TEST_AUDIT.md` has 4/1/1/2/1/0. So the owner's 2026-11-18 repo rule ("repo te owner build er kono kotha thakbe na") is met for the shipped extension and user docs, but not for the pushed source or the internal audit records — this predates v3.0.0 and the v3.0.0 snapshot push continues it. | Owner decision (keep-vs-scrub): keep the audit records as the internal history and accept source comments as developer text, OR scrub. Scrubbing source comments is safe (comments only, no behaviour change) but touches the owner-variant code paths' documentation; scrubbing AUDIT.md would rewrite history. No change made in this audit. |
| A-105 | Low (verified, no change) | **A-26: `RELEASE_PAGE_URL` still points at `v2.1.1-dev-20261118`** (`updates.ts:82`, same href in `dashboard/index.html:49`). Verified harmless, no rebuild: the banner link is set from the API record — `main.ts:445–447` sets `download.href = record.downloadUrl` whenever present, and `updates.ts:532` uses `release.downloadUrl || RELEASE_PAGE_URL`, so the constant is only the fallback when the API returns no `html_url`; the static HTML href is only the pre-first-check fallback. The v3.0.0 zip's fallback is therefore the current published release, which is correct until v3.0.0 is published. | At publish time, move it to the v3.0.0 tag per the standing one-release-behind-until-publish rule (same as A-90). Do NOT rebuild v3.0.0 for this. |
| A-106 | Low (evaluated, no change) | **A-97 provider-name residual confirmed in the v3.0.0 public zip.** All 9 providers appear ×2 in `background.js` (Groq 5, Google/Gemini 5, NVIDIA 6, OpenRouter 5, Mistral 6, Together 2, Hugging Face 2, Cerebras 2, plus endpoint strings `api.groq.com` ×2, `generativelanguage.googleapis.com` ×2, `api.together.xyz` ×2, `router.huggingface.co` ×2, `api.cerebras.ai` ×2, `integrate.api.nvidia.com` ×2, `openrouter.ai` ×2, `api.mistral.ai` ×2). The cloud-call builders are still absent: `buildCloudRequestBody` / `buildCloudCall` → 0 hits in every public file. Same family as A-75/A-96 (dead Studio strings in public `background.js`, live backup sanitizer). | **Decision: DO NOT split** (same reasoning as A-97 — `backup.ts` must know the AI keys to exclude them from backups). Revisit only if the backup sanitizer is ever reworked. |
| A-107 | Low (doc) | **`docs/LIVE_TEST_AUDIT.md` also has zero mentions of v3.0.0** (like AUDIT.md had before this section). The v3.0.0 probe runs (probe35 21/21, probe36 12/12) exist only as kept logs, not as a written live-test section. | Step-3 doc fix: add a short v3.0.0 live-test section to `LIVE_TEST_AUDIT.md` (probe35/probe36 results + A-89 holds + note that probe37 was not re-run). |
| A-108 | Low (doc) | **README "v1.0.0 was the final first version" contradicts the live release state** (see A-102 — no stable v1.0.0 exists). Same fix as A-102: correct the Status line when the owner decides. | Owner decision (see A-102). |

## v3.0.0 audit notes (verified this round, no finding)

- **Manifest (built zip):** version `3.0.0`; permissions exactly the 9 expected (`storage`, `tabs`, `scripting`, `activeTab`, `userScripts`, `notifications`, `sidePanel`, `contextMenus`, `alarms`); `optional_permissions` exactly [`tabGroups`]; no `host_permissions`, no `chrome_url_overrides`; `optional_host_permissions` [`*://*/*`]; 4 commands (`toggle-flow` / `add-current-site` / `open-dashboard` / `quick-note`, all Alt+Shift+*); `omnibox` keyword `flow`; no `default_popup`. Entrypoints present: `background.js`, `dashboard.html`, `floating.js`, `float.html`, `sidepanel.html`, `gm-relay.js`, `style-injector.js`, `chunks/`.
- **GM shim (exactly six functions, `engine.ts:165–180`):** always defined — `GM_setValue`, `GM_getValue`, `GM_addStyle`, `GM_notification` — plus grant-gated `GM_xmlhttpRequest` (`@grant` + `@connect`) and `GM_setClipboard`; same six exposed on the `window.GM` object form. Everything else (`GM_openInTab`, `GM_download`, `unsafeWindow`, …) is not implemented, as the README says.
- **Storage keys accounted for:** `hiddengemflow.scripts.v1`, `.sessions.v1`, `.notes.v1`, `.folders.v1`, `.schedules.v1`, `.schedules.runs.v1`, `.sync.v1`, `.store.cache.v1`, `.store.token.v1`, `.ai.v1`, `.ai.tokens.v1`, `.userstyles.v1`, `.runs.v1`, `.scripts.errors.v1`, `.studio.tests.v1`, `.studio.template.v1`, `.bridge.dismissed.v1`, `.newtab.v1` (legacy, ignored), plus `hgf:gm:` per-script prefix and `hgf-*` alarm ids. The two AI keys are inert in the public build (A-83) and excluded from backups.
- **Store (live, 2026-11-18 09:28 UTC, raw.githubusercontent):** exactly 4 scripts, names + versions as expected — Titan Exchange Auto Trader Pro by HiddenGem v2.0, Universal DOM Diagnostic v2.0 — TM Only v2.0.0, 9Chain Virtual Node Auto v2.0.0, Firstprint Daily Streak Auto-Claim v1.0.2; `updatedAt` 2026-11-17. (Note: the Universal DOM Diagnostic *description* in the store index says "Tampermonkey only" — store-repo text, not extension text; the extension itself is 0 for that phrase.)
- **Uploader (code review only — real-token E2E is impossible in this harness, and is NOT claimed):** `tools/store-uploader.html` + `entrypoints/shared/store-publish.ts`. Token goes only to `api.github.com` in the `Authorization: Bearer` header, never in a URL, never in logs, never in downloads; stored only in the page's localStorage with a Forget button (`store-publish.ts:247,390,443,1087`; uploader `:303,350,380,443,1087`). Publish order: read current `index.json` → upload script → upload updated `index.json` → jsDelivr purge for both. Upgrade suggests a patch bump; Delete is two-click (arm → confirm), removes the `index.json` entry first then the file, and documents the orphan-file case honestly. No-token Download/Copy fallbacks still work. The wrong-token 401 refusal was the only live-proven uploader behaviour (earlier rounds); publish/upgrade/delete success paths remain unverified live (see open limitations).
- **Cache-buster still NOT applied** (open item, exact lines re-verified): `store.ts:344` `fetchIndexFrom` does a plain `fetch(url)` and `fetchStoreCode` does a plain `fetch(url.href)` — no `cache: "no-store"` in either. After a publish + jsDelivr purge, Load store can still show the old list for raw.githubusercontent's ~5 min cache. Fix is one line in each function; needs the owner's word (offered before, left pending).
- **A-61 loopback-http allowance unchanged:** `ai-author.ts:233–251` (`validateCustomBaseUrl`) allows plain `http://` only for `localhost` / `127.0.0.1` / `::1` / `[::1]`; `sync.ts:174–208` same rule for WebDAV. A key never travels over a network on loopback. Recommendation: keep as designed (documented, loopback-only); the open user question (blanket ban vs loopback allowance) stays open since 2026-11-16.
- **License:** MIT everywhere checked — `LICENSE` file (MIT, Copyright (c) 2026 Bidyut Roy), `package.json` `"license": "MIT"`, README MIT badge, dashboard footer "MIT". MIT vs GPL-3.0 decision still open (since v1.0.0); no change made.
- **Pushed source vs built zips:** branch head was still `5d847cf1` ("Fix README…", 2026-11-18T00:33:10Z) at every check in this audit round — worker A's v3.0.0 snapshot push had NOT landed when this section was written, so the per-file pushed-vs-local-vs-zip comparison is **PENDING** (see open limitations). Nothing was pushed by this audit.
- **Owner live test:** the owner has NOT yet reported a live test of v3.0.0 — not claimed anywhere in this audit.

## v3.0.0 open limitations (not hidden)

1. **v3.0.0 release-asset byte-match PENDING.** The v3.0.0 release is created by the parent via browser after this audit started. Once it exists, verify the uploaded asset's digest equals the delivered zip sha256 `f61b1f86cf6c58b5edc0a29b7c236679412fd5604ce854a7ff0d9838a9d16f37` before calling the release verified.
2. **Pushed-source comparison PENDING.** Worker A's v3.0.0 snapshot push had not landed at audit time (head still `5d847cf1`). When it lands, compare the pushed files per-file against the local source and the v3.0.0 zip contents before closing this item.
3. **A-102: no stable v1.0.0 release exists live** (see finding above) — owner decision needed.
4. **A-100/A-101/A-107 doc fixes ready for step 3** (CHANGELOG + release-notes draft probe numbers; README v3.0.0; `LIVE_TEST_AUDIT.md` v3.0.0 section) — local only, NOT pushed.
5. **A-103: v2.1.1 release-notes rewording** still needs the owner's approval.
6. **A-104: AUDIT.md keep-vs-scrub** (45 "owner" lines / 32 "public" lines in `docs/AUDIT.md`; 26/7 in `docs/LIVE_TEST_AUDIT.md`) — owner decision needed.
7. **Cache-buster still NOT applied** (one line in `fetchIndexFrom` + one in `fetchStoreCode`); **A-61 loopback allowance**; **license MIT vs GPL-3.0** — all still open, all need the owner's word.
8. **Real-key Generate with NVIDIA NIM still unverified** (carried from v2.1.2/v2.1.3); **uploader publish/upgrade/delete success paths still NOT live-verified** (real PAT impossible in this harness); **temp-test unregistration on tab-close/finish/timeout** still code-reviewed only.
9. **Pre-release vs full release for v3.0.0** — undecided. The draft proposes title "HiddenGem Flow v3.0.0" with no "(public build)" wording; whether the v3.0.0 release is created as a pre-release (like v2.1.1-dev) or flipped to a full release is the owner's call at publish time.
