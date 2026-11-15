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
  var seen = {};
  function forward(id, title, message) {
    if (!id || seen[id]) return;
    seen[id] = true;
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
  function isSignal(node) {
    return !!node && node.nodeType === 1 && node.hasAttribute && node.hasAttribute("data-hgf-gm-notify");
  }
  function scan(root) {
    try {
      var nodes = (root || document).querySelectorAll("[data-hgf-gm-notify]");
      for (var i = 0; i < nodes.length; i++) drain(nodes[i]);
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
          if (n && n.nodeType === 1 && n.querySelectorAll) {
            var inner = n.querySelectorAll("[data-hgf-gm-notify]");
            for (var k = 0; k < inner.length; k++) drain(inner[k]);
          }
        }
      }
    });
    mo.observe(document.documentElement || document, { childList: true, subtree: true });
  } catch (e) {}
})();
