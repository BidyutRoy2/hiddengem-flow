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
//  * GM_notification — two transports, in order (finding A-04, 2026-11-15):
//    (1) chrome.runtime.sendMessage to the background, when the world has
//    it (MAIN world / older Chrome) — the background shows a real
//    chrome.notifications notification (needs the `notifications`
//    permission). No DOM toast fallback is used: a toast inside the page
//    is not a notification. (2) In Chrome 158's USER_SCRIPT world the
//    ONLY chrome API is chrome.runtime.id — sendMessage, storage, tabs
//    are all undefined (verified live with a 23-path capability probe).
//    So the shim appends a transient signal node to the page DOM and the
//    relay content script (public/gm-relay.js, ISOLATED world, runtime-
//    registered by the background for the same @match patterns) drains
//    it and forwards it. A BroadcastChannel was deliberately NOT used:
//    it is origin-scoped across tabs, so one tab's signal would be
//    forwarded by every other tab on the same origin. If both transports
//    fail, the call silently does nothing.
//  * GM_addStyle — appends a <style> element to the document.
//  * GM (object form: GM.setValue, GM.getValue, GM.addStyle,
//    GM.notification) is provided as well — same four functions.
//  * v1.3 — GM_xmlhttpRequest + GM_setClipboard, both @grant-gated:
//    the shim only DEFINES them when the script declares the matching
//    @grant, so a script without the grant gets a ReferenceError, never
//    a fake. GM_xmlhttpRequest also needs @connect: the shim signals
//    through the DOM (same A-04 pattern), the relay forwards the
//    request to the background, and the background fetches with
//    credentials:"omit" ONLY when the host is in the script's @connect
//    list (see shared/gm-xhr.ts isConnectAllowed) — a redirect to an
//    unlisted host is refused. The response comes back as a DOM node
//    the shim polls for (MutationObserver + 30 s timeout).
//    GM_setClipboard tries navigator.clipboard.writeText, then
//    document.execCommand("copy"), then a DOM signal the relay drains
//    and copies in the isolated world. No new permission anywhere.
//  * Everything else (GM_openInTab, GM_download, unsafeWindow, ...)
//    is NOT defined. A script that calls one gets a ReferenceError/
//    TypeError at runtime and a scanner warning at install time —
//    never a fake that pretends to work.
//
// The shim is a string because chrome.userScripts takes code, not a
// function. `scriptId` is JSON-encoded into it so a hostile script name
// cannot break out of the string.

import { runnableScripts } from "./folders";
import {
  clearScriptError,
  loadScriptErrors,
  loadScripts,
  parseMetadata,
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
    if (await chrome.permissions.contains({ origins: script.matches })) return true;
    // v1.3 (A-33): origin-widened fallback. A persistent grant for
    // `https://example.com/*` covers a script matching
    // `https://example.com/foo/*` — contains() with the narrow
    // pattern alone would say false. Widen each @match to its origin
    // and re-check. (This does NOT cover activeTab grants — those are
    // invisible to contains() entirely; the background's float ping
    // covers those. See background.ts hasHostAccessForTab.)
    const origins: string[] = [];
    for (const m of script.matches || []) {
      const mm = String(m ?? "").replace(/^\*:\/\//, "https://");
      try {
        const u = new URL(mm);
        if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname) {
          const origin = `${u.protocol}//${u.host}/*`;
          if (!origins.includes(origin)) origins.push(origin);
        }
      } catch {
        // Unparseable pattern — the exact check above already ran.
      }
    }
    if (origins.length > 0) return await chrome.permissions.contains({ origins });
    return false;
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

/** DOM attribute the GM shim uses to signal a notification (drained by public/gm-relay.js). */
export const GM_NOTIFY_SIGNAL_ATTR = "data-hgf-gm-notify";
/** Base id for runtime-registered GM relay content scripts (one per @match pattern). */
export const GM_RELAY_BASE_ID = "hgf-gm-relay";

/**
 * The GM shim, injected BEFORE the user's script code in the same
 * userscript `js` entry, so GM_* exists when the script runs.
 *
 * `grants` is the script's declared @grant list: GM_xmlhttpRequest
 * and GM_setClipboard are defined ONLY when granted (v1.3) — a
 * script without the grant gets a ReferenceError, never a fake.
 * GM_setValue / GM_getValue / GM_notification / GM_addStyle are
 * always defined (they were the v1.0 surface).
 */
export function gmShimCode(scriptId: string, grants: string[] = []): string {
  const id = JSON.stringify(String(scriptId));
  const hasXhr = Array.isArray(grants) && grants.includes("GM_xmlhttpRequest");
  const hasClip = Array.isArray(grants) && grants.includes("GM_setClipboard");
  // XHR waiter registry + response observer (only when granted).
  const xhrPart = hasXhr
    ? `var __xhrWaiters={};function __xhrResp(node){try{var raw=node.textContent||"";node.remove();var r;try{r=JSON.parse(raw);}catch(e){return;}var w=__xhrWaiters[r.id];if(!w)return;delete __xhrWaiters[r.id];if(w.timer)clearTimeout(w.timer);if(r.ok){if(typeof w.onload==="function")w.onload({responseText:r.responseText||"",response:r.responseText||"",status:r.status||0,statusText:r.statusText||"",finalUrl:r.finalUrl||"",readyState:4});}else{if(typeof w.onerror==="function")w.onerror({responseText:"",response:"",status:r.status||0,statusText:r.statusText||"",finalUrl:r.finalUrl||"",readyState:4,error:r.error||"Request failed"});}}catch(e){}}function __xhrWatch(){try{var mo=new MutationObserver(function(muts){for(var i=0;i<muts.length;i++){var added=muts[i].addedNodes;for(var j=0;j<added.length;j++){var n=added[j];if(n&&n.nodeType===1&&n.hasAttribute&&n.hasAttribute("data-hgf-gm-xhr-resp"))__xhrResp(n);}}});mo.observe(document.documentElement||document,{childList:true,subtree:true});}catch(e){}}function __xhr(d){try{var details=(d&&typeof d==="object")?d:{};var url=String(details.url||"");if(!url){if(typeof details.onerror==="function")details.onerror({status:0,statusText:"No URL",readyState:4,error:"GM_xmlhttpRequest: no URL"});return null;}var __rid="x"+Date.now().toString(36)+Math.floor(Math.random()*1e9).toString(36);var req={id:__rid,scriptId:__id,url:url,method:String(details.method||"GET"),data:typeof details.data==="string"?details.data.slice(0,100000):"",headers:{}};if(details.headers&&typeof details.headers==="object"){try{for(var k in details.headers){if(typeof details.headers[k]==="string")req.headers[String(k).slice(0,100)]=details.headers[k].slice(0,1000);}}catch(e){}}var waiter={onload:details.onload,onerror:details.onerror,ontimeout:details.ontimeout,timer:null};waiter.timer=setTimeout(function(){var w=__xhrWaiters[__rid];if(!w)return;delete __xhrWaiters[__rid];if(typeof w.ontimeout==="function")w.ontimeout({status:0,statusText:"Timeout",readyState:4});else if(typeof w.onerror==="function")w.onerror({status:0,statusText:"Timeout",readyState:4,error:"GM_xmlhttpRequest timed out after 30 s"});},30000);__xhrWaiters[__rid]=waiter;var __n=document.createElement("div");__n.setAttribute("data-hgf-gm-xhr","");__n.setAttribute("data-id",__rid);__n.textContent=JSON.stringify(req);__n.style.display="none";(document.documentElement||document.body||document).appendChild(__n);return{abort:function(){var w=__xhrWaiters[__rid];if(w){if(w.timer)clearTimeout(w.timer);delete __xhrWaiters[__rid];}}};}catch(e){if(d&&typeof d.onerror==="function")d.onerror({status:0,statusText:String(e),readyState:4,error:String(e)});return null;}}__xhrWatch();`
    : "";
  const clipPart = hasClip
    ? `function __clipFallback(t){try{var ta=document.createElement("textarea");ta.value=t;ta.style.cssText="position:fixed;opacity:0";(document.body||document.documentElement).appendChild(ta);ta.select();var ok=false;try{ok=document.execCommand("copy");}catch(e){}ta.remove();if(ok)return;}catch(e){}try{var d=document.createElement("div");d.setAttribute("data-hgf-gm-clipboard","");d.textContent=t;d.style.display="none";(document.documentElement||document.body||document).appendChild(d);}catch(e){}}function __clip(text){try{var t=String(text==null?"":text).slice(0,100000);if(typeof navigator!=="undefined"&&navigator.clipboard&&typeof navigator.clipboard.writeText==="function"){try{var p=navigator.clipboard.writeText(t);if(p&&typeof p.catch==="function")p.catch(function(){__clipFallback(t);});return;}catch(e){}}__clipFallback(t);}catch(e){}}`
    : "";
  const gmObj = `{setValue:__set,getValue:__get,addStyle:__addStyle,notification:__notify${hasXhr ? ",xmlhttpRequest:__xhr" : ""}${hasClip ? ",setClipboard:__clip" : ""}}`;
  return `(function(){var __id=${id};var __prefix=${JSON.stringify(GM_STORAGE_PREFIX)}+__id+":";function __set(k,v){try{localStorage.setItem(__prefix+String(k),JSON.stringify(v));}catch(e){}}function __get(k,d){try{var r=localStorage.getItem(__prefix+String(k));if(r===null)return d;try{return JSON.parse(r);}catch(e){return r;}}catch(e){return d;}}function __addStyle(css){try{var s=document.createElement("style");s.textContent=String(css);(document.head||document.documentElement).appendChild(s);return s;}catch(e){return null;}}function __notify(a,b){try{var o=(a&&typeof a==="object")?a:{text:a,title:b};var __t=String(o.title||"HiddenGem Flow").slice(0,80);var __m=String(o.text||"").slice(0,400);var __id2="n"+Date.now().toString(36)+Math.floor(Math.random()*1e9).toString(36);if(typeof chrome!=="undefined"&&chrome.runtime&&typeof chrome.runtime.sendMessage==="function"){try{chrome.runtime.sendMessage({type:"hiddengemflow:gm-notify",title:__t,message:__m,id:__id2});return;}catch(e){}}try{var __d=document.createElement("div");__d.setAttribute("data-hgf-gm-notify","");__d.setAttribute("data-id",__id2);__d.setAttribute("data-title",__t);__d.setAttribute("data-message",__m);__d.style.display="none";(document.documentElement||document.body||document).appendChild(__d);}catch(e){}}catch(e){}}${xhrPart}${clipPart}window.GM_setValue=__set;window.GM_getValue=__get;window.GM_addStyle=__addStyle;window.GM_notification=__notify;${hasXhr ? "window.GM_xmlhttpRequest=__xhr;" : ""}${hasClip ? "window.GM_setClipboard=__clip;" : ""}window.GM=${gmObj};})();`;
}

/** The chrome.userScripts registration object for one script. @run-at from the metadata (default document_idle). */
export function buildRegisteredScript(script: Script): Record<string, unknown> {
  let runAt = "document_idle";
  try {
    const meta = parseMetadata(script.code);
    if (meta.runAt === "document_start" || meta.runAt === "document_end" || meta.runAt === "document_idle") {
      runAt = meta.runAt;
    }
  } catch {
    // Keep the default.
  }
  return {
    id: script.id,
    matches: script.matches,
    js: [{ code: `${gmShimCode(script.id, script.grants)}\n;${script.code}` }],
    runAt,
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
  // v1.3: archived scripts never run — the engine refuses them even
  // when called directly (e.g. after a restore that re-enables one).
  if (script.archived === true) {
    const msg = "Not registered: this script is archived. Restore it first.";
    await setScriptError(script.id, msg);
    throw new Error(msg);
  }
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
    await ensureGmRelayForEnabled();
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
  await ensureGmRelayForEnabled();
}

/**
 * Register ALL enabled scripts, ONE at a time, in order. Sequential on
 * purpose: a failure on one script must not abort the rest, and the
 * per-script error is recorded for each failure. Returns the error map
 * (scriptId → message) for the scripts that failed.
 */
export async function registerEnabledScripts(scripts: Script[]): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  // v1.3: archived scripts never run — only enabled AND unarchived ones register.
  for (const script of runnableScripts(scripts)) {
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
  const errors = await registerEnabledScripts(scripts);
  await ensureGmRelayForEnabled();
  return errors;
}

function relayIdFor(pattern: string): string {
  let h = 0;
  for (let i = 0; i < pattern.length; i++) h = (h * 31 + pattern.charCodeAt(i)) >>> 0;
  return `${GM_RELAY_BASE_ID}-${h.toString(36)}`;
}

/**
 * GM_notification relay (finding A-04): register public/gm-relay.js as a
 * runtime content script for the given @match patterns, one registration
 * per pattern so a pattern without host access yet fails alone instead
 * of taking the rest down with it. No new manifest permissions:
 * registerContentScripts needs only the `scripting` permission (already
 * granted), and a pattern runs only where the user has already granted
 * host access — exactly where the userscript itself can run. Patterns
 * with no access yet throw here and are re-attempted on the next
 * registration / startup / permission grant. Registrations for patterns
 * no longer wanted are removed. Never throws.
 */
export async function ensureGmRelay(matches: string[]): Promise<void> {
  try {
    if (typeof chrome === "undefined" || !chrome?.scripting?.registerContentScripts) return;
    const wanted = new Map<string, string>();
    for (const m of matches || []) {
      if (typeof m === "string" && m) wanted.set(relayIdFor(m), m);
    }
    try {
      const existing = await chrome.scripting.getRegisteredContentScripts();
      for (const s of existing || []) {
        if (typeof s?.id === "string" && s.id.startsWith(GM_RELAY_BASE_ID) && !wanted.has(s.id)) {
          try {
            await chrome.scripting.unregisterContentScripts({ ids: [s.id] });
          } catch {}
        }
      }
    } catch {}
    for (const [id, pattern] of wanted) {
      try {
        try {
          await chrome.scripting.unregisterContentScripts({ ids: [id] });
        } catch {}
        await chrome.scripting.registerContentScripts([
          {
            id,
            matches: [pattern],
            js: ["gm-relay.js"],
            runAt: "document_idle",
            world: "ISOLATED",
            persistAcrossSessions: true,
          },
        ]);
      } catch {
        // No host access for this pattern yet (or Chrome refused it).
        // The userscript cannot run there either, so nothing is lost;
        // re-attempted on the next registration / startup / grant.
      }
    }
  } catch {}
}

/** Collect the @match patterns of every enabled script and ensure the relay for them. Never throws. */
export async function ensureGmRelayForEnabled(): Promise<void> {
  try {
    const scripts = await loadScripts();
    const matches: string[] = [];
    for (const s of runnableScripts(scripts)) {
      for (const m of s.matches || []) if (!matches.includes(m)) matches.push(m);
    }
    await ensureGmRelay(matches);
  } catch {}
}

/**
 * v2.1.0 (Studio Test): register the relay for ONE pattern WITHOUT
 * pruning the others. ensureGmRelay() above removes relay
 * registrations for patterns it was not given — calling it with only
 * the test pattern would unregister the relay for every enabled
 * script. A temporary test must never do that. Never throws.
 */
export async function ensureGmRelayForPattern(pattern: string): Promise<void> {
  try {
    if (typeof chrome === "undefined" || !chrome?.scripting?.registerContentScripts) return;
    if (typeof pattern !== "string" || !pattern) return;
    const id = relayIdFor(pattern);
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [id] });
    } catch {}
    try {
      await chrome.scripting.registerContentScripts([
        {
          id,
          matches: [pattern],
          js: ["gm-relay.js"],
          runAt: "document_idle",
          world: "ISOLATED",
          persistAcrossSessions: true,
        },
      ]);
    } catch {
      // No host access for this pattern yet (or Chrome refused it).
    }
  } catch {}
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
  if (enabled && !updated.archived) {
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
