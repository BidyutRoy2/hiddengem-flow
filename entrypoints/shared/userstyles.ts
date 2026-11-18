// HiddenGem Flow — Per-site CSS / userstyles (v1.5+, #11).
//
// Create/import .user.css, per-site enable, live preview, dark/light
// scheduling (uses the existing alarms — one hourly check).
//
// Applied via chrome.scripting registered content scripts with CSS
// (NOT via userScripts): the background registers one content
// script per active style (`hgf-style-<id>`, matches = the style's
// host). No new permission — `scripting` is already held, and the
// style only ever runs on its own host.
//
// SECURITY: userstyle CSS cannot exfiltrate. validateUserStyleCss
// rejects any `@import` (remote or local — an import is a fetch the
// user did not see) and any `url()` pointing at an http(s) host.
// Relative url()s are rejected too: a relative URL inside a content
// script resolves against the page, which is still a fetch the user
// did not ask for. Only `data:` URLs are allowed inside url().
// The background re-validates before every registration (audit A-41
// class), so a hand-edited stored style can never smuggle an import
// in.

export const USERSTYLES_KEY = "hiddengemflow.userstyles.v1";
/** Ask the background to re-register active styles (after a save / toggle / schedule change). */
export const MSG_USERSTYLES_SYNC = "hiddengemflow:userstyles-sync";
export const MSG_USERSTYLES_APPLY = "hiddengemflow:styles-apply";
/** Prefix of the registered content-script ids for styles. */
export const USERSTYLE_SCRIPT_PREFIX = "hgf-style-";
/** Max CSS bytes per style. */
export const USERSTYLE_MAX_CSS_BYTES = 100 * 1024;

export interface UserStyle {
  id: string;
  name: string;
  /** Host the style applies to, e.g. "testnet.titanx.cc" (no scheme, no path). */
  host: string;
  css: string;
  enabled: boolean;
  /** "always" = whenever enabled; "dark-hours" = only between startHour and endHour. */
  schedule: "always" | "dark-hours";
  startHour: number;
  endHour: number;
  /** Live preview ON means the style is registered even while the form is open, so the site shows it at once. */
  preview?: boolean;
  createdAt: number;
  updatedAt: number;
}

declare const chrome: any;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function newId(): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // Fall through.
  }
  return `style-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Host for a style: lowercased, no scheme/path/port, no wildcard. Null when unusable. Pure. */
export function cleanStyleHost(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let host = raw.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "").replace(/^www\./, "");
  host = host.split("/")[0].split(":")[0].split("?")[0];
  if (!host || host.includes("*") || host.includes(" ") || (!host.includes(".") && host !== "localhost")) return null;
  return host;
}

/**
 * Host carried by a granted origin pattern (e.g.
 * "http://127.0.0.1:18081/*" -> "127.0.0.1"). The port is dropped:
 * a grant for one port still proves the user granted that host.
 * Pure.
 */
export function hostOfOriginPattern(pattern: string): string | null {
  if (typeof pattern !== "string") return null;
  const noScheme = pattern.replace(/^\*:\/\//, "").replace(/^https?:\/\//, "");
  const hostPort = noScheme.split("/")[0];
  if (!hostPort || hostPort.includes("*")) return null;
  const host = hostPort.split(":")[0].toLowerCase().replace(/^www\./, "");
  return host || null;
}

/**
 * Has the user granted site access for this style's host? Checked
 * against the origins chrome.permissions.getAll() reports —
 * permissions.contains() with a broad pattern returns false even
 * when a narrower grant for the same host exists, so the origins
 * are compared host-by-host instead. Pure.
 */
export function styleHostGranted(grantedOrigins: string[], host: string): boolean {
  const clean = cleanStyleHost(host);
  if (!clean) return false;
  return (grantedOrigins || []).some((o) => hostOfOriginPattern(o) === clean);
}

/**
 * Validate userstyle CSS. Returns { ok:true } or { ok:false, error }.
 * Rejects: empty CSS, over the size cap, any @import, any url()
 * pointing at http(s) or a relative path. data: URLs are allowed.
 * Pure.
 */
export function validateUserStyleCss(css: string): { ok: boolean; error?: string } {
  if (typeof css !== "string" || !css.trim()) return { ok: false, error: "The CSS is empty." };
  if (css.length > USERSTYLE_MAX_CSS_BYTES) return { ok: false, error: "That CSS is over the 100 KB limit." };
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import\b/i.test(stripped)) {
    return { ok: false, error: "“@import” is not allowed in a userstyle — it would fetch another file from the web. Paste the CSS itself instead." };
  }
  const urlRe = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(stripped)) !== null) {
    const target = (m[2] ?? "").trim().toLowerCase();
    if (!target) continue;
    if (target.startsWith("data:")) continue;
    if (target.startsWith("http://") || target.startsWith("https://") || target.startsWith("//")) {
      return { ok: false, error: `“url(${m[2]})” points at a remote host — a userstyle may not fetch from the web.` };
    }
    return { ok: false, error: `“url(${m[2]})” is a relative URL — a userstyle may not fetch files. Use a data: URL or no URL at all.` };
  }
  // Unbalanced braces are a typo, not a security issue — but a style
  // that never closes cannot apply, so refuse it with the reason.
  const opens = (stripped.match(/{/g) ?? []).length;
  const closes = (stripped.match(/}/g) ?? []).length;
  if (opens !== closes) return { ok: false, error: "The CSS has unbalanced { } braces — fix them before saving." };
  return { ok: true };
}

/** Is this style active right now (enabled + schedule window)? Pure. */
export function styleScheduleActive(style: UserStyle, now: number = Date.now()): boolean {
  if (style.enabled !== true) return false;
  if (style.schedule !== "dark-hours") return true;
  const hour = new Date(now).getHours();
  const start = style.startHour;
  const end = style.endHour;
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/** Match patterns for a host: the host itself and its www. variant. Pure. */
export function styleMatchPatterns(host: string): string[] {
  const clean = cleanStyleHost(host);
  if (!clean) return [];
  const patterns = [`*://${clean}/*`];
  // "www." only makes sense for real domains — never for an IP
  // address or localhost (www.127.0.0.1 is not a host a page has).
  if (!clean.startsWith("www.") && clean !== "localhost" && !/^\d+\.\d+\.\d+\.\d+$/.test(clean)) {
    patterns.push(`*://www.${clean}/*`);
  }
  return patterns;
}

/** Does this style apply to this URL's host? Pure. */
export function styleMatchesUrl(style: UserStyle, url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return host === style.host.replace(/^www\./, "");
  } catch {
    return false;
  }
}

export function validUserStyle(raw: unknown): raw is UserStyle {
  if (!isRecord(raw)) return false;
  if (typeof raw.id !== "string" || !raw.id) return false;
  if (typeof raw.name !== "string" || !raw.name.trim()) return false;
  if (typeof raw.host !== "string" || cleanStyleHost(raw.host) === null) return false;
  if (typeof raw.css !== "string" || !raw.css.trim()) return false;
  if (typeof raw.createdAt !== "number" || typeof raw.updatedAt !== "number") return false;
  return true;
}

export function sanitizeUserStyle(raw: unknown): UserStyle | null {
  if (!isRecord(raw)) return null;
  const host = typeof raw.host === "string" ? cleanStyleHost(raw.host) : null;
  if (typeof raw.id !== "string" || !raw.id || typeof raw.name !== "string" || !raw.name.trim() || !host) return null;
  if (typeof raw.css !== "string" || !raw.css.trim()) return null;
  const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : 0;
  const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
  if (createdAt <= 0) return null;
  const startHour = typeof raw.startHour === "number" && raw.startHour >= 0 && raw.startHour <= 23 ? Math.floor(raw.startHour) : 19;
  const endHour = typeof raw.endHour === "number" && raw.endHour >= 0 && raw.endHour <= 23 ? Math.floor(raw.endHour) : 7;
  return {
    id: raw.id,
    name: raw.name.trim().slice(0, 80),
    host,
    css: raw.css.slice(0, USERSTYLE_MAX_CSS_BYTES),
    enabled: raw.enabled === true,
    schedule: raw.schedule === "dark-hours" ? "dark-hours" : "always",
    startHour,
    endHour,
    ...(raw.preview === true ? { preview: true } : {}),
    createdAt,
    updatedAt,
  };
}

export function sanitizeUserStyles(raw: unknown): UserStyle[] {
  if (!Array.isArray(raw)) return [];
  const out: UserStyle[] = [];
  for (const entry of raw) {
    const clean = sanitizeUserStyle(entry);
    if (clean) out.push(clean);
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** Create a new style (validates host + CSS first). Pure. */
export function createUserStyle(
  input: { name: string; host: string; css: string; schedule?: "always" | "dark-hours"; startHour?: number; endHour?: number },
  now: number = Date.now(),
  id: string = newId(),
): { ok: true; style: UserStyle } | { ok: false; error: string } {
  const host = cleanStyleHost(input.host);
  if (!host) return { ok: false, error: "That host is not usable — use a domain like example.com." };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "Give the style a name." };
  const check = validateUserStyleCss(input.css);
  if (!check.ok) return { ok: false, error: check.error ?? "That CSS is not usable." };
  return {
    ok: true,
    style: {
      id,
      name: name.slice(0, 80),
      host,
      css: input.css,
      enabled: true,
      schedule: input.schedule === "dark-hours" ? "dark-hours" : "always",
      startHour: typeof input.startHour === "number" ? input.startHour : 19,
      endHour: typeof input.endHour === "number" ? input.endHour : 7,
      createdAt: now,
      updatedAt: now,
    },
  };
}

/** Update a style's CSS (re-validated) / flags. Pure. */
export function updateUserStyle(
  styles: UserStyle[],
  id: string,
  patch: { name?: string; host?: string; css?: string; enabled?: boolean; schedule?: "always" | "dark-hours"; startHour?: number; endHour?: number; preview?: boolean },
  now: number = Date.now(),
): { ok: true; styles: UserStyle[] } | { ok: false; error: string } {
  const style = styles.find((s) => s.id === id);
  if (!style) return { ok: false, error: "That style no longer exists." };
  if (patch.css !== undefined) {
    const check = validateUserStyleCss(patch.css);
    if (!check.ok) return { ok: false, error: check.error ?? "That CSS is not usable." };
  }
  if (patch.host !== undefined && cleanStyleHost(patch.host) === null) {
    return { ok: false, error: "That host is not usable — use a domain like example.com." };
  }
  const next = styles.map((s) =>
    s.id === id
      ? {
          ...s,
          ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 80) || s.name } : {}),
          ...(patch.host !== undefined ? { host: cleanStyleHost(patch.host) ?? s.host } : {}),
          ...(patch.css !== undefined ? { css: patch.css } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.schedule !== undefined ? { schedule: patch.schedule } : {}),
          ...(patch.startHour !== undefined ? { startHour: patch.startHour } : {}),
          ...(patch.endHour !== undefined ? { endHour: patch.endHour } : {}),
          ...(patch.preview !== undefined ? { preview: patch.preview } : {}),
          updatedAt: now,
        }
      : s,
  );
  return { ok: true, styles: next };
}

export function deleteUserStyle(styles: UserStyle[], id: string): UserStyle[] {
  return styles.filter((s) => s.id !== id);
}

// ---------------------------------------------------------------------------
// Storage wrappers
// ---------------------------------------------------------------------------

function storageAvailable(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome?.storage?.local;
  } catch {
    return false;
  }
}

export async function loadUserStyles(): Promise<UserStyle[]> {
  if (!storageAvailable()) return [];
  try {
    const data = await chrome.storage.local.get(USERSTYLES_KEY);
    return sanitizeUserStyles(data?.[USERSTYLES_KEY]);
  } catch {
    return [];
  }
}

export async function saveUserStyles(styles: UserStyle[]): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [USERSTYLES_KEY]: sanitizeUserStyles(styles) });
}
