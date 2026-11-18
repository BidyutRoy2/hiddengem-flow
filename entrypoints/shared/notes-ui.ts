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

import { parseChecklistItems, renderMarkdown, spansToText, toggleChecklistItem } from "./markdown";
import {
  NOTE_BRANDS,
  createNote,
  deleteNote,
  displayTitle,
  formatDueDate,
  formatEditedDate,
  isNoteOverdue,
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
import { loadTasks, markTaskCompleted, saveTasks, type Task } from "./tasks";

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
  // v1.4: tasks are needed to name linked tasks / checklist links and
  // to complete a task when its checklist item is ticked.
  let tasks: Task[] = [];
  let query = "";
  let view: "list" | "editor" = "list";
  let editingId: string | null = null;
  let draftBrand: NoteBrand = "HiddenGem";
  let draftTags: string[] = [];
  let draftChecklistLinks: Record<string, string> = {};
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
  const dueInput = q<HTMLInputElement>('[data-notes-due]');
  const taskSelect = q<HTMLSelectElement>('[data-notes-task]');
  const checklistLinksBox = q<HTMLElement>('[data-notes-checklist-links]');

  /** "2026-11-17T09:00" (local) for a datetime-local input. Pure-ish (date math only). */
  function toLocalInputValue(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** A datetime-local value → ms timestamp (local time), or null when empty/invalid. */
  function fromLocalInputValue(value: string): number | null {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return null;
    const ms = new Date(trimmed).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  /**
   * v1.4: ticking a checklist item flips its `- [ ]` / `- [x]` line
   * in the note body (the body is the single source of truth for
   * done state) and — only when the item is ticked ON and carries an
   * explicit per-item task link — completes that task. The link is
   * validated against live tasks first: a link to a deleted task
   * completes nothing, and an untick never un-completes a task.
   */
  async function handleChecklistToggle(note: Note, index: number, checked: boolean): Promise<void> {
    const newBody = toggleChecklistItem(note.body, index);
    if (newBody === note.body) return;
    notes = updateNote(notes, note.id, { body: newBody });
    await saveNotes(notes);
    renderList();
    const linkTaskId = note.checklistLinks?.[String(index)];
    if (!checked || !linkTaskId) return;
    const allTasks = await loadTasks();
    const task = allTasks.find((t) => t.id === linkTaskId);
    if (!task || task.completed === true) return;
    await saveTasks(markTaskCompleted(allTasks, linkTaskId));
    tasks = await loadTasks();
    renderList();
  }

  /** Rebuild the editor's per-item task-link rows from the body's
   *  current checklist lines. Select values are kept in
   *  draftChecklistLinks by item index, so re-rendering never loses a
   *  choice the user already made. */
  function renderChecklistLinkRows(): void {
    if (!checklistLinksBox) return;
    checklistLinksBox.innerHTML = "";
    const body = bodyInput?.value ?? "";
    const items = parseChecklistItems(body);
    if (items.length === 0) return;
    const head = document.createElement("p");
    head.className = "note-checklist-head";
    head.textContent = "Checklist links — ticking a linked item completes its task:";
    checklistLinksBox.appendChild(head);
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "note-checklist-row";
      const label = document.createElement("span");
      label.className = "note-checklist-label";
      const text = spansToText(item.spans);
      label.textContent = `${item.checked ? "☑" : "☐"} ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`;
      label.title = text;
      row.appendChild(label);
      const select = document.createElement("select");
      select.className = "note-checklist-sel";
      select.setAttribute("aria-label", `Task linked to checklist item ${item.index + 1}`);
      select.dataset.checklistIndex = String(item.index);
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "No linked task";
      select.appendChild(none);
      for (const task of tasks) {
        const opt = document.createElement("option");
        opt.value = task.id;
        opt.textContent = task.name;
        select.appendChild(opt);
      }
      select.value = draftChecklistLinks[String(item.index)] ?? "";
      select.addEventListener("change", () => {
        if (select.value) draftChecklistLinks[String(item.index)] = select.value;
        else delete draftChecklistLinks[String(item.index)];
      });
      row.appendChild(select);
      checklistLinksBox.appendChild(row);
    }
  }

  /** Fill the "Linked task" select (editor) from the current task list. */
  function renderTaskSelect(): void {
    if (!taskSelect) return;
    const current = taskSelect.value;
    taskSelect.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "No linked task";
    taskSelect.appendChild(none);
    for (const task of tasks) {
      const opt = document.createElement("option");
      opt.value = task.id;
      opt.textContent = task.name;
      taskSelect.appendChild(opt);
    }
    taskSelect.value = current;
  }

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
    draftChecklistLinks = note?.checklistLinks ? { ...note.checklistLinks } : {};
    if (editorTitleEl) editorTitleEl.textContent = note ? "Edit note" : "New note";
    if (titleInput) titleInput.value = note ? note.title : "";
    if (bodyInput) bodyInput.value = note ? note.body : "";
    if (tagInput) tagInput.value = "";
    if (dueInput) dueInput.value = note?.dueAt ? toLocalInputValue(note.dueAt) : "";
    renderTaskSelect();
    if (taskSelect) taskSelect.value = note?.linkedTaskId ?? "";
    renderBrandPicker();
    renderEditorTags();
    renderChecklistLinkRows();
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

      // v1.4: due-date + linked-task chips (honest when the link is stale).
      const dueText = formatDueDate(note.dueAt);
      const linkedTask = note.linkedTaskId ? tasks.find((t) => t.id === note.linkedTaskId) ?? null : null;
      if (dueText || note.linkedTaskId) {
        const chips = document.createElement("div");
        chips.className = "note-chips";
        if (dueText) {
          const dueChip = document.createElement("span");
          dueChip.className = "note-due-chip";
          if (isNoteOverdue(note.dueAt)) dueChip.classList.add("overdue");
          dueChip.textContent = dueText;
          chips.appendChild(dueChip);
        }
        if (note.linkedTaskId) {
          const linkChip = document.createElement("span");
          linkChip.className = "note-link-chip";
          linkChip.textContent = linkedTask ? `→ ${linkedTask.name}` : "→ linked task gone";
          chips.appendChild(linkChip);
        }
        li.appendChild(chips);
      }

      if (note.body.trim()) {
        // v1.4: the body renders as Markdown (safe renderer — DOM
        // nodes + textContent only, never innerHTML with note
        // content). Notes with checklist items are not line-clamped,
        // so their checkboxes stay visible and clickable.
        const body = document.createElement("div");
        body.className = "note-body";
        const items = parseChecklistItems(note.body);
        if (items.length > 0) body.classList.add("has-checklist");
        const names: Record<number, string> = {};
        const done: Record<number, boolean> = {};
        const missing: Record<number, boolean> = {};
        for (const [idxStr, taskId] of Object.entries(note.checklistLinks ?? {})) {
          const idx = Number(idxStr);
          const task = tasks.find((t) => t.id === taskId);
          if (task) {
            names[idx] = task.name;
            done[idx] = task.completed === true;
          } else {
            names[idx] = "";
            missing[idx] = true;
          }
        }
        renderMarkdown(note.body, body, document, {
          checklistTaskNames: names,
          checklistTaskDone: done,
          checklistTaskMissing: missing,
          onChecklistToggle: (index, checked) => {
            void handleChecklistToggle(note, index, checked);
          },
        });
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
    const dueAt = fromLocalInputValue(dueInput?.value ?? "");
    const linkedTaskId = taskSelect?.value ? taskSelect.value : null;
    const checklistLinks = Object.keys(draftChecklistLinks).length > 0 ? { ...draftChecklistLinks } : null;
    if (editingId) {
      const stillThere = notes.some((n) => n.id === editingId);
      if (stillThere) {
        notes = updateNote(notes, editingId, { title, body, brand: draftBrand, tags: draftTags, dueAt, linkedTaskId, checklistLinks });
      } else {
        // The note was deleted elsewhere while editing — save as new
        // instead of silently losing the edit.
        notes = sortNotes([
          ...notes,
          createNote(title, body, draftBrand, draftTags, Date.now(), undefined, {
            dueAt: dueAt ?? undefined,
            linkedTaskId,
            checklistLinks: checklistLinks ?? undefined,
          }),
        ]);
      }
    } else {
      notes = sortNotes([
        ...notes,
        createNote(title, body, draftBrand, draftTags, Date.now(), undefined, {
          dueAt: dueAt ?? undefined,
          linkedTaskId,
          checklistLinks: checklistLinks ?? undefined,
        }),
      ]);
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
  // v1.4: adding/removing a checklist line while editing re-renders
  // the link rows (on blur, so an open select is never rebuilt
  // mid-choice). Existing link choices survive by item index.
  bodyInput?.addEventListener("change", () => renderChecklistLinkRows());
  q<HTMLElement>('[data-notes-viewall]')?.addEventListener("click", () => openDashboardNotes());

  async function refresh(): Promise<void> {
    notes = await loadNotes();
    tasks = await loadTasks();
    // Never clobber an open editor: only the list re-renders.
    if (view === "list") renderList();
  }

  void refresh();
  return { refresh };
}
