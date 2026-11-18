/* HiddenGem Flow — userstyle injector (v1.5+).
 *
 * chrome.scripting.registerContentScripts() takes CSS as FILE paths, not
 * inline CSS text — so a style's CSS cannot be passed directly. Instead
 * the background registers this one shared script per style (with that
 * style's match patterns), and this script reads the styles from storage
 * and injects the matching ones as <style> elements. Runs in the
 * isolated world; it only touches the page DOM, never page JS.
 */
(function () {
  var STYLES_KEY = "hiddengemflow.userstyles.v1";

  function scheduleActive(style, now) {
    if (style.schedule !== "dark-hours") return true;
    var hour = new Date(now).getHours();
    var start = typeof style.startHour === "number" ? style.startHour : 19;
    var end = typeof style.endHour === "number" ? style.endHour : 7;
    if (start === end) return true;
    if (start < end) return hour >= start && hour < end;
    return hour >= start || hour < end;
  }

  function hostMatches(styleHost, hostname) {
    var h = (hostname || "").toLowerCase().replace(/^www\./, "");
    return h === (styleHost || "").toLowerCase();
  }

  function applyStyles() {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    chrome.storage.local.get(STYLES_KEY).then(function (data) {
      var styles = data[STYLES_KEY] || [];
      var now = Date.now();
      var host = window.location.hostname;
      // Remove styles this injector previously added, then re-add the
      // ones that still apply (so toggling off removes them live).
      document.querySelectorAll("style[data-hgf-style]").forEach(function (el) { el.remove(); });
      var head = document.documentElement;
      if (!head) return;
      for (var i = 0; i < styles.length; i++) {
        var style = styles[i];
        if (!style || style.enabled !== true) continue;
        if (!hostMatches(style.host, host)) continue;
        if (!scheduleActive(style, now) && style.preview !== true) continue;
        var el = document.createElement("style");
        el.setAttribute("data-hgf-style", style.id);
        el.textContent = style.css || "";
        (document.head || document.documentElement).appendChild(el);
      }
    }).catch(function () { /* storage unavailable — no styles apply */ });
  }

  function applyWhenReady() {
    if (document.documentElement) applyStyles();
    else document.addEventListener("DOMContentLoaded", applyStyles, { once: true });
  }

  applyWhenReady();
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === "hiddengemflow:styles-apply") applyStyles();
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && changes[STYLES_KEY]) applyStyles();
    });
  } catch (e) { /* messaging/storage events unavailable — nav reload still applies */ }
})();
