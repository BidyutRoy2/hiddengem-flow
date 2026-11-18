// HiddenGem Flow — built-in editor helpers (v1.3, #3) + install-from-URL (v1.3, #7).
//
// EDITOR: the dashboard editor is a plain <textarea> (no Monaco /
// CodeMirror dependency — both would need a network install and a
// large bundle for a manager that must build offline). What this
// module provides instead, honestly:
//  * lintEditor(code) — bracket mismatch ((), [], {} outside
//    comments/strings), bad @match patterns, missing metadata block,
//    @grant lines asking for functions this extension does not
//    implement, and a script with no @match at all. Pure, no throws.
//  * highlightEditor(code) — the same code as escaped HTML with
//    spans for comments, keywords, strings, numbers and GM calls, so
//    the dashboard can show a read-only highlighted preview under
//    the textarea. Every value is escaped first; the preview never
//    executes anything.
//  * parseEditorMetadata — the metadata block extended for v1.3:
//    @require, @run-at, @connect join the @name/@match/@grant/
//    @updateURL lines parseMetadata already reads.
//  * newScriptTemplate(url) — "New script from current page": a
//    starter script whose @match is prefilled from the active tab's
//    URL (origin + path + *). A non-http(s) URL yields the bare
//    template with a placeholder @match.
//
// INSTALL FROM URL: paste a .user.js URL → fetch ON USER CLICK ONLY
// (the dashboard calls fetchInstallUrl only from the Fetch button) →
// preview card (name, version, @match, size) + security scan score →
// Confirm Install. NEVER auto-install: the preview is data only; the
// script is installed only when the user clicks Confirm Install.
// Validation before any parse: the fetched text must contain a
// ==UserScript== block and must look like JavaScript (rejects HTML
// error pages and non-userscript files); oversized files (> 2 MB)
// are refused. The fetch itself is the caller's (dashboard) — this
// module only validates + previews, so the pure half stays testable.

import { matchPatternToRegExp, parseMetadata, securityScan, type ScanReport, type ScriptMetadata } from "./scripts";

export type EditorMetadata = ScriptMetadata;

/** Valid @run-at values (Chrome userScripts runAt). Anything else is a lint warning, not an error. */
export const VALID_RUN_AT = ["document_start", "document_end", "document_idle"];

/** Max fetched script size the installer accepts (2 MB). */
export const MAX_INSTALL_SIZE_BYTES = 2 * 1024 * 1024;

/**
 * Parse the metadata block with the v1.3 keys added: @require (all),
 * @run-at (first), @connect (all). parseMetadata in shared/scripts.ts
 * already reads them — this is the editor's alias for it.
 */
export function parseEditorMetadata(code: string): EditorMetadata {
  return parseMetadata(code);
}

export interface LintIssue {
  severity: "error" | "warning";
  line: number;
  message: string;
}

/** Strip comments and strings, keeping line numbers (replaced by spaces) so lint line numbers stay right. */
function maskCommentsAndStrings(code: string): string {
  let out = "";
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];
    if (ch === "/" && next === "/") {
      while (i < n && code[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) {
        out += code[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
    } else if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      out += " ";
      i++;
      while (i < n) {
        if (code[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (code[i] === quote) {
          out += " ";
          i++;
          break;
        }
        out += code[i] === "\n" ? "\n" : " ";
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const UNSUPPORTED_GRANT_NAMES = [
  "GM_openInTab",
  "GM_download",
  "unsafeWindow",
  "GM_info",
  "GM_log",
  "GM_registerMenuCommand",
  "GM_unregisterMenuCommand",
  "GM_deleteValue",
  "GM_listValues",
  "GM_addValueChangeListener",
  "GM_removeValueChangeListener",
  "GM_getResourceText",
  "GM_getResourceURL",
  "GM_cookie",
];

/**
 * Lint editor code. Checks, in order: metadata block present; every
 * @match parses (bad patterns name the line); @run-at is a known
 * value; @grant lines asking for unimplemented functions; bracket
 * mismatch for (), [] and {} outside comments/strings (reports the
 * first unclosed opener's line, or the first stray closer's line);
 * no @match at all (warning — the script runs nowhere). Never throws;
 * empty code yields one error.
 */
export function lintEditor(code: string): LintIssue[] {
  const issues: LintIssue[] = [];
  if (typeof code !== "string" || !code.trim()) {
    return [{ severity: "error", line: 1, message: "Script code is empty." }];
  }
  const lines = code.split("\n");
  const hasBlock = /\/\/\s*==UserScript==/.test(code) && /\/\/\s*==\/UserScript==/.test(code);
  if (!hasBlock) {
    issues.push({ severity: "warning", line: 1, message: "No // ==UserScript== metadata block — the script will install as “Untitled script” with no @match patterns." });
  }
  const meta = parseEditorMetadata(code);
  // Bad @match patterns, with their line numbers.
  const blockMatch = code.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
  if (blockMatch) {
    const blockStart = code.slice(0, code.indexOf(blockMatch[0])).split("\n").length;
    blockMatch[1].split("\n").forEach((rawLine, idx) => {
      const m = rawLine.trim().match(/^\/\/\s*@(match|include)\s+(.+?)\s*$/i);
      if (!m) return;
      if (!matchPatternToRegExp(m[2])) {
        issues.push({ severity: "error", line: blockStart + idx, message: `Bad @${m[1].toLowerCase()} pattern "${m[2]}" — it does not look like a match pattern (e.g. https://example.com/*).` });
      }
    });
  }
  if (meta.runAt !== null && !VALID_RUN_AT.includes(meta.runAt)) {
    issues.push({ severity: "error", line: 1, message: `@run-at "${meta.runAt}" is not valid — use document_start, document_end or document_idle.` });
  }
  for (const grant of meta.grants) {
    if (UNSUPPORTED_GRANT_NAMES.includes(grant)) {
      issues.push({ severity: "warning", line: 1, message: `@grant ${grant} is not implemented by HiddenGem Flow — calls to it will fail at runtime.` });
    }
  }
  if (meta.matches.length === 0) {
    issues.push({ severity: "warning", line: 1, message: "No @match patterns — this script will run nowhere until you add one." });
  }
  // Bracket mismatch on the masked code (comments/strings blanked).
  const masked = maskCommentsAndStrings(code);
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: Array<{ ch: string; line: number }> = [];
  let reported = false;
  for (let i = 0; i < masked.length && !reported; i++) {
    const ch = masked[i];
    if (ch === "(" || ch === "[" || ch === "{") {
      stack.push({ ch, line: masked.slice(0, i).split("\n").length });
    } else if (ch === ")" || ch === "]" || ch === "}") {
      const want = pairs[ch];
      const top = stack[stack.length - 1];
      if (!top || top.ch !== want) {
        issues.push({ severity: "error", line: masked.slice(0, i).split("\n").length, message: `Unmatched "${ch}" — no opening "${want}" for it.` });
        reported = true;
      } else {
        stack.pop();
      }
    }
  }
  if (!reported && stack.length > 0) {
    const first = stack[0];
    issues.push({ severity: "error", line: first.line, message: `Unclosed "${first.ch}" — a matching closer is missing.` });
  }
  return issues;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const JS_KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch",
  "case", "break", "continue", "new", "typeof", "instanceof", "in", "of", "try", "catch",
  "finally", "throw", "class", "extends", "import", "export", "default", "await", "async",
  "this", "true", "false", "null", "undefined", "void", "delete",
]);

/**
 * Highlight code as escaped HTML: comments grey, keywords emerald,
 * strings gold, numbers and GM_* calls blue-ish. The output is
 * display-only — it is never executed, and every character is
 * escaped before any span is added. Returns the HTML string.
 */
export function highlightEditor(code: string): string {
  const src = typeof code === "string" ? code : "";
  let html = "";
  let i = 0;
  const n = src.length;
  const pushText = (text: string, cls: string | null): void => {
    if (!text) return;
    html += cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text);
  };
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      pushText(src.slice(i, j), "cm");
      i = j;
    } else if (ch === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      pushText(src.slice(i, j), "cm");
      i = j;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      pushText(src.slice(i, j), "str");
      i = j;
    } else if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9._a-fA-FxX]/.test(src[j])) j++;
      pushText(src.slice(i, j), "num");
      i = j;
    } else if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (word.startsWith("GM_") || word === "GM") pushText(word, "fn");
      else if (JS_KEYWORDS.has(word)) pushText(word, "kw");
      else pushText(word, null);
      i = j;
    } else {
      pushText(ch, null);
      i++;
    }
  }
  return html;
}

/** Human size: "12 KB" / "1.2 MB" / "843 B". Pure. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes % 1024 === 0 ? 0 : 1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Starter template for "New script from current page". `pageUrl` is
 * the active tab's URL (or null when there is none / it is not
 * http(s)); the @match is origin + path + "*" so the script runs on
 * that page and its siblings. A non-http(s) URL yields the template
 * with a placeholder @match the user must fill in.
 */
export function newScriptTemplate(pageUrl: string | null): string {
  let match = "https://example.com/*";
  let hostNote = "example.com";
  if (typeof pageUrl === "string" && pageUrl) {
    try {
      const u = new URL(pageUrl);
      if (u.protocol === "http:" || u.protocol === "https:") {
        const path = u.pathname.endsWith("*") ? u.pathname : `${u.pathname}*`;
        match = `${u.protocol}//${u.host}${path}`;
        hostNote = u.host;
      }
    } catch {
      // Keep the placeholder.
    }
  }
  return [
    "// ==UserScript==",
    "// @name        My script for " + hostNote,
    "// @version     1.0",
    "// @description Runs on " + hostNote + ".",
    "// @match       " + match,
    "// @grant       none",
    "// ==/UserScript==",
    "",
    "// Your code runs on every page matching @match above.",
    "// GM_setValue, GM_getValue, GM_notification, GM_addStyle,",
    "// GM_xmlhttpRequest (needs @connect) and GM_setClipboard are available.",
    "console.log('HiddenGem Flow: my script ran on', location.href);",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Install from URL — validation + preview (fetch itself is the caller's)
// ---------------------------------------------------------------------------

export interface InstallPreview {
  name: string;
  version: string;
  matches: string[];
  grants: string[];
  updateURL: string | null;
  sizeBytes: number;
  sizeLabel: string;
  scan: ScanReport;
  /** True when the code has a metadata block at all. */
  hasMetadata: boolean;
}

export type InstallValidation =
  | { ok: true; preview: InstallPreview }
  | { ok: false; error: string };

/**
 * Validate fetched text BEFORE any install step. Rejects: empty
 * files, oversized files (> 2 MB), HTML error pages (starts with
 * "<!DOCTYPE" / "<html"), text with no ==UserScript== block, and
 * code with no @name AND no @match (nothing identifiable to install).
 * On success returns the preview card data (name/version/@match/
 * size + the security scan). Never throws. Pure.
 */
export function validateFetchedScript(text: string, url: string): InstallValidation {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: "That URL returned an empty file — nothing to install." };
  }
  const sizeBytes = new TextEncoder().encode(text).length;
  if (sizeBytes > MAX_INSTALL_SIZE_BYTES) {
    return { ok: false, error: `That file is ${formatBytes(sizeBytes)} — scripts over ${formatBytes(MAX_INSTALL_SIZE_BYTES)} are refused.` };
  }
  const head = text.trimStart().slice(0, 200).toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<head")) {
    return { ok: false, error: "That URL returned a web page, not a userscript — check the link (it should end in .user.js, or be a raw file link)." };
  }
  const meta = parseEditorMetadata(text);
  const hasMetadata = /\/\/\s*==UserScript==/.test(text);
  if (!hasMetadata) {
    return { ok: false, error: "That file has no // ==UserScript== metadata block — it is not a userscript." };
  }
  if (meta.name === null && meta.matches.length === 0) {
    return { ok: false, error: "That userscript has no @name and no @match — there is nothing identifiable to install." };
  }
  return {
    ok: true,
    preview: {
      name: meta.name ?? "Untitled script",
      version: meta.version ?? "1.0",
      matches: meta.matches,
      grants: meta.grants,
      updateURL: meta.updateURL,
      sizeBytes,
      sizeLabel: formatBytes(sizeBytes),
      scan: securityScan(text, meta),
      hasMetadata,
    },
  };
}

/** True when a URL looks fetchable as a script (http(s) only, non-empty). Pure — the dashboard checks this before fetching. */
export function isFetchableScriptUrl(raw: string): boolean {
  try {
    const u = new URL(String(raw ?? "").trim());
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

/**
 * GreasyFork / OpenUserJS live search is NOT attempted from the
 * extension: those sites do not send CORS headers the extension page
 * can use, and the extension holds no host permission for them (by
 * design — v1.3 adds no host_permissions). The "Find scripts for this
 * site" panel therefore shows store scripts first, then installed
 * scripts, plus a manual URL field. This constant is the honest
 * reason shown in the UI, so the panel never fakes search results.
 */
export const EXTERNAL_SEARCH_NOTE =
  "Live search of GreasyFork / OpenUserJS is not built in: those sites do not allow the extension page to read their search results, and HiddenGem Flow asks for no host permission for them. Paste a script's direct .user.js link below to install it instead.";
