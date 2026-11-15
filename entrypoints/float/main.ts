import {
  MSG_OPEN_EXTENSION_DETAILS,
  MSG_SCRIPTS_STATUS,
  MSG_TOGGLE_SCRIPT,
  SCRIPTS_KEY,
  SCRIPT_ERRORS_KEY,
  type Script,
} from "../shared/scripts";
import {
  TASKS_KEY,
  buildFaviconUrl,
  createTask,
  formatOpenResult,
  letterFor,
  loadTasks,
  openUrlsViaBackground,
  saveTasks,
  sortTasks,
  type Task,
} from "../shared/tasks";
import { UPDATE_KEY, isUpdateAvailable, loadUpdateRecord } from "../shared/updates";

// HiddenGem Flow — standalone floating window page (v1.0.2, float.html).
//
// WHY THIS PAGE EXISTS: the in-page floating window is a content script
// injected into the active tab, and Chrome forbids injection on
// chrome://, brave://, the Web Store, about:blank and new-tab pages —
// so a toolbar click there did nothing at all. The background now
// opens THIS page as a popup window (chrome.windows.create, type
// "popup", 360x680) when the active tab is not an http(s) page. No
// chrome_url_overrides — the user's new tab page is never replaced.
//
// SAME UI as the in-page window, minus the parts that only make sense
// on a page: no Shadow DOM (this IS its own page), no internal drag
// (the OS popup window itself is draggable — grab its title bar), no
// Smart Notification Bridge (there is no site to match against), and
// "Add current site" is disabled with a hint, because there is no site
// to add from here. Storage logic is NOT duplicated — tasks and script
// status come from the same shared modules as the in-page window
// (shared/tasks.ts, shared/scripts.ts); only the DOM rendering is
// page-specific, because the page DOM is not a Shadow DOM.

declare const chrome: any;

const GITHUB_URL = "https://github.com/BidyutRoy2/hiddengem-flow-store";

function q<T extends HTMLElement>(sel: string): T | null {
  return document.querySelector(sel) as T | null;
}

/** Current task list (module scope — the add form needs it for the duplicate check). */
let tasks: Task[] = [];

/** Unreleased: show the open result ("Opened 3 tabs." / "Opened 50 tabs. 10 skipped (50 open at a time)."). */
function showOpenStatus(message: string): void {
  const status = q<HTMLElement>('[data-status="open"]');
  if (!status) return;
  if (message) {
    status.textContent = message;
    status.hidden = false;
  } else {
    status.textContent = "";
    status.hidden = true;
  }
}

/** Daily Tasks: all saved tasks (scrollable), click one opens it. */
async function renderTasks(): Promise<void> {
  const list = q<HTMLUListElement>('[data-list="tasks"]');
  const empty = q<HTMLElement>('[data-empty="tasks"]');
  const openAllBtn = q<HTMLButtonElement>('[data-act="open-all"]');
  if (!list) return;
  try {
    tasks = await loadTasks();
  } catch {
    tasks = [];
  }
  const sorted = sortTasks(tasks);
  if (empty) empty.hidden = tasks.length !== 0;
  if (openAllBtn) openAllBtn.disabled = tasks.length === 0;
  list.innerHTML = "";
  for (const task of sorted) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = `Open ${task.name} in a new tab`;
    const fav = document.createElement("span");
    fav.className = "fav";
    fav.textContent = letterFor(task.name);
    const favUrl = task.favicon ?? buildFaviconUrl(task.url);
    if (favUrl) {
      const img = document.createElement("img");
      img.src = favUrl;
      img.alt = "";
      img.addEventListener("error", () => img.remove());
      fav.appendChild(img);
    }
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = task.name;
    btn.append(fav, nm);
    if (task.pinned) {
      const pin = document.createElement("span");
      pin.className = "pin";
      pin.textContent = "★";
      btn.append(pin);
    }
    btn.addEventListener("click", () => {
      void openUrlsViaBackground([task.url]).then((result) => {
        showOpenStatus(result.ok ? formatOpenResult(result) : "Could not open the tab — try again.");
      });
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
  if (openAllBtn) {
    openAllBtn.onclick = () => {
      void openUrlsViaBackground(sorted.map((t) => t.url)).then((result) => {
        showOpenStatus(result.ok ? formatOpenResult(result) : "Could not open the tabs — try again.");
      });
    };
  }
}

/**
 * Active Scripts: there is no page here, so there is nothing to match
 * @match patterns against — the list shows every enabled installed
 * script, with its toggle. The note says so honestly instead of
 * pretending these scripts are "running on this page".
 */
async function renderScripts(): Promise<void> {
  const list = q<HTMLUListElement>('[data-list="scripts"]');
  const empty = q<HTMLElement>('[data-empty="scripts"]');
  const banner = q<HTMLElement>('[data-banner="userscripts"]');
  const note = q<HTMLElement>('[data-note="scripts"]');
  if (!list) return;
  interface StatusResponse {
    ok?: boolean;
    available?: boolean;
    error?: string;
    scripts?: Script[];
    hostAccess?: Record<string, boolean>;
  }
  let res: StatusResponse | null = null;
  try {
    res = (await chrome.runtime.sendMessage({ type: MSG_SCRIPTS_STATUS })) as StatusResponse;
  } catch {
    res = null;
  }
  const available = res?.ok === true && res?.available === true;
  // Unreleased: live "User Scripts: ON / OFF" status + the button that
  // opens the extension's Details page (the toggle itself still needs
  // a human click there). Re-checked on every render, including when
  // the popup regains focus after the user flips the toggle.
  const usText = q<HTMLElement>('[data-us-text]');
  const usEnable = q<HTMLButtonElement>('[data-act="us-enable"]');
  if (usText) {
    usText.textContent = available ? "User Scripts: ON" : "User Scripts: OFF";
    usText.className = available ? "on" : "off";
  }
  if (usEnable) usEnable.hidden = available;
  // The banner text lives in index.html (with the exact enable steps);
  // here we only show or hide it.
  if (banner) banner.hidden = available;
  if (!available) {
    list.innerHTML = "";
    if (empty) {
      empty.hidden = false;
      empty.textContent = "Scripts are paused until user scripts are allowed.";
    }
    if (note) note.hidden = true;
    return;
  }
  const scripts: Script[] = Array.isArray(res?.scripts) ? (res!.scripts as Script[]) : [];
  const enabled = scripts.filter((s) => s.enabled);
  list.innerHTML = "";
  for (const script of enabled) {
    const li = document.createElement("li");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = true;
    toggle.title = `Disable ${script.name}`;
    toggle.setAttribute("aria-label", `Enable ${script.name}`);
    toggle.addEventListener("change", async () => {
      try {
        await chrome.runtime.sendMessage({ type: MSG_TOGGLE_SCRIPT, id: script.id, enabled: toggle.checked });
      } catch {
        toggle.checked = !toggle.checked;
      }
      await renderScripts();
    });
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = script.name;
    nm.title = script.matches.join(", ");
    const ver = document.createElement("span");
    ver.className = "ver";
    ver.textContent = `v${script.version}`;
    li.append(toggle, nm, ver);
    list.appendChild(li);
  }
  if (empty) {
    empty.hidden = enabled.length !== 0;
    empty.textContent =
      scripts.length === 0 ? "No scripts installed yet." : "No scripts enabled.";
  }
  if (note) {
    note.hidden = scripts.length === 0;
    const needsAccess = enabled.filter((s) => res?.hostAccess?.[s.id] === false);
    const base = `${scripts.length} installed · ${enabled.length} enabled — no website open, so scripts are listed, not matched to a page`;
    note.textContent =
      needsAccess.length > 0
        ? `${base} · ${needsAccess.length} need${needsAccess.length === 1 ? "s" : ""} site access — Dashboard → Scripts → Grant site access`
        : base;
  }
}

/**
 * Extension update line (Unreleased) — same compact line as the
 * in-page floating window. Reads the STORED check record only; the
 * background checks, this page never fetches. Clicking opens the
 * dashboard, where the banner has the download link.
 */
async function renderUpdateLine(): Promise<void> {
  const line = q<HTMLButtonElement>('[data-update]');
  if (!line) return;
  let record: Awaited<ReturnType<typeof loadUpdateRecord>> = null;
  try {
    record = await loadUpdateRecord();
  } catch {
    record = null;
  }
  if (!record || !isUpdateAvailable(record)) {
    line.hidden = true;
    line.textContent = "";
    return;
  }
  line.textContent = `Update available: ${record.tag} — open the Dashboard to download it.`;
  line.hidden = false;
}

function refreshAll(): void {
  void renderTasks().catch(() => {
    // Best-effort refresh — a failed re-read must not break the window.
  });
  void renderScripts().catch(() => {
    // Same as above.
  });
  void renderUpdateLine().catch(() => {
    // Same as above.
  });
}

// --- Buttons ---
q<HTMLButtonElement>('[data-act="close"]')?.addEventListener("click", () => {
  window.close();
});
q<HTMLButtonElement>(".dash")?.addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "hiddengemflow:open-dashboard" }).catch(() => {
    // Dashboard open failed — nothing else to do from here.
  });
});
q<HTMLElement>('[data-act="view-all"]')?.addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "hiddengemflow:open-dashboard" }).catch(() => {
    // Same as above.
  });
});
// "Add current site" is disabled in the HTML (there is no site to add
// from a standalone window), so it has no handler on purpose — a
// disabled button cannot be clicked, and the hint under it explains why.

// Unreleased — manual add form: Name + URL by hand, since there is no
// current site here. Same createTask + duplicate check as the
// dashboard ("This site is already saved."), then the list refreshes.
q<HTMLButtonElement>('[data-act="add-task"]')?.addEventListener("click", () => {
  const form = q<HTMLElement>('[data-form="add-task"]');
  if (form) form.hidden = false;
  q<HTMLInputElement>('[data-in="name"]')?.focus();
});
q<HTMLButtonElement>('[data-act="save-task"]')?.addEventListener("click", async () => {
  const errBox = q<HTMLElement>('[data-err="add-task"]');
  const nameInput = q<HTMLInputElement>('[data-in="name"]');
  const urlInput = q<HTMLInputElement>('[data-in="url"]');
  const showErr = (msg: string): void => {
    if (!errBox) return;
    errBox.textContent = msg;
    errBox.hidden = !msg;
  };
  try {
    const task = createTask(nameInput?.value ?? "", urlInput?.value ?? "", Date.now(), undefined, tasks);
    await saveTasks([...tasks, task]);
  } catch (err) {
    showErr(err instanceof Error ? err.message : "That URL does not look valid.");
    return;
  }
  if (nameInput) nameInput.value = "";
  if (urlInput) urlInput.value = "";
  showErr("");
  const form = q<HTMLElement>('[data-form="add-task"]');
  if (form) form.hidden = true;
  await renderTasks();
});
q<HTMLButtonElement>('[data-act="cancel-task"]')?.addEventListener("click", () => {
  const form = q<HTMLElement>('[data-form="add-task"]');
  if (form) form.hidden = true;
  const errBox = q<HTMLElement>('[data-err="add-task"]');
  if (errBox) {
    errBox.textContent = "";
    errBox.hidden = true;
  }
});

// Unreleased — the "Open extension details to enable" button. It only
// OPENS the Details page; the toggle itself still needs a human click
// there (no extension can flip it).
q<HTMLButtonElement>('[data-act="us-enable"]')?.addEventListener("click", async (e) => {
  const btn = e.currentTarget as HTMLButtonElement | null;
  try {
    const res = (await chrome.runtime.sendMessage({ type: MSG_OPEN_EXTENSION_DETAILS })) as { ok?: boolean; error?: string } | null;
    if (res?.ok) return;
    throw new Error(res?.error ?? "Could not open the extensions page.");
  } catch {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Could not open — open chrome://extensions yourself";
    }
  }
});

// The update line opens the dashboard (same as the "Open Dashboard"
// button below — the banner there has the download link).
q<HTMLButtonElement>('[data-update]')?.addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "hiddengemflow:open-dashboard" }).catch(() => {
    // Dashboard open failed — nothing else to do from here.
  });
});

// Unreleased: re-check when the popup regains focus — the user may have
// just flipped the toggle on the Details page and come back.
window.addEventListener("focus", () => {
  refreshAll();
});

// Live-update while the popup stays open (same pattern as the dashboard).
try {
  chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
    if (areaName !== "local") return;
    if (changes[TASKS_KEY] || changes[SCRIPTS_KEY] || changes[SCRIPT_ERRORS_KEY] || changes[UPDATE_KEY]) {
      refreshAll();
    }
  });
} catch {
  // Storage events unavailable — the initial render still applies.
}

void refreshAll();

// Keep the GitHub URL in one place for the footer link check (the href
// itself lives in index.html); referenced here so a future URL change
// has a single obvious spot to update alongside it.
void GITHUB_URL;
