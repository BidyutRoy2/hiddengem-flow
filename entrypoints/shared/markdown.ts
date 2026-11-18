// HiddenGem Flow — small safe Markdown renderer for notes (v1.4, #16).
//
// The renderer NEVER uses innerHTML with note content (AUDIT A-01
// lesson): the parser turns text into a token tree of plain strings,
// and the DOM builder creates every node with createElement +
// textContent. A note body containing `<script>`, `<img onerror=…>`
// or a `javascript:` link renders as inert text — the live probe
// asserts exactly that.
//
// Supported subset (deliberate — notes are short):
//   # / ## / ### headings, paragraphs, `- ` bullet lists,
//   `- [ ]` / `- [x]` checklists, **bold**, *italic*, `code`,
//   [text](https://…) links (http(s) only — any other scheme renders
//   as plain text, never a link).
//
// Split in two on purpose, like the other shared modules:
//  * PURE parser (`parseMarkdown`, `parseChecklistItems`,
//    `toggleChecklistItem`): no DOM, no chrome — unit-testable in
//    plain Node (see smoke-v14.ts).
//  * DOM builder (`renderMarkdown`): takes a `doc` (defaults to the
//    global document) and returns an element built only from
//    createElement + textContent. Checklist checkboxes call back into
//    the caller — the renderer never writes storage itself.

export type MdSpan =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type MdBlock =
  | { type: "heading"; level: 1 | 2 | 3; spans: MdSpan[] }
  | { type: "para"; spans: MdSpan[] }
  | { type: "list"; items: MdSpan[][] }
  | { type: "checklist"; items: MdCheckItem[] };

export interface MdCheckItem {
  /** Index among ALL checklist items in the note (0-based) — the key
   *  the caller uses for its per-item task link. */
  index: number;
  checked: boolean;
  spans: MdSpan[];
}

/**
 * Parse inline spans: **bold**, *italic*, `code`, [text](url).
 * Unmatched markers stay literal text. A link whose URL is not
 * http(s) is rendered as plain text — never a clickable link. Pure.
 */
export function parseInline(text: string): MdSpan[] {
  const spans: MdSpan[] = [];
  const src = text ?? "";
  let i = 0;
  let buf = "";
  const flush = (): void => {
    if (buf) {
      spans.push({ kind: "text", text: buf });
      buf = "";
    }
  };
  while (i < src.length) {
    // Link: [text](url) — the URL must be http(s) to become a link.
    if (src[i] === "[") {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(src.slice(i));
      if (m) {
        const url = m[2];
        if (url.startsWith("http://") || url.startsWith("https://")) {
          flush();
          spans.push({ kind: "link", text: m[1], href: url });
          i += m[0].length;
          continue;
        }
        // Non-http(s) link: keep the whole thing as literal text.
        buf += m[0];
        i += m[0].length;
        continue;
      }
    }
    // Bold: **text**
    if (src.startsWith("**", i)) {
      const end = src.indexOf("**", i + 2);
      if (end !== -1 && end > i + 2) {
        flush();
        spans.push({ kind: "bold", text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    // Code: `text`
    if (src[i] === "`") {
      const end = src.indexOf("`", i + 1);
      if (end !== -1 && end > i + 1) {
        flush();
        spans.push({ kind: "code", text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Italic: *text* (single star, not part of **).
    if (src[i] === "*" && !src.startsWith("**", i)) {
      const end = src.indexOf("*", i + 1);
      if (end !== -1 && end > i + 1) {
        flush();
        spans.push({ kind: "italic", text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    buf += src[i];
    i += 1;
  }
  flush();
  return spans;
}

/**
 * Parse a note body into blocks. Headings (#/##/###), bullet lists
 * (`- `), checklists (`- [ ]` / `- [x]`, consecutive lines grouped),
 * everything else grouped into paragraphs on blank lines. A line
 * that looks like markup but is malformed stays literal text. Pure.
 */
export function parseMarkdown(body: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = (body ?? "").split(/\r?\n/);
  let checkIndex = 0;
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length === 0) return;
    blocks.push({ type: "para", spans: parseInline(para.join(" ")) });
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushPara();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, spans: parseInline(heading[2]) });
      i += 1;
      continue;
    }
    const check = /^-\s+\[([ xX])\]\s+(.*)$/.exec(trimmed);
    if (check) {
      flushPara();
      const items: MdCheckItem[] = [];
      while (i < lines.length) {
        const m = /^-\s+\[([ xX])\]\s+(.*)$/.exec(lines[i].trim());
        if (!m) break;
        items.push({ index: checkIndex++, checked: m[1].toLowerCase() === "x", spans: parseInline(m[2]) });
        i += 1;
      }
      blocks.push({ type: "checklist", items });
      continue;
    }
    if (/^-\s+/.test(trimmed)) {
      flushPara();
      const items: MdSpan[][] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!/^-\s+/.test(t) || /^-\s+\[/.test(t)) break;
        items.push(parseInline(t.replace(/^-\s+/, "")));
        i += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }
    para.push(trimmed);
    i += 1;
  }
  flushPara();
  return blocks;
}

/**
 * All checklist items in a body, in order. Pure — the tick handler
 * and the editor's link picker both read this.
 */
export function parseChecklistItems(body: string): MdCheckItem[] {
  const items: MdCheckItem[] = [];
  for (const block of parseMarkdown(body)) {
    if (block.type === "checklist") items.push(...block.items);
  }
  return items;
}

/**
 * Flip one checklist item (`- [ ]` ↔ `- [x]`) by its index among all
 * checklist items. Returns the new body; the input is returned
 * unchanged when the index does not exist. Pure.
 */
export function toggleChecklistItem(body: string, index: number): string {
  const lines = (body ?? "").split(/\r?\n/);
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*-\s+\[)([ xX])(\]\s+.*)$/.exec(lines[i]);
    if (!m) continue;
    seen += 1;
    if (seen !== index) continue;
    lines[i] = `${m[1]}${m[2].toLowerCase() === "x" ? " " : "x"}${m[3]}`;
    return lines.join("\n");
  }
  return body;
}

/** Plain text of a span list (for search / clipboard). Pure. */
export function spansToText(spans: MdSpan[]): string {
  return spans.map((s) => s.text).join("");
}

// ---------------------------------------------------------------------------
// DOM builder — createElement + textContent only, never innerHTML.
// ---------------------------------------------------------------------------

export interface RenderMarkdownOptions {
  /** Per-item task link: checklist index → task name to show. */
  checklistTaskNames?: Record<number, string>;
  /** Per-item task link state: checklist index → the task is already completed. */
  checklistTaskDone?: Record<number, boolean>;
  /** Per-item task link state: checklist index → the linked task no longer exists. */
  checklistTaskMissing?: Record<number, boolean>;
  /** Called when the user ticks/unticks a checklist item. */
  onChecklistToggle?: (index: number, checked: boolean) => void;
}

type AnyDoc = {
  createElement: (tag: string) => AnyEl;
};

type AnyEl = {
  textContent: string | null;
  className: string;
  // Method syntax (not property syntax) on purpose: real DOM
  // elements satisfy this structurally through method bivariance,
  // and the Node smoke-test shim implements the same shape.
  appendChild(child: unknown): unknown;
  append(...children: unknown[]): void;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, fn: (e: unknown) => void): void;
  classList: { add(...names: string[]): void; toggle(name: string, force?: boolean): void };
  // Checkbox state, set by the builder on input elements.
  checked?: boolean;
  type?: string;
  disabled?: boolean;
  href?: string;
  target?: string;
  rel?: string;
};

function appendSpans(parent: AnyEl, doc: AnyDoc, spans: MdSpan[]): void {
  for (const span of spans) {
    if (span.kind === "text") {
      const withText = doc as AnyDoc & { createTextNode?: (text: string) => AnyEl };
      if (typeof withText.createTextNode === "function") {
        parent.appendChild(withText.createTextNode(span.text));
      } else {
        parent.appendChild(textNode(doc, span.text));
      }
    } else if (span.kind === "bold") {
      const el = doc.createElement("strong");
      el.textContent = span.text;
      parent.appendChild(el);
    } else if (span.kind === "italic") {
      const el = doc.createElement("em");
      el.textContent = span.text;
      parent.appendChild(el);
    } else if (span.kind === "code") {
      const el = doc.createElement("code");
      el.textContent = span.text;
      parent.appendChild(el);
    } else if (span.kind === "link") {
      const el = doc.createElement("a");
      el.textContent = span.text;
      // The parser only ever emits http(s) hrefs; the check below is
      // belt and braces — a non-http(s) href never becomes a link.
      if (span.href.startsWith("http://") || span.href.startsWith("https://")) {
        el.setAttribute("href", span.href);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
      parent.appendChild(el);
    }
  }
}

function textNode(doc: AnyDoc, text: string): AnyEl {
  // A text node has no tag — emulate it with a span that carries only
  // textContent. Real DOM callers pass the real document, where
  // createTextNode exists; the shim path below keeps Node tests honest.
  const el = doc.createElement("span");
  el.textContent = text;
  return el;
}

/**
 * Render a note body into `container` (cleared first). Every node is
 * built with createElement + textContent — note content is never
 * assigned to innerHTML, so markup in a note renders as inert text.
 * Checklist items get a real checkbox; ticking calls
 * `options.onChecklistToggle` — the caller owns the storage write
 * and the linked-task completion. Returns the container.
 */
export function renderMarkdown(
  body: string,
  container: AnyEl,
  doc: AnyDoc = (globalThis as unknown as { document?: AnyDoc }).document as AnyDoc,
  options: RenderMarkdownOptions = {},
): AnyEl {
  // Clear without innerHTML (the caller may pass a real DOM element
  // or the Node test shim — both expose textContent + appendChild).
  container.textContent = "";
  const blocks = parseMarkdown(body);
  for (const block of blocks) {
    if (block.type === "heading") {
      const el = doc.createElement(block.level === 1 ? "h4" : block.level === 2 ? "h5" : "h6");
      el.className = "md-heading";
      appendSpans(el, doc, block.spans);
      container.appendChild(el);
    } else if (block.type === "para") {
      const el = doc.createElement("p");
      el.className = "md-para";
      appendSpans(el, doc, block.spans);
      container.appendChild(el);
    } else if (block.type === "list") {
      const ul = doc.createElement("ul");
      ul.className = "md-list";
      for (const item of block.items) {
        const li = doc.createElement("li");
        appendSpans(li, doc, item);
        ul.appendChild(li);
      }
      container.appendChild(ul);
    } else if (block.type === "checklist") {
      for (const item of block.items) {
        const row = doc.createElement("div");
        row.className = "md-check";
        if (item.checked) row.classList.add("done");
        const box = doc.createElement("input");
        box.type = "checkbox";
        box.checked = item.checked;
        box.className = "md-check-box";
        box.setAttribute("aria-label", `Checklist item ${item.index + 1}`);
        if (options.onChecklistToggle) {
          const idx = item.index;
          box.addEventListener("change", () => {
            options.onChecklistToggle?.(idx, box.checked === true);
          });
        } else {
          box.disabled = true;
        }
        row.appendChild(box);
        const label = doc.createElement("span");
        label.className = "md-check-label";
        appendSpans(label, doc, item.spans);
        row.appendChild(label);
        const taskName = options.checklistTaskNames?.[item.index];
        if (taskName !== undefined) {
          const link = doc.createElement("span");
          link.className = "md-check-link";
          if (options.checklistTaskMissing?.[item.index]) {
            link.textContent = "→ linked task gone";
          } else if (options.checklistTaskDone?.[item.index]) {
            link.textContent = `→ ${taskName} done ✓`;
          } else {
            link.textContent = `→ ${taskName}`;
          }
          row.appendChild(link);
        }
        container.appendChild(row);
      }
    }
  }
  return container;
}
