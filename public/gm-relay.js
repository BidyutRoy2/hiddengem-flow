// HiddenGem Flow — GM_notification relay (Unreleased fix, finding A-04).
//
// WHY THIS FILE EXISTS
// A userscript runs in Chrome's USER_SCRIPT world, where the ONLY chrome
// API is chrome.runtime.id — chrome.runtime.sendMessage, chrome.storage,
// chrome.tabs, chrome.notifications are ALL undefined there (verified live
// in Chrome 158, 2026-11-15: a capability probe of 23 API paths found
// exactly one string, runtime.id). So the GM shim cannot talk to the
// background directly, and the background cannot reach into the page.
// Instead the shim appends a transient signal node to the page DOM; this
// relay content script (ISOLATED world — full extension APIs, including
// chrome.runtime.sendMessage) drains the node and forwards it to the
// background, which shows the real notification.
//
// NO NEW PERMISSIONS. The relay is registered at runtime with
// chrome.scripting.registerContentScripts (the `scripting` permission is
// already in the manifest) for exactly the @match patterns of enabled
// scripts — patterns the user has ALREADY granted host access to. It
// never runs where the userscript cannot run, and it is unregistered
// when no enabled script needs it. It is NOT in the manifest's
// content_scripts: that would ask for host permission at install time.
//
// SCOPING. DOM nodes are per-document, so a signal can never leak into
// another tab. A BroadcastChannel was deliberately NOT used: it is
// origin-scoped across tabs, so a signal posted in one example.com tab
// would be forwarded by the relay in every other example.com tab.
// The node is removed the moment it is read, so it never lingers.
//
// ORDERING. Either side may load first: the node stays in the DOM until
// drained, and the relay drains pre-existing nodes on load AND observes
// for new ones (MutationObserver).
//
// This file is plain JavaScript with no imports — it is shipped verbatim
// from public/ and registered by file path, because
// chrome.scripting.registerContentScripts takes file paths, not code
// strings (a { code } object there throws "Invalid type").

(function () {
  if (typeof window !== "undefined" && window.__hgfGmRelay) return;
  if (typeof window !== "undefined") window.__hgfGmRelay = true;
  // Deep audit (A-22): the seen set is capped — the background caps
  // its own dedupe set at 200, and this one used to grow without
  // limit for the page's lifetime (a script notifying in a loop).
  var seen = {};
  var seenCount = 0;
  var SEEN_LIMIT = 200;
  function forward(id, title, message) {
    if (!id || seen[id]) return;
    seen[id] = true;
    seenCount++;
    if (seenCount > SEEN_LIMIT) {
      var first = Object.keys(seen)[0];
      if (first) {
        delete seen[first];
        seenCount--;
      }
    }
    try {
      chrome.runtime.sendMessage({
        type: "hiddengemflow:gm-notify",
        title: title,
        message: message,
        id: id,
      });
    } catch (e) {}
  }
  function drain(node) {
    try {
      var id = node.getAttribute("data-id");
      if (!id) {
        node.remove();
        return;
      }
      var title = node.getAttribute("data-title") || "HiddenGem Flow";
      var message = node.getAttribute("data-message") || "";
      node.remove();
      forward(id, title, message);
    } catch (e) {}
  }
  // v1.3 — GM_xmlhttpRequest: the shim posts a signal node whose
  // textContent is the JSON request ({id, scriptId, url, method,
  // data, headers}). The relay forwards it to the background (which
  // enforces @grant + @connect and does the fetch — the relay never
  // fetches itself) and writes the response back as a node the shim
  // polls for. The request node is removed the moment it is read.
  function drainXhr(node) {
    try {
      var raw = node.textContent || "";
      node.remove();
      var req = null;
      try { req = JSON.parse(raw); } catch (e) { return; }
      if (!req || typeof req.id !== "string" || !req.id) return;
      var rid = req.id;
      var respond = function (resp) {
        try {
          var out = document.createElement("div");
          out.setAttribute("data-hgf-gm-xhr-resp", "");
          out.setAttribute("data-id", rid);
          out.textContent = JSON.stringify(resp || { id: rid, ok: false, status: 0, statusText: "No response", responseText: "", finalUrl: "" });
          out.style.display = "none";
          (document.documentElement || document.body || document).appendChild(out);
        } catch (e) {}
      };
      try {
        var p = chrome.runtime.sendMessage({ type: "hiddengemflow:gm-xhr", request: req });
        if (p && typeof p.then === "function") {
          p.then(function (res) {
            if (res && typeof res === "object" && "ok" in res) respond({ id: rid, ok: !!res.ok, status: res.status || 0, statusText: res.statusText || "", responseText: res.responseText || "", finalUrl: res.finalUrl || "", error: res.error || undefined });
            else respond({ id: rid, ok: false, status: 0, statusText: "No response", responseText: "", finalUrl: "", error: "The background did not answer the request." });
          }).catch(function (e) {
            respond({ id: rid, ok: false, status: 0, statusText: String(e), responseText: "", finalUrl: "", error: String(e) });
          });
        } else {
          respond({ id: rid, ok: false, status: 0, statusText: "No response", responseText: "", finalUrl: "", error: "The background did not answer the request." });
        }
      } catch (e) {
        respond({ id: rid, ok: false, status: 0, statusText: String(e), responseText: "", finalUrl: "", error: String(e) });
      }
    } catch (e) {}
  }
  // v1.3 — GM_setClipboard fallback: the shim already tried
  // navigator.clipboard + execCommand in the page world; when both
  // fail it posts the text here and the relay copies it with
  // execCommand in the isolated world (no new permission).
  function drainClipboard(node) {
    try {
      var text = node.textContent || "";
      node.remove();
      if (!text) return;
      try {
        var ta = document.createElement("textarea");
        ta.value = text.slice(0, 100000);
        ta.style.cssText = "position:fixed;opacity:0";
        (document.body || document.documentElement).appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch (e) {}
        ta.remove();
      } catch (e) {}
    } catch (e) {}
  }
  // v2.1.0 — Studio Test step reporting: a test draft posts a signal
  // node whose textContent is the JSON step ({step, status, detail}).
  // The relay forwards it to the background, which stores it under
  // the sender tab's id for the Studio to poll. The payload is
  // untrusted draft data — the background sanitizes it (only the
  // four known fields, length-capped, never executed); the relay
  // itself never reads it beyond forwarding the raw text. The node
  // is removed the moment it is read.
  function drainStudioStep(node) {
    try {
      var raw = node.textContent || "";
      node.remove();
      if (!raw) return;
      try {
        chrome.runtime.sendMessage({ type: "hiddengemflow:studio-step", step: raw });
      } catch (e) {}
    } catch (e) {}
  }
  function isSignal(node) {
    return !!node && node.nodeType === 1 && node.hasAttribute && node.hasAttribute("data-hgf-gm-notify");
  }
  function isXhrSignal(node) {
    return !!node && node.nodeType === 1 && node.hasAttribute && node.hasAttribute("data-hgf-gm-xhr");
  }
  function isClipboardSignal(node) {
    return !!node && node.nodeType === 1 && node.hasAttribute && node.hasAttribute("data-hgf-gm-clipboard");
  }
  function isStudioStepSignal(node) {
    return !!node && node.nodeType === 1 && node.hasAttribute && node.hasAttribute("data-hgf-studio-step");
  }
  function scan(root) {
    try {
      var nodes = (root || document).querySelectorAll("[data-hgf-gm-notify]");
      for (var i = 0; i < nodes.length; i++) drain(nodes[i]);
    } catch (e) {}
    try {
      var xnodes = (root || document).querySelectorAll("[data-hgf-gm-xhr]");
      for (var j = 0; j < xnodes.length; j++) drainXhr(xnodes[j]);
    } catch (e) {}
    try {
      var cnodes = (root || document).querySelectorAll("[data-hgf-gm-clipboard]");
      for (var k = 0; k < cnodes.length; k++) drainClipboard(cnodes[k]);
    } catch (e) {}
    try {
      var snodes = (root || document).querySelectorAll("[data-hgf-studio-step]");
      for (var s = 0; s < snodes.length; s++) drainStudioStep(snodes[s]);
    } catch (e) {}
  }
  try {
    scan(document);
    var mo = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (isSignal(n)) {
            drain(n);
            continue;
          }
          if (isXhrSignal(n)) {
            drainXhr(n);
            continue;
          }
          if (isClipboardSignal(n)) {
            drainClipboard(n);
            continue;
          }
          if (isStudioStepSignal(n)) {
            drainStudioStep(n);
            continue;
          }
          if (n && n.nodeType === 1 && n.querySelectorAll) {
            var inner = n.querySelectorAll("[data-hgf-gm-notify]");
            for (var k = 0; k < inner.length; k++) drain(inner[k]);
            var xinner = n.querySelectorAll("[data-hgf-gm-xhr]");
            for (var x = 0; x < xinner.length; x++) drainXhr(xinner[x]);
            var cinner = n.querySelectorAll("[data-hgf-gm-clipboard]");
            for (var c = 0; c < cinner.length; c++) drainClipboard(cinner[c]);
            var sinner = n.querySelectorAll("[data-hgf-studio-step]");
            for (var si = 0; si < sinner.length; si++) drainStudioStep(sinner[si]);
          }
        }
      }
    });
    mo.observe(document.documentElement || document, { childList: true, subtree: true });
  } catch (e) {}
})();
