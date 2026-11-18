// HiddenGem Flow — Per-script run log + storage viewer (v1.5+, #23).
//
// Inspect GM_setValue data per script, per-script error console,
// exportable run history. READ-ONLY — the viewer never edits script
// data: it has no write path at all (no save function exists in this
// module, and the background handler only reads).
//
// GM values live in the page origin's localStorage under
// `hgf:gm:<scriptId>:<key>` (see shared/engine.ts GM_STORAGE_PREFIX).
// The background reads them by running a static function in a tab
// that is open on one of the script's @match sites
// (chrome.scripting.executeScript with a fixed func — never the
// script's code, never eval). When no such tab is open, the viewer
// says so honestly ("open the site tab first") instead of inventing
// values. The per-script error console is the existing
// hiddengemflow.scripts.errors.v1 key; the run history is the
// existing runs log (hiddengemflow.runs.v1), filtered to the script.

import { GM_STORAGE_PREFIX } from "./engine";

export const MSG_GM_VALUES_READ = "hiddengemflow:gm-values-read";
/** Max GM value characters shown per key (long values are truncated, never hidden silently — the row says so). */
export const GM_VALUE_PREVIEW_MAX = 200;

export interface GmValueEntry {
  key: string;
  /** Display value (JSON-parsed when possible, truncated at GM_VALUE_PREVIEW_MAX). */
  value: string;
  truncated: boolean;
}

/**
 * Parse a localStorage snapshot into one script's GM values.
 * `snapshot` is a plain object of key → raw string (read from the
 * page by the background's static reader). Only keys under this
 * script's prefix are returned; anything else is ignored. Pure.
 */
export function parseGmValues(snapshot: Record<string, string>, scriptId: string): GmValueEntry[] {
  const prefix = `${GM_STORAGE_PREFIX}${scriptId}:`;
  const out: GmValueEntry[] = [];
  for (const [key, raw] of Object.entries(snapshot)) {
    if (!key.startsWith(prefix)) continue;
    const name = key.slice(prefix.length);
    if (!name) continue;
    let display: string;
    try {
      const parsed = JSON.parse(raw);
      display = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
    } catch {
      display = raw;
    }
    const truncated = display.length > GM_VALUE_PREVIEW_MAX;
    out.push({ key: name, value: truncated ? display.slice(0, GM_VALUE_PREVIEW_MAX) : display, truncated });
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

/** One honest line for a value row ("lastPrice: 0.42" / "runs: 18"). Pure. */
export function formatGmValue(entry: GmValueEntry): string {
  return `${entry.key}: ${entry.value}${entry.truncated ? " …" : ""}`;
}

/** Build the exportable run-history JSON for one script (runs whose scriptIds include it). Pure. */
export function buildScriptRunExport(
  scriptId: string,
  scriptName: string,
  runs: Array<{ runId: string; url: string; status: string; scriptIds: string[]; startedAt: number }>,
  exportedAt: string = new Date().toISOString(),
): { app: string; type: string; scriptId: string; scriptName: string; exportedAt: string; runs: Array<{ url: string; status: string; startedAt: number }> } {
  return {
    app: "hiddengem-flow",
    type: "script-run-history",
    scriptId,
    scriptName,
    exportedAt,
    runs: runs
      .filter((r) => r.scriptIds.includes(scriptId))
      .map((r) => ({ url: r.url, status: r.status, startedAt: r.startedAt })),
  };
}
