// HiddenGem Flow — Script Manager shared module (Phase 3).
//
// Split in two halves on purpose (same pattern as shared/tasks.ts):
//  * PURE half (everything up to the "Storage" section): no `chrome`
//    APIs, no DOM, no Date.now() hidden inside the logic — all inputs are
//    parameters. Unit-testable in plain Node (see the /tmp smoke test).
//  * Storage half: thin wrappers around chrome.storage.local. Only the
//    dashboard, floating window and background import these.
//
// Honest limits of this module (also stated in the UI + README):
//  * parseMetadata / securityScan are heuristics over the source text.
//    The scanner strips comments and string literals before matching, so
//    an `eval(` inside a string is not flagged — but obfuscated code can
//    still slip past it. The scan is a warning, never a block and never
//    proof a script is safe.
//  * GM values (GM_setValue / GM_getValue) live in the page origin's
//    localStorage, namespaced per script (see engine.ts). The page's own
//    JavaScript can read those keys — never store secrets with GM_*.
//  * Only four GM functions exist: GM_setValue, GM_getValue,
//    GM_notification, GM_addStyle. Anything else a script asks for is
//    flagged by the scanner and listed as NOT supported in the UI.

export interface ScriptHistoryEntry {
  version: string;
  code: string;
  savedAt: number;
}

export type ScriptSource = "manual" | "import" | "store";

export interface Script {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string | null;
  namespace: string | null;
  matches: string[];
  grants: string[];
  code: string;
  enabled: boolean;
  source: ScriptSource;
  updateURL?: string;
  downloadURL?: string;
  autoUpgrade: boolean;
  installedAt: number;
  updatedAt: number;
  history: ScriptHistoryEntry[];
}

export interface ScriptMetadata {
  name: string | null;
  version: string | null;
  description: string | null;
  author: string | null;
  namespace: string | null;
  matches: string[];
  grants: string[];
  updateURL: string | null;
  downloadURL: string | null;
}

export interface ScanFinding {
  severity: "high" | "medium" | "low";
  rule: string;
  message: string;
}

export interface ScanReport {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  findings: ScanFinding[];
}

export const SCRIPTS_KEY = "hiddengemflow.scripts.v1";
export const SCRIPT_ERRORS_KEY = "hiddengemflow.scripts.errors.v1";

/** Message types the background service worker understands (Phase 3). */
export const MSG_SCRIPTS_STATUS = "hiddengemflow:scripts-status";
export const MSG_TOGGLE_SCRIPT = "hiddengemflow:toggle-script";
export const MSG_GM_NOTIFY = "hiddengemflow:gm-notify";
/**
 * Unreleased: ask the background to open this extension's Details page
 * (chrome://extensions/?id=...) so the user can flip "Allow User
 * Scripts" there. The extension cannot flip that toggle itself — there
 * is no API for it — this message only opens the page.
 */
export const MSG_OPEN_EXTENSION_DETAILS = "hiddengemflow:open-extension-details";

/** GM functions this extension actually implements (see engine.ts). */
export const SUPPORTED_GRANTS = ["GM_setValue", "GM_getValue", "GM_notification", "GM_addStyle"];

/** GM functions scripts may ask for that are NOT implemented. */
export const UNSUPPORTED_GRANTS_NOTE =
  "Not supported: GM_xmlhttpRequest, GM_openInTab, GM_download, GM_setClipboard, unsafeWindow and every other GM_* function.";

export const ALLOW_USER_SCRIPTS_STEPS =
  "chrome://extensions → HiddenGem Flow → Details → Allow User Scripts (toggle ON), then reload the page.";

export const HISTORY_LIMIT = 10;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function newId(prefix: string): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return `${prefix}-${c.randomUUID()}`;
  } catch {
    // Fall through to the timestamp fallback.
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * File extensions that are definitely NOT JavaScript. A file with one
 * of these can be picked and inspected, but it cannot run as a
 * userscript in a browser page — only JavaScript runs there. Returns
 * the lowercase extension (without the dot), or null when the name has
 * no extension or a JavaScript-ish one (.js, .user.js, .txt, .mjs,
 * or no extension at all). Pure — the caller shows the warning.
 */
const NON_JS_EXTENSIONS = new Set([
  "py", "pyw", "rb", "php", "java", "go", "rs", "sh", "bash", "zsh", "pl", "pm",
  "lua", "c", "h", "cpp", "hpp", "cs", "swift", "kt", "kts", "scala", "ts", "tsx",
  "ps1", "bat", "cmd", "sql", "html", "css", "xml", "json", "md", "yaml", "yml", "toml",
]);

export function nonJsExtension(filename: string): string | null {
  const base = String(filename ?? "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return NON_JS_EXTENSIONS.has(ext) ? ext : null;
}

/** File base name without its last extension ("my-script.txt" → "my-script"). */
export function fileBaseName(filename: string): string {
  const base = String(filename ?? "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return base || "script";
  return base.slice(0, dot) || "script";
}

const EMPTY_METADATA: ScriptMetadata = {
  name: null,
  version: null,
  description: null,
  author: null,
  namespace: null,
  matches: [],
  grants: [],
  updateURL: null,
  downloadURL: null,
};

/**
 * Parse the `// ==UserScript== ... // ==/UserScript==` metadata block.
 * Never throws: garbage input returns nulls / empty lists. When the
 * block is absent, every field is null/empty. @match and @include are
 * both collected as match patterns; every other key keeps its first
 * occurrence, except @match/@include/@grant which keep all of them.
 */
export function parseMetadata(code: string): ScriptMetadata {
  const meta: ScriptMetadata = {
    ...EMPTY_METADATA,
    matches: [],
    grants: [],
  };
  if (typeof code !== "string" || !code) return meta;
  let block: string | null = null;
  try {
    const m = code.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
    block = m ? m[1] : null;
  } catch {
    return meta;
  }
  if (!block) return meta;
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    const m = line.match(/^\/\/\s*@([A-Za-z]+)\s+(.+?)\s*$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (!value) continue;
    switch (key) {
      case "name":
        if (meta.name === null) meta.name = value;
        break;
      case "version":
        if (meta.version === null) meta.version = value;
        break;
      case "description":
        if (meta.description === null) meta.description = value;
        break;
      case "author":
        if (meta.author === null) meta.author = value;
        break;
      case "namespace":
        if (meta.namespace === null) meta.namespace = value;
        break;
      case "match":
      case "include":
        meta.matches.push(value);
        break;
      case "grant":
        meta.grants.push(value);
        break;
      case "updateurl":
        if (meta.updateURL === null) meta.updateURL = value;
        break;
      case "downloadurl":
        if (meta.downloadURL === null) meta.downloadURL = value;
        break;
      default:
        break;
    }
  }
  return meta;
}

/**
 * Convert one userscript @match pattern to a RegExp.
 * Supported: scheme `*` (http or https), `http`, `https`; host `*`
 * (any host), `*.example.com` (the domain and any of its subdomains —
 * deliberately lenient vs Chrome's exact rule, documented in the UI),
 * or an exact host; path with `*` wildcards. Also accepts the bare
 * `*` and `<all_urls>` patterns (match any http(s) URL).
 * Returns null for a pattern that cannot be understood.
 */
export function matchPatternToRegExp(pattern: string): RegExp | null {
  const p = (pattern ?? "").trim();
  if (!p) return null;
  if (p === "*" || p === "<all_urls>") return /^https?:\/\/[^/]+(?:\/.*)?$/i;
  const m = p.match(/^(\*|https?):\/\/([^/]+)(\/.*)?$/i);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const host = m[2];
  const path = m[3] ?? "/*";
  if (!host) return null;

  const schemeRe = scheme === "*" ? "https?" : scheme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let hostRe: string;
  if (host === "*") {
    hostRe = "[^/]+";
  } else if (host.startsWith("*.")) {
    const rest = host.slice(2).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Lenient: bare domain AND any subdomain depth.
    hostRe = `(?:[^/.]+\\.)*${rest}`;
  } else {
    hostRe = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  const pathRe = path
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  try {
    return new RegExp(`^${schemeRe}:\\/\\/${hostRe}${pathRe}$`, "i");
  } catch {
    return null;
  }
}

/** True when `url` matches at least one of the @match-style patterns. */
export function urlMatches(url: string, matches: string[]): boolean {
  if (typeof url !== "string" || !url || !Array.isArray(matches)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  for (const pattern of matches) {
    const re = matchPatternToRegExp(pattern);
    if (re && re.test(url)) return true;
  }
  return false;
}

/** Strip // and block comments plus string literals (', ", `) from code. */
function stripCommentsAndStrings(code: string): string {
  let out = "";
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];
    if (ch === "/" && next === "/") {
      while (i < n && code[i] !== "\n") i++;
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i++;
      while (i < n) {
        if (code[i] === "\\") {
          i += 2;
          continue;
        }
        if (code[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      out += " ";
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function countMatches(haystack: string, re: RegExp): number {
  const m = haystack.match(re);
  return m ? m.length : 0;
}

/**
 * Heuristic security scan of a userscript.
 * Score starts at 100: high −25, medium −12, low −4, floored at 0.
 * Grade: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, else F.
 * Never throws; an empty code string scores 100 with a low note.
 * Order of findings is stable (rule order below), not source order.
 */
export function securityScan(code: string, metadata?: ScriptMetadata | null): ScanReport {
  const findings: ScanFinding[] = [];
  const src = typeof code === "string" ? code : "";
  const clean = stripCommentsAndStrings(src);
  const meta = metadata ?? parseMetadata(src);

  // --- high severity ---
  let n = countMatches(clean, /\beval\s*\(/g);
  if (n > 0) findings.push({ severity: "high", rule: "eval", message: `Uses eval() (${n}×) — runs a string as code; a compromised string runs anything.` });
  n = countMatches(clean, /\bnew\s+Function\s*\(/g);
  if (n > 0) findings.push({ severity: "high", rule: "new-Function", message: `Uses new Function() (${n}×) — same risk as eval().` });
  n = countMatches(clean, /\bGM_xmlhttpRequest\s*\(/g);
  if (n > 0)
    findings.push({
      severity: "high",
      rule: "GM_xmlhttpRequest",
      message: `Calls GM_xmlhttpRequest (${n}×) — cross-origin requests that bypass the page's CORS rules. Not supported by HiddenGem Flow, so the call will fail — but it shows the script expects that power.`,
    });
  n = countMatches(clean, /\bdocument\.cookie\b/g);
  if (n > 0) findings.push({ severity: "high", rule: "document.cookie", message: `Reads/writes document.cookie (${n}×) — can steal session cookies.` });
  if (clean.includes("unsafeWindow")) {
    findings.push({ severity: "high", rule: "unsafeWindow", message: "Uses unsafeWindow — direct access to the page's JavaScript context. Not supported by HiddenGem Flow." });
  }
  if (meta.grants.some((g) => g.trim() === "*")) {
    findings.push({ severity: "high", rule: "grant-*", message: "Declares @grant * — asks for every GM power at once, including unsafeWindow." });
  }

  // --- medium severity ---
  n = countMatches(clean, /\.innerHTML\s*=/g);
  if (n > 0) findings.push({ severity: "medium", rule: "innerHTML", message: `Assigns .innerHTML (${n}×) — can inject HTML; a script that builds HTML from page data can run injected markup.` });
  n = countMatches(clean, /\bdocument\.write\s*\(/g);
  if (n > 0) findings.push({ severity: "medium", rule: "document.write", message: `Uses document.write() (${n}×) — writes raw HTML into the page.` });
  n = countMatches(clean, /\bfetch\s*\(/g);
  if (n > 0) findings.push({ severity: "medium", rule: "fetch", message: `Uses fetch() (${n}×) — sends data to / receives data from a network host. Check the URLs it contacts.` });
  n = countMatches(clean, /\bnew\s+XMLHttpRequest\s*\(/g);
  if (n > 0) findings.push({ severity: "medium", rule: "XMLHttpRequest", message: `Uses XMLHttpRequest (${n}×) — network request to a host. Check the URLs it contacts.` });
  n = countMatches(clean, /\bnew\s+WebSocket\s*\(/g);
  if (n > 0) findings.push({ severity: "medium", rule: "WebSocket", message: `Opens a WebSocket (${n}×) — a live channel to an external host.` });
  n = countMatches(clean, /\blocalStorage\b/g);
  if (n > 0) findings.push({ severity: "medium", rule: "localStorage", message: `Touches localStorage (${n}×) — page-visible storage; anything saved here can be read by the page's own scripts.` });
  n = countMatches(clean, /\bsessionStorage\b/g);
  if (n > 0) findings.push({ severity: "medium", rule: "sessionStorage", message: `Touches sessionStorage (${n}×) — page-visible storage for this tab.` });

  // Unsupported GM_* calls (anything not in the supported four).
  const gmCalls = new Set<string>();
  for (const m of clean.matchAll(/\b(GM_[A-Za-z]+)\s*\(/g)) gmCalls.add(m[1]);
  for (const fn of [...gmCalls].sort()) {
    if (fn === "GM_xmlhttpRequest") continue; // already high above
    if (!SUPPORTED_GRANTS.includes(fn)) {
      findings.push({
        severity: "medium",
        rule: `unsupported-${fn}`,
        message: `${fn}() is called but not implemented by HiddenGem Flow — the call will do nothing. See the supported list in the Scripts tab.`,
      });
    }
  }

  // --- low severity (informational) ---
  n = countMatches(clean, /\bGM_setValue\s*\(/g) + countMatches(clean, /\bGM_getValue\s*\(/g);
  if (n > 0)
    findings.push({
      severity: "low",
      rule: "GM-storage",
      message: `Uses GM_setValue/GM_getValue (${n}×). Values are stored in the page origin's localStorage, namespaced per script — the page can read them, so don't store secrets.`,
    });

  let score = 100;
  for (const f of findings) {
    if (f.severity === "high") score -= 25;
    else if (f.severity === "medium") score -= 12;
    else score -= 4;
  }
  score = Math.max(0, score);
  const grade: ScanReport["grade"] = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { score, grade, findings };
}

/** Compare two version strings numerically per segment. -1 / 0 / 1. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a ?? "").split(".");
  const pb = String(b ?? "").split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10);
    const nb = Number.parseInt(pb[i] ?? "0", 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const sa = pa[i] ?? "";
      const sb = pb[i] ?? "";
      if (sa < sb) return -1;
      if (sa > sb) return 1;
      continue;
    }
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

/** Added + removed line count between two code versions (simple multiset diff). */
export function countLinesChanged(oldCode: string, newCode: string): number {
  const count = (code: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (const line of String(code ?? "").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      map.set(trimmed, (map.get(trimmed) ?? 0) + 1);
    }
    return map;
  };
  const oldMap = count(oldCode);
  const newMap = count(newCode);
  let changed = 0;
  for (const [line, c] of oldMap) {
    const d = c - (newMap.get(line) ?? 0);
    if (d > 0) changed += d;
  }
  for (const [line, c] of newMap) {
    const d = c - (oldMap.get(line) ?? 0);
    if (d > 0) changed += d;
  }
  return changed;
}

/**
 * Push the script's CURRENT code/version onto its history, keeping the
 * last 10 entries. Returns a new script object; the input is untouched.
 */
export function pushHistory(script: Script, now: number = Date.now()): Script {
  const entry: ScriptHistoryEntry = { version: script.version, code: script.code, savedAt: now };
  const history = [entry, ...script.history].slice(0, HISTORY_LIMIT);
  return { ...script, history };
}

/**
 * Roll back a script to history[index]: the current code is first saved
 * into history (so the rollback itself is undoable), then code + version
 * are taken from the chosen entry and updatedAt is stamped. The old
 * history entries are kept. Throws when the index is out of range.
 * Returns a new script object.
 */
export function rollbackTo(script: Script, index: number, now: number = Date.now()): Script {
  const entry = script.history[index];
  if (!entry) throw new Error("That version is not in this script's history.");
  const withCurrent = pushHistory(script, now);
  return { ...withCurrent, code: entry.code, version: entry.version, updatedAt: now };
}

/**
 * Build a Script record from raw code. Metadata supplies name/version/
 * matches/grants/update URLs when present; the fallbacks are an
 * "Untitled script" name (or `fallbackName` — e.g. the file's base
 * name when a .txt / .js file was imported without an @name line),
 * version "1.0", and NO @match patterns (a script with no @match runs
 * nowhere — the UI says so plainly, and the engine refuses to register
 * it). Throws when the code is empty. `now` and `id` are parameters
 * so tests can pin them.
 */
export function createScript(
  code: string,
  source: ScriptSource,
  now: number = Date.now(),
  id: string = newId("script"),
  fallbackName?: string,
): Script {
  if (typeof code !== "string" || !code.trim()) throw new Error("Script code is empty.");
  const meta = parseMetadata(code);
  const suggested = typeof fallbackName === "string" && fallbackName.trim() ? fallbackName.trim() : null;
  return {
    id,
    name: meta.name ?? suggested ?? "Untitled script",
    version: meta.version ?? "1.0",
    description: meta.description ?? "",
    author: meta.author,
    namespace: meta.namespace,
    matches: meta.matches,
    grants: meta.grants,
    code,
    enabled: true,
    source,
    ...(meta.updateURL ? { updateURL: meta.updateURL } : {}),
    ...(meta.downloadURL ? { downloadURL: meta.downloadURL } : {}),
    autoUpgrade: false,
    installedAt: now,
    updatedAt: now,
    history: [],
  };
}

/**
 * Replace a script's code (edit save / version upgrade). The current
 * code is pushed to history first, the version is re-read from the new
 * code's metadata (kept when the new code has no @version), and
 * updatedAt is stamped. Returns a new array; unknown id → unchanged.
 */
export function updateScriptCode(scripts: Script[], id: string, newCode: string, now: number = Date.now()): Script[] {
  if (typeof newCode !== "string" || !newCode.trim()) throw new Error("Script code is empty.");
  const meta = parseMetadata(newCode);
  return scripts.map((s) => {
    if (s.id !== id) return s;
    const withHistory = pushHistory(s, now);
    return {
      ...withHistory,
      code: newCode,
      version: meta.version ?? s.version,
      description: meta.description ?? s.description,
      author: meta.author ?? s.author,
      namespace: meta.namespace ?? s.namespace,
      matches: meta.matches.length > 0 ? meta.matches : s.matches,
      grants: meta.grants,
      ...(meta.updateURL ? { updateURL: meta.updateURL } : s.updateURL ? { updateURL: s.updateURL } : {}),
      ...(meta.downloadURL ? { downloadURL: meta.downloadURL } : s.downloadURL ? { downloadURL: s.downloadURL } : {}),
      updatedAt: now,
    };
  });
}

/** Toggle a script's enabled flag. Returns a new array. */
export function toggleScriptEnabled(scripts: Script[], id: string): Script[] {
  return scripts.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
}

/** Remove a script by id. Returns a new array. */
export function deleteScript(scripts: Script[], id: string): Script[] {
  return scripts.filter((s) => s.id !== id);
}

/** Scripts whose @match patterns match `url`. */
export function scriptsForUrl(scripts: Script[], url: string): Script[] {
  return scripts.filter((s) => urlMatches(url, s.matches));
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

function isScript(raw: unknown): raw is Script {
  return (
    !!raw &&
    typeof (raw as Script).id === "string" &&
    typeof (raw as Script).name === "string" &&
    typeof (raw as Script).code === "string" &&
    Array.isArray((raw as Script).matches) &&
    Array.isArray((raw as Script).history)
  );
}

/** Load all installed scripts; [] when nothing is saved or storage is unavailable. */
export async function loadScripts(): Promise<Script[]> {
  if (!storageAvailable()) return [];
  try {
    const data = await chrome.storage.local.get(SCRIPTS_KEY);
    const raw = data?.[SCRIPTS_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.filter(isScript);
  } catch {
    return [];
  }
}

/** Persist the whole script list (replaces the stored value). */
export async function saveScripts(scripts: Script[]): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [SCRIPTS_KEY]: scripts });
}

/** Map of scriptId → registration error message, from the last register attempt. */
export async function loadScriptErrors(): Promise<Record<string, string>> {
  if (!storageAvailable()) return {};
  try {
    const data = await chrome.storage.local.get(SCRIPT_ERRORS_KEY);
    const raw = data?.[SCRIPT_ERRORS_KEY];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveScriptErrors(errors: Record<string, string>): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [SCRIPT_ERRORS_KEY]: errors });
}

export async function setScriptError(id: string, message: string): Promise<void> {
  const errors = await loadScriptErrors();
  errors[id] = message;
  await saveScriptErrors(errors);
}

export async function clearScriptError(id: string): Promise<void> {
  const errors = await loadScriptErrors();
  delete errors[id];
  await saveScriptErrors(errors);
}
