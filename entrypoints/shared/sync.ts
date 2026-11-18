// HiddenGem Flow — opt-in sync to the user's own storage (Later, #20).
//
// Sync tasks/scripts/notes (and flows/folders/settings — the backup
// payload) to a provider the user picks: WebDAV, GitHub Gist, or
// Google Drive. DEFAULT OFF — a big toggle, off until the user turns
// it on. NO HiddenGem server, NO account, NO signup.
//
// TOKENS: provider credentials are tokens the user pastes (WebDAV
// basic-auth user/password, Gist PAT, Drive token). They live in
// chrome.storage.local under SYNC_TOKENS_KEY ONLY — a separate key
// that backup.ts explicitly excludes: tokens are NEVER in backups,
// NEVER in snapshots, NEVER in logs, and NEVER sent anywhere except
// the user-chosen provider endpoint. The settings key (SYNC_KEY)
// holds only the provider choice + non-secret config, and IS in
// backups. NO `identity` permission, NO OAuth flow — the user pastes
// a token they created themselves.
//
// CONFLICTS: last write wins, with a backup snapshot saved FIRST —
// an upload snapshots local state before sending (so a bad push is
// recoverable), and a download snapshots local state before writing
// the remote payload over it. A sync NEVER destroys local data
// without a snapshot. A failed provider call shows its error honestly
// and leaves local data untouched.
//
// NETWORK: nothing is fetched until the user turns sync on AND
// presses Sync now (or sets a periodic sync). The background creates
// the `hgf-sync` alarm ONLY when sync is enabled with a periodic
// interval — with sync off, no alarm exists and no request is ever
// made. The provider URL is validated against that provider's host
// pattern before any request (a Gist token is never sent to a
// WebDAV-looking host, and vice versa).
//
// The payload is the same full-backup shape as the local export
// ({ app, type:"backup", version:1, exportedAt, data }) — one format
// for export, snapshot and sync, so a downloaded payload is validated
// by the same strict parseFullBackup as a file import.
//
// Same split as shared/tasks.ts: PURE half first (no chrome APIs, no
// DOM, no hidden Date.now()), storage half after. Unit-testable in
// plain Node (see smoke-later.ts).

declare const chrome: any;

/** Sync settings — NO tokens here (they live under SYNC_TOKENS_KEY). */
export const SYNC_KEY = "hiddengemflow.sync.v1";
/** Provider tokens — NEVER in backups, NEVER in logs, NEVER snapshotted. */
export const SYNC_TOKENS_KEY = "hiddengemflow.sync.tokens.v1";
/** Periodic-sync alarm (created only while sync is on with an interval). */
export const SYNC_ALARM = "hgf-sync";

/** Ask the background to upload local state to the provider now. */
export const MSG_SYNC_NOW = "hiddengemflow:sync-now";
/** Ask the background to download the provider copy (snapshot-first, then write). */
export const MSG_SYNC_PULL = "hiddengemflow:sync-pull";
/** Ask the background for the sync status (settings + last sync + alarms — never tokens). */
export const MSG_SYNC_STATUS = "hiddengemflow:sync-status";

export type SyncProvider = "webdav" | "gist" | "drive";

export const SYNC_PROVIDERS: SyncProvider[] = ["webdav", "gist", "drive"];

export const SYNC_PROVIDER_LABELS: Record<SyncProvider, string> = {
  webdav: "WebDAV",
  gist: "GitHub Gist",
  drive: "Google Drive",
};

/** Periodic sync intervals (minutes). 0 = manual only. */
export const SYNC_AUTO_INTERVALS = [0, 60, 360, 1440] as const;

export interface SyncSettings {
  /** Default OFF — nothing syncs until the user turns this on. */
  enabled: boolean;
  provider: SyncProvider;
  /** WebDAV only: the full URL of the file to PUT/GET (your server). */
  webdavUrl: string;
  /** Gist only: the gist id (hex). */
  gistId: string;
  /** Drive only: the file id. */
  driveFileId: string;
  /** 0 = manual only; otherwise sync every N minutes (via the hgf-sync alarm). */
  autoSyncMinutes: number;
  /** Last sync attempt (upload or download), or null when never synced. */
  lastSync: { at: number; ok: boolean; message: string } | null;
}

/** Provider tokens — kept under SYNC_TOKENS_KEY, excluded from backups. */
export interface SyncTokens {
  /** WebDAV basic-auth username (may be empty for a token-only server). */
  webdavUser: string;
  /** WebDAV basic-auth password. */
  webdavPassword: string;
  /** GitHub personal access token (needs the `gist` scope). */
  gistToken: string;
  /** Google Drive OAuth access token (pasted by the user — no OAuth flow in the extension). */
  driveToken: string;
}

export function defaultSyncSettings(): SyncSettings {
  return {
    enabled: false,
    provider: "webdav",
    webdavUrl: "",
    gistId: "",
    driveFileId: "",
    autoSyncMinutes: 0,
    lastSync: null,
  };
}

export function defaultSyncTokens(): SyncTokens {
  return { webdavUser: "", webdavPassword: "", gistToken: "", driveToken: "" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidProvider(raw: unknown): raw is SyncProvider {
  return raw === "webdav" || raw === "gist" || raw === "drive";
}

function isValidAutoSync(raw: unknown): raw is number {
  return typeof raw === "number" && (SYNC_AUTO_INTERVALS as readonly number[]).includes(raw);
}

/**
 * Clean a stored sync settings value. Never throws; unusable input
 * becomes the default (sync OFF). A lastSync entry is kept only when
 * it has a usable timestamp and a string message. Pure.
 */
export function sanitizeSyncSettings(raw: unknown): SyncSettings {
  const fallback = defaultSyncSettings();
  if (!isRecord(raw)) return fallback;
  let lastSync: SyncSettings["lastSync"] = null;
  if (isRecord(raw.lastSync) && typeof raw.lastSync.at === "number" && Number.isFinite(raw.lastSync.at) && typeof raw.lastSync.message === "string") {
    lastSync = { at: raw.lastSync.at, ok: raw.lastSync.ok === true, message: raw.lastSync.message.slice(0, 300) };
  }
  return {
    enabled: raw.enabled === true,
    provider: isValidProvider(raw.provider) ? raw.provider : "webdav",
    webdavUrl: typeof raw.webdavUrl === "string" ? raw.webdavUrl.slice(0, 2048) : "",
    gistId: typeof raw.gistId === "string" ? raw.gistId.slice(0, 128) : "",
    driveFileId: typeof raw.driveFileId === "string" ? raw.driveFileId.slice(0, 256) : "",
    autoSyncMinutes: isValidAutoSync(raw.autoSyncMinutes) ? raw.autoSyncMinutes : 0,
    lastSync,
  };
}

/**
 * Clean a stored tokens value. Never throws; unusable input is empty
 * tokens. Tokens are opaque strings — no validation beyond length.
 * Pure.
 */
export function sanitizeSyncTokens(raw: unknown): SyncTokens {
  const fallback = defaultSyncTokens();
  if (!isRecord(raw)) return fallback;
  const pick = (key: string): string => (typeof raw[key] === "string" ? (raw[key] as string).slice(0, 4096) : "");
  return {
    webdavUser: pick("webdavUser"),
    webdavPassword: pick("webdavPassword"),
    gistToken: pick("gistToken"),
    driveToken: pick("driveToken"),
  };
}

/** True when the settings hold a token for the chosen provider (a token is stored). Pure. */
export function syncTokenStored(provider: SyncProvider, tokens: SyncTokens): boolean {
  if (provider === "webdav") return tokens.webdavPassword.length > 0 || tokens.webdavUser.length > 0;
  if (provider === "gist") return tokens.gistToken.length > 0;
  return tokens.driveToken.length > 0;
}

/** True when `host` is a loopback host (local test/dev server). Pure. */
export function isLoopbackHost(host: string): boolean {
  const h = (host ?? "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

/**
 * Validate the target for `provider` from the settings. Returns
 * { ok:true } or { ok:false, error } with a plain-English reason.
 * Rules:
 *  * WebDAV: the URL must parse as http(s); plain http is allowed
 *    ONLY for a loopback host (a local server for testing) — a
 *    remote http URL would send the password in the clear.
 *  * Gist: the gist id must be hex (20+ chars); the endpoint is
 *    always https://api.github.com — never user-supplied.
 *  * Drive: the file id must look like a Drive id (10+ base64url
 *    chars); the endpoint is always https://www.googleapis.com —
 *    never user-supplied.
 * Pure.
 */
export function validateSyncTarget(provider: SyncProvider, settings: SyncSettings): { ok: true } | { ok: false; error: string } {
  if (provider === "webdav") {
    const raw = (settings.webdavUrl ?? "").trim();
    if (!raw) return { ok: false, error: "Add your WebDAV URL first — the full address of the file to sync to (e.g. https://my-server.example.com/hiddengem-flow-backup.json)." };
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { ok: false, error: "That WebDAV URL does not parse — check it and try again." };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, error: "The WebDAV URL must start with https:// (or http:// for a server on this computer only)." };
    }
    if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
      return { ok: false, error: "Plain http:// is only allowed for a server on this computer (localhost) — a remote WebDAV URL must be https://, or your password would travel in the clear." };
    }
    return { ok: true };
  }
  if (provider === "gist") {
    const id = (settings.gistId ?? "").trim();
    if (!/^[0-9a-f]{20,}$/i.test(id)) {
      return { ok: false, error: "That Gist id does not look right — a Gist id is a long hex string (open the Gist on GitHub and copy the id from its URL)." };
    }
    return { ok: true };
  }
  const id = (settings.driveFileId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) {
    return { ok: false, error: "That Drive file id does not look right — open the file in Google Drive and copy the id from its URL." };
  }
  return { ok: true };
}

/** The upload URL for the provider (WebDAV: the user's URL; Gist/Drive: fixed provider hosts). Pure. */
export function syncUploadUrl(provider: SyncProvider, settings: SyncSettings): string | null {
  if (provider === "webdav") return (settings.webdavUrl ?? "").trim() || null;
  if (provider === "gist") return `https://api.github.com/gists/${(settings.gistId ?? "").trim()}`;
  return `https://www.googleapis.com/upload/drive/v3/files/${(settings.driveFileId ?? "").trim()}?uploadType=media`;
}

/** The download URL for the provider. Pure. */
export function syncDownloadUrl(provider: SyncProvider, settings: SyncSettings): string | null {
  if (provider === "webdav") return (settings.webdavUrl ?? "").trim() || null;
  if (provider === "gist") return `https://api.github.com/gists/${(settings.gistId ?? "").trim()}`;
  return `https://www.googleapis.com/drive/v3/files/${(settings.driveFileId ?? "").trim()}?alt=media`;
}

/**
 * The optional-host-permission pattern for the provider — the ONE
 * origin sync needs to reach. WebDAV: the user's own URL origin
 * (e.g. `http://127.0.0.1:18082/*`); Gist/Drive: the fixed provider
 * host. An extension fetch to any other host is CORS-blocked without
 * this grant, so the dashboard asks for exactly this pattern on the
 * user's Sync click (same per-site pattern as script site access) —
 * never a blanket whole-web pattern. Returns null when the provider has no
 * usable address yet. Pure.
 */
export function syncOriginPattern(provider: SyncProvider, settings: SyncSettings): string | null {
  if (provider === "gist") return "https://api.github.com/*";
  if (provider === "drive") return "https://www.googleapis.com/*";
  const raw = (settings.webdavUrl ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}/*`;
  } catch {
    return null;
  }
}

/**
 * True when `url` is an allowed host for `provider` — the check that
 * runs BEFORE any token is attached to a request. Gist tokens only
 * ever go to api.github.com, Drive tokens only to
 * *.googleapis.com, WebDAV credentials only to the exact URL the
 * user typed. A mismatch means the request is refused, never sent.
 * Pure.
 */
export function syncHostAllowed(provider: SyncProvider, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (provider === "webdav") {
    // The user typed this URL themselves — any http(s) host they
    // chose is theirs. The scheme rule lives in validateSyncTarget.
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  }
  if (provider === "gist") return parsed.hostname === "api.github.com" && parsed.protocol === "https:";
  return (parsed.hostname === "www.googleapis.com" || parsed.hostname === "drive.googleapis.com") && parsed.protocol === "https:";
}

/**
 * Build the request body for an upload. WebDAV/Drive take the raw
 * backup JSON; Gist takes { files: { name: { content } } } (the Gist
 * API shape). Returns null when the provider is unknown. Pure.
 */
export function buildSyncUploadBody(provider: SyncProvider, backupJson: string): string | null {
  if (provider === "webdav" || provider === "drive") return backupJson;
  if (provider === "gist") {
    return JSON.stringify({ files: { "hiddengem-flow-backup.json": { content: backupJson } } });
  }
  return null;
}

/**
 * Pull the backup JSON out of a provider's download response. WebDAV/
 * Drive return the raw JSON; Gist returns the Gist object, whose
 * files["hiddengem-flow-backup.json"].content is the JSON. Returns
 * null when the response does not carry a usable payload. Pure.
 */
export function extractSyncDownloadBody(provider: SyncProvider, responseText: string): string | null {
  if (provider === "webdav" || provider === "drive") {
    return typeof responseText === "string" && responseText.trim() ? responseText : null;
  }
  if (provider === "gist") {
    try {
      const parsed = JSON.parse(responseText) as { files?: Record<string, { content?: unknown }> };
      const file = parsed?.files?.["hiddengem-flow-backup.json"];
      return typeof file?.content === "string" && file.content.trim() ? file.content : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** "Every hour" / "Every 6 hours" / "Every day" / "Manual only". Pure. */
export function formatSyncInterval(minutes: number): string {
  if (minutes === 0) return "Manual only";
  if (minutes === 60) return "Every hour";
  if (minutes < 1440) return `Every ${minutes / 60} hours`;
  return "Every day";
}

/** The next periodic-sync fire, or null when sync is off / manual-only. Pure. */
export function nextSyncFire(settings: SyncSettings, now: number = Date.now()): number | null {
  if (settings.enabled !== true) return null;
  if (!isValidAutoSync(settings.autoSyncMinutes) || settings.autoSyncMinutes === 0) return null;
  return now + settings.autoSyncMinutes * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Storage wrappers (chrome.storage.local only — not part of the pure half)
// ---------------------------------------------------------------------------

function storageAvailable(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome?.storage?.local;
  } catch {
    return false;
  }
}

/** Load the sync settings (no tokens); the default (OFF) when nothing is saved. */
export async function loadSyncSettings(): Promise<SyncSettings> {
  if (!storageAvailable()) return defaultSyncSettings();
  try {
    const data = await chrome.storage.local.get(SYNC_KEY);
    return sanitizeSyncSettings(data?.[SYNC_KEY]);
  } catch {
    return defaultSyncSettings();
  }
}

/** Persist the sync settings (replaces the stored value). */
export async function saveSyncSettings(settings: SyncSettings): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [SYNC_KEY]: sanitizeSyncSettings(settings) });
}

/** Load the provider tokens; empty tokens when nothing is saved. */
export async function loadSyncTokens(): Promise<SyncTokens> {
  if (!storageAvailable()) return defaultSyncTokens();
  try {
    const data = await chrome.storage.local.get(SYNC_TOKENS_KEY);
    return sanitizeSyncTokens(data?.[SYNC_TOKENS_KEY]);
  } catch {
    return defaultSyncTokens();
  }
}

/** Persist the provider tokens (replaces the stored value). Never called with anything else. */
export async function saveSyncTokens(tokens: SyncTokens): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [SYNC_TOKENS_KEY]: sanitizeSyncTokens(tokens) });
}
