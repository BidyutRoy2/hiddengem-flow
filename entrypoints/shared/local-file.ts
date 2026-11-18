// HiddenGem Flow — Local-file workflow (v1.5+, #22).
//
// Export a script as a .user.js file for external editing, and
// re-import it (the existing scan + confirm install path). Plus the
// MV3 feasibility spike for TRACKING a local file and reloading on
// change — see LOCAL_FILE_SPIKE below and docs/AUDIT.md (A-49).
//
// SPIKE RESULT (honest, verified in the design, not faked): a
// service worker cannot watch a local file. The File System Access
// API (showOpenFilePicker) only runs in a page with a user gesture;
// its handle can be kept in IndexedDB, but a service worker has no
// gesture to re-read it, and Chrome gives a file handle no
// background read permission without one. There is also no
// chrome.fileSystem / file-watching API for extensions in MV3. So
// this build ships EXPORT + MANUAL RE-IMPORT (pick the file again,
// see the diff against the installed script, confirm to update) and
// a "Check file for changes" button that re-reads a previously
// picked handle ON A CLICK (a real user gesture) — it never pretends
// to watch in the background. The tracked handle lives in the
// dashboard page's IndexedDB only (never in chrome.storage, which
// cannot hold a handle, and never in backups).

import { parseMetadata } from "./scripts";

/** The spike verdict, shown in the UI so nobody mistakes manual re-import for watching. */
export const LOCAL_FILE_SPIKE =
  "File-watching is not possible in MV3: a service worker cannot re-read a local file without a user gesture, and Chrome has no file-watching API for extensions. This build exports a .user.js file and re-imports it when you pick the file again — it never pretends to watch the file in the background.";

/** Suggested file name for an exported script. Pure. */
export function localFileName(scriptName: string): string {
  const base = (scriptName || "script")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "script"}.user.js`;
}

/**
 * Validate a re-imported file against the installed script it claims
 * to update: it must parse as a userscript, and its @name must match
 * the installed script's name (otherwise it is a different script,
 * and the caller must refuse it as an update). Returns the parsed
 * name/version, or an error. Pure.
 */
export function validateLocalFileReimport(
  code: string,
  installedName: string,
): { ok: true; name: string; version: string } | { ok: false; error: string } {
  if (typeof code !== "string" || !code.trim()) return { ok: false, error: "That file is empty." };
  if (code.length > 1024 * 1024) return { ok: false, error: "That file is over the 1 MB import limit." };
  const meta = parseMetadata(code);
  if (!meta.name) return { ok: false, error: "That file has no @name in its metadata block — it is not a userscript." };
  if (meta.name !== installedName) {
    return { ok: false, error: `That file is “${meta.name}”, not “${installedName}” — pick the file for this script, or import it as a new script instead.` };
  }
  return { ok: true, name: meta.name, version: meta.version || "0" };
}
