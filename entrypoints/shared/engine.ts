// HiddenGem Flow — userScripts engine (Phase 3).
//
// Chrome-only (chrome.userScripts, MV3). The dashboard and the background
// import this; the floating window does NOT — a content script cannot rely
// on chrome.userScripts, so it asks the background instead (see
// MSG_SCRIPTS_STATUS / MSG_TOGGLE_SCRIPT).
//
// WORLD CHOICE — USER_SCRIPT, deliberately, not MAIN:
//  * chrome.userScripts only accepts "MAIN" or "USER_SCRIPT" for the
//    world (the "ISOLATED"/"MAIN" pair belongs to chrome.scripting,
//    not to userScripts — passing "ISOLATED" makes register() throw,
//    which is exactly the bug found by the 2026-11-15 live test:
//    "Value must be one of MAIN, USER_SCRIPT").
//  * USER_SCRIPT is the isolated user-script world: the script's
//    JavaScript is separate from the page's JavaScript, so the page
//    cannot read or overwrite the GM shim, and the script cannot be
//    tricked by a page that redefines globals. MAIN would be needed
//    only for scripts that must touch the page's own JS objects —
//    that is what an unsafeWindow-style escape does, and it is
//    NOT supported here.
//  * The DOM is shared in both worlds, so scripts can still read and
//    change the page, and GM_addStyle works by injecting a <style> node.
//
// GM IMPLEMENTATION — exactly four functions, nothing faked:
//  * GM_setValue / GM_getValue — synchronous, backed by the page origin's
//    localStorage under `hgf:gm:<scriptId>:<key>`. Synchronous storage is
//    the reason for localStorage: chrome.storage is async, and GM_* is
//    synchronous by convention — an async shim would break scripts
//    that read a value and use it on the next line. The price is honest
//    and stated in the UI: the page's own JavaScript can read those keys,
//    so never store secrets with GM_*.
//  * GM_notification — sends chrome.runtime.sendMessage to the
//    background, which shows a real chrome.notifications notification
//    (needs the `notifications` permission). No DOM toast fallback is
//    used: a toast inside the page is not a notification. If the message
//    fails (background asleep), the call silently does nothing.
//  * GM_addStyle — appends a <style> element to the document.
//  * GM (object form: GM.setValue, GM.getValue, GM.addStyle,
//    GM.notification) is provided as well — same four functions.
//  * Everything else (GM_xmlhttpRequest, GM_openInTab, GM_download,
//    GM_setClipboard, unsafeWindow, ...) is NOT defined. A script that
//    calls one gets a ReferenceError/TypeError at runtime and a scanner
//    warning at install time — never a fake that pretends to work.
//
// The shim is a string because chrome.userScripts takes code, not a
// function. `scriptId` is JSON-encoded into it so a hostile script name
// cannot break out of the string.

import {
  clearScriptError,
  loadScriptErrors,
  loadScripts,
  saveScriptErrors,
  saveScripts,
  setScriptError,
  toggleScriptEnabled,
  type Script,
} from "./scripts";

declare const chrome: any;

/**
 * SITE ACCESS — the second half of "will this script actually run?"
 *
 * Registering is not enough. Chrome's own userScripts docs say it
 * plainly: add the "userScripts" permission AND "host_permissions for
 * sites you want to run scripts on" — user scripts run ONLY where the
 * extension has host access. Proved live 2026-11-15 (v1.0.1 audit): a
 * script registered fine (getScripts() listed it, no error) yet never
 * ran on a fresh example.com tab; after one real toolbar click on that
 * tab (an activeTab grant) + reload, the same script ran.
 *
 * This extension deliberately requests NO required host permissions
 * (least privilege; the floating window is injected on demand via
 * activeTab). So host access is OPTIONAL and per-site: the manifest
 * declares optional_host_permissions with the all-URLs pattern (see
 * wxt.config.ts). The user grants it for a script's @match sites from
 * the dashboard Scripts tab ("Grant site access" — a real Chrome
 * permission prompt, so it needs a user gesture) or wholesale from
 * chrome://extensions → Details → Site access → "On all sites".
 * Until then the script is registered but inert, and the UI says so
 * instead of pretending it runs. (Same pattern as ScriptSentry, the
 * sibling userscript manager.)
 */
export async function scriptHasHostAccess(script: Script): Promise<boolean> {
  try {
    if (typeof chrome === "undefined" || !chrome.permissions?.contains) return false;
    return await chrome.permissions.contains({ origins: script.matches });
  } catch {
    return false;
  }
}

/** Ask the user (gesture required — Chrome shows its own prompt) to grant host access for this script's @match sites. Returns true when granted. */
export async function requestHostAccess(script: Script): Promise<boolean> {
  try {
    if (typeof chrome === "undefined" || !chrome.permissions?.request) return false;
    return await chrome.permissions.request({ origins: script.matches });
  } catch {
    return false;
  }
}

export const GM_STORAGE_PREFIX = "hgf:gm:";

/**
 * The GM shim, injected BEFORE the user's script code in the same
 * userscript `js` entry, so GM_* exists when the script runs.
 */
export function gmShimCode(scriptId: string): string {
  const id = JSON.stringify(String(scriptId));
  return `(function(){var __id=${id};var __prefix=${JSON.stringify(GM_STORAGE_PREFIX)}+__id+":";function __set(k,v){try{localStorage.setItem(__prefix+String(k),JSON.stringify(v));}catch(e){}}function __get(k,d){try{var r=localStorage.getItem(__prefix+String(k));if(r===null)return d;try{return JSON.parse(r);}catch(e){return r;}}catch(e){return d;}}function __addStyle(css){try{var s=document.createElement("style");s.textContent=String(css);(document.head||document.documentElement).appendChild(s);return s;}catch(e){return null;}}function __notify(a,b){try{var o=(a&&typeof a==="object")?a:{text:a,title:b};if(typeof chrome!=="undefined"&&chrome.runtime&&chrome.runtime.sendMessage){chrome.runtime.sendMessage({type:"hiddengemflow:gm-notify",title:String(o.title||"HiddenGem Flow"),message:String(o.text||"")});}}catch(e){}}window.GM_setValue=__set;window.GM_getValue=__get;window.GM_addStyle=__addStyle;window.GM_notification=__notify;window.GM={setValue:__set,getValue:__get,addStyle:__addStyle,notification:__notify};})();`;
}

/** The chrome.userScripts registration object for one script. */
export function buildRegisteredScript(script: Script): Record<string, unknown> {
  return {
    id: script.id,
    matches: script.matches,
    js: [{ code: `${gmShimCode(script.id)}\n;${script.code}` }],
    runAt: "document_idle",
    world: "USER_SCRIPT",
  };
}

/**
 * Is chrome.userScripts usable right now? This is the ONLY reliable
 * check: Chrome throws from getScripts() when the user has not enabled
 * "Allow User Scripts" for this extension (chrome://extensions →
 * HiddenGem Flow → Details → Allow User Scripts). The permission alone
 * is not enough — the toggle is a separate, per-extension user choice.
 */
export async function checkUserScripts(): Promise<{ available: boolean; error?: string }> {
  try {
    if (typeof chrome === "undefined" || !chrome?.userScripts?.getScripts) {
      return { available: false, error: "chrome.userScripts is not available in this browser." };
    }
    await chrome.userScripts.getScripts();
    return { available: true };
  } catch (err) {
    return {
      available: false,
      error: `User scripts are not enabled. ${String(err instanceof Error ? err.message : err)}`,
    };
  }
}

/**
 * Register ONE enabled script. Throws when there is nothing to match
 * (no @match patterns — the script would run nowhere) or when Chrome
 * refuses the registration. On failure the error is persisted per
 * script (hiddengemflow.scripts.errors.v1) so the dashboard can show
 * it next to the script; on success any old error is cleared.
 */
export async function registerScript(script: Script): Promise<void> {
  if (!script.matches || script.matches.length === 0) {
    const msg = "Not registered: this script has no @match patterns, so it would run nowhere. Add an @match line to run it.";
    await setScriptError(script.id, msg);
    throw new Error(msg);
  }
  try {
    await chrome.userScripts.unregister({ ids: [script.id] });
  } catch {
    // Not registered yet — fine.
  }
  try {
    await chrome.userScripts.register([buildRegisteredScript(script)]);
    await clearScriptError(script.id);
  } catch (err) {
    const msg = `Registration failed: ${err instanceof Error ? err.message : String(err)}`;
    await setScriptError(script.id, msg);
    throw new Error(msg);
  }
}

/** Unregister one script. Never throws (a missing registration is fine). */
export async function unregisterScript(id: string): Promise<void> {
  try {
    await chrome.userScripts.unregister({ ids: [id] });
  } catch {
    // Already unregistered or API unavailable — nothing to do.
  }
  await clearScriptError(id);
}

/**
 * Register ALL enabled scripts, ONE at a time, in order. Sequential on
 * purpose: a failure on one script must not abort the rest, and the
 * per-script error is recorded for each failure. Returns the error map
 * (scriptId → message) for the scripts that failed.
 */
export async function registerEnabledScripts(scripts: Script[]): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const script of scripts) {
    if (!script.enabled) continue;
    try {
      await registerScript(script);
    } catch (err) {
      errors[script.id] = err instanceof Error ? err.message : String(err);
    }
  }
  // Keep the persisted error map in sync: drop errors for scripts that
  // now register fine, keep the fresh failures.
  try {
    const stored = await loadScriptErrors();
    for (const id of Object.keys(stored)) {
      if (!(id in errors)) delete stored[id];
    }
    await saveScriptErrors({ ...stored, ...errors });
  } catch {
    // Storage failure must not break startup.
  }
  return errors;
}

/** Re-read scripts from storage and register every enabled one (startup path). */
export async function reregisterEnabledFromStorage(): Promise<Record<string, string>> {
  const check = await checkUserScripts();
  if (!check.available) return {};
  const scripts = await loadScripts();
  return registerEnabledScripts(scripts);
}

/**
 * Flip one script's enabled flag, persist it, and register/unregister
 * just that script. Returns the updated script list.
 */
export async function setScriptEnabled(id: string, enabled: boolean): Promise<Script[]> {
  let scripts = await loadScripts();
  const target = scripts.find((s) => s.id === id);
  if (!target) throw new Error("Script not found.");
  if (target.enabled === enabled) return scripts;
  scripts = toggleScriptEnabled(scripts, id);
  await saveScripts(scripts);
  const updated = scripts.find((s) => s.id === id);
  if (!updated) return scripts;
  if (enabled) {
    try {
      await registerScript(updated);
    } catch {
      // Error already persisted by registerScript; the toggle stays on
      // so the user sees the error next to the script and can fix it.
    }
  } else {
    await unregisterScript(id);
  }
  return scripts;
}
