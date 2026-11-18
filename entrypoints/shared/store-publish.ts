// HiddenGem Flow — Studio store publishing: publish to the Official Store (v2.1.0).
//
// A port of tools/store-uploader.html into the extension (the
// standalone page stays as a backup, untouched). Same rules, same
// order, same entry format — the extension's Script Store loader
// (shared/store.ts) reads exactly what buildStoreEntry writes.
//
// TOKEN RULE (the real protection): the GitHub fine-grained token
// (Contents read/write on hiddengemflow-store only) is sent ONLY to
// api.github.com, in the Authorization header — never in a URL, never
// to any other host, never written into any file, never logged. The
// jsDelivr purge is a plain GET with no auth. Without a token,
// Publish/Upgrade/Delete are disabled and the three Download
// fallbacks are the way (publish by hand on github.com).
//
// Same split as the other shared modules: PURE half first (no chrome
// APIs, no DOM — unit-testable in plain Node), fetch half after.
// The fetch functions take the token as a parameter and never store
// it; the Studio module owns loading/saving it under
// hiddengemflow.store.token.v1 (browser-only, never in backups/logs).

import { parseMetadata } from "./scripts";
import type { StoreIndex, StoreScript } from "./store";

export const STORE_OWNER = "BidyutRoy2";
export const STORE_REPO = "hiddengem-flow-store";
export const STORE_BRANCH = "main";
/** Storage key for the store PAT — browser-only, NEVER in backups, NEVER in logs. */
export const STORE_TOKEN_KEY = "hiddengemflow.store.token.v1";

export interface StoreConfig {
  owner: string;
  repo: string;
  branch: string;
  /** Fine-grained PAT, or "" when none is saved. Never logged. */
  token: string;
}

export function defaultStoreConfig(): StoreConfig {
  return { owner: STORE_OWNER, repo: STORE_REPO, branch: STORE_BRANCH, token: "" };
}

/** "Titan Quick Buy" -> "titan-quick-buy". Fallback "script". Pure. */
export function slugify(name: string): string {
  const s = String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "script";
}

/** "1.0.0" -> "1.0.1" — increments the last number in the version. Pure. */
export function suggestVersionBump(version: string): string {
  const v = String(version ?? "").trim() || "1.0.0";
  const m = v.match(/^(.*?)(\d+)([^0-9]*)$/);
  if (!m) return `${v}.1`;
  return m[1] + (parseInt(m[2], 10) + 1) + m[3];
}

/** jsDelivr cache-purge URL (documented format). Pure. */
export function purgeUrl(owner: string, repo: string, branch: string, path: string): string {
  return `https://purge.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`;
}

/** Raw file URL for a store script. Pure. */
export function rawCodeUrl(owner: string, repo: string, branch: string, filename: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/scripts/${encodeURIComponent(filename)}`;
}

/** Raw + jsDelivr URLs for the public store index. Pure. */
export function rawIndexUrl(owner: string, repo: string, branch: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/index.json`;
}
export function jsdelivrIndexUrl(owner: string, repo: string, branch: string): string {
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/index.json`;
}

/** Script filename in the store: slug + ".user.js". Pure. */
export function sanitizeFilename(name: string): string {
  return `${slugify(name)}.user.js`;
}

export function encodeBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

export function decodeBase64(b64: string): string {
  return decodeURIComponent(escape(atob(String(b64 ?? "").replace(/\s/g, ""))));
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The fields a publish/upgrade needs. Pure shape; the Studio reads them from its form. */
export interface StoreScriptFields {
  name: string;
  version: string;
  author: string;
  description: string;
  matches: string[];
  code: string;
}

/**
 * Validate the fields. Missing name or code is an error; missing
 * @match is a warning (the entry is still produced, but the script
 * will run nowhere until matches are added). Pure.
 */
export function validateStoreFields(f: StoreScriptFields): { ok: boolean; warning: boolean; error?: string } {
  if (!f.name.trim()) return { ok: false, warning: false, error: "A script name is required — type one above, or Import a file that has an @name line." };
  if (!f.code.trim()) return { ok: false, warning: false, error: "There is no script source yet — paste code above, or choose a file." };
  if (f.matches.length === 0) {
    return { ok: true, warning: true, error: "No @match lines — this script will run nowhere until you add the sites it runs on. The publish still goes ahead, but Script Store will show “runs nowhere”." };
  }
  return { ok: true, warning: false };
}

function stripHeader(code: string): string {
  return String(code ?? "").replace(/\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==\s*/, "");
}

/** Rebuild the ==UserScript== header from the fields (same as the uploader). Pure. */
export function buildStoreHeader(f: StoreScriptFields): string {
  const lines = ["// ==UserScript=="];
  lines.push(`// @name        ${f.name}`);
  lines.push("// @namespace   hiddengem-flow-store");
  lines.push(`// @version     ${f.version}`);
  if (f.description) lines.push(`// @description ${f.description}`);
  if (f.author) lines.push(`// @author      ${f.author}`);
  for (const m of f.matches) lines.push(`// @match       ${m}`);
  lines.push("// @grant       none");
  lines.push("// ==/UserScript==");
  return lines.join("\n");
}

/** The full .user.js file: rebuilt header + the script body. Pure. */
export function buildStoreUserJs(f: StoreScriptFields): string {
  return `${buildStoreHeader(f)}\n\n${stripHeader(f.code).replace(/^\s+/, "")}\n`;
}

/**
 * The index entry — exactly what the extension's Script Store loader
 * expects (name, version, author, description, matches, codeUrl,
 * publishedAt, updatedAt). A NEW entry gets publishedAt = updatedAt
 * = today; an UPGRADE keeps the listed entry's publishedAt (even
 * when it is empty — a date is never invented) and only updatedAt
 * becomes today. Pure.
 */
export function buildStoreEntry(f: StoreScriptFields, cfg: StoreConfig, existing?: StoreScript | null): StoreScript {
  const filename = sanitizeFilename(f.name);
  const now = todayISO();
  const publishedAt = existing ? (typeof existing.publishedAt === "string" ? existing.publishedAt : "") : now;
  return {
    name: f.name,
    version: f.version,
    author: f.author,
    description: f.description,
    matches: f.matches,
    codeUrl: rawCodeUrl(cfg.owner, cfg.repo, cfg.branch, filename),
    publishedAt,
    updatedAt: now,
  };
}

/**
 * Auto-fill source: read @name/@version/@description/@author/@match
 * out of a script's ==UserScript== block. Reads ONLY those five
 * metadata fields — the code itself is never executed, never
 * evaluated, and never trusted beyond those lines (parseMetadata
 * regex-parses the block). Pure.
 */
export function parseStoreMeta(code: string): { name: string | null; version: string | null; description: string | null; author: string | null; matches: string[] } {
  const meta = parseMetadata(code);
  return {
    name: meta.name ?? null,
    version: meta.version ?? null,
    description: meta.description ?? null,
    author: meta.author ?? null,
    matches: [...(meta.matches ?? [])],
  };
}

/**
 * The script file's name, ONLY when the entry's codeUrl points at
 * this repo's own raw copy under scripts/ — anything else is refused
 * and nothing is deleted. Pure.
 */
export function filenameFromCodeUrlForDelete(codeUrl: string | undefined, cfg: StoreConfig): string | null {
  if (typeof codeUrl !== "string") return null;
  const prefix = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/scripts/`;
  if (!codeUrl.startsWith(prefix)) return null;
  const rest = codeUrl.slice(prefix.length);
  if (!rest || rest.includes("/") || rest.includes("?") || rest.includes("#")) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

/** The script filename for an UPGRADE read (looser: only needs to READ a file, never to remove one). Pure. */
export function filenameFromCodeUrl(codeUrl: string | undefined, name: string): string {
  if (typeof codeUrl === "string") {
    const m = codeUrl.match(/\/scripts\/([^/?#]+)$/);
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        // Fall through to the slug.
      }
    }
    const m2 = codeUrl.match(/\/([^/?#]+\.user\.js)$/);
    if (m2) {
      try {
        return decodeURIComponent(m2[1]);
      } catch {
        // Fall through to the slug.
      }
    }
  }
  return sanitizeFilename(name);
}

/** Validate a parsed store index (unknown fields tolerated, scripts list required). Pure. */
export function parseStoreIndexText(raw: string): { ok: true; index: StoreIndex } | { ok: false; error: string } {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The store index is not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { scripts?: unknown }).scripts)) {
    return { ok: false, error: "The store index has no scripts list." };
  }
  const index = parsed as StoreIndex;
  const scripts = index.scripts.filter(
    (s): s is StoreScript => !!s && typeof s.name === "string" && !!s.name && typeof s.version === "string" && !!s.version,
  );
  return { ok: true, index: { ...index, scripts } };
}

// ---------------------------------------------------------------------------
// GitHub API (api.github.com only, token in the header only)
// ---------------------------------------------------------------------------

function ghHeaders(cfg: StoreConfig, json: boolean): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (json) headers["Content-Type"] = "application/json";
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  return headers;
}

/** Human-readable GitHub error (401 = bad token, etc.). Pure. */
export function ghErrorMessage(status: number, data: unknown, fallback: string): string {
  const msg = data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string" ? ((data as { message: string }).message) : "";
  if (status === 401) return "GitHub said 401 — the token is wrong, expired, or has no access to this repo. Check the token and the fine-grained steps above.";
  if (status === 403) return `GitHub said 403 — ${msg || "forbidden"}. The token may lack the Contents permission, or the hourly limit was hit.`;
  if (status === 404) return `GitHub said 404 — ${msg || "not found"}. Check the owner / repo / branch above.`;
  if (status === 409) return "GitHub said 409 — a conflict (usually a stale file id). The page retries once with a fresh id.";
  if (status === 422) return `GitHub said 422 — ${msg || "the request was rejected"}.`;
  return `GitHub said ${status} — ${msg || fallback || "request failed"}.`;
}

export interface GhFile {
  exists: boolean;
  sha: string | null;
  text: string | null;
}

/** GET one file from the repo. A 404 means "no such file" — a normal outcome, not an error. */
export async function ghGetFile(path: string, cfg: StoreConfig): Promise<GhFile> {
  const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: ghHeaders(cfg, false) });
  } catch {
    throw new Error("Could not reach api.github.com — check your connection, then try again.");
  }
  if (res.status === 404) return { exists: false, sha: null, text: null };
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error(ghErrorMessage(res.status, data, `could not read ${path}`));
  if (!data || typeof data !== "object" || typeof (data as { content?: unknown }).content !== "string") {
    return { exists: false, sha: typeof (data as { sha?: unknown }).sha === "string" ? ((data as { sha: string }).sha) : null, text: null };
  }
  return { exists: true, sha: (data as { sha?: string }).sha ?? null, text: decodeBase64((data as { content: string }).content) };
}

/** PUT one file. Pass the fresh sha for an existing file (or null to create it). Retries once on a sha conflict. */
export async function ghPutFile(
  path: string,
  text: string,
  message: string,
  cfg: StoreConfig,
  sha: string | null,
  logFn?: (line: string) => void,
): Promise<{ status: number; sha: string | null }> {
  const body: Record<string, unknown> = { message, content: encodeBase64(text), branch: cfg.branch };
  if (sha) body.sha = sha;
  let attempt = 0;
  while (true) {
    attempt++;
    const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`;
    let res: Response;
    try {
      res = await fetch(url, { method: "PUT", headers: ghHeaders(cfg, true), body: JSON.stringify(body) });
    } catch {
      throw new Error(`Could not reach api.github.com while uploading ${path} — check your connection, then try again.`);
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.ok) {
      if (logFn) logFn(`PUT ${path} … ${res.status}${res.status === 201 ? " (created)" : " (updated)"}`);
      const content = data && typeof data === "object" ? (data as { content?: { sha?: string } }).content : null;
      return { status: res.status, sha: content?.sha ?? null };
    }
    const isShaConflict =
      (res.status === 409 || res.status === 422) &&
      data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string" && /sha/i.test((data as { message: string }).message);
    if (isShaConflict && attempt === 1) {
      if (logFn) logFn(`PUT ${path} … ${res.status} (stale file id) — refetching the id once and retrying…`);
      const fresh = await ghGetFile(path, cfg);
      if (!fresh.exists || !fresh.sha) throw new Error(`The file changed on GitHub while publishing ${path} — reload and try again.`);
      body.sha = fresh.sha;
      continue;
    }
    throw new Error(ghErrorMessage(res.status, data, `could not upload ${path}`));
  }
}

/** DELETE one file from the repo (body { message, sha }). */
export async function ghDeleteFile(
  path: string,
  message: string,
  cfg: StoreConfig,
  sha: string,
  logFn?: (line: string) => void,
): Promise<void> {
  const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "DELETE", headers: ghHeaders(cfg, true), body: JSON.stringify({ message, sha }) });
  } catch {
    throw new Error(`Could not reach api.github.com while deleting ${path} — check your connection, then try again.`);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.ok) {
    if (logFn) logFn(`DELETE ${path} … ${res.status}`);
    return;
  }
  throw new Error(ghErrorMessage(res.status, data, `could not delete ${path}`));
}

/** Best-effort jsDelivr cache purge (GET, no auth). Returns true on 200. */
export async function purgeFile(path: string, cfg: StoreConfig, logFn?: (line: string) => void): Promise<boolean> {
  const url = purgeUrl(cfg.owner, cfg.repo, cfg.branch, path);
  try {
    const res = await fetch(url, { method: "GET" });
    if (logFn) logFn(`purge ${path} … ${res.status}${res.ok ? " (cache cleared)" : " (left the cache alone — the publish still worked)"}`);
    return res.ok;
  } catch {
    if (logFn) logFn(`purge ${path} … failed (left the cache alone — the publish still worked)`);
    return false;
  }
}

/**
 * Test connection: GET the repo contents — verifies token + repo +
 * branch in one call. An empty repo answers 404 "This repository is
 * empty.", which still means the token and repo are fine. Throws an
 * honest error otherwise. Returns "empty" when the repo exists but
 * has no files yet.
 */
export async function testStoreConnection(cfg: StoreConfig): Promise<"ok" | "empty"> {
  if (!cfg.token) throw new Error("Paste a token first — Test connection needs one. (No token? Use the Download buttons in step 2 and publish by hand.)");
  const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents?ref=${encodeURIComponent(cfg.branch)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${cfg.token}` } });
  } catch {
    throw new Error("Could not reach api.github.com — check your connection, then try again.");
  }
  if (res.status === 401) throw new Error("GitHub said 401 — the token is wrong or expired. Generate a fresh one (steps above) and paste it again.");
  if (res.status === 403) {
    let d: unknown = null;
    try {
      d = await res.json();
    } catch {
      d = null;
    }
    const msg = d && typeof d === "object" && typeof (d as { message?: unknown }).message === "string" ? ((d as { message: string }).message) : "forbidden";
    throw new Error(`GitHub said 403 — ${msg}. The token may lack Contents access to this repo.`);
  }
  if (res.status === 404) {
    let d: unknown = null;
    try {
      d = await res.json();
    } catch {
      d = null;
    }
    if (d && typeof d === "object" && typeof (d as { message?: unknown }).message === "string" && /empty/i.test((d as { message: string }).message)) {
      return "empty";
    }
    throw new Error("GitHub said 404 — repo or branch not found. Check the owner / repo / branch above.");
  }
  if (!res.ok) {
    let d: unknown = null;
    try {
      d = await res.json();
    } catch {
      d = null;
    }
    throw new Error(ghErrorMessage(res.status, d, "connection test failed"));
  }
  return "ok";
}

/**
 * Load the live store index: with a token, through the GitHub API;
 * without one, the public copy (raw first, jsDelivr fallback — raw is
 * freshest, jsDelivr can stay stale after a publish). Pure fetch
 * policy, same as the uploader and the store loader.
 */
export async function loadLiveStoreIndex(cfg: StoreConfig): Promise<{ index: StoreIndex; via: "api" | "raw" | "jsdelivr" }> {
  if (cfg.token) {
    const file = await ghGetFile("index.json", cfg);
    if (!file.exists || !file.text) throw new Error("index.json is not published yet. Publish your first script from the New Script view.");
    const parsed = parseStoreIndexText(file.text);
    if (!parsed.ok) throw new Error(parsed.error);
    return { index: parsed.index, via: "api" };
  }
  let res = await fetch(rawIndexUrl(cfg.owner, cfg.repo, cfg.branch));
  if (!res.ok) res = await fetch(jsdelivrIndexUrl(cfg.owner, cfg.repo, cfg.branch));
  if (res.status === 404) throw new Error("index.json is not published yet. Publish your first script from the New Script view (a token is needed to publish).");
  if (!res.ok) throw new Error(`The public store copy answered ${res.status}. Add a token above to read it through the GitHub API instead.`);
  const parsed = parseStoreIndexText(await res.text());
  if (!parsed.ok) throw new Error(parsed.error);
  return { index: parsed.index, via: res.url.includes("jsdelivr") ? "jsdelivr" : "raw" };
}
