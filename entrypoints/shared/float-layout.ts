// HiddenGem Flow — floating window layout (finding A-10).
//
// The order, visibility and default page of the floating window's three
// tabs (Daily Tasks, Scripts, Notepad). Same split as shared/tasks.ts:
//  * PURE half (up to the "Storage" section): no `chrome` APIs, no DOM,
//    no Date.now() hidden inside the logic — all inputs are parameters.
//    Unit-testable in plain Node (see the smoke test).
//  * Storage half: thin wrappers around chrome.storage.local. Only the
//    two floating windows import these.
//
// Privacy note: the layout is local-only, like everything else in the
// extension — no network request in this module at all.

export type FloatTabId = "tasks" | "scripts" | "notes";

export const FLOAT_TABS: Array<{ id: FloatTabId; label: string }> = [
  { id: "tasks", label: "Daily Tasks" },
  { id: "scripts", label: "Scripts" },
  { id: "notes", label: "Notepad" },
];

export const FLOAT_LAYOUT_KEY = "hiddengemflow.float.layout.v1";

export interface FloatLayout {
  /** Tab order, first = leftmost in the tab bar. */
  order: FloatTabId[];
  /** Tabs hidden from the tab bar (restorable from Edit layout). */
  hidden: FloatTabId[];
  /** The tab that opens first when the floating window opens. */
  defaultTab: FloatTabId;
}

export function defaultFloatLayout(): FloatLayout {
  return { order: ["tasks", "scripts", "notes"], hidden: [], defaultTab: "tasks" };
}

function isTabId(value: unknown): value is FloatTabId {
  return value === "tasks" || value === "scripts" || value === "notes";
}

/**
 * Clean a stored (or hand-edited) layout: unknown ids are dropped,
 * duplicates are removed (first occurrence wins), tabs missing from
 * `order` are appended in default order, and `hidden` keeps only
 * known, ordered ids. `defaultTab` must be a visible tab — a hidden
 * or unknown default falls back to the first visible tab. Never
 * throws; a completely unusable value becomes the default. Pure.
 */
export function sanitizeFloatLayout(raw: unknown): FloatLayout {
  const fallback = defaultFloatLayout();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const r = raw as Record<string, unknown>;
  const order: FloatTabId[] = [];
  if (Array.isArray(r.order)) {
    for (const id of r.order) {
      if (isTabId(id) && !order.includes(id)) order.push(id);
    }
  }
  for (const id of fallback.order) {
    if (!order.includes(id)) order.push(id);
  }
  const hidden: FloatTabId[] = [];
  if (Array.isArray(r.hidden)) {
    for (const id of r.hidden) {
      if (isTabId(id) && order.includes(id) && !hidden.includes(id)) hidden.push(id);
    }
  }
  const visible = order.filter((id) => !hidden.includes(id));
  const defaultTab = isTabId(r.defaultTab) && visible.includes(r.defaultTab) ? r.defaultTab : visible[0] ?? "tasks";
  return { order, hidden, defaultTab };
}

/** The tabs the tab bar shows, in layout order. Pure. */
export function visibleTabs(layout: FloatLayout): FloatTabId[] {
  return layout.order.filter((id) => !layout.hidden.includes(id));
}

/** The tab that opens first: the stored default when it is visible, else the first visible tab. Pure. */
export function effectiveDefaultTab(layout: FloatLayout): FloatTabId {
  const visible = visibleTabs(layout);
  return visible.includes(layout.defaultTab) ? layout.defaultTab : visible[0] ?? "tasks";
}

/** Reorder the tabs: move `id` to position `toIndex` (clamped). Unknown ids and no-op moves return the layout unchanged. Pure. */
export function moveFloatTab(layout: FloatLayout, id: FloatTabId, toIndex: number): FloatLayout {
  const order = [...layout.order];
  const from = order.indexOf(id);
  if (from === -1) return layout;
  const to = Math.max(0, Math.min(order.length - 1, toIndex));
  if (from === to) return layout;
  order.splice(from, 1);
  order.splice(to, 0, id);
  return sanitizeFloatLayout({ ...layout, order });
}

/** Hide a tab (it stays in `order` so restoring keeps its place). Hiding the default tab moves the default to the first visible tab. Pure. */
export function hideFloatTab(layout: FloatLayout, id: FloatTabId): FloatLayout {
  if (!layout.order.includes(id) || layout.hidden.includes(id)) return layout;
  return sanitizeFloatLayout({ ...layout, hidden: [...layout.hidden, id] });
}

/** Restore a hidden tab. Pure. */
export function showFloatTab(layout: FloatLayout, id: FloatTabId): FloatLayout {
  if (!layout.hidden.includes(id)) return layout;
  return sanitizeFloatLayout({ ...layout, hidden: layout.hidden.filter((h) => h !== id) });
}

/** Set the default tab; a hidden tab can never be the default (sanitize falls back to the first visible tab). Pure. */
export function setFloatDefaultTab(layout: FloatLayout, id: FloatTabId): FloatLayout {
  return sanitizeFloatLayout({ ...layout, defaultTab: id });
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

/** Load the saved layout; the default when nothing is saved or storage is unavailable. */
export async function loadFloatLayout(): Promise<FloatLayout> {
  if (!storageAvailable()) return defaultFloatLayout();
  try {
    const data = await chrome.storage.local.get(FLOAT_LAYOUT_KEY);
    return sanitizeFloatLayout(data?.[FLOAT_LAYOUT_KEY]);
  } catch {
    return defaultFloatLayout();
  }
}

/** Persist the whole layout (replaces the stored value). */
export async function saveFloatLayout(layout: FloatLayout): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [FLOAT_LAYOUT_KEY]: sanitizeFloatLayout(layout) });
}
