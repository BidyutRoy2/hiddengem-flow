// HiddenGem Flow — omnibox search (v1.4, #18).
//
// The address bar keyword is `flow` (manifest `omnibox` key — no
// permission, manifest key only). Typing `flow` + Tab + a query
// searches tasks, scripts and notes from storage and opens the match.
// The query is NEVER executed as code: it is only a substring search
// over stored names/URLs/titles, and the entered text is only ever
// parsed as a `kind:id` lookup key whose id must exist in storage.
//
// Ranking: tasks first, then scripts, then notes; within a kind, a
// name/title that STARTS with the query outranks one that merely
// contains it, which outranks a URL/body/tag match.
//
// Pure — no chrome APIs, no DOM. Unit-testable in plain Node (see
// smoke-v14.ts). The background owns the chrome.omnibox wiring.

export type OmniboxKind = "task" | "script" | "note";

export interface OmniboxResult {
  kind: OmniboxKind;
  /** Storage id of the match. */
  id: string;
  /** Title shown in the suggestion. */
  title: string;
  /** Secondary line shown in the suggestion (URL / version / brand). */
  description: string;
  /** The content the omnibox returns on enter: `task:<id>` etc. */
  content: string;
}

export interface OmniboxSearchable {
  tasks: Array<{ id: string; name: string; url: string }>;
  scripts: Array<{ id: string; name: string; version?: string }>;
  notes: Array<{ id: string; title: string; body: string; tags: string[]; brand: string }>;
}

/** At most this many suggestions (Chrome shows at most 6). */
export const OMNIBOX_MAX_RESULTS = 5;

/**
 * Ranked search over tasks, scripts and notes. Empty query returns
 * []. A match is a case-insensitive substring; a name/title that
 * starts with the query scores higher than one that contains it.
 * Pure.
 */
export function searchOmnibox(data: OmniboxSearchable, query: string, limit: number = OMNIBOX_MAX_RESULTS): OmniboxResult[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ score: number; kindRank: number; result: OmniboxResult }> = [];
  const starts = (text: string): boolean => text.toLowerCase().startsWith(q);
  const contains = (text: string): boolean => text.toLowerCase().includes(q);

  for (const t of data.tasks ?? []) {
    let score = 0;
    if (starts(t.name)) score = 3;
    else if (contains(t.name)) score = 2;
    else if (contains(t.url)) score = 1;
    if (score === 0) continue;
    scored.push({
      score,
      kindRank: 0,
      result: { kind: "task", id: t.id, title: t.name, description: t.url, content: `task:${t.id}` },
    });
  }
  for (const s of data.scripts ?? []) {
    let score = 0;
    if (starts(s.name)) score = 3;
    else if (contains(s.name)) score = 2;
    if (score === 0) continue;
    scored.push({
      score,
      kindRank: 1,
      result: {
        kind: "script",
        id: s.id,
        title: s.name,
        description: s.version ? `v${s.version}` : "script",
        content: `script:${s.id}`,
      },
    });
  }
  for (const n of data.notes ?? []) {
    const title = n.title || n.body.split(/\r?\n/).find((l) => l.trim()) || "Untitled note";
    let score = 0;
    if (starts(title)) score = 3;
    else if (contains(title)) score = 2;
    else if (contains(n.body) || n.tags.some((tag) => contains(tag))) score = 1;
    if (score === 0) continue;
    scored.push({
      score,
      kindRank: 2,
      result: { kind: "note", id: n.id, title, description: n.brand, content: `note:${n.id}` },
    });
  }
  scored.sort((a, b) => b.score - a.score || a.kindRank - b.kindRank || a.result.title.localeCompare(b.result.title));
  return scored.slice(0, limit).map((s) => s.result);
}

/**
 * Parse what the user entered: `task:<id>` / `script:<id>` /
 * `note:<id>` from a picked suggestion, or null when the text is a
 * free query instead. The id is returned as-is — the caller MUST
 * check it exists in storage before acting on it. Pure.
 */
export function parseOmniboxInput(text: string): { kind: OmniboxKind; id: string } | null {
  const m = /^(task|script|note):(.+)$/.exec((text ?? "").trim());
  if (!m) return null;
  if (!m[2]) return null;
  return { kind: m[1] as OmniboxKind, id: m[2] };
}
