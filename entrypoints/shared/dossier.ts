// HiddenGem Flow — Site dossier (v1.5+, #17).
//
// One per-site page uniting that site's task, matching scripts,
// tagged notes, run history and store recommendations — grown from
// the Smart Notification Bridge (the bridge banner now links to the
// dossier). ALL content comes from real storage: the dossier is
// DERIVED, so it needs no storage key of its own.
//
// Pure assembly only — the dashboard loads tasks/scripts/notes/runs
// /store cache and calls assembleDossier. A note counts as "tagged"
// for a site when one of its tags matches the site's host tokens
// (e.g. tag "titan" for testnet.titanx.cc) or the note is linked to
// the site's task (v1.4 linkedTaskId).

import type { Note } from "./notes";
import type { RunEntry } from "./runs";
import type { Script } from "./scripts";
import { scriptsForUrl } from "./scripts";
import type { StoreScript } from "./store";
import { findStoreScriptsForUrl } from "./store";
import type { Task } from "./tasks";
import { siteHost } from "./open-tabs";

export interface Dossier {
  host: string | null;
  url: string;
  task: Task | null;
  matchingScripts: Script[];
  /** Installed scripts that do NOT match this site (shown as "no match", like the design). */
  nonMatchingScripts: Script[];
  taggedNotes: Note[];
  runHistory: RunEntry[];
  storeRecommendations: StoreScript[];
}

/** Host tokens for tag matching: "testnet.titanx.cc" → ["testnet", "titanx", "titan"]. Pure. */
export function hostTokens(host: string): string[] {
  const out: string[] = [];
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  for (const p of parts) {
    if (!p || p === "com" || p === "net" || p === "org" || p === "io" || p === "cc" || p === "co" || p === "uk") continue;
    if (!out.includes(p)) out.push(p);
    // "titanx" → also match a "titan" tag.
    if (p.endsWith("x") && p.length > 3) {
      const stem = p.slice(0, -1);
      if (!out.includes(stem)) out.push(stem);
    }
  }
  return out;
}

/** Does this note belong to this site? Tag match OR linked to the site's task. Pure. */
export function noteMatchesSite(note: Note, host: string | null, taskId: string | null): boolean {
  if (taskId && note.linkedTaskId === taskId) return true;
  if (!host) return false;
  const tokens = hostTokens(host);
  const tags = (note.tags ?? []).map((t) => t.toLowerCase());
  return tags.some((t) => tokens.includes(t));
}

export function assembleDossier(input: {
  url: string;
  tasks: Task[];
  scripts: Script[];
  notes: Note[];
  runs: RunEntry[];
  storeScripts: StoreScript[];
}): Dossier {
  const host = siteHost(input.url);
  const task =
    input.tasks.find((t) => {
      try {
        return siteHost(t.url) === host && host !== null;
      } catch {
        return false;
      }
    }) ?? null;
  const matchingScripts = scriptsForUrl(input.scripts, input.url);
  const matchingIds = new Set(matchingScripts.map((s) => s.id));
  const nonMatchingScripts = input.scripts.filter((s) => !matchingIds.has(s.id));
  const taggedNotes = input.notes.filter((n) => noteMatchesSite(n, host, task ? task.id : null));
  const runHistory = input.runs
    .filter((r) => {
      try {
        return siteHost(r.url) === host && host !== null;
      } catch {
        return false;
      }
    })
    .slice(0, 10);
  const installedNames = new Set(input.scripts.map((s) => s.name));
  const storeRecommendations = findStoreScriptsForUrl(input.storeScripts, input.url).filter((s) => !installedNames.has(s.name));
  return { host, url: input.url, task, matchingScripts, nonMatchingScripts, taggedNotes, runHistory, storeRecommendations };
}
