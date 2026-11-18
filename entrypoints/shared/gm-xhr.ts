// HiddenGem Flow — GM_xmlhttpRequest @connect gate + GM_setClipboard (v1.3, #8).
//
// GM_xmlhttpRequest is the dangerous GM function: it lets a script
// fetch ANY URL, bypassing the page's CORS rules. So it is gated
// TWICE:
//  1. @grant: the script must declare `@grant GM_xmlhttpRequest`
//     (enforced by the shim — the function only exists for scripts
//     whose grant list includes it; see engine.ts gmShimCode).
//  2. @connect: the request's host must be listed in the script's
//     @connect lines. A host is allowed when it matches a @connect
//     entry exactly, or is a subdomain of a @connect entry, or the
//     entry is "*" (any host — allowed only when the user explicitly
//     wrote it; the scanner warns about it). No credentials or
//     cookies are ever sent (fetch credentials:"omit"), and a
//     redirect to an unlisted host is refused: the fetch follows
//     redirects and the FINAL URL is checked against the same list
//     (redirect:"manual" cannot work cross-origin from a service
//     worker — the Location header is unreadable there, probe30b);
//     a redirect to an unlisted host still fetches one
//     credential-less GET, but its body is discarded and the script
//     gets a refusal, never the response.
//
// The USER_SCRIPT world cannot fetch cross-origin itself (page CORS
// applies), so the shim signals through the DOM (same pattern as
// GM_notification, A-04): a signal node → public/gm-relay.js (ISOLATED
// world) → background MSG_GM_XHR → the background fetches and the
// relay writes a response node the shim polls for. The background is
// the only place the fetch happens, and it re-validates everything
// (script exists, enabled, not archived, grant declared, host in
// @connect) — the shim's checks are convenience, the background's
// are the enforcement.
//
// GM_setClipboard: the shim tries navigator.clipboard.writeText
// first, then document.execCommand("copy") with a temp textarea,
// then a DOM signal the relay drains and copies with execCommand in
// the isolated world. No new permission: clipboard writes from a
// user-script page context need none of the manifest's permissions.
// The text is capped at 100 KB in every path.

export const MSG_GM_XHR = "hiddengemflow:gm-xhr";
export const MSG_GM_CLIPBOARD = "hiddengemflow:gm-clipboard";
/** Ask the background to run the one-click self-test script on the active tab (v1.3, #25). */
export const MSG_SELF_TEST = "hiddengemflow:self-test";

/** DOM signal attributes (same A-04 pattern as GM_notification). */
export const GM_XHR_SIGNAL_ATTR = "data-hgf-gm-xhr";
export const GM_XHR_RESP_ATTR = "data-hgf-gm-xhr-resp";
export const GM_CLIPBOARD_SIGNAL_ATTR = "data-hgf-gm-clipboard";

/** Max GM_xmlhttpRequest response the background returns (1 MB). */
export const GM_XHR_MAX_RESPONSE_BYTES = 1024 * 1024;
/** Max text GM_setClipboard copies (100 KB). */
export const GM_CLIPBOARD_MAX_CHARS = 100 * 1024;
/** Max time the shim waits for an XHR response (30 s). */
export const GM_XHR_TIMEOUT_MS = 30000;

/**
 * True when `url`'s host is allowed by the script's @connect list.
 * Rules: http(s) only; an entry of "*" allows any host; an exact
 * host match allows it; "*.example.com" or a bare "example.com"
 * entry allows the domain and any subdomain. Entries are matched
 * case-insensitively; ports and paths in an entry are ignored.
 * Never throws. Pure.
 */
export function isConnectAllowed(url: string, connects: string[]): boolean {
  let host: string;
  try {
    const u = new URL(String(url ?? ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  for (const raw of connects ?? []) {
    const entry = String(raw ?? "").trim().toLowerCase();
    if (!entry) continue;
    if (entry === "*") return true;
    const entryHost = entry.split("/")[0].split(":")[0].replace(/^\*\./, "");
    if (!entryHost) continue;
    if (host === entryHost) return true;
    if (host.endsWith(`.${entryHost}`)) return true;
  }
  return false;
}

/**
 * Parse a @connect list out of a script's code (the metadata block).
 * Thin wrapper over parseEditorMetadata for callers that only need
 * the connects. Never throws. Pure.
 */
export function connectHostsOf(code: string): string[] {
  try {
    const m = String(code ?? "").match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
    if (!m) return [];
    const out: string[] = [];
    for (const rawLine of m[1].split("\n")) {
      const line = rawLine.trim().match(/^\/\/\s*@connect\s+(.+?)\s*$/i);
      if (line && line[1]) out.push(line[1].trim());
    }
    return out;
  } catch {
    return [];
  }
}

export interface GmXhrRequest {
  /** The script id making the request (validated by the background against storage). */
  scriptId: string;
  url: string;
  method: string;
  /** Request body as text (only for POST/PUT/PATCH). Capped at 100 KB. */
  data?: string;
  /** Response headers the script asked for (informational only — the background sends none extra). */
  headers?: Record<string, string>;
}

export interface GmXhrResponse {
  ok: boolean;
  status: number;
  statusText: string;
  responseText: string;
  finalUrl: string;
  error?: string;
}

/** Clean a GM_xmlhttpRequest details object from an untrusted script. Returns null when unusable. Pure. */
export function sanitizeGmXhrRequest(raw: unknown): GmXhrRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.scriptId !== "string" || !r.scriptId) return null;
  if (typeof r.url !== "string" || !r.url) return null;
  const method = typeof r.method === "string" && r.method ? r.method.toUpperCase() : "GET";
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) return null;
  const data = typeof r.data === "string" ? r.data.slice(0, GM_CLIPBOARD_MAX_CHARS) : undefined;
  const headers: Record<string, string> = {};
  if (r.headers && typeof r.headers === "object" && !Array.isArray(r.headers)) {
    for (const [k, v] of Object.entries(r.headers as Record<string, unknown>)) {
      if (typeof v === "string") headers[String(k).slice(0, 100)] = v.slice(0, 1000);
      if (Object.keys(headers).length >= 20) break;
    }
  }
  return { scriptId: r.scriptId, url: r.url, method, ...(data !== undefined ? { data } : {}), headers };
}
