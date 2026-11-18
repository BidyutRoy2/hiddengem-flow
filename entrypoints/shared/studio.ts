// HiddenGem Flow — Script Studio (v2.1.0, OWNER BUILD ONLY).
//
// The Dashboard tab where scripts are generated, tested, fixed,
// saved, and published to the Official Store — all inside the
// extension. This module is imported ONLY through a dynamic import
// guarded by IS_OWNER_BUILD (see dashboard/main.ts), so the bundler
// drops it — and every "Script Studio" string in it — from the
// PUBLIC build entirely. Never import this module statically from
// any shared code (the background must stay Studio-free; it talks to
// the Studio only through shared/studio-protocol.ts).
//
// Three views: Generate / Test / Publish to store.
//  * Generate: compact LLM setup (the cloud LLM code moved here from
//    the Later tab) + the master prompt template (built-in default
//    below, editable, Reset to default) + TWO boxes only (Website
//    link + Task). Draft is memory-only until saved.
//  * Test: the draft runs ONCE on its real site as a TEMPORARY
//    chrome.userScripts entry (background MSG_STUDIO_TEST_START) —
//    never installed. Per-step results arrive through the DOM-signal
//    + relay pattern (A-04: sendMessage is undefined in the
//    userscript world). A wallet Confirm is NEVER auto-clicked: the
//    test shows "Waiting for your Confirm in the wallet" and waits.
//  * Publish: a port of tools/store-uploader.html (which stays as a
//    backup, untouched). The PAT is sent only to api.github.com.
//
// Storage (see the design spec §d): template text under
// hiddengemflow.studio.template.v1 (absent = built-in default),
// store PAT under hiddengemflow.store.token.v1 (browser-only, never
// in backups/logs), test history under
// hiddengemflow.studio.tests.v1 (last 20, not backed up). NO owner
// key — there is no Owner mode toggle in the two-build model.
// The forbidden word (a userscript-manager brand name) never appears anywhere user-facing.
// No eval / new Function / remote code. No new permissions.

import {
  AI_PROVIDERS,
  aiKeyFor,
  aiTokenKeyFor,
  aiTokensFromStored,
  buildCloudCall,
  buildModelsCall,
  cloudAvailable,
  defaultAiSettings,
  defaultAiTokens,
  describeDraftFailure,
  extractCloudDraft,
  extractGeminiDraft,
  generateAiDraft,
  loadAiSettings,
  loadAiTokens,
  modelsFetchError,
  orderModels,
  parseAiHost,
  parseModelsResponse,
  providerDef,
  saveAiSettings,
  saveAiTokens,
  validateCustomBaseUrl,
  type AiProviderId,
  type AiSettings,
  type AiTokens,
} from "./ai-author";
import { parseMetadata } from "./scripts";
import {
  MSG_STUDIO_TEST_START,
  MSG_STUDIO_TEST_STEPS,
  MSG_STUDIO_TEST_STOP,
  STUDIO_TESTS_KEY,
  addStudioTestRun,
  sanitizeStudioTests,
  studioStepState,
  type StudioStep,
  type StudioTestRun,
} from "./studio-protocol";
import {
  STORE_TOKEN_KEY,
  buildStoreEntry,
  buildStoreUserJs,
  defaultStoreConfig,
  filenameFromCodeUrl,
  filenameFromCodeUrlForDelete,
  ghDeleteFile,
  ghGetFile,
  ghPutFile,
  jsdelivrIndexUrl,
  loadLiveStoreIndex,
  parseStoreIndexText,
  parseStoreMeta,
  purgeFile,
  rawCodeUrl,
  rawIndexUrl,
  sanitizeFilename,
  suggestVersionBump,
  testStoreConnection,
  validateStoreFields,
  type StoreConfig,
  type StoreScriptFields,
} from "./store-publish";
import type { StoreIndex, StoreScript } from "./store";

declare const chrome: any;

/** The Studio's built-in master prompt template (v2, from docs/master-prompt-template.md) + step reporting for the Test view. */
export const STUDIO_DEFAULT_TEMPLATE = `You are writing a userscript for HiddenGem Flow, a Chrome MV3 extension that runs userscripts with chrome.userScripts. The user will paste your script into the extension's script editor. Output the COMPLETE script in one code block, ready to paste, plus a 2-line summary before it.

GOAL: Do NOT ask for a goal. Derive the goal from the WEBSITE + TASKS below. The script's @name and @description must come from them.

WEBSITE: [paste the full URL, e.g. https://firstprint.fun/app/#/earn]
TASKS — do them in order, one step at a time:
Step 1 — WHERE: [page/section, e.g. "the Earn page, top Daily Streak card"] | DO: [action, e.g. "find the button with text 'Claim +50' and click it"] | WAIT AFTER: [e.g. 3 seconds] | DONE WHEN: [how to know it worked, e.g. "the button disappears or becomes disabled"]
Step 2 — WHERE: [...] | DO: [...] | WAIT AFTER: [...] | DONE WHEN: [...]
(add more steps as needed — copy the Step line)

RUN RULES (leave the defaults if you have nothing to change):
- Delay between steps: [default: 3 to 5 seconds, random in that range]
- Run: [default: once when the page opens]
- Stop when: [e.g. "after the last step succeeds" / "after 3 failed tries"]
- If a step fails: [default: retry it 2 times, then stop and show the reason in the status panel]
- Never do: [default: "never click Confirm inside the wallet popup — the user confirms it", "never ask for or use a private key or seed phrase", "never click Follow/Join buttons"]

=== HIDDEN GEM FLOW SCRIPT RULES (follow all of them) ===
HEADER: start with a ==UserScript== block: @name (short, from the tasks), @namespace HiddenGemFlow, @version 1.0.0, @description (one line, from the tasks), @match (exactly the WEBSITE URL above), @grant GM_setValue, @grant GM_getValue, @grant GM_notification, @run-at document-idle.
GM APIS AVAILABLE (only these): GM_setValue / GM_getValue (values are stored per-script, visible on the page — NEVER store secrets or keys in them), GM_notification (show a notification), GM_addStyle (add CSS), GM_setClipboard (copy text), GM_xmlhttpRequest (only if a @connect host is listed — do NOT add @connect unless a task needs to fetch another site).
STATUS PANEL: show a small panel at the bottom-right with the current step, last result, and a Start/Stop button.
CONSTRAINTS:
- Only run on the @match URL above. Never run on other sites.
- Wait up to 30 seconds for each element to appear before giving up on that step.
- Find elements by their visible text or aria-label, never by a long fragile CSS path.
- Do not use eval, new Function, document.write, or innerHTML with page data.
- Keep the code readable with short comments on each step.

STEP REPORTING (for the Test view in the extension):
- After each step finishes, report it by appending a hidden div to the page: document.createElement('div'), setAttribute('data-hgf-studio-step', ''), textContent = JSON.stringify({step: <number>, status: 'ok' | 'failed' | 'waiting-wallet', detail: '<short text>'}), style.display = 'none', append to document.documentElement. Status 'ok' when the step's DONE WHEN is true, 'failed' with the reason when it gives up, 'waiting-wallet' when a wallet popup appeared and the USER must confirm it in the wallet — never click Confirm yourself.
- Also report a final step when the script stops: {step: <last step + 1>, status: 'ok' | 'failed', detail: 'done' or the stop reason}.`;

/** Storage key for the owner's edited master prompt template. Absent = the built-in default above. */
export const STUDIO_TEMPLATE_KEY = "hiddengemflow.studio.template.v1";

/** A template is plain text, ≤200 KB. Pure. */
export function sanitizeStudioTemplate(raw: unknown): string {
  if (typeof raw !== "string") return STUDIO_DEFAULT_TEMPLATE;
  const text = raw.slice(0, 200 * 1024);
  return text ? text : STUDIO_DEFAULT_TEMPLATE;
}

/** A store token is a plain string, ≤4096 chars. Pure. */
export function sanitizeStudioToken(raw: unknown): string {
  return typeof raw === "string" ? raw.slice(0, 4096) : "";
}

/** Context the dashboard hands the Studio at init (the Studio never imports dashboard/main.ts). */
export interface StudioContext {
  /** Switch to a dashboard tab by name (must accept "studio"). */
  selectTab: (name: string) => void;
  /** Register an extra tab name so selectTab accepts it. */
  addTab: (name: string) => void;
  /** Register a callback the dashboard runs when the Studio tab is selected. */
  registerOnSelect: (fn: () => void) => void;
  /** Load draft code into the Scripts tab editor (scan + confirm, never installs). */
  openDraftInEditor: (code: string) => void;
}

function storageAvailable(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome?.storage?.local;
  } catch {
    return false;
  }
}

async function loadStudioTemplate(): Promise<string> {
  if (!storageAvailable()) return STUDIO_DEFAULT_TEMPLATE;
  try {
    const data = await chrome.storage.local.get(STUDIO_TEMPLATE_KEY);
    const raw = data?.[STUDIO_TEMPLATE_KEY];
    return typeof raw === "string" ? sanitizeStudioTemplate(raw) : STUDIO_DEFAULT_TEMPLATE;
  } catch {
    return STUDIO_DEFAULT_TEMPLATE;
  }
}

async function saveStudioTemplate(text: string): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [STUDIO_TEMPLATE_KEY]: sanitizeStudioTemplate(text) });
}

async function loadStoreToken(): Promise<string> {
  if (!storageAvailable()) return "";
  try {
    const data = await chrome.storage.local.get(STORE_TOKEN_KEY);
    return sanitizeStudioToken(data?.[STORE_TOKEN_KEY]);
  } catch {
    return "";
  }
}

async function saveStoreToken(token: string): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [STORE_TOKEN_KEY]: sanitizeStudioToken(token) });
}

async function forgetStoreToken(): Promise<void> {
  if (!storageAvailable()) return;
  try {
    await chrome.storage.local.remove(STORE_TOKEN_KEY);
  } catch {
    // Non-fatal.
  }
}

async function loadStudioTests(): Promise<StudioTestRun[]> {
  if (!storageAvailable()) return [];
  try {
    const data = await chrome.storage.local.get(STUDIO_TESTS_KEY);
    return sanitizeStudioTests(data?.[STUDIO_TESTS_KEY]);
  } catch {
    return [];
  }
}

async function recordStudioTest(run: StudioTestRun): Promise<void> {
  if (!storageAvailable()) return;
  try {
    const runs = await loadStudioTests();
    await chrome.storage.local.set({ [STUDIO_TESTS_KEY]: addStudioTestRun(runs, run) });
  } catch {
    // Non-fatal.
  }
}

// ---------------------------------------------------------------------------
// DOM helpers (all dynamic content via textContent/createElement —
// provider and draft data never becomes HTML)
// ---------------------------------------------------------------------------

function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function showStatus(id: string, text: string): void {
  const node = el(id);
  if (node) {
    node.hidden = false;
    node.textContent = text;
  }
}

function hideStatus(id: string): void {
  const node = el(id);
  if (node) node.hidden = true;
}

function downloadFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Panel skeleton (static HTML only — no interpolated values)
// ---------------------------------------------------------------------------

const STUDIO_PANEL_HTML = `
      <section id="panel-studio" class="panel">
        <div class="card">
          <h2>Script Studio <span class="badge">Owner only</span></h2>
          <p>Generate, test, fix and publish scripts to the Official Store — all inside the extension. A draft is <b>memory-only</b> until you save it: reloading the Dashboard loses an unsaved draft.</p>
          <div class="row" role="tablist" aria-label="Studio views">
            <button type="button" class="secondary st-viewbtn" id="stViewGenerate" aria-pressed="true">Generate</button>
            <button type="button" class="secondary st-viewbtn" id="stViewTest" aria-pressed="false">Test</button>
            <button type="button" class="secondary st-viewbtn" id="stViewPublish" aria-pressed="false">Publish to store</button>
          </div>
        </div>

        <div id="stGenerateView">
          <div class="card">
            <h2>LLM setup</h2>
            <p class="hint">Cloud LLM is off by default and stays off until you turn it on here, naming a provider and pasting your own API key. The key is stored in this browser only, never in backups, never logged, and sent only to that provider.</p>
            <div class="form-row">
              <label>
                <span>Provider</span>
                <select id="stProvider" aria-label="Cloud LLM provider">
                  <option value="" selected>None (local templates only)</option>
                  <option value="groq">Groq</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="nvidia">NVIDIA NIM</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="together">Together AI</option>
                  <option value="huggingface">Hugging Face</option>
                  <option value="cerebras">Cerebras</option>
                  <option value="mistral">Mistral</option>
                  <option value="custom">Custom (OpenAI-compatible)</option>
                </select>
              </label>
              <label class="grow">
                <span id="stKeyLabel">API key (your own key)</span>
                <input id="stCloudKey" type="password" placeholder="Pick a provider first" autocomplete="off" maxlength="4096" />
              </label>
            </div>
            <div class="form-row">
              <label class="grow" id="stModelTextRow">
                <span>Model</span>
                <input id="stCloudModel" type="text" placeholder="llama-3.3-70b-versatile" autocomplete="off" maxlength="120" />
              </label>
              <label class="grow" id="stModelSelectRow" hidden>
                <span>Model — detected</span>
                <select id="stCloudModelSelect" aria-label="Detected models"></select>
              </label>
              <label class="grow" id="stCustomBaseRow" hidden>
                <span>Base URL (https only)</span>
                <input id="stCustomBaseUrl" type="text" placeholder="https://your-endpoint.example.com/v1" autocomplete="off" maxlength="500" />
              </label>
            </div>
            <div class="row">
              <button id="stDetectModels" type="button" class="secondary" disabled title="Pick a provider and paste your API key first">Detect models</button>
              <button id="stModelManual" type="button" class="secondary" hidden>Type manually</button>
            </div>
            <p id="stModelStatus" class="hint" role="status" hidden></p>
            <p id="stProviderNote" class="hint" hidden></p>
            <label class="toggle-row">
              <input id="stCloudToggle" type="checkbox" />
              <span><strong>Enable cloud LLM</strong><small id="stCloudToggleNote">Only when a provider and key are saved above.</small></span>
            </label>
            <div class="row">
              <button id="stSaveCloud" type="button" class="secondary">Save cloud LLM settings</button>
            </div>
            <p id="stCloudStatus" class="hint" role="status" hidden></p>
            <p id="stCloudNote" class="hint">Local templates need no API key and make no network request. Cloud LLM is off — turn it on above to use a provider with your own key.</p>
          </div>

          <div class="card">
            <details id="stTemplateDetails">
              <summary>Master prompt template — the AI derives the goal from your tasks</summary>
              <p class="hint">Set by default — the AI derives the goal from your tasks. Edit it here to change how every draft is written; Reset to default deletes your edit.</p>
              <p id="stTemplatePreview" class="hint"></p>
              <textarea id="stTemplateEdit" spellcheck="false" rows="12" aria-label="Master prompt template" hidden></textarea>
              <div class="row">
                <button id="stTemplateEditBtn" type="button" class="secondary">View / Edit</button>
                <button id="stTemplateSaveBtn" type="button" class="primary" hidden>Save template</button>
                <button id="stTemplateResetBtn" type="button" class="secondary">Reset to default</button>
              </div>
              <p id="stTemplateStatus" class="hint" role="status" hidden></p>
            </details>
          </div>

          <div class="card">
            <h2>Generate a script</h2>
            <div class="form-row">
              <label class="grow">
                <span>Website link</span>
                <input id="stWebsite" type="text" placeholder="e.g. https://firstprint.fun/app/#/earn" autocomplete="off" inputmode="url" maxlength="2048" />
              </label>
            </div>
            <label class="import-label">
              <span>Task — what should the script do, step by step</span>
              <textarea id="stTask" spellcheck="false" rows="5" placeholder="Step 1 — WHERE: the Earn page, top Daily Streak card | DO: find the button with text 'Claim +50' and click it | WAIT AFTER: 3 seconds | DONE WHEN: the button disappears or becomes disabled"></textarea>
            </label>
            <div class="row">
              <button id="stGenerate" type="button" class="primary">Generate script</button>
              <button id="stGenerateLocal" type="button" class="secondary">Generate draft (local templates)</button>
            </div>
            <p id="stStatus" class="hint" role="status" hidden></p>
            <div id="stDraftBox" class="code-preview" hidden>
              <p id="stDraftMeta" class="hint"></p>
              <div id="stDraftChips" class="row"></div>
              <pre id="stDraftCode" class="ai-code"></pre>
            </div>
            <div class="row" id="stDraftActions" hidden>
              <button id="stTestDraft" type="button" class="primary">Test in extension</button>
              <button id="stCopyDraft" type="button" class="secondary">Copy</button>
              <button id="stOpenEditor" type="button" class="secondary">Open in editor</button>
              <button id="stSaveScript" type="button" class="secondary">Save as script</button>
              <button id="stDiscardDraft" type="button" class="secondary">Discard draft</button>
            </div>
            <p class="hint">The draft is memory-only until you save it — reloading the Dashboard loses it. Test in extension runs the draft once on its real site without installing it; Save as script opens the normal editor (scan, then confirm).</p>
          </div>
        </div>

        <div id="stTestView" hidden>
          <div class="card">
            <h2>Test in extension</h2>
            <p>The draft runs <b>once</b> on its real site as a temporary entry — it is never added to the installed scripts. Stopping the test, closing the test tab, or the test finishing unregisters the temporary entry immediately.</p>
            <p id="stTestTarget" class="hint">No test running — generate a draft, then press “Test in extension”.</p>
            <p id="stTestElapsed" class="hint" role="status" hidden></p>
            <div id="stTestSteps" class="runlog" role="log" aria-label="Test step results">No steps reported yet.</div>
            <p id="stTestBanner" class="hint" role="status" hidden></p>
            <div class="row">
              <button id="stTestStop" type="button" class="secondary" disabled>Stop test</button>
              <button id="stTestRetest" type="button" class="secondary" disabled>Re-test</button>
              <button id="stTestFixAi" type="button" class="secondary" disabled>Fix with AI</button>
              <button id="stTestEditManual" type="button" class="secondary" disabled>Edit manually</button>
            </div>
            <p id="stTestFixNote" class="hint" hidden>Fix with AI needs cloud LLM — turn it on in LLM setup, or fix manually.</p>
            <p id="stTestStatus" class="hint" role="status" hidden></p>
            <h3>Recent tests</h3>
            <ul id="stTestHistory" class="flow-list"></ul>
            <p id="stTestHistoryEmpty" class="hint">No tests yet.</p>
          </div>
        </div>

        <div id="stPublishView" hidden>
          <div class="card">
            <h2>GitHub connection</h2>
            <p class="hint">The token is sent only to <code>api.github.com</code>, in the <code>Authorization</code> header — never in a URL, never to any other host, never written into any file. Without a token, Publish is disabled and the Download buttons are the way (publish by hand on github.com).</p>
            <div class="form-row">
              <label>
                <span>Owner</span>
                <input id="stStoreOwner" type="text" value="BidyutRoy2" autocomplete="off" maxlength="120" />
              </label>
              <label>
                <span>Repository</span>
                <input id="stStoreRepo" type="text" value="hiddengem-flow-store" autocomplete="off" maxlength="120" />
              </label>
              <label>
                <span>Branch</span>
                <input id="stStoreBranch" type="text" value="main" autocomplete="off" maxlength="120" />
              </label>
            </div>
            <label class="import-label">
              <span>Personal Access Token <small>(fine-grained, Contents read/write on this repo only)</small></span>
              <input id="stStoreToken" type="password" placeholder="github_pat_…" autocomplete="off" maxlength="4096" />
            </label>
            <div class="row">
              <button id="stTestConn" type="button" class="primary">Test connection</button>
              <button id="stForgetToken" type="button" class="secondary">Forget token</button>
              <span id="stConnStatus" class="hint" role="status">No token saved in this browser yet.</span>
            </div>
            <p id="stConnError" class="error" role="alert" hidden></p>
            <p id="stConnOk" class="hint" role="status" hidden></p>
            <h3>Create the token (you do this on GitHub — this page cannot create it)</h3>
            <ol>
              <li>GitHub → your avatar → <strong>Settings</strong> → <strong>Developer settings</strong> → <strong>Personal access tokens</strong> → <strong>Fine-grained tokens</strong> → <strong>Generate new token</strong>.</li>
              <li>Token name: e.g. <code>HiddenGem Flow store uploader</code>. Expiration: pick one (90 days is a sane default).</li>
              <li><strong>Repository access</strong> → <strong>Only select repositories</strong> → choose <code>hiddengem-flow-store</code> (and nothing else).</li>
              <li><strong>Permissions</strong> → <strong>Repository permissions</strong> → <strong>Contents</strong> → <strong>Read and write</strong>. Nothing else is needed — do not add other permissions.</li>
              <li><strong>Generate token</strong>, copy it once, paste it above, then click <strong>Test connection</strong>. A working token is saved in this browser only; <strong>Forget token</strong> deletes it.</li>
            </ol>
          </div>

          <div class="card">
            <div class="row" role="tablist" aria-label="Publish views">
              <button type="button" class="secondary st-viewbtn" id="stPubViewNew" aria-pressed="true">New Script</button>
              <button type="button" class="secondary st-viewbtn" id="stPubViewLive" aria-pressed="false">Live Scripts</button>
            </div>
          </div>

          <div class="card" id="stPubNewView">
            <h2>New Script — publish to the store</h2>
            <label class="import-label">
              <span>Script name *</span>
              <input id="stPubName" type="text" placeholder="e.g. Titan Quick Buy" autocomplete="off" maxlength="120" />
            </label>
            <div class="form-row">
              <label>
                <span>Version</span>
                <input id="stPubVersion" type="text" value="1.0.0" autocomplete="off" maxlength="32" />
              </label>
              <label>
                <span>Author <small>(optional)</small></span>
                <input id="stPubAuthor" type="text" placeholder="e.g. HiddenGem" autocomplete="off" maxlength="120" />
              </label>
            </div>
            <label class="import-label">
              <span>Description <small>(optional — one line, shown in Script Store)</small></span>
              <input id="stPubDesc" type="text" placeholder="What the script does" autocomplete="off" maxlength="240" />
            </label>
            <label class="import-label">
              <span>@match — one per line * <small>(the sites the script runs on, e.g. https://example.com/*)</small></span>
              <textarea id="stPubMatches" rows="3" spellcheck="false" placeholder="https://example.com/*"></textarea>
            </label>
            <label class="import-label">
              <span>Script source</span>
              <textarea id="stPubCode" spellcheck="false" rows="10" placeholder="// ==UserScript==&#10;// @name        …"></textarea>
            </label>
            <div class="row">
              <button id="stUseDraft" type="button" class="secondary">Use generated script</button>
              <button id="stPubFileBtn" type="button" class="secondary">Choose a script file…</button>
              <input id="stPubFile" type="file" accept=".js,.user.js,text/plain" hidden />
              <button id="stPubImport" type="button" class="secondary">Import — read details from the code</button>
            </div>
            <p class="hint">Name, Version, Description and @match auto-fill from the script's <code>==UserScript==</code> metadata as soon as the script is provided (Use generated script, Import, file, or paste) — the fields stay editable after auto-fill. A script without <code>@description</code> leaves Description blank.</p>
            <div class="row">
              <button id="stPublish" type="button" class="primary">Publish to the store</button>
              <button id="stDownloadJs" type="button" class="secondary">Download .user.js</button>
              <button id="stCopyEntry" type="button" class="secondary">Copy index.json entry</button>
              <button id="stDownloadIndex" type="button" class="secondary">Download index.json</button>
            </div>
            <label class="import-label">
              <span>Existing index.json <small>(optional, for the Download index.json button only — choose your current index.json and the new entry is added to it; otherwise a fresh index with this one script is created)</small></span>
              <input id="stIndexInput" type="file" accept=".json,application/json" />
            </label>
            <p id="stIndexNote" class="hint" hidden></p>
            <p id="stPubError" class="error" role="alert" hidden></p>
            <p id="stPubWarn" class="hint" role="status" hidden></p>
            <p id="stPubOk" class="hint" role="status" hidden></p>
            <pre id="stPubLog" class="log" hidden></pre>
            <p class="hint">Publish does, in order: read the current <code>index.json</code> (and its file id) → upload the script to <code>scripts/&lt;name&gt;.user.js</code> → upload the updated <code>index.json</code> → clear the jsDelivr cache for both files. Then check it in the extension: Script Store → <strong>Load store</strong>.</p>
          </div>

          <div class="card" id="stPubLiveView" hidden>
            <h2>Live Scripts</h2>
            <div class="row">
              <button id="stLiveLoad" type="button" class="primary">Load live scripts</button>
              <input id="stLiveSearch" type="search" placeholder="Search live scripts…" aria-label="Search live scripts" autocomplete="off" />
              <span id="stLiveCount" class="hint" role="status"></span>
            </div>
            <p id="stLiveError" class="error" role="alert" hidden></p>
            <p id="stDelOk" class="hint" role="status" hidden></p>
            <ul id="stLiveList" class="flow-list"></ul>
            <p id="stLiveEmpty" class="hint">Load the live scripts to see what is published right now.</p>
            <pre id="stDelLog" class="log" hidden></pre>
          </div>

          <div class="card" id="stUpgradeCard" hidden>
            <h2 id="stUpName">Upgrade script</h2>
            <div class="form-row">
              <label>
                <span>Version</span>
                <input id="stUpVersion" type="text" autocomplete="off" maxlength="32" />
              </label>
              <label>
                <span>Author <small>(optional)</small></span>
                <input id="stUpAuthor" type="text" autocomplete="off" maxlength="120" />
              </label>
            </div>
            <label class="import-label">
              <span>Description <small>(optional)</small></span>
              <input id="stUpDesc" type="text" autocomplete="off" maxlength="240" />
            </label>
            <label class="import-label">
              <span>@match — one per line</span>
              <textarea id="stUpMatches" rows="3" spellcheck="false"></textarea>
            </label>
            <label class="import-label">
              <span>Script source</span>
              <textarea id="stUpCode" spellcheck="false" rows="10"></textarea>
            </label>
            <div class="row">
              <button id="stPublishUpgrade" type="button" class="primary">Publish upgrade</button>
              <button id="stCancelUpgrade" type="button" class="secondary">Cancel</button>
            </div>
            <p id="stUpError" class="error" role="alert" hidden></p>
            <p id="stUpOk" class="hint" role="status" hidden></p>
            <pre id="stUpLog" class="log" hidden></pre>
          </div>
        </div>
      </section>
`;

// ---------------------------------------------------------------------------
// State (dashboard page memory only — the draft is never stored)
// ---------------------------------------------------------------------------

let ctx: StudioContext | null = null;
/** Cloud LLM settings (no key here — keys live under AI_TOKENS_KEY). */
let stAi: AiSettings = defaultAiSettings();
/** Per-provider "a key is stored" flags (booleans only — the page never holds real keys in memory). */
let stAiKeysStored: Partial<Record<AiProviderId, boolean>> = {};
/** The last detected model list — page memory only, never stored. */
let stDetectedModels: { provider: AiProviderId; baseUrl: string; models: string[]; total: number; truncated: boolean } | null = null;
/** The provider the cloud fields currently show. */
let stProviderShown: AiProviderId | null = null;
/** The current draft code — page memory only, never stored, never installed without Save. */
let stDraftCode: string | null = null;
/** The master's template text in force (built-in default or the owner's edit). */
let stTemplate: string = STUDIO_DEFAULT_TEMPLATE;
/** Test state. */
let stTest: { tabId: number; name: string; site: string; startedAt: number; timer: number | null; pollTimer: number | null; finished: boolean; failedStep: string } | null = null;
let stTestSteps: StudioStep[] = [];
/** Publish state. */
let stTokenStored = false;
let stLiveEntries: StoreScript[] = [];
let stLiveLoadedAt: string | null = null;
let stDeleteArmedName: string | null = null;
let stDeleteBusy = false;
let stUpgradeTarget: { entry: StoreScript; scriptPath: string; filename: string } | null = null;
let stExistingIndex: StoreIndex | null = null;

function switchStudioView(which: "generate" | "test" | "publish"): void {
  const views: Record<string, string> = { generate: "stGenerateView", test: "stTestView", publish: "stPublishView" };
  for (const [key, id] of Object.entries(views)) {
    const node = el(id);
    if (node) node.hidden = key !== which;
  }
  for (const [key, id] of Object.entries({ generate: "stViewGenerate", test: "stViewTest", publish: "stViewPublish" })) {
    const btn = el<HTMLButtonElement>(id);
    if (btn) btn.setAttribute("aria-pressed", key === which ? "true" : "false");
  }
  if (which === "test") void renderTestHistory();
}

function switchPublishView(which: "new" | "live"): void {
  const newView = el("stPubNewView");
  const liveView = el("stPubLiveView");
  if (newView) newView.hidden = which !== "new";
  if (liveView) liveView.hidden = which !== "live";
  const newBtn = el<HTMLButtonElement>("stPubViewNew");
  const liveBtn = el<HTMLButtonElement>("stPubViewLive");
  if (newBtn) newBtn.setAttribute("aria-pressed", which === "new" ? "true" : "false");
  if (liveBtn) liveBtn.setAttribute("aria-pressed", which === "live" ? "true" : "false");
}

// ---------------------------------------------------------------------------
// Generate — LLM setup (moved here from the Later tab, same behaviour)
// ---------------------------------------------------------------------------

/**
 * Ask once, on a user gesture, for access to one cloud-LLM origin
 * (A-53 pattern, same as sync). Used ONLY as a retry after a network
 * failure — providers that send CORS headers never reach here.
 */
async function ensureAiHostAccess(originPattern: string): Promise<{ ok: boolean }> {
  try {
    if (await chrome.permissions.contains({ origins: [originPattern] })) return { ok: true };
    const granted = await chrome.permissions.request({ origins: [originPattern] });
    if (!granted) return { ok: false };
    for (let i = 0; i < 7; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        if (await chrome.permissions.contains({ origins: [originPattern] })) return { ok: true };
      } catch {
        break;
      }
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function renderAiProviderFields(providerId: AiProviderId | null, modelValue: string, customBaseUrl: string): void {
  const def = providerDef(providerId);
  const keyLabel = el("stKeyLabel");
  if (keyLabel) keyLabel.textContent = def ? `${def.label} API key (your own key)` : "API key (your own key)";
  const keyStored = providerId !== null && stAiKeysStored[providerId] === true;
  const keyInput = el<HTMLInputElement>("stCloudKey");
  if (keyInput) keyInput.placeholder = !def ? "Pick a provider first" : keyStored ? "Saved — leave blank to keep it" : `Paste your ${def.label} API key…`;
  const modelInput = el<HTMLInputElement>("stCloudModel");
  if (modelInput) {
    modelInput.value = modelValue;
    modelInput.placeholder = def ? def.defaultModel : "llama-3.3-70b-versatile";
  }
  const customRow = el("stCustomBaseRow");
  if (customRow) customRow.hidden = providerId !== "custom";
  const customInput = el<HTMLInputElement>("stCustomBaseUrl");
  if (customInput) customInput.value = providerId === "custom" ? customBaseUrl : "";
  const note = el("stProviderNote");
  if (note) {
    note.hidden = !def?.note;
    note.textContent = def?.note ?? "";
  }
  const toggleNote = el("stCloudToggleNote");
  if (toggleNote) {
    if (!def) {
      toggleNote.textContent = "Only when a provider and key are saved above.";
    } else if (def.id === "custom") {
      const checked = validateCustomBaseUrl(customBaseUrl);
      toggleNote.textContent = checked.ok
        ? `The key is sent only to ${new URL(checked.url).host}.`
        : "The key is sent only to your custom endpoint (set a valid base URL above).";
    } else {
      toggleNote.textContent = `Only when a provider and key are saved above. The key is sent only to ${def.keyHost}.`;
    }
  }
  renderAiModelPicker();
  refreshDetectButton();
  stProviderShown = providerId;
}

function renderAiModelPicker(): void {
  const provider = (el<HTMLSelectElement>("stProvider")?.value ?? "") as AiProviderId | "";
  const currentBaseUrl = (el<HTMLInputElement>("stCustomBaseUrl")?.value ?? "").trim();
  const detected = stDetectedModels;
  const matches =
    detected !== null &&
    detected.provider === provider &&
    (provider !== "custom" || detected.baseUrl === currentBaseUrl);
  const textRow = el("stModelTextRow");
  const selectRow = el("stModelSelectRow");
  const manualBtn = el("stModelManual");
  const select = el<HTMLSelectElement>("stCloudModelSelect");
  const modelInput = el<HTMLInputElement>("stCloudModel");
  if (textRow) textRow.hidden = matches;
  if (selectRow) selectRow.hidden = !matches;
  if (manualBtn) manualBtn.hidden = !matches;
  if (!matches || !select || !modelInput || !detected) return;
  const current = modelInput.value.trim();
  select.replaceChildren();
  for (const id of detected.models) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    select.appendChild(option);
  }
  const wanted = detected.models.includes(current) ? current : detected.models[0];
  select.value = wanted;
  if (modelInput.value !== wanted) modelInput.value = wanted;
}

function refreshDetectButton(): void {
  const provider = (el<HTMLSelectElement>("stProvider")?.value ?? "") as AiProviderId | "";
  const btn = el<HTMLButtonElement>("stDetectModels");
  if (!btn) return;
  const hasKey =
    provider !== "" &&
    ((el<HTMLInputElement>("stCloudKey")?.value ?? "").trim().length > 0 || stAiKeysStored[provider] === true);
  btn.disabled = provider === "" || !hasKey;
  btn.title = provider === "" ? "Pick a provider first" : hasKey ? "" : "Paste your API key first — detection needs the key";
}

function renderAiCard(): void {
  const available = cloudAvailable(stAi, aiTokensFromStored(stAiKeysStored));
  const def = providerDef(stAi.provider);
  const note = el("stCloudNote");
  if (note) {
    note.textContent = available
      ? `Cloud LLM is on (${def?.label ?? "your provider"}, your own key). Local templates still work with no network request — use either button.`
      : "Local templates need no API key and make no network request. Cloud LLM is off — turn it on above to use a provider with your own key.";
  }
  const provider = el<HTMLSelectElement>("stProvider");
  if (provider) provider.value = stAi.provider ?? "";
  renderAiProviderFields(stAi.provider, stAi.model, stAi.customBaseUrl);
  const toggle = el<HTMLInputElement>("stCloudToggle");
  if (toggle) toggle.checked = stAi.cloudEnabled === true;
  const fixNote = el("stTestFixNote");
  if (fixNote) fixNote.hidden = available;
  const fixBtn = el<HTMLButtonElement>("stTestFixAi");
  if (fixBtn && stTest && !stTest.finished) fixBtn.disabled = !available;
}

async function refreshAiState(): Promise<void> {
  try {
    const [loadedAi, loadedTokens] = await Promise.all([loadAiSettings(), loadAiTokens()]);
    stAi = loadedAi;
    stAiKeysStored = {};
    for (const def of AI_PROVIDERS) {
      stAiKeysStored[def.id] = aiKeyFor(def.id, loadedTokens).length > 0;
    }
  } catch {
    // A failed load leaves the previous render in place.
    return;
  }
  renderAiCard();
}

/** Show a draft preview (local or cloud). The draft is text only — never installed here. */
function showDraft(code: string, meta: string): void {
  stDraftCode = code;
  const box = el("stDraftBox");
  const codeEl = el("stDraftCode");
  const metaEl = el("stDraftMeta");
  const actions = el("stDraftActions");
  const chips = el("stDraftChips");
  if (codeEl) codeEl.textContent = code;
  if (metaEl) metaEl.textContent = meta;
  if (chips) {
    chips.replaceChildren();
    const parsed = parseMetadata(code);
    const chipTexts: string[] = [];
    if (parsed.name) chipTexts.push(parsed.name);
    if (parsed.version) chipTexts.push(`v${parsed.version}`);
    for (const m of parsed.matches.slice(0, 3)) chipTexts.push(m);
    for (const g of parsed.grants.slice(0, 4)) chipTexts.push(g);
    for (const text of chipTexts) {
      const chip = document.createElement("span");
      chip.className = "sched-chip";
      chip.textContent = text;
      chips.appendChild(chip);
    }
  }
  if (box) box.hidden = false;
  if (actions) actions.hidden = false;
}

function clearDraft(): void {
  stDraftCode = null;
  const box = el("stDraftBox");
  const actions = el("stDraftActions");
  if (box) box.hidden = true;
  if (actions) actions.hidden = true;
}

/** Build the cloud prompt: the template + the concrete website + tasks. */
function buildStudioPrompt(website: string, task: string): string {
  return `${stTemplate}\n\nWEBSITE: ${website}\nTASKS:\n${task}`;
}

/** Ask the cloud LLM once and return the draft code (or an honest error). Shared by Generate and Fix with AI. */
async function askCloud(prompt: string, tokens: AiTokens): Promise<{ ok: true; code: string; label: string } | { ok: false; error: string }> {
  const settings = await loadAiSettings();
  if (!cloudAvailable(settings, tokens)) {
    return { ok: false, error: "Cloud LLM is off — turn it on in LLM setup (provider + your own key) first." };
  }
  const built = buildCloudCall(settings, tokens, prompt);
  if (!built.ok) return { ok: false, error: `${built.error} Nothing was installed.` };
  const { call } = built;
  const label = call.providerLabel;
  let res: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(call.url, { method: "POST", headers: call.headers, body: JSON.stringify(call.body) });
      break;
    } catch (err) {
      lastErr = err;
      if (attempt === 0 && (await ensureAiHostAccess(call.originPattern)).ok) continue;
      break;
    }
  }
  if (!res) {
    return { ok: false, error: `Could not reach ${label} — ${lastErr instanceof Error ? lastErr.message : String(lastErr)} Nothing was installed.` };
  }
  if (!res.ok) {
    return { ok: false, error: `${label} refused the request (HTTP ${res.status}). Check your key in the cloud settings above. Nothing was installed.` };
  }
  let text = "";
  try {
    text = await res.text();
  } catch {
    return { ok: false, error: `${label} answered, but the reply could not be read. Nothing was installed.` };
  }
  const code = call.shape === "gemini" ? extractGeminiDraft(text) : extractCloudDraft(text);
  if (!code) {
    return { ok: false, error: `${label} answered, but ${describeDraftFailure(text, call.shape)}. Nothing was installed.` };
  }
  return { ok: true, code, label };
}

function renderTemplateCard(): void {
  const preview = el("stTemplatePreview");
  if (preview) {
    const firstLines = stTemplate.split("\n").slice(0, 3).join(" ");
    preview.textContent = firstLines.length > 220 ? `${firstLines.slice(0, 220)}…` : firstLines;
  }
  const edit = el<HTMLTextAreaElement>("stTemplateEdit");
  if (edit && !edit.hidden) edit.value = stTemplate;
}

async function initGenerateView(): Promise<void> {
  stTemplate = await loadStudioTemplate();
  renderTemplateCard();
  await refreshAiState();

  el("stViewGenerate")?.addEventListener("click", () => switchStudioView("generate"));
  el("stViewTest")?.addEventListener("click", () => switchStudioView("test"));
  el("stViewPublish")?.addEventListener("click", () => switchStudioView("publish"));

  // --- Template card ---
  el("stTemplateEditBtn")?.addEventListener("click", () => {
    const edit = el<HTMLTextAreaElement>("stTemplateEdit");
    const saveBtn = el("stTemplateSaveBtn");
    if (!edit || !saveBtn) return;
    const opening = edit.hidden;
    edit.hidden = !opening;
    saveBtn.hidden = !opening;
    if (opening) {
      edit.value = stTemplate;
      edit.focus();
    }
  });
  el("stTemplateSaveBtn")?.addEventListener("click", () => {
    void (async () => {
      const edit = el<HTMLTextAreaElement>("stTemplateEdit");
      if (!edit) return;
      stTemplate = sanitizeStudioTemplate(edit.value);
      await saveStudioTemplate(stTemplate);
      edit.hidden = true;
      const saveBtn = el("stTemplateSaveBtn");
      if (saveBtn) saveBtn.hidden = true;
      renderTemplateCard();
      showStatus("stTemplateStatus", "Template saved — it is used for every new draft from now on.");
    })();
  });
  el("stTemplateResetBtn")?.addEventListener("click", () => {
    void (async () => {
      stTemplate = STUDIO_DEFAULT_TEMPLATE;
      try {
        await chrome.storage.local.remove(STUDIO_TEMPLATE_KEY);
      } catch {
        // Non-fatal.
      }
      const edit = el<HTMLTextAreaElement>("stTemplateEdit");
      if (edit) {
        edit.value = stTemplate;
        edit.hidden = true;
      }
      const saveBtn = el("stTemplateSaveBtn");
      if (saveBtn) saveBtn.hidden = true;
      renderTemplateCard();
      showStatus("stTemplateStatus", "Template reset to the built-in default.");
    })();
  });

  // --- LLM setup: provider picker ---
  el("stProvider")?.addEventListener("change", () => {
    const picked = (el<HTMLSelectElement>("stProvider")?.value ?? "") as AiProviderId | "";
    const def = providerDef(picked === "" ? null : picked);
    if (picked !== "" && picked === stProviderShown) {
      renderAiProviderFields(
        picked,
        (el<HTMLInputElement>("stCloudModel")?.value ?? "").trim(),
        picked === "custom" ? (el<HTMLInputElement>("stCustomBaseUrl")?.value ?? "").trim() : "",
      );
      return;
    }
    stDetectedModels = null;
    hideStatus("stModelStatus");
    renderAiProviderFields(picked === "" ? null : picked, def ? def.defaultModel : "", picked === "custom" ? stAi.customBaseUrl : "");
  });
  el("stCloudKey")?.addEventListener("input", () => refreshDetectButton());
  el("stCloudModelSelect")?.addEventListener("change", () => {
    const select = el<HTMLSelectElement>("stCloudModelSelect");
    const modelInput = el<HTMLInputElement>("stCloudModel");
    if (select && modelInput) modelInput.value = select.value;
  });
  el("stModelManual")?.addEventListener("click", () => {
    stDetectedModels = null;
    renderAiModelPicker();
    hideStatus("stModelStatus");
    el<HTMLInputElement>("stCloudModel")?.focus();
  });
  el("stDetectModels")?.addEventListener("click", () => {
    void (async () => {
      const provider = (el<HTMLSelectElement>("stProvider")?.value ?? "") as AiProviderId | "";
      const def = providerDef(provider === "" ? null : provider);
      if (!def || provider === "") return;
      const typedKey = (el<HTMLInputElement>("stCloudKey")?.value ?? "").trim();
      let key = typedKey;
      if (!key) {
        const tokens = await loadAiTokens();
        key = aiKeyFor(provider, tokens);
      }
      if (!key) {
        showStatus("stModelStatus", "Paste your API key first — detection needs the key.");
        return;
      }
      const customBaseUrl = (el<HTMLInputElement>("stCustomBaseUrl")?.value ?? "").trim();
      const built = buildModelsCall(provider, key, customBaseUrl);
      if (!built.ok) {
        showStatus("stModelStatus", built.error);
        return;
      }
      const { call } = built;
      showStatus("stModelStatus", `Detecting models from ${call.providerLabel}…`);
      const btn = el<HTMLButtonElement>("stDetectModels");
      if (btn) btn.disabled = true;
      let res: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await fetch(call.url, { method: "GET", headers: call.headers });
          break;
        } catch {
          if (attempt === 0 && (await ensureAiHostAccess(call.originPattern)).ok) continue;
          break;
        }
      }
      refreshDetectButton();
      if (!res) {
        showStatus("stModelStatus", "models ana jayni — key ar connection check koro");
        return;
      }
      if (!res.ok) {
        showStatus("stModelStatus", modelsFetchError(res.status, call.providerLabel));
        return;
      }
      let text = "";
      try {
        text = await res.text();
      } catch {
        showStatus("stModelStatus", "models ana jayni — key ar connection check koro");
        return;
      }
      const parsed = parseModelsResponse(call.shape, text);
      const ordered = orderModels(provider, parsed.ids, def.defaultModel);
      if (ordered.models.length === 0) {
        stDetectedModels = null;
        renderAiModelPicker();
        showStatus("stModelStatus", "kono model pelam na");
        return;
      }
      stDetectedModels = { provider, baseUrl: customBaseUrl, models: ordered.models, total: ordered.total, truncated: ordered.truncated };
      renderAiModelPicker();
      showStatus(
        "stModelStatus",
        ordered.truncated
          ? `${ordered.models.length} models found — showing 100 of ${ordered.total}, type the rest manually`
          : `${ordered.models.length} models found`,
      );
    })();
  });
  // --- LLM setup: save ---
  el("stSaveCloud")?.addEventListener("click", () => {
    void (async () => {
      const picked = (el<HTMLSelectElement>("stProvider")?.value ?? "") as AiProviderId | "";
      const provider: AiProviderId | null = picked === "" ? null : picked;
      const def = providerDef(provider);
      const keyInput = (el<HTMLInputElement>("stCloudKey")?.value ?? "").trim();
      const modelInput = (el<HTMLInputElement>("stCloudModel")?.value ?? "").trim();
      const customBaseUrl = (el<HTMLInputElement>("stCustomBaseUrl")?.value ?? "").trim();
      if (provider === "custom") {
        const checked = validateCustomBaseUrl(customBaseUrl);
        if (!checked.ok) {
          showStatus("stCloudStatus", `Cloud LLM settings NOT saved — ${checked.error}`);
          return;
        }
      }
      let keyStored = provider !== null && stAiKeysStored[provider] === true;
      if (keyInput && def) {
        const current = await loadAiTokens();
        await saveAiTokens({ ...current, [aiTokenKeyFor(def.id)]: keyInput });
        keyStored = true;
        stAiKeysStored[def.id] = true;
        const input = el<HTMLInputElement>("stCloudKey");
        if (input) input.value = "";
      }
      const wantEnabled = el<HTMLInputElement>("stCloudToggle")?.checked === true;
      const settings: AiSettings = {
        cloudEnabled: wantEnabled && provider !== null && keyStored && (provider !== "custom" || validateCustomBaseUrl(customBaseUrl).ok),
        provider,
        model: modelInput || (def ? def.defaultModel : stAi.model),
        customBaseUrl: provider === "custom" ? customBaseUrl : "",
      };
      stAi = settings;
      await saveAiSettings(stAi);
      await refreshAiState();
      const label = def ? def.label : "a provider";
      if (wantEnabled && !settings.cloudEnabled) {
        showStatus(
          "stCloudStatus",
          provider === "custom" && !validateCustomBaseUrl(customBaseUrl).ok
            ? "Cloud LLM stays off — the Custom base URL is not valid. Fix it above and save again."
            : `Cloud LLM stays off — it needs a provider AND a saved key. Pick ${label} above and paste your key, then enable it.`,
        );
      } else if (settings.cloudEnabled) {
        showStatus("stCloudStatus", `Cloud LLM is ON (${label}, your own key). The key is stored in this browser only — never in backups, never logged.`);
      } else {
        showStatus("stCloudStatus", "Cloud LLM is off — local templates still work with no key and no network request.");
      }
    })();
  });

  // --- Generate: cloud (when enabled) ---
  el("stGenerate")?.addEventListener("click", () => {
    void (async () => {
      const website = (el<HTMLInputElement>("stWebsite")?.value ?? "").trim();
      const task = (el<HTMLTextAreaElement>("stTask")?.value ?? "").trim();
      if (!website) {
        showStatus("stStatus", "Paste the website link first.");
        return;
      }
      if (!task) {
        showStatus("stStatus", "Type what the script should do first.");
        return;
      }
      const tokens = await loadAiTokens();
      const settings = await loadAiSettings();
      if (cloudAvailable(settings, tokens)) {
        showStatus("stStatus", `Asking ${providerDef(settings.provider)?.shortLabel ?? "the cloud LLM"}…`);
        const result = await askCloud(buildStudioPrompt(website, task), tokens);
        if (!result.ok) {
          clearDraft();
          showStatus("stStatus", result.error);
          return;
        }
        showDraft(result.code, `Cloud draft (${result.label}) — preview only, NOT installed. Review it, then Test it or Save as script.`);
        hideStatus("stStatus");
        return;
      }
      // Cloud off: fall through to the local templates, same as the
      // old Later button did — the prompt is the task + the site.
      generateLocal(website, task);
    })();
  });
  // --- Generate: local templates (no key, no network) ---
  el("stGenerateLocal")?.addEventListener("click", () => {
    const website = (el<HTMLInputElement>("stWebsite")?.value ?? "").trim();
    const task = (el<HTMLTextAreaElement>("stTask")?.value ?? "").trim();
    if (!website) {
      showStatus("stStatus", "Paste the website link first.");
      return;
    }
    if (!task) {
      showStatus("stStatus", "Type what the script should do first.");
      return;
    }
    generateLocal(website, task);
  });
  // --- Draft actions ---
  el("stTestDraft")?.addEventListener("click", () => {
    if (!stDraftCode) return;
    switchStudioView("test");
    void startTest();
  });
  el("stCopyDraft")?.addEventListener("click", () => {
    void (async () => {
      if (!stDraftCode) return;
      const ok = await copyText(stDraftCode);
      showStatus("stStatus", ok ? "Copied — paste it in Scripts → New script, or anywhere else." : "Copy failed in this browser — select the code above and copy it by hand.");
    })();
  });
  el("stOpenEditor")?.addEventListener("click", () => {
    if (!stDraftCode || !ctx) return;
    const code = stDraftCode;
    ctx.openDraftInEditor(code);
  });
  el("stSaveScript")?.addEventListener("click", () => {
    if (!stDraftCode || !ctx) return;
    const code = stDraftCode;
    clearDraft();
    ctx.openDraftInEditor(code);
    showStatus("stStatus", "Draft loaded into the editor — scan it, then Confirm install. Nothing is installed until you confirm.");
  });
  el("stDiscardDraft")?.addEventListener("click", () => {
    clearDraft();
    hideStatus("stStatus");
  });
}

function generateLocal(website: string, task: string): void {
  const host = parseAiHost(website);
  const prompt = host ? `${task} on ${host}` : task;
  const result = generateAiDraft(prompt);
  if (result.ok) {
    showDraft(result.code, `Template: ${result.templateTitle} — preview only, NOT installed. Review it, then Test it or Save as script.`);
    hideStatus("stStatus");
  } else {
    clearDraft();
    showStatus("stStatus", `${result.error} Try one of these: ${result.suggestions.join(" · ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test — run the draft once, temporarily, on its real site
// ---------------------------------------------------------------------------

function renderTestSteps(): void {
  const box = el("stTestSteps");
  if (!box) return;
  box.replaceChildren();
  if (stTestSteps.length === 0) {
    box.textContent = stTest ? "Running — no steps reported yet. (If the draft never reports a step, the Test view shows only running / finished / error — it never claims a step passed that it did not observe.)" : "No steps reported yet.";
    return;
  }
  for (const step of stTestSteps) {
    const state = studioStepState(step.status);
    const line = document.createElement("div");
    const mark = document.createElement("span");
    mark.className = state === "ok" ? "ok" : state === "failed" ? "wr" : "tm";
    mark.textContent = state === "ok" ? "✓ " : state === "failed" ? "⚠ " : state === "waiting-wallet" ? "◌ " : "· ";
    const text = document.createElement("span");
    text.textContent = `Step ${step.step} — ${step.status}${step.detail ? ` — ${step.detail}` : ""}`;
    line.append(mark, text);
    box.append(line);
  }
}

async function renderTestHistory(): Promise<void> {
  const list = el("stTestHistory");
  const empty = el("stTestHistoryEmpty");
  if (!list) return;
  const runs = await loadStudioTests();
  list.replaceChildren();
  if (empty) empty.hidden = runs.length > 0;
  for (const run of runs.slice(0, 20)) {
    const li = document.createElement("li");
    const when = new Date(run.at);
    const hh = String(when.getHours()).padStart(2, "0");
    const mm = String(when.getMinutes()).padStart(2, "0");
    li.textContent = `${hh}:${mm} — ${run.name} on ${run.site} — ${run.result}${run.failedStep ? ` (${run.failedStep})` : ""}`;
    list.append(li);
  }
}

function setTestButtons(running: boolean): void {
  const stop = el<HTMLButtonElement>("stTestStop");
  const retest = el<HTMLButtonElement>("stTestRetest");
  const fix = el<HTMLButtonElement>("stTestFixAi");
  const edit = el<HTMLButtonElement>("stTestEditManual");
  if (stop) stop.disabled = !running;
  if (retest) retest.disabled = !stTest;
  // Fix with AI is disabled when cloud LLM is off — the honest note
  // (stTestFixNote) says why, and the click handler repeats it.
  if (fix) fix.disabled = !stTest || !cloudAvailable(stAi, aiTokensFromStored(stAiKeysStored));
  if (edit) edit.disabled = !stDraftCode;
}

function clearTestTimers(): void {
  if (stTest?.timer !== null && stTest?.timer !== undefined) window.clearInterval(stTest.timer);
  if (stTest?.pollTimer !== null && stTest?.pollTimer !== undefined) window.clearInterval(stTest.pollTimer);
  if (stTest) {
    stTest.timer = null;
    stTest.pollTimer = null;
  }
}

async function finishTest(result: string, failedStep: string): Promise<void> {
  if (!stTest) return;
  clearTestTimers();
  stTest.finished = true;
  const run: StudioTestRun = { name: stTest.name, site: stTest.site, result, failedStep, at: Date.now() };
  await recordStudioTest(run);
  const banner = el("stTestBanner");
  if (banner) {
    banner.hidden = false;
    banner.textContent =
      result === "passed"
        ? "✓ Test passed — every reported step succeeded."
        : result === "failed"
          ? `⚠ Test failed${failedStep ? ` — ${failedStep}` : ""}. Fix with AI or edit manually, then Re-test.`
          : result === "stopped"
            ? "Test stopped by you — the temporary entry is unregistered."
            : result === "timed out"
              ? "Test timed out after 3 minutes — the temporary entry is unregistered."
              : `Test finished — ${result}.`;
  }
  const elapsed = el("stTestElapsed");
  if (elapsed) elapsed.hidden = true;
  setTestButtons(false);
  const fixBtn = el<HTMLButtonElement>("stTestFixAi");
  if (fixBtn) fixBtn.disabled = false;
  await renderTestHistory();
}

async function pollTest(): Promise<void> {
  if (!stTest || stTest.finished) return;
  try {
    const res = (await chrome.runtime.sendMessage({ type: MSG_STUDIO_TEST_STEPS, tabId: stTest.tabId })) as
      | { ok?: boolean; steps?: StudioStep[]; status?: string; finished?: boolean; result?: string; failedStep?: string }
      | null;
    if (!res || res.ok !== true) return;
    const steps = Array.isArray(res.steps) ? res.steps : [];
    if (JSON.stringify(steps) !== JSON.stringify(stTestSteps)) {
      stTestSteps = steps;
      renderTestSteps();
    }
    const waiting = steps.some((s) => studioStepState(s.status) === "waiting-wallet");
    const banner = el("stTestBanner");
    if (waiting && banner) {
      banner.hidden = false;
      banner.textContent = "◌ Waiting for your Confirm in the wallet — confirm in the wallet popup yourself; the test waits and never clicks it for you.";
    }
    if (res.finished === true) {
      await finishTest(res.result ?? "finished", res.failedStep ?? "");
    }
  } catch {
    // Background unreachable — the next poll retries.
  }
}

async function startTest(): Promise<void> {
  if (!stDraftCode) {
    showStatus("stTestStatus", "Generate a draft first — there is nothing to test yet.");
    return;
  }
  if (stTest && !stTest.finished) {
    await stopTest("stopped");
  }
  const website = (el<HTMLInputElement>("stWebsite")?.value ?? "").trim();
  let url: string;
  try {
    const parsed = new URL(website);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("not http(s)");
    url = parsed.href;
  } catch {
    showStatus("stTestStatus", "The Website link is not a usable http(s) URL — paste the full link first.");
    return;
  }
  const meta = parseMetadata(stDraftCode);
  const name = meta.name ?? "Untitled draft";
  // The test needs host access for the site (A-53 pattern, same as
  // sync): ask once, on this click gesture, for exactly that
  // origin. A denial is an honest error, not a silent failure.
  try {
    const origin = new URL(url).origin;
    const pattern = `${origin}/*`;
    if (!(await chrome.permissions.contains({ origins: [pattern] }))) {
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) {
        showStatus("stTestStatus", `Site access to ${origin} was declined — the test cannot run there without that one-time grant. Click Test in extension again to retry.`);
        return;
      }
      for (let i = 0; i < 7; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        try {
          if (await chrome.permissions.contains({ origins: [pattern] })) break;
        } catch {
          break;
        }
      }
    }
  } catch (err) {
    showStatus("stTestStatus", `Could not ask for site access: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  showStatus("stTestStatus", "Starting the test — registering the draft temporarily and opening its site…");
  type StudioTestStartResult = { ok?: boolean; tabId?: number; error?: string } | null;
  let res: StudioTestStartResult = null;
  try {
    res = (await chrome.runtime.sendMessage({ type: MSG_STUDIO_TEST_START, code: stDraftCode, url })) as StudioTestStartResult;
  } catch (err) {
    showStatus("stTestStatus", `Could not start the test: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (!res || res.ok !== true || typeof res.tabId !== "number") {
    showStatus("stTestStatus", res?.error ?? "The test could not start — see the Scripts tab for the Allow User Scripts toggle and site access.");
    return;
  }
  stTestSteps = [];
  stTest = { tabId: res.tabId, name, site: url, startedAt: Date.now(), timer: null, pollTimer: null, finished: false, failedStep: "" };
  const target = el("stTestTarget");
  if (target) target.textContent = `Testing “${name}” on ${url} — temporary entry only, never installed.`;
  const banner = el("stTestBanner");
  if (banner) banner.hidden = true;
  hideStatus("stTestStatus");
  renderTestSteps();
  setTestButtons(true);
  const elapsed = el("stTestElapsed");
  if (elapsed) {
    elapsed.hidden = false;
    elapsed.textContent = "Elapsed: 0s";
  }
  stTest.timer = window.setInterval(() => {
    if (!stTest || stTest.finished) return;
    const node = el("stTestElapsed");
    if (node) node.textContent = `Elapsed: ${Math.floor((Date.now() - stTest.startedAt) / 1000)}s`;
  }, 1000);
  stTest.pollTimer = window.setInterval(() => {
    void pollTest();
  }, 1000);
  void pollTest();
}

async function stopTest(result: "stopped" | "timed out" = "stopped"): Promise<void> {
  if (!stTest) return;
  const tabId = stTest.tabId;
  try {
    await chrome.runtime.sendMessage({ type: MSG_STUDIO_TEST_STOP, tabId });
  } catch {
    // Background unreachable — the entry still unregisters on its own timeout.
  }
  await finishTest(result, "");
}

// ---------------------------------------------------------------------------
// Publish — port of tools/store-uploader.html
// ---------------------------------------------------------------------------

function readStoreConfig(): StoreConfig {
  return {
    owner: (el<HTMLInputElement>("stStoreOwner")?.value ?? "").trim() || "BidyutRoy2",
    repo: (el<HTMLInputElement>("stStoreRepo")?.value ?? "").trim() || "hiddengem-flow-store",
    branch: (el<HTMLInputElement>("stStoreBranch")?.value ?? "").trim() || "main",
    token: "",
  };
}

async function readStoreConfigWithToken(): Promise<StoreConfig> {
  const cfg = readStoreConfig();
  const typed = (el<HTMLInputElement>("stStoreToken")?.value ?? "").trim();
  cfg.token = typed || (await loadStoreToken());
  return cfg;
}

function refreshTokenStatus(): void {
  const status = el("stConnStatus");
  if (status) {
    status.textContent = stTokenStored
      ? "A token is saved in this browser only. Click Test connection to verify it."
      : "No token saved in this browser yet.";
  }
}

function logTo(logId: string, line: string): void {
  const logEl = el(logId);
  if (!logEl) return;
  logEl.hidden = false;
  logEl.textContent = `${logEl.textContent || ""}${line}\n`;
}

function readPublishFields(): StoreScriptFields {
  const matches = (el<HTMLTextAreaElement>("stPubMatches")?.value ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  return {
    name: (el<HTMLInputElement>("stPubName")?.value ?? "").trim(),
    version: (el<HTMLInputElement>("stPubVersion")?.value ?? "").trim() || "1.0.0",
    author: (el<HTMLInputElement>("stPubAuthor")?.value ?? "").trim(),
    description: (el<HTMLInputElement>("stPubDesc")?.value ?? "").trim(),
    matches,
    code: el<HTMLTextAreaElement>("stPubCode")?.value ?? "",
  };
}

/** Auto-fill Name/Version/Description/Author/@match from the code's metadata. Fields stay editable after. Pure DOM, no code execution. */
function autoFillFromCode(code: string): { filled: boolean; noMeta: boolean } {
  const meta = parseStoreMeta(code);
  let filled = false;
  const setIf = (id: string, value: string | null): void => {
    if (value === null || value === "") return;
    const input = el<HTMLInputElement>(id);
    if (input) {
      input.value = value;
      filled = true;
    }
  };
  setIf("stPubName", meta.name);
  setIf("stPubVersion", meta.version);
  setIf("stPubDesc", meta.description);
  setIf("stPubAuthor", meta.author);
  if (meta.matches.length > 0) {
    const matches = el<HTMLTextAreaElement>("stPubMatches");
    if (matches) {
      matches.value = meta.matches.join("\n");
      filled = true;
    }
  }
  return { filled, noMeta: !meta.name && !meta.version && meta.matches.length === 0 };
}

function showPubMsg(kind: "error" | "warn" | "ok", text: string): void {
  const id = kind === "error" ? "stPubError" : kind === "warn" ? "stPubWarn" : "stPubOk";
  const node = el(id);
  if (!node) return;
  if (!text) {
    node.hidden = true;
    return;
  }
  node.hidden = false;
  node.textContent = text;
}

function renderLiveList(): void {
  const list = el("stLiveList");
  const empty = el("stLiveEmpty");
  const count = el("stLiveCount");
  if (!list) return;
  const q = (el<HTMLInputElement>("stLiveSearch")?.value ?? "").trim().toLowerCase();
  list.replaceChildren();
  const shown = stLiveEntries.filter((e) => {
    if (!q) return true;
    return `${e.name} ${e.description}`.toLowerCase().includes(q);
  });
  if (count) {
    count.textContent = `${stLiveEntries.length} script(s) in the store${stLiveLoadedAt ? ` · loaded ${stLiveLoadedAt}` : ""}${q ? ` · showing ${shown.length} matching “${q}”` : ""}`;
  }
  if (empty) empty.hidden = shown.length > 0;
  if (shown.length === 0) {
    const li = document.createElement("li");
    li.textContent = stLiveEntries.length === 0 ? "The store is empty — nothing is published yet." : "No scripts match that search.";
    li.className = "hint";
    list.append(li);
    return;
  }
  for (const e of shown) {
    const li = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = `${e.name} — v${e.version}`;
    const meta = document.createElement("div");
    meta.className = "hint";
    const bits: string[] = [];
    if (e.author) bits.push(`by ${e.author}`);
    if (e.matches && e.matches.length) bits.push(`runs on ${e.matches.join(", ")}`);
    else bits.push("no @match info");
    if (e.updatedAt) bits.push(`updated ${e.updatedAt}`);
    meta.textContent = bits.join(" · ");
    const desc = document.createElement("div");
    desc.textContent = e.description || "No description in the store entry.";
    const upgradeBtn = document.createElement("button");
    upgradeBtn.type = "button";
    upgradeBtn.className = "secondary";
    upgradeBtn.textContent = "Upgrade this script…";
    upgradeBtn.addEventListener("click", () => {
      void openUpgrade(e);
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    const armed = stDeleteArmedName === e.name;
    delBtn.className = armed ? "danger-btn" : "secondary";
    delBtn.textContent = armed ? "Confirm delete — removes it from the store" : "Delete";
    delBtn.disabled = stDeleteBusy;
    delBtn.addEventListener("click", () => {
      void onDeleteClick(e);
    });
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "secondary";
    copyBtn.textContent = "Copy raw URL";
    copyBtn.disabled = !e.codeUrl;
    copyBtn.addEventListener("click", () => {
      void (async () => {
        if (!e.codeUrl) return;
        const ok = await copyText(e.codeUrl);
        showPubMsg("ok", ok ? "Raw URL copied." : "Copy failed — select the URL by hand.");
      })();
    });
    li.append(title, meta, desc, upgradeBtn, delBtn, copyBtn);
    if (armed) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "secondary";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => {
        stDeleteArmedName = null;
        showPubMsg("error", "");
        renderLiveList();
      });
      li.append(cancelBtn);
    }
    list.append(li);
  }
}

async function onDeleteClick(entry: StoreScript): Promise<void> {
  showPubMsg("error", "");
  const okNode = el("stDelOk");
  if (okNode) okNode.hidden = true;
  if (stDeleteBusy) return;
  if (stDeleteArmedName !== entry.name) {
    stDeleteArmedName = entry.name;
    renderLiveList();
    return;
  }
  await performDelete(entry);
}

async function performDelete(entry: StoreScript): Promise<void> {
  const cfg = await readStoreConfigWithToken();
  const logEl = el("stDelLog");
  if (logEl) {
    logEl.textContent = "";
    logEl.hidden = true;
  }
  if (!cfg.token) {
    stDeleteArmedName = null;
    renderLiveList();
    showPubMsg("error", "Add your token above to delete scripts from the store.");
    return;
  }
  const filename = filenameFromCodeUrlForDelete(entry.codeUrl, cfg);
  if (!filename) {
    stDeleteArmedName = null;
    renderLiveList();
    showPubMsg("error", "This script's file is not in this repo — delete it where it lives.");
    return;
  }
  const scriptPath = `scripts/${filename}`;
  stDeleteBusy = true;
  renderLiveList();
  try {
    logTo("stDelLog", `Deleting “${entry.name}” from ${cfg.owner}/${cfg.repo}@${cfg.branch}…`);
    logTo("stDelLog", "GET index.json …");
    const indexFile = await ghGetFile("index.json", cfg);
    if (!indexFile.exists || !indexFile.text) throw new Error("index.json is not in the repo.");
    const parsed = parseStoreIndexText(indexFile.text);
    if (!parsed.ok) throw new Error("The index.json in the repo is not a store index.");
    const index = parsed.index;
    if (!index.scripts.some((s) => s && s.name === entry.name)) throw new Error(`“${entry.name}” is no longer in the store index.`);
    index.scripts = index.scripts.filter((s) => !s || s.name !== entry.name);
    index.updatedAt = new Date().toISOString().slice(0, 10);
    await ghPutFile("index.json", `${JSON.stringify(index, null, 2)}\n`, `Remove ${entry.name} from store`, cfg, indexFile.sha, (line) => logTo("stDelLog", line));
    let fileGone = false;
    let fileError: string | null = null;
    try {
      logTo("stDelLog", `GET ${scriptPath} …`);
      const scriptFile = await ghGetFile(scriptPath, cfg);
      if (!scriptFile.exists || scriptFile.sha === null) {
        logTo("stDelLog", `GET ${scriptPath} … 404 (the file was already gone)`);
        fileGone = true;
      } else {
        await ghDeleteFile(scriptPath, `Remove script file: ${filename}`, cfg, scriptFile.sha, (line) => logTo("stDelLog", line));
      }
    } catch (err) {
      fileError = err instanceof Error ? err.message : String(err);
    }
    await purgeFile("index.json", cfg, (line) => logTo("stDelLog", line));
    if (!fileError && !fileGone) await purgeFile(scriptPath, cfg, (line) => logTo("stDelLog", line));
    logTo("stDelLog", "Done.");
    stDeleteArmedName = null;
    stDeleteBusy = false;
    if (stUpgradeTarget && stUpgradeTarget.entry.name === entry.name) {
      stUpgradeTarget = null;
      const card = el("stUpgradeCard");
      if (card) card.hidden = true;
    }
    stLiveEntries = stLiveEntries.filter((s) => !s || s.name !== entry.name);
    renderLiveList();
    if (fileError) {
      showPubMsg("error", `Removed “${entry.name}” from the store, but the file could not be deleted — ${fileError} You can delete ${scriptPath} manually on GitHub.`);
    } else if (fileGone) {
      const okNode = el("stDelOk");
      if (okNode) {
        okNode.hidden = false;
        okNode.textContent = `Deleted “${entry.name}” — removed from the store. Its file was already gone from scripts/.`;
      }
    } else {
      const okNode = el("stDelOk");
      if (okNode) {
        okNode.hidden = false;
        okNode.textContent = `Deleted “${entry.name}” — removed from the store and its file deleted.`;
      }
    }
  } catch (err) {
    logTo("stDelLog", `FAILED: ${err instanceof Error ? err.message : String(err)}`);
    stDeleteArmedName = null;
    stDeleteBusy = false;
    renderLiveList();
    showPubMsg("error", `${err instanceof Error ? err.message : String(err)} Nothing was deleted.`);
  }
}

async function openUpgrade(entry: StoreScript): Promise<void> {
  const errNode = el("stUpError");
  if (errNode) errNode.hidden = true;
  const okNode = el("stUpOk");
  if (okNode) okNode.hidden = true;
  const logEl = el("stUpLog");
  if (logEl) {
    logEl.textContent = "";
    logEl.hidden = true;
  }
  const cfg = await readStoreConfigWithToken();
  const filename = filenameFromCodeUrl(entry.codeUrl, entry.name);
  const scriptPath = `scripts/${filename}`;
  stUpgradeTarget = { entry, scriptPath, filename };
  const nameNode = el("stUpName");
  if (nameNode) nameNode.textContent = `${entry.name} (v${entry.version})`;
  const version = el<HTMLInputElement>("stUpVersion");
  if (version) version.value = suggestVersionBump(entry.version);
  const author = el<HTMLInputElement>("stUpAuthor");
  if (author) author.value = entry.author || "";
  const desc = el<HTMLInputElement>("stUpDesc");
  if (desc) desc.value = entry.description || "";
  const matches = el<HTMLTextAreaElement>("stUpMatches");
  if (matches) matches.value = (entry.matches || []).join("\n");
  const code = el<HTMLTextAreaElement>("stUpCode");
  if (code) code.value = "";
  const card = el("stUpgradeCard");
  if (card) {
    card.hidden = false;
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  try {
    let scriptCode: string | null = null;
    if (entry.code && entry.code.trim()) {
      scriptCode = entry.code;
      logTo("stUpLog", "Loaded the script from the index entry itself (inline code).");
    } else if (cfg.token) {
      logTo("stUpLog", `GET ${scriptPath} …`);
      const file = await ghGetFile(scriptPath, cfg);
      if (!file.exists || !file.text) throw new Error(`The script file ${scriptPath} is not in the repo any more — the index points at a missing file.`);
      scriptCode = file.text;
      logTo("stUpLog", `GET ${scriptPath} … 200`);
    } else {
      const url = rawCodeUrl(cfg.owner, cfg.repo, cfg.branch, filename);
      logTo("stUpLog", `GET ${filename} (public copy) …`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not fetch the public copy of the script (${res.status}). Add a token above to read it through the GitHub API.`);
      scriptCode = await res.text();
      logTo("stUpLog", `GET ${filename} (public copy) … 200`);
    }
    if (code && scriptCode !== null) code.value = scriptCode;
  } catch (err) {
    const node = el("stUpError");
    if (node) {
      node.hidden = false;
      node.textContent = err instanceof Error ? err.message : String(err);
    }
  }
}

async function initPublishView(): Promise<void> {
  stTokenStored = (await loadStoreToken()).length > 0;
  refreshTokenStatus();

  el("stPubViewNew")?.addEventListener("click", () => switchPublishView("new"));
  el("stPubViewLive")?.addEventListener("click", () => switchPublishView("live"));

  el("stTestConn")?.addEventListener("click", () => {
    void (async () => {
      const cfg = await readStoreConfigWithToken();
      const errNode = el("stConnError");
      const okNode = el("stConnOk");
      if (errNode) errNode.hidden = true;
      if (okNode) okNode.hidden = true;
      if (!cfg.token) {
        if (errNode) {
          errNode.hidden = false;
          errNode.textContent = "Paste a token first — Test connection needs one. (No token? Use the Download buttons in step 2 and publish by hand.)";
        }
        return;
      }
      const btn = el<HTMLButtonElement>("stTestConn");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Testing…";
      }
      try {
        const result = await testStoreConnection(cfg);
        const typed = (el<HTMLInputElement>("stStoreToken")?.value ?? "").trim();
        if (typed) {
          await saveStoreToken(typed);
          stTokenStored = true;
          const input = el<HTMLInputElement>("stStoreToken");
          if (input) input.value = "";
        }
        refreshTokenStatus();
        if (okNode) {
          okNode.hidden = false;
          okNode.textContent =
            result === "empty"
              ? `Connected — ${cfg.owner}/${cfg.repo}@${cfg.branch} exists and the token works. The repo is empty, so the first publish will create index.json. Token saved in this browser only.`
              : `Connected — ${cfg.owner}/${cfg.repo}@${cfg.branch}, token works. Token saved in this browser only (Forget token removes it).`;
        }
        const status = el("stConnStatus");
        if (status) status.textContent = `Connected: ${cfg.owner}/${cfg.repo}@${cfg.branch} (token saved in this browser).`;
      } catch (err) {
        if (errNode) {
          errNode.hidden = false;
          errNode.textContent = err instanceof Error ? err.message : String(err);
        }
        const status = el("stConnStatus");
        if (status) status.textContent = "Connection failed — nothing was published.";
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Test connection";
        }
      }
    })();
  });
  el("stForgetToken")?.addEventListener("click", () => {
    void (async () => {
      await forgetStoreToken();
      stTokenStored = false;
      const input = el<HTMLInputElement>("stStoreToken");
      if (input) input.value = "";
      const errNode = el("stConnError");
      if (errNode) errNode.hidden = true;
      const okNode = el("stConnOk");
      if (okNode) {
        okNode.hidden = false;
        okNode.textContent = "Token forgotten — removed from this browser. The page still works with the Download buttons.";
      }
      refreshTokenStatus();
    })();
  });

  // --- Auto-fill: Use generated script / file / Import / paste ---
  el("stUseDraft")?.addEventListener("click", () => {
    showPubMsg("error", "");
    showPubMsg("warn", "");
    showPubMsg("ok", "");
    if (!stDraftCode) {
      showPubMsg("error", "No draft yet — generate one in the Generate view first.");
      return;
    }
    const code = el<HTMLTextAreaElement>("stPubCode");
    if (code) code.value = stDraftCode;
    const result = autoFillFromCode(stDraftCode);
    showPubMsg("ok", result.noMeta ? "Draft loaded — no ==UserScript== block found, so the fields were left as-is. Add a name and @match lines above." : "Draft loaded — details read from the code. Check the fields above, then publish or download below.");
  });
  el("stPubFileBtn")?.addEventListener("click", () => el<HTMLInputElement>("stPubFile")?.click());
  el("stPubFile")?.addEventListener("change", () => {
    const input = el<HTMLInputElement>("stPubFile");
    const file = input?.files?.[0];
    if (input) input.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const code = el<HTMLTextAreaElement>("stPubCode");
      if (code) code.value = String(reader.result || "");
      const result = autoFillFromCode(String(reader.result || ""));
      showPubMsg("ok", result.noMeta ? `No ==UserScript== block found in “${file.name}” — the fields were left as-is.` : `Details read from the code (“${file.name}”). Check the fields above, then publish or download below.`);
    };
    reader.onerror = () => showPubMsg("error", "Could not read that file.");
    reader.readAsText(file);
  });
  el("stPubImport")?.addEventListener("click", () => {
    showPubMsg("error", "");
    showPubMsg("warn", "");
    showPubMsg("ok", "");
    const code = el<HTMLTextAreaElement>("stPubCode")?.value ?? "";
    if (!code.trim()) {
      showPubMsg("error", "Nothing to import — paste code above, or choose a file first.");
      return;
    }
    const result = autoFillFromCode(code);
    const v = validateStoreFields(readPublishFields());
    if (!v.ok) {
      showPubMsg("error", v.error ?? "Check the fields above.");
      return;
    }
    if (v.warning && v.error) showPubMsg("warn", v.error);
    showPubMsg("ok", result.noMeta ? "No ==UserScript== block found in this code — the fields were left as-is. Add a name and @match lines above." : "Details read from the code. Check the fields above, then publish or download below.");
  });
  el("stPubCode")?.addEventListener("paste", () => {
    setTimeout(() => {
      const code = el<HTMLTextAreaElement>("stPubCode")?.value ?? "";
      if (code.trim()) autoFillFromCode(code);
    }, 0);
  });

  // --- Publish (new script) ---
  el("stPublish")?.addEventListener("click", () => {
    void (async () => {
      const cfg = await readStoreConfigWithToken();
      showPubMsg("error", "");
      showPubMsg("warn", "");
      showPubMsg("ok", "");
      const logEl = el("stPubLog");
      if (logEl) {
        logEl.textContent = "";
        logEl.hidden = true;
      }
      if (!cfg.token) {
        showPubMsg("error", "Publish needs a token — paste one in section 1 and Test connection first. Or use the Download buttons below and upload the two files on github.com by hand.");
        return;
      }
      const f = readPublishFields();
      const v = validateStoreFields(f);
      if (!v.ok) {
        showPubMsg("error", v.error ?? "Check the fields above.");
        return;
      }
      if (v.warning && v.error) showPubMsg("warn", v.error);
      const btn = el<HTMLButtonElement>("stPublish");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Publishing…";
      }
      try {
        const filename = sanitizeFilename(f.name);
        const scriptPath = `scripts/${filename}`;
        const userJs = buildStoreUserJs(f);
        logTo("stPubLog", `Publishing “${f.name}” v${f.version} to ${cfg.owner}/${cfg.repo}@${cfg.branch}…`);
        logTo("stPubLog", "GET index.json …");
        const indexFile = await ghGetFile("index.json", cfg);
        let index: StoreIndex;
        let existingEntry: StoreScript | null = null;
        if (indexFile.exists && indexFile.text) {
          const parsed = parseStoreIndexText(indexFile.text);
          if (!parsed.ok) throw new Error("The index.json already in the repo is not a store index (it needs a scripts list) — fix or delete it on GitHub first. Nothing was published.");
          index = parsed.index;
          existingEntry = index.scripts.find((s) => s && s.name === f.name) ?? null;
          logTo("stPubLog", `GET index.json … 200 (${index.scripts.length} script(s) already listed)`);
        } else {
          index = { version: "1.0", updatedAt: new Date().toISOString().slice(0, 10), scripts: [] };
          logTo("stPubLog", "GET index.json … 404 (not published yet — will create it)");
        }
        const entry = buildStoreEntry(f, cfg, existingEntry);
        logTo("stPubLog", `GET ${scriptPath} …`);
        const scriptFile = await ghGetFile(scriptPath, cfg);
        logTo("stPubLog", `GET ${scriptPath} … ${scriptFile.exists ? "200 (already there — will update it)" : "404 (new file)"}`);
        await ghPutFile(scriptPath, userJs, `Publish script: ${f.name} v${f.version}`, cfg, scriptFile.exists ? scriptFile.sha : null, (line) => logTo("stPubLog", line));
        index.scripts = index.scripts.filter((s) => !s || s.name !== entry.name);
        index.scripts.push(entry);
        index.updatedAt = new Date().toISOString().slice(0, 10);
        if (!index.version) index.version = "1.0";
        await ghPutFile("index.json", `${JSON.stringify(index, null, 2)}\n`, `Publish store index: add ${f.name} v${f.version}`, cfg, indexFile.exists ? indexFile.sha : null, (line) => logTo("stPubLog", line));
        await purgeFile("index.json", cfg, (line) => logTo("stPubLog", line));
        await purgeFile(scriptPath, cfg, (line) => logTo("stPubLog", line));
        logTo("stPubLog", "Done.");
        showPubMsg("ok", `Published “${f.name}” v${f.version} — ${scriptPath} and index.json are now in ${cfg.owner}/${cfg.repo}. Check it in the extension: Script Store → Load store.`);
      } catch (err) {
        logTo("stPubLog", `FAILED: ${err instanceof Error ? err.message : String(err)}`);
        showPubMsg("error", err instanceof Error ? err.message : String(err));
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Publish to the store";
        }
      }
    })();
  });

  // --- Fallback downloads (no token needed) ---
  el("stDownloadJs")?.addEventListener("click", () => {
    const f = readPublishFields();
    const v = validateStoreFields(f);
    if (!v.ok) {
      showPubMsg("error", v.error ?? "Check the fields above.");
      return;
    }
    downloadFile(sanitizeFilename(f.name), buildStoreUserJs(f), "text/javascript");
    if (!v.warning) showPubMsg("ok", `Downloaded ${sanitizeFilename(f.name)} — upload it to scripts/ in the store repo (create the folder if needed).`);
  });
  el("stCopyEntry")?.addEventListener("click", () => {
    void (async () => {
      const f = readPublishFields();
      const v = validateStoreFields(f);
      if (!v.ok) {
        showPubMsg("error", v.error ?? "Check the fields above.");
        return;
      }
      const cfg = readStoreConfig();
      const entry = buildStoreEntry(f, cfg);
      const ok = await copyText(JSON.stringify(entry, null, 2));
      showPubMsg("ok", ok ? "Index entry copied — paste it into the scripts list in index.json." : "Copy failed in this browser — select the preview below and copy it by hand.");
    })();
  });
  el("stIndexInput")?.addEventListener("change", () => {
    const input = el<HTMLInputElement>("stIndexInput");
    const file = input?.files?.[0];
    if (input) input.value = "";
    stExistingIndex = null;
    const note = el("stIndexNote");
    if (note) note.hidden = true;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.scripts)) throw new Error("no scripts list");
        stExistingIndex = parsed as StoreIndex;
        if (note) {
          note.hidden = false;
          note.textContent = `Loaded “${file.name}” — ${parsed.scripts.length} script(s) inside. Download index.json will add this script to that list (same name replaces the old entry).`;
        }
      } catch {
        showPubMsg("error", "That file is not a store index (it needs a scripts list). A fresh index will be created instead.");
      }
    };
    reader.onerror = () => showPubMsg("error", "Could not read that file.");
    reader.readAsText(file);
  });
  el("stDownloadIndex")?.addEventListener("click", () => {
    const f = readPublishFields();
    const v = validateStoreFields(f);
    if (!v.ok) {
      showPubMsg("error", v.error ?? "Check the fields above.");
      return;
    }
    const cfg = readStoreConfig();
    const existingEntry = stExistingIndex ? stExistingIndex.scripts.find((s) => s && s.name === f.name) ?? null : null;
    const entry = buildStoreEntry(f, cfg, existingEntry);
    let index: StoreIndex;
    if (stExistingIndex) {
      const scripts = stExistingIndex.scripts.filter((s) => !s || s.name !== entry.name);
      scripts.push(entry);
      index = { version: stExistingIndex.version || "1.0", updatedAt: new Date().toISOString().slice(0, 10), scripts };
    } else {
      index = { version: "1.0", updatedAt: new Date().toISOString().slice(0, 10), scripts: [entry] };
    }
    downloadFile("index.json", `${JSON.stringify(index, null, 2)}\n`, "application/json");
    if (!v.warning) showPubMsg("ok", `Downloaded index.json with ${index.scripts.length} script(s) — upload it to the store repo root.`);
  });

  // --- Live Scripts ---
  el("stLiveLoad")?.addEventListener("click", () => {
    void (async () => {
      const cfg = await readStoreConfigWithToken();
      const errNode = el("stLiveError");
      if (errNode) errNode.hidden = true;
      const btn = el<HTMLButtonElement>("stLiveLoad");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Loading…";
      }
      try {
        const { index, via } = await loadLiveStoreIndex(cfg);
        stLiveEntries = index.scripts;
        stLiveLoadedAt = new Date().toLocaleString();
        renderLiveList();
        const count = el("stLiveCount");
        if (count && via !== "api") count.textContent += ` · via ${via} (public copy)`;
      } catch (err) {
        if (errNode) {
          errNode.hidden = false;
          errNode.textContent = err instanceof Error ? err.message : String(err);
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Load live scripts";
        }
      }
    })();
  });
  el("stLiveSearch")?.addEventListener("input", () => renderLiveList());

  // --- Upgrade ---
  el("stCancelUpgrade")?.addEventListener("click", () => {
    stUpgradeTarget = null;
    const card = el("stUpgradeCard");
    if (card) card.hidden = true;
    const errNode = el("stUpError");
    if (errNode) errNode.hidden = true;
    const okNode = el("stUpOk");
    if (okNode) okNode.hidden = true;
  });
  el("stPublishUpgrade")?.addEventListener("click", () => {
    void (async () => {
      if (!stUpgradeTarget) return;
      const cfg = await readStoreConfigWithToken();
      const errNode = el("stUpError");
      const okNode = el("stUpOk");
      if (errNode) errNode.hidden = true;
      if (okNode) okNode.hidden = true;
      const logEl = el("stUpLog");
      if (logEl) {
        logEl.textContent = "";
        logEl.hidden = true;
      }
      if (!cfg.token) {
        if (errNode) {
          errNode.hidden = false;
          errNode.textContent = "Publishing an upgrade needs a token — paste one in section 1 and Test connection first.";
        }
        return;
      }
      const version = (el<HTMLInputElement>("stUpVersion")?.value ?? "").trim() || stUpgradeTarget.entry.version;
      const f: StoreScriptFields = {
        name: stUpgradeTarget.entry.name,
        version,
        author: (el<HTMLInputElement>("stUpAuthor")?.value ?? "").trim(),
        description: (el<HTMLInputElement>("stUpDesc")?.value ?? "").trim(),
        matches: (el<HTMLTextAreaElement>("stUpMatches")?.value ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
        code: el<HTMLTextAreaElement>("stUpCode")?.value ?? "",
      };
      if (!f.code.trim()) {
        if (errNode) {
          errNode.hidden = false;
          errNode.textContent = "There is no script source — the upgrade has nothing to publish.";
        }
        return;
      }
      if (f.matches.length === 0) {
        if (errNode) {
          errNode.hidden = false;
          errNode.textContent = "No @match lines — this script would run nowhere. Add the sites it runs on first.";
        }
        return;
      }
      const btn = el<HTMLButtonElement>("stPublishUpgrade");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Publishing…";
      }
      try {
        const entry = buildStoreEntry(f, cfg, stUpgradeTarget.entry);
        const userJs = buildStoreUserJs(f);
        logTo("stUpLog", `Publishing upgrade “${f.name}” v${stUpgradeTarget.entry.version} → v${version}…`);
        logTo("stUpLog", `GET ${stUpgradeTarget.scriptPath} …`);
        const scriptFile = await ghGetFile(stUpgradeTarget.scriptPath, cfg);
        logTo("stUpLog", `GET ${stUpgradeTarget.scriptPath} … ${scriptFile.exists ? "200" : "404 (the file is gone — will create it)"}`);
        await ghPutFile(stUpgradeTarget.scriptPath, userJs, `Upgrade script: ${f.name} v${version}`, cfg, scriptFile.exists ? scriptFile.sha : null, (line) => logTo("stUpLog", line));
        logTo("stUpLog", "GET index.json …");
        const indexFile = await ghGetFile("index.json", cfg);
        if (!indexFile.exists || !indexFile.text) throw new Error("index.json disappeared from the repo while publishing — reload the Live Scripts list and try again.");
        const parsed = parseStoreIndexText(indexFile.text);
        if (!parsed.ok) throw new Error("The index.json in the repo is no longer a store index — fix it on GitHub first. The script file was already uploaded.");
        const index = parsed.index;
        index.scripts = index.scripts.filter((s) => !s || s.name !== entry.name);
        index.scripts.push(entry);
        index.updatedAt = new Date().toISOString().slice(0, 10);
        await ghPutFile("index.json", `${JSON.stringify(index, null, 2)}\n`, `Upgrade store index: ${f.name} v${version}`, cfg, indexFile.sha, (line) => logTo("stUpLog", line));
        await purgeFile("index.json", cfg, (line) => logTo("stUpLog", line));
        await purgeFile(stUpgradeTarget.scriptPath, cfg, (line) => logTo("stUpLog", line));
        logTo("stUpLog", "Done.");
        if (okNode) {
          okNode.hidden = false;
          okNode.textContent = `Published the upgrade — “${f.name}” is now v${version}. Check it in the extension: Script Store → Load store.`;
        }
        stLiveEntries = stLiveEntries.filter((s) => !s || s.name !== entry.name);
        stLiveEntries.push(entry);
        renderLiveList();
      } catch (err) {
        logTo("stUpLog", `FAILED: ${err instanceof Error ? err.message : String(err)}`);
        if (errNode) {
          errNode.hidden = false;
          errNode.textContent = err instanceof Error ? err.message : String(err);
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Publish upgrade";
        }
      }
    })();
  });

  // --- Test view buttons ---
  el("stTestStop")?.addEventListener("click", () => {
    void stopTest("stopped");
  });
  el("stTestRetest")?.addEventListener("click", () => {
    void startTest();
  });
  el("stTestFixAi")?.addEventListener("click", () => {
    void (async () => {
      if (!stDraftCode) return;
      const tokens = await loadAiTokens();
      const settings = await loadAiSettings();
      if (!cloudAvailable(settings, tokens)) {
        showStatus("stTestStatus", "Fix with AI needs cloud LLM — turn it on in LLM setup, or fix manually.");
        return;
      }
      const failed = stTestSteps.filter((s) => studioStepState(s.status) === "failed");
      const failedText = failed.length > 0 ? failed.map((s) => `Step ${s.step} failed: ${s.detail}`).join("\n") : "The test did not pass.";
      const prompt = `Fix this userscript. Keep everything else the same — only fix what the test result below says is broken. Output ONLY the complete fixed userscript code, starting with the // ==UserScript== metadata block, no explanation, no markdown fences.\n\nDRAFT:\n${stDraftCode}\n\nTEST RESULT:\n${failedText}`;
      showStatus("stTestStatus", `Asking ${providerDef(settings.provider)?.shortLabel ?? "the cloud LLM"} to fix the draft…`);
      const result = await askCloud(prompt, tokens);
      if (!result.ok) {
        showStatus("stTestStatus", result.error);
        return;
      }
      showDraft(result.code, `Fixed draft (${result.label}) — preview only, NOT installed. Review it, then Test it again.`);
      hideStatus("stTestStatus");
      switchStudioView("generate");
    })();
  });
  el("stTestEditManual")?.addEventListener("click", () => {
    if (!stDraftCode || !ctx) return;
    ctx.openDraftInEditor(stDraftCode);
  });
}

// ---------------------------------------------------------------------------
// Init — called once, owner build only, from dashboard/main.ts
// ---------------------------------------------------------------------------

/** Create the Studio tab + panel and wire all three views. Owner build only. */
export async function initStudio(context: StudioContext): Promise<void> {
  ctx = context;
  context.addTab("studio");
  // Tab button, after Script Store.
  const tabsNav = document.querySelector<HTMLElement>(".tabs");
  const storeTab = document.querySelector<HTMLElement>('.tab[data-tab="store"]');
  const tabBtn = document.createElement("button");
  tabBtn.className = "tab";
  tabBtn.dataset.tab = "studio";
  tabBtn.setAttribute("role", "tab");
  tabBtn.setAttribute("aria-selected", "false");
  tabBtn.textContent = "Script Studio ";
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = "Owner only";
  tabBtn.append(badge);
  tabBtn.addEventListener("click", () => {
    context.selectTab("studio");
    try {
      history.replaceState(null, "", "#studio");
    } catch {
      // Non-fatal.
    }
  });
  if (storeTab && storeTab.parentNode) {
    storeTab.parentNode.insertBefore(tabBtn, storeTab.nextSibling);
  } else if (tabsNav) {
    tabsNav.append(tabBtn);
  }
  // Panel.
  const main = document.querySelector<HTMLElement>("main");
  if (main) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = STUDIO_PANEL_HTML;
    const panel = wrapper.firstElementChild;
    if (panel) main.append(panel);
  }
  // Register the tab-switch refresh (test history + AI state).
  context.registerOnSelect(() => {
    void renderTestHistory();
    void refreshAiState();
  });
  // Settings storage-keys list: the static HTML names the AI keys
  // "(AI authoring)" so the public build contains no Studio strings
  // at all. In the owner build they live in the Studio, and the three
  // Studio keys exist only here — relabel + append at runtime.
  const keyAi = document.getElementById("keyAi");
  if (keyAi && keyAi.textContent) keyAi.textContent = keyAi.textContent.replace("(AI authoring)", "(Script Studio)");
  const keyAiTokens = document.getElementById("keyAiTokens");
  if (keyAiTokens && keyAiTokens.textContent) keyAiTokens.textContent = keyAiTokens.textContent.replace("(AI authoring)", "(Script Studio)");
  if (keyAiTokens) {
    keyAiTokens.insertAdjacentHTML(
      "afterend",
      `<li><code>hiddengemflow.studio.template.v1</code> — the Script Studio master prompt template, when edited (absent = the built-in default)</li>` +
        `<li><code>hiddengemflow.store.token.v1</code> — the Official Store token (GitHub fine-grained PAT) — NEVER in backups, NEVER in logs, sent only to api.github.com (Script Studio)</li>` +
        `<li><code>hiddengemflow.studio.tests.v1</code> — the last 20 Script Studio test runs — local working state, NOT backed up</li>`,
    );
  }
  await initGenerateView();
  await initPublishView();
  await renderTestHistory();
  if (location.hash.replace(/^#/, "") === "studio") {
    context.selectTab("studio");
  }
}
