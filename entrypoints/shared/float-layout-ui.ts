// HiddenGem Flow — Edit layout UI for the floating windows (finding A-10).
//
// ONE shared UI layer for BOTH floating forms — the in-page window
// (entrypoints/floating.ts, Shadow DOM) and the standalone popup page
// (entrypoints/float/main.ts, plain DOM). The two forms have separate
// markup and separate CSS (different prefixes), but the same data
// attributes and the same class names, so this module can mount into
// either by taking the root element.
//
// The editor replaces the page content while it is open (the tab bar
// stays visible, with hidden tabs faded). It edits a DRAFT — nothing
// is saved until "Save layout". Cancel discards the draft.
//
// REORDER is HTML5 drag-and-drop on the row grip (⋮⋮). The probe tests
// it with real mouse drags; if drag ever proves flaky inside the float,
// small ↑ ↓ buttons are the honest fallback (see AUDIT A-10).
//
// RENDERING: rows are built with createElement + textContent only —
// tab labels come from a fixed table, never from user input.

import {
  FLOAT_TABS,
  effectiveDefaultTab,
  hideFloatTab,
  loadFloatLayout,
  moveFloatTab,
  saveFloatLayout,
  setFloatDefaultTab,
  showFloatTab,
  type FloatLayout,
  type FloatTabId,
} from "./float-layout";
import { loadTasks } from "./tasks";
import { loadScripts } from "./scripts";
import { loadNotes } from "./notes";

export interface FloatLayoutEditorHandle {
  /** Open the editor (loads the current layout + live counts, renders rows). */
  open: () => void;
  /** Re-read the stored layout and tell the caller when it changed elsewhere. Skipped while editing. */
  refresh: () => Promise<void>;
  /** True while the editor is open. */
  isEditing: () => boolean;
}

export interface FloatLayoutEditorOptions {
  /** Called when the editor opens — the caller switches the float to its editing view. */
  onOpen: () => void;
  /** Called when the editor closes — applied=true after Save (layout is the saved one), false after Cancel. */
  onClose: (applied: boolean, layout: FloatLayout) => void;
  /** Called when the stored layout changed elsewhere (storage event) while not editing. */
  onExternalChange: (layout: FloatLayout) => void;
}

/**
 * Reorder the tab bar buttons per `layout.order`, hide the hidden ones
 * (or fade them while editing), and return the tab that should be
 * active: `activeTab` when it is visible, else the layout's default.
 * The buttons keep their own click listeners — appendChild only moves
 * them. Pure DOM, no storage.
 */
export function applyFloatLayoutToTabs(
  root: Document | HTMLElement,
  layout: FloatLayout,
  activeTab: FloatTabId,
  editing: boolean,
): FloatTabId {
  const bar = root.querySelector("[data-tabs]");
  if (!bar) return effectiveDefaultTab(layout);
  const buttons = Array.from(bar.querySelectorAll<HTMLElement>("[data-float-tab]"));
  const byId = new Map(buttons.map((b) => [b.dataset.floatTab as FloatTabId, b]));
  for (const id of layout.order) {
    const btn = byId.get(id);
    if (btn) bar.appendChild(btn);
  }
  for (const btn of buttons) {
    const id = btn.dataset.floatTab as FloatTabId;
    const hidden = layout.hidden.includes(id);
    if (editing) {
      btn.hidden = false;
      btn.classList.toggle("hidden-tab", hidden);
    } else {
      btn.hidden = hidden;
      btn.classList.remove("hidden-tab");
    }
  }
  const visible = layout.order.filter((id) => !layout.hidden.includes(id));
  if (editing) return activeTab;
  return visible.includes(activeTab) ? activeTab : effectiveDefaultTab(layout);
}

export function mountFloatLayoutEditor(
  root: Document | HTMLElement,
  opts: FloatLayoutEditorOptions,
): FloatLayoutEditorHandle {
  const q = <T extends HTMLElement>(sel: string): T | null => root.querySelector(sel) as T | null;

  const panel = q<HTMLElement>("[data-layout-panel]");
  let editing = false;
  let draft: FloatLayout | null = null;
  let counts: Record<FloatTabId, number> = { tasks: 0, scripts: 0, notes: 0 };
  let dragId: FloatTabId | null = null;

  function subtitleFor(id: FloatTabId): string {
    if (!draft) return "";
    if (draft.hidden.includes(id)) return "Hidden — not in the tab bar";
    if (draft.defaultTab === id) return "Opens first";
    if (id === "notes") return counts.notes === 1 ? "1 note" : `${counts.notes} notes`;
    if (id === "tasks") return counts.tasks === 1 ? "1 task" : `${counts.tasks} tasks`;
    return counts.scripts === 1 ? "1 installed" : `${counts.scripts} installed`;
  }

  function renderRows(): void {
    const rowsBox = q<HTMLElement>("[data-layout-rows]");
    if (!rowsBox || !draft) return;
    rowsBox.innerHTML = "";
    for (const id of draft.order) {
      const tab = FLOAT_TABS.find((t) => t.id === id);
      if (!tab) continue;
      const hidden = draft.hidden.includes(id);
      const isDefault = draft.defaultTab === id;

      const row = document.createElement("div");
      row.className = "layout-row";
      if (hidden) row.classList.add("off");
      row.draggable = true;
      row.dataset.tabId = id;

      const grip = document.createElement("span");
      grip.className = "layout-grip";
      grip.textContent = "⋮⋮";
      grip.title = "Drag to reorder";
      row.appendChild(grip);

      const name = document.createElement("span");
      name.className = "layout-name";
      name.textContent = tab.label;
      const sub = document.createElement("small");
      sub.textContent = subtitleFor(id);
      name.appendChild(sub);
      row.appendChild(name);

      const eye = document.createElement("button");
      eye.type = "button";
      eye.className = "layout-eye";
      eye.dataset.layoutEye = id;
      eye.textContent = hidden ? "🚫" : "👁️";
      eye.title = hidden ? `Show ${tab.label}` : `Hide ${tab.label}`;
      eye.setAttribute("aria-label", hidden ? `Show ${tab.label}` : `Hide ${tab.label}`);
      row.appendChild(eye);

      const star = document.createElement("button");
      star.type = "button";
      star.className = "layout-star";
      star.dataset.layoutStar = id;
      star.textContent = isDefault ? "★" : "☆";
      star.classList.toggle("on", isDefault);
      star.title = isDefault ? `${tab.label} opens first` : `Make ${tab.label} open first`;
      star.setAttribute("aria-label", isDefault ? `${tab.label} opens first` : `Make ${tab.label} open first`);
      row.appendChild(star);

      rowsBox.appendChild(row);
    }
  }

  function renderPanel(): void {
    if (!panel || !draft) return;
    panel.innerHTML = "";
    const heading = document.createElement("h3");
    heading.textContent = "✎ Edit layout";
    panel.appendChild(heading);
    const hint = document.createElement("p");
    hint.className = "layout-hint";
    hint.textContent = "Drag ⋮⋮ to reorder the pages. Tap the eye to hide or show a page. Tap the star to set the page that opens first.";
    panel.appendChild(hint);
    const rowsBox = document.createElement("div");
    rowsBox.setAttribute("data-layout-rows", "");
    panel.appendChild(rowsBox);
    const saveRow = document.createElement("div");
    saveRow.className = "layout-save-row";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "layout-save";
    saveBtn.setAttribute("data-layout-save", "");
    saveBtn.textContent = "Save layout";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "layout-cancel";
    cancelBtn.setAttribute("data-layout-cancel", "");
    cancelBtn.textContent = "Cancel";
    saveRow.append(saveBtn, cancelBtn);
    panel.appendChild(saveRow);
    const note = document.createElement("p");
    note.className = "note-local";
    note.textContent = "Saved on this browser only — the same layout shows in both floating windows.";
    panel.appendChild(note);
  }

  function close(applied: boolean): void {
    if (!editing || !draft) return;
    const saved = draft;
    editing = false;
    draft = null;
    if (panel) {
      panel.innerHTML = "";
      panel.hidden = true;
    }
    opts.onClose(applied, saved);
  }

  async function open(): Promise<void> {
    if (editing) return;
    draft = await loadFloatLayout();
    try {
      const [tasks, scripts, notes] = await Promise.all([loadTasks(), loadScripts(), loadNotes()]);
      counts = { tasks: tasks.length, scripts: scripts.length, notes: notes.length };
    } catch {
      counts = { tasks: 0, scripts: 0, notes: 0 };
    }
    editing = true;
    renderPanel();
    if (panel) panel.hidden = false;
    renderRows();
    opts.onOpen();
  }

  // --- Row actions (delegated on the panel — rows are re-rendered) ---
  panel?.addEventListener("click", async (e) => {
    if (!editing || !draft) return;
    const target = e.target as HTMLElement | null;
    const eye = target?.closest?.("[data-layout-eye]") as HTMLElement | null;
    const star = target?.closest?.("[data-layout-star]") as HTMLElement | null;
    const save = target?.closest?.("[data-layout-save]") as HTMLElement | null;
    const cancel = target?.closest?.("[data-layout-cancel]") as HTMLElement | null;
    if (eye) {
      const id = eye.dataset.layoutEye as FloatTabId | undefined;
      if (!id) return;
      draft = draft.hidden.includes(id) ? showFloatTab(draft, id) : hideFloatTab(draft, id);
      renderRows();
      return;
    }
    if (star) {
      const id = star.dataset.layoutStar as FloatTabId | undefined;
      if (!id) return;
      draft = setFloatDefaultTab(draft, id);
      renderRows();
      return;
    }
    if (save) {
      const saved = draft;
      try {
        await saveFloatLayout(saved);
      } catch {
        // Storage failed — close anyway; the layout just won't persist.
      }
      close(true);
      return;
    }
    if (cancel) {
      close(false);
    }
  });

  // --- HTML5 drag-and-drop reorder (grip rows are draggable) ---
  panel?.addEventListener("dragstart", (e) => {
    if (!editing || !draft) return;
    const row = (e.target as HTMLElement | null)?.closest?.(".layout-row") as HTMLElement | null;
    if (!row) return;
    dragId = row.dataset.tabId as FloatTabId | undefined ?? null;
    if (!dragId) return;
    try {
      e.dataTransfer?.setData("text/plain", dragId);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    } catch {
      // Drag data unavailable — the drop handler still has dragId.
    }
    row.classList.add("dragging");
  });
  panel?.addEventListener("dragover", (e) => {
    if (!editing || !draft || !dragId) return;
    const row = (e.target as HTMLElement | null)?.closest?.(".layout-row") as HTMLElement | null;
    if (!row || row.dataset.tabId === dragId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const rect = row.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    row.classList.toggle("drop-before", before);
    row.classList.toggle("drop-after", !before);
  });
  panel?.addEventListener("dragleave", (e) => {
    const row = (e.target as HTMLElement | null)?.closest?.(".layout-row") as HTMLElement | null;
    row?.classList.remove("drop-before", "drop-after");
  });
  panel?.addEventListener("drop", (e) => {
    if (!editing || !draft || !dragId) return;
    const row = (e.target as HTMLElement | null)?.closest?.(".layout-row") as HTMLElement | null;
    if (!row || row.dataset.tabId === dragId) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const targetId = row.dataset.tabId as FloatTabId;
    let toIndex = draft.order.indexOf(targetId);
    if (!before) toIndex += 1;
    // moveFloatTab clamps; moving down past the removal point needs -1.
    const fromIndex = draft.order.indexOf(dragId);
    if (fromIndex !== -1 && fromIndex < toIndex) toIndex -= 1;
    draft = moveFloatTab(draft, dragId, toIndex);
    dragId = null;
    renderRows();
  });
  panel?.addEventListener("dragend", () => {
    dragId = null;
    panel.querySelectorAll(".layout-row").forEach((r) => r.classList.remove("dragging", "drop-before", "drop-after"));
  });

  q<HTMLElement>('[data-act="edit-layout"]')?.addEventListener("click", () => {
    void open();
  });

  async function refresh(): Promise<void> {
    if (editing) return; // Never clobber an open editor.
    const layout = await loadFloatLayout();
    opts.onExternalChange(layout);
  }

  return {
    open: () => void open(),
    refresh,
    isEditing: () => editing,
  };
}
