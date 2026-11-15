// HiddenGem Flow — Notepad shared module (finding A-09).
//
// Split in two halves on purpose, same as shared/tasks.ts:
//  * PURE half (everything up to the "Storage" section): no `chrome`
//    APIs, no DOM, no Date.now() hidden inside the logic — all inputs
//    are parameters. Unit-testable in plain Node (see the smoke test).
//  * Storage half: thin wrappers around chrome.storage.local. Only the
//    dashboard and the two floating windows import these.
//
// Privacy note: notes are local-only. There is no network request in
// this module at all — no sync, no server, no analytics, no telemetry.
// Notes never leave the browser.

export type NoteBrand = "HiddenGem" | "Personal" | "Work";

/** The three brand options a note can carry (data — easy to change later). */
export const NOTE_BRANDS: NoteBrand[] = ["HiddenGem", "Personal", "Work"];

export const NOTES_KEY = "hiddengemflow.notes.v1";

/** A note carries at most this many tags. */
export const NOTES_MAX_TAGS = 10;

/** A single tag is at most this many characters. */
export const NOTE_TAG_MAX_LENGTH = 20;

export interface Note {
  id: string;
  title: string;
  body: string;
  brand: NoteBrand;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function newNoteId(): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // Fall through to the timestamp fallback.
  }
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Unknown or misspelled brands fall back to HiddenGem — never a throw. */
export function sanitizeBrand(raw: unknown): NoteBrand {
  return (NOTE_BRANDS as string[]).includes(String(raw)) ? (raw as NoteBrand) : "HiddenGem";
}

/**
 * Clean a tag list: trim, drop empties, cap each tag at 20 characters,
 * dedupe case-insensitively (first spelling wins), cap at 10 tags.
 * Non-array input is []. Does not mutate.
 */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const clean = String(t ?? "").trim().slice(0, NOTE_TAG_MAX_LENGTH);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= NOTES_MAX_TAGS) break;
  }
  return out;
}

/**
 * The title a note shows: its title when set, else the first non-empty
 * line of its body (capped at 80 characters), else "Untitled note".
 * Pure.
 */
export function displayTitle(title: string, body: string): string {
  const t = (title ?? "").trim();
  if (t) return t;
  const first = (body ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
  if (!first) return "Untitled note";
  return first.length > 80 ? `${first.slice(0, 80)}…` : first;
}

/**
 * Create a note. The title may be empty (it falls back to the body's
 * first line, or "Untitled note", when shown) and the body may be empty
 * — a note is never refused for being blank. `now` and `id` are
 * parameters so tests can pin them. Pure.
 */
export function createNote(
  title: string,
  body: string,
  brand: unknown,
  tags: unknown,
  now: number = Date.now(),
  id: string = newNoteId(),
): Note {
  return {
    id,
    title: (title ?? "").trim(),
    body: body ?? "",
    brand: sanitizeBrand(brand),
    tags: normalizeTags(tags),
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update a note's fields. Only the fields present in `patch` change;
 * `updatedAt` is stamped to `now` on every update. Unknown id → the
 * array is returned unchanged. Returns a new array. Pure.
 */
export function updateNote(
  notes: Note[],
  id: string,
  patch: { title?: string; body?: string; brand?: unknown; tags?: unknown },
  now: number = Date.now(),
): Note[] {
  return notes.map((n) => {
    if (n.id !== id) return n;
    return {
      ...n,
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.brand !== undefined ? { brand: sanitizeBrand(patch.brand) } : {}),
      ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
      updatedAt: now,
    };
  });
}

/** Remove a note by id. Returns a new array. */
export function deleteNote(notes: Note[], id: string): Note[] {
  return notes.filter((n) => n.id !== id);
}

/**
 * Toggle a note's pinned flag. Pinning is not an edit — it does not
 * stamp updatedAt, so the "Edited …" line never moves for a pin.
 * Returns a new array.
 */
export function toggleNotePin(notes: Note[], id: string): Note[] {
  return notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n));
}

/** Pinned notes first, then most recently updated first. Does not mutate. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

/**
 * Case-insensitive substring search over title + body + tags. Empty
 * query returns the list unchanged (same order). Does not mutate.
 */
export function searchNotes(notes: Note[], query: string): Note[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return [...notes];
  return notes.filter(
    (n) =>
      n.title.toLowerCase().includes(q) ||
      n.body.toLowerCase().includes(q) ||
      n.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

/**
 * "Edited today, 08:10" / "Edited yesterday" / "Edited 13 Nov 2026".
 * `now` is a parameter so tests can pin it. Pure.
 */
export function formatEditedDate(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const dayStart = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((dayStart(n) - dayStart(d)) / 86400000);
  if (diffDays === 0) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `Edited today, ${hh}:${mm}`;
  }
  if (diffDays === 1) return "Edited yesterday";
  return `Edited ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

/**
 * The text Copy puts on the clipboard: ONLY the note body — the title
 * is never included (user rule, 2026-11-15: "only Note e ja thakbe
 * seta copy hobe"). Pure.
 */
export function noteClipboardText(note: Note): string {
  return note.body;
}

// ---------------------------------------------------------------------------
// Storage wrappers (chrome.storage.local only — not part of the pure half)
// ---------------------------------------------------------------------------

declare const chrome: any;

function storageAvailable(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome?.storage?.local;
  } catch {
    return false;
  }
}

/**
 * Load all saved notes; [] when nothing is saved or storage is
 * unavailable. Entries read back from storage are sanitized the same
 * way new notes are (brand, tags, booleans, timestamps) — a hand-edited
 * or older stored value can never break the list.
 */
export async function loadNotes(): Promise<Note[]> {
  if (!storageAvailable()) return [];
  try {
    const data = await chrome.storage.local.get(NOTES_KEY);
    const raw = data?.[NOTES_KEY];
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    return raw
      .filter((t: unknown): t is Record<string, unknown> => !!t && typeof t === "object" && typeof (t as Note).id === "string")
      .map((t) => {
        const createdAt = typeof t.createdAt === "number" && Number.isFinite(t.createdAt) ? t.createdAt : now;
        const updatedAt = typeof t.updatedAt === "number" && Number.isFinite(t.updatedAt) ? t.updatedAt : createdAt;
        return {
          id: t.id as string,
          title: typeof t.title === "string" ? t.title : "",
          body: typeof t.body === "string" ? t.body : "",
          brand: sanitizeBrand(t.brand),
          tags: normalizeTags(t.tags),
          pinned: t.pinned === true,
          createdAt,
          updatedAt,
        } satisfies Note;
      });
  } catch {
    return [];
  }
}

/** Persist the whole note list (replaces the stored value). */
export async function saveNotes(notes: Note[]): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [NOTES_KEY]: notes });
}
