// HiddenGem Flow — Scratchpad (v1.5+, #12).
//
// Run unsaved JS/CSS ONCE on the current tab, with a "Save as
// script/style" button that opens the v1.3 editor / userstyle form.
// Nothing is saved unless the user presses Save — the scratchpad
// itself writes no storage at all.
//
// HOW IT RUNS (no eval, no new Function, no remote code):
//  * JS runs through the same sanctioned path as "Run script on this
//    page" (background runScriptOnce): the code is registered as a
//    TEMPORARY chrome.userScripts entry for exactly the current tab's
//    URL, the tab reloads, the entry is unregistered after 15 s. The
//    code is the user's own typed text, run once, on the tab they
//    chose, after their click — the same trust model as an installed
//    script, without installing anything.
//  * CSS runs through chrome.scripting.insertCSS on the current tab
//    (activeTab grant from the toolbar click / dashboard gesture), and
//    falls back to the same temporary-userScripts path when the tab
//    has no direct host access. The CSS is validated with the same
//    rule as userstyles (no @import, no remote url()).
//
// The background enforces: current tab only (the active tab of a
// normal window), http(s) only, non-empty code, size caps, and the
// "Allow User Scripts" toggle for the JS path.

export const MSG_SCRATCHPAD_RUN = "hiddengemflow:scratchpad-run";
/** Max JS bytes for one scratchpad run. */
export const SCRATCHPAD_MAX_JS_BYTES = 100 * 1024;
/** Max CSS bytes for one scratchpad run. */
export const SCRATCHPAD_MAX_CSS_BYTES = 100 * 1024;

export type ScratchpadKind = "js" | "css";

/**
 * Validate scratchpad input before anything runs. JS gets a size
 * cap only (its content is the user's own code, run once on their
 * tab — the scanner is not a gate here, and the code is never
 * stored); CSS gets the userstyle safety rule. Pure.
 */
export function validateScratchpad(
  code: string,
  kind: ScratchpadKind,
): { ok: boolean; error?: string } {
  if (typeof code !== "string" || !code.trim()) {
    return { ok: false, error: kind === "js" ? "Type some JavaScript first." : "Type some CSS first." };
  }
  const cap = kind === "js" ? SCRATCHPAD_MAX_JS_BYTES : SCRATCHPAD_MAX_CSS_BYTES;
  if (code.length > cap) return { ok: false, error: "That is over the 100 KB limit for one run." };
  if (kind === "css") {
    const stripped = code.replace(/\/\*[\s\S]*?\*\//g, "");
    if (/@import\b/i.test(stripped)) {
      return { ok: false, error: "“@import” is not allowed — it would fetch another file from the web." };
    }
    const urlRe = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi;
    let m: RegExpExecArray | null;
    while ((m = urlRe.exec(stripped)) !== null) {
      const target = (m[2] ?? "").trim().toLowerCase();
      if (!target || target.startsWith("data:")) continue;
      return { ok: false, error: `“url(${m[2]})” would fetch from the web — a scratchpad run may not do that.` };
    }
  }
  return { ok: true };
}
