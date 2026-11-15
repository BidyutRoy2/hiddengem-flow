// HiddenGem Flow — Notepad UI for the floating windows (finding A-09).
//
// ONE shared UI layer for BOTH floating forms — the in-page window
// (entrypoints/floating.ts, Shadow DOM) and the standalone popup page
// (entrypoints/float/main.ts, plain DOM). The two forms have separate
// markup (template string vs index.html) and separate CSS (different
// prefixes), but the same data attributes and the same class names, so
// this module can mount into either by taking the root element.
//
// DATA: all state lives in shared/notes.ts (hiddengemflow.notes.v1).
// RENDERING: notes are rendered with createElement + textContent only —
// a note's title, body, brand and tags are user text and must never be
// interpolated as HTML (same rule as AUDIT A-01).
//
// DELETE is two-step, no window.confirm(): the first click arms that
// note's delete button (red "Confirm?"), the second click deletes it.
// Clicking anywhere else disarms — the arm is reset on any click that
// is not on the armed delete button.

import {
  NOTE_BRANDS,
  createNote,
  deleteNote,
  displayTitle,
  formatEditedDate,
  loadNotes,
  noteClipboardText,
  normalizeTags,
  saveNotes,
  sortNotes,
  searchNotes,
  toggleNotePin,
  updateNote,
  type Note,
  type NoteBrand,
} from "./notes";

export interface FloatNotesHandle {
  /** Re-read storage and re-render the list (safe while editing — the editor is untouched). */
  refresh: () => Promise<void>;
}

/**
 * Mount the Notepad page into `root`, which must already contain the
 * notes section markup (search input, + New note button, list, empty
 * line, count, view-all link, editor) with the data attributes used
 * below. `openDashboardNotes` opens the dashboard on its Notepad tab
 * (the "View all in Dashboard →" link). Returns a handle whose
 * refresh() the caller registers in its storage-change refreshers.
 */
export function mountFloatNotes(
  root: Document | HTMLElement,
  openDashboardNotes: () => void,
): FloatNotesHandle {
  const q = <T extends HTMLElement>(sel: string): T | null => root.querySelector(sel) as T | null;

  let notes: Note[] = [];
  let query = "";
  let view: "list" | "editor" = "list";
  let editingId: string | null = null;
  let draftBrand: NoteBrand = "HiddenGem";
  let draftTags: string[] = [];
  let armedDeleteId: string | null = null;
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  const listEl = q<HTMLUListElement>('[data-notes-list]');
  const emptyEl = q<HTMLElement>('[data-notes-empty]');
  const countEl = q<HTMLElement>('[data-notes-count]');
  const listViewEl = q<HTMLElement>('[data-notes-list-view]');
  const editorEl = q<HTMLElement>('[data-notes-editor]');
  const editorTitleEl = q<HTMLElement>('[data-notes-editor-title]');
  const titleInput = q<HTMLInputElement>('[data-notes-title]');
  const bodyInput = q<HTMLTextAreaElement>('[data-notes-body]');
  const tagsBox = q<HTMLElement>('[data-notes-tags]');
  const tagInput = q<HTMLInputElement>('[data-notes-tag-input]');

  function showView(next: "list" | "editor"): void {
    view = next;
    if (listViewEl) listViewEl.hidden = next !== "list";
    if (editorEl) editorEl.hidden = next !== "editor";
  }

  function renderBrandPicker(): void {
    const box = q<HTMLElement>('[data-notes-brand]');
    if (!box) return;
    for (const btn of Array.from(box.querySelectorAll<HTMLElement>("[data-brand]"))) {
      const brand = btn.dataset.brand ?? "";
      btn.classList.toggle("sel-gem", brand === draftBrand && brand === "HiddenGem");
      btn.classList.toggle("sel-gold", brand === draftBrand && brand !== "HiddenGem");
    }
  }

  function renderEditorTags(): void {
    if (!tagsBox || !tagInput) return;
    // Rebuild the chips; the input is re-appended last (it is the only
    // element that keeps user-typed text, so it is kept, not rebuilt).
    for (const chip of Array.from(tagsBox.querySelectorAll("[data-tag-chip]"))) chip.remove();
    for (const tag of draftTags) {
      const chip = document.createElement("span");
      chip.className = "note-tag";
      chip.setAttribute("data-tag-chip", "");
      chip.textContent = `${tag} ×`;
      chip.title = `Remove tag ${tag}`;
      chip.addEventListener("click", () => {
        draftTags = draftTags.filter((t) => t !== tag);
        renderEditorTags();
      });
      tagsBox.insertBefore(chip, tagInput);
    }
  }

  function openEditor(note?: Note): void {
    armedDeleteId = null;
    editingId = note ? note.id : null;
    draftBrand = note ? note.brand : "HiddenGem";
    draftTags = note ? [...note.tags] : [];
    if (editorTitleEl) editorTitleEl.textContent = note ? "Edit note" : "New note";
    if (titleInput) titleInput.value = note ? note.title : "";
    if (bodyInput) bodyInput.value = note ? note.body : "";
    if (tagInput) tagInput.value = "";
    renderBrandPicker();
    renderEditorTags();
    showView("editor");
    titleInput?.focus();
  }

  function closeEditor(): void {
    editingId = null;
    showView("list");
  }

  function renderList(): void {
    if (!listEl) return;
    const pinnedCount = notes.filter((n) => n.pinned).length;
    const visible = sortNotes(searchNotes(notes, query));
    if (countEl) {
      if (notes.length === 0) {
        countEl.hidden = true;
        countEl.textContent = "";
      } else {
        countEl.hidden = false;
        countEl.textContent =
          pinnedCount > 0
            ? `${notes.length} note${notes.length === 1 ? "" : "s"} · ${pinnedCount} pinned`
            : `${notes.length} note${notes.length === 1 ? "" : "s"}`;
      }
    }
    if (emptyEl) {
      if (notes.length === 0) {
        emptyEl.hidden = false;
        emptyEl.textContent = "No notes yet — tap + New note to write your first one.";
      } else if (visible.length === 0) {
        emptyEl.hidden = false;
        emptyEl.textContent = "No notes match that search.";
      } else {
        emptyEl.hidden = true;
      }
    }
    listEl.innerHTML = "";
    for (const note of visible) {
      const li = document.createElement("li");
      li.className = "note";
      if (note.pinned) li.classList.add("pinned");
      li.dataset.noteId = note.id;

      const top = document.createElement("div");
      top.className = "note-top";
      if (note.pinned) {
        const pinMark = document.createElement("span");
        pinMark.className = "note-pin-mark";
        pinMark.textContent = "📌";
        top.appendChild(pinMark);
      }
      const title = document.createElement("span");
      title.className = "note-title";
      title.textContent = displayTitle(note.title, note.body);
      top.appendChild(title);
      const brand = document.createElement("span");
      brand.className = "brand";
      if (note.brand === "HiddenGem") brand.classList.add("gem");
      brand.textContent = note.brand;
      top.appendChild(brand);
      li.appendChild(top);

      if (note.tags.length > 0) {
        const tags = document.createElement("div");
        tags.className = "note-tags";
        for (const tag of note.tags) {
          const chip = document.createElement("span");
          chip.className = "note-tag";
          chip.textContent = tag;
          tags.appendChild(chip);
        }
        li.appendChild(tags);
      }

      if (note.body.trim()) {
        const body = document.createElement("div");
        body.className = "note-body";
        body.textContent = note.body;
        li.appendChild(body);
      }

      const foot = document.createElement("div");
      foot.className = "note-foot";
      const meta = document.createElement("span");
      meta.className = "note-meta";
      meta.textContent = formatEditedDate(note.updatedAt);
      foot.appendChild(meta);
      const acts = document.createElement("span");
      acts.className = "note-acts";
      const makeAct = (act: string, label: string, title: string): HTMLButtonElement => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "note-act";
        btn.dataset.noteAct = act;
        btn.dataset.noteId = note.id;
        btn.textContent = label;
        btn.title = title;
        btn.setAttribute("aria-label", `${title} — ${displayTitle(note.title, note.body)}`);
        return btn;
      };
      const copyBtn = makeAct("copy", "📋", "Copy note");
      const editBtn = makeAct("edit", "✏️", "Edit note");
      const pinBtn = makeAct("pin", "📌", note.pinned ? "Unpin" : "Pin to top");
      if (note.pinned) pinBtn.classList.add("on");
      const delBtn = makeAct("delete", "🗑️", "Delete note");
      delBtn.classList.add("del");
      if (armedDeleteId === note.id) {
        delBtn.classList.add("armed");
        delBtn.textContent = "Confirm?";
        delBtn.title = "Click again to delete this note";
      }
      acts.append(copyBtn, editBtn, pinBtn, delBtn);
      foot.appendChild(acts);
      li.appendChild(foot);
      listEl.appendChild(li);
    }
  }

  async function persist(): Promise<void> {
    await saveNotes(notes);
    renderList();
  }

  // --- List actions (delegated on the list — the rows are re-rendered) ---
  listEl?.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement | null)?.closest?.("button[data-note-act]") as HTMLButtonElement | null;
    if (!btn) return;
    const act = btn.dataset.noteAct ?? "";
    const id = btn.dataset.noteId ?? "";
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    if (act === "copy") {
      const text = noteClipboardText(note);
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        // Clipboard API unavailable (rare) — fall back to execCommand.
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand("copy");
          ta.remove();
        } catch {
          ok = false;
        }
      }
      btn.textContent = ok ? "✓" : "✕";
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        btn.textContent = "📋";
      }, 1200);
      return;
    }
    if (act === "edit") {
      openEditor(note);
      return;
    }
    if (act === "pin") {
      notes = toggleNotePin(notes, id);
      await persist();
      return;
    }
    if (act === "delete") {
      if (armedDeleteId === id) {
        armedDeleteId = null;
        if (editingId === id) closeEditor();
        notes = deleteNote(notes, id);
        await persist();
      } else {
        armedDeleteId = id;
        renderList();
      }
    }
  });

  // Clicking anywhere else disarms a pending delete. The button's own
  // click runs first (target phase), so an arm-confirm click is never
  // mistaken for "elsewhere" — the delegated listener only fires for
  // clicks whose target is not a delete button.
  root.addEventListener("click", (e) => {
    if (!armedDeleteId) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("[data-note-act='delete']")) return;
    armedDeleteId = null;
    renderList();
  });

  // --- Editor ---
  q<HTMLElement>('[data-notes-new]')?.addEventListener("click", () => openEditor());
  q<HTMLElement>('[data-notes-save]')?.addEventListener("click", async () => {
    const title = titleInput?.value ?? "";
    const body = bodyInput?.value ?? "";
    if (editingId) {
      const stillThere = notes.some((n) => n.id === editingId);
      if (stillThere) {
        notes = updateNote(notes, editingId, { title, body, brand: draftBrand, tags: draftTags });
      } else {
        // The note was deleted elsewhere while editing — save as new
        // instead of silently losing the edit.
        notes = sortNotes([...notes, createNote(title, body, draftBrand, draftTags)]);
      }
    } else {
      notes = sortNotes([...notes, createNote(title, body, draftBrand, draftTags)]);
    }
    await persist();
    closeEditor();
  });
  q<HTMLElement>('[data-notes-cancel]')?.addEventListener("click", () => closeEditor());
  q<HTMLElement>('[data-notes-brand]')?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest?.("[data-brand]") as HTMLElement | null;
    if (!btn) return;
    const brand = btn.dataset.brand ?? "";
    if ((NOTE_BRANDS as string[]).includes(brand)) {
      draftBrand = brand as NoteBrand;
      renderBrandPicker();
    }
  });
  tagInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const value = tagInput.value;
    if (!value.trim()) return;
    draftTags = normalizeTags([...draftTags, value]);
    tagInput.value = "";
    renderEditorTags();
  });
  q<HTMLInputElement>('[data-notes-search]')?.addEventListener("input", (e) => {
    query = (e.target as HTMLInputElement | null)?.value ?? "";
    renderList();
  });
  q<HTMLElement>('[data-notes-viewall]')?.addEventListener("click", () => openDashboardNotes());

  async function refresh(): Promise<void> {
    notes = await loadNotes();
    // Never clobber an open editor: only the list re-renders.
    if (view === "list") renderList();
  }

  void refresh();
  return { refresh };
}
