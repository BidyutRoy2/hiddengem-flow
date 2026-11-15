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
| `notifications` | `GM_notification` only — real system notification from the background | KEEP |
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
2. **Store repo is live since 2026-11-15** (`BidyutRoy2/hiddengem-flow-store`, one real script — "Markdown Link Copier" v1.0.0). The live fetch path is now verified end to end (probe21: Load store → card → scan → install → the script ran on example.com). The failure path (jsDelivr → raw → cache → honest "not published yet" message) was verified earlier, on the empty store.
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
