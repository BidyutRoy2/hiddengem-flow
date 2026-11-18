// HiddenGem Flow — AI authoring, LOCAL templates first (Later, #24).
//
// A natural-language prompt → a script DRAFT from BUILT-IN prompt
// templates (pattern-based, shipped in the extension, no network).
// The draft is ALWAYS shown as a preview; it is NEVER installed
// without the user pressing Save — which routes through the normal
// v1.3 editor (scan + confirm + version history). NO cloud LLM call
// by default.
//
// CLOUD LLM exists ONLY as an explicit opt-in setting naming a
// provider + the user's own API key (BYOK, stored in the browser
// only under AI_TOKENS_KEY, never in backups, never logged). If no
// provider/key is configured, the cloud path simply does not exist
// in the UI beyond the opt-in setting text. The cloud call itself
// runs from the dashboard page (user gesture) to the provider's
// endpoint — the key is sent ONLY there, never anywhere else. A
// cloud draft goes through the SAME preview + editor + scan path
// as a template draft: it is never executed before Save, and never
// installed without the user's confirm.
//
// PROVIDERS (v2.0.2): Groq, Google Gemini, NVIDIA NIM, OpenRouter,
// Together AI, Hugging Face, Cerebras, Mistral — each with its own
// fixed endpoint + default free model — plus Custom (the user types
// a base URL). Every provider speaks the OpenAI-compatible chat
// completions shape EXCEPT Gemini, which has its own adapter below.
// The dashboard never builds a request URL itself: buildCloudCall
// is the single place a key meets an endpoint, and it only ever
// returns the endpoint of the provider the user selected. v2.0.2
// adds buildModelsCall — the same single-place discipline for the
// models-list request (Detect models).
//
// TEMPLATE SAFETY (the audit rule): templates are static strings
// with slot substitution of VALIDATED values only — a hostname that
// passes parseAiHost, a CSS selector that passes
// validateAiSelector, or a free-text value embedded via
// JSON.stringify (so a quote in the prompt can never break out of
// the string). A prompt whose slots cannot be validated does NOT
// produce a draft: it returns a plain-English error + what to try
// instead. No eval / new Function anywhere — the draft is plain text
// the user reviews, and a saved script runs through the existing
// chrome.userScripts registration.
//
// Same split as shared/tasks.ts: PURE half first (no chrome APIs, no
// DOM, no hidden Date.now()), storage half after. Unit-testable in
// plain Node (see smoke-later.ts).

declare const chrome: any;

/** AI authoring settings — NO API key here (it lives under AI_TOKENS_KEY). */
export const AI_KEY = "hiddengemflow.ai.v1";
/** Cloud LLM API keys — NEVER in backups, NEVER in logs. One key per provider, all under this one storage key. */
export const AI_TOKENS_KEY = "hiddengemflow.ai.tokens.v1";

/** The nine cloud providers. "custom" has no fixed endpoint — the user types a base URL. */
export type AiProviderId =
  | "groq"
  | "gemini"
  | "nvidia"
  | "openrouter"
  | "together"
  | "huggingface"
  | "cerebras"
  | "mistral"
  | "custom";

export interface AiProviderDef {
  id: AiProviderId;
  /** Short name shown in the dropdown, the button and status lines. */
  label: string;
  /** Short name for tight spots (button + "Asking …" status) — same as label except Custom. */
  shortLabel: string;
  /** Fixed chat-completions endpoint. null for Custom (user-supplied base URL). */
  endpoint: string | null;
  /** Gemini's endpoint is a template: {model} is replaced with the model name. */
  endpointTemplate?: string;
  /** Default free model — the Model field is pre-filled with this, and the user may change it. */
  defaultModel: string;
  /** "openai" = OpenAI-compatible chat completions; "gemini" = Google's generateContent shape. */
  shape: "openai" | "gemini";
  /** Host shown in the "The key is sent only to …" copy. For Custom it is computed from the base URL. */
  keyHost: string | null;
  /** Extra honest note shown under the picker when this provider is selected (or null). */
  note: string | null;
}

/**
 * The provider table — the ONLY endpoints a cloud key is ever sent
 * to. A provider not in this table cannot be selected, and a key is
 * never sent to any other host. Free-tier defaults (November 2026);
 * the Model field is user-editable because free models change.
 */
export const AI_PROVIDERS: AiProviderDef[] = [
  { id: "groq", label: "Groq", shortLabel: "Groq", endpoint: "https://api.groq.com/openai/v1/chat/completions", defaultModel: "llama-3.3-70b-versatile", shape: "openai", keyHost: "api.groq.com", note: null },
  { id: "gemini", label: "Google Gemini", shortLabel: "Google Gemini", endpoint: null, endpointTemplate: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", defaultModel: "gemini-2.0-flash", shape: "gemini", keyHost: "generativelanguage.googleapis.com", note: "Google sends the key as a ?key= parameter on its own endpoint (its documented browser approach) — never anywhere else." },
  { id: "nvidia", label: "NVIDIA NIM", shortLabel: "NVIDIA NIM", endpoint: "https://integrate.api.nvidia.com/v1/chat/completions", defaultModel: "meta/llama-3.3-70b-instruct", shape: "openai", keyHost: "integrate.api.nvidia.com", note: "Free NIM endpoints may be region-blocked in Bangladesh — if NVIDIA refuses the request, that is the provider's block, not this extension." },
  { id: "openrouter", label: "OpenRouter", shortLabel: "OpenRouter", endpoint: "https://openrouter.ai/api/v1/chat/completions", defaultModel: "meta-llama/llama-3.3-70b-instruct:free", shape: "openai", keyHost: "openrouter.ai", note: null },
  { id: "together", label: "Together AI", shortLabel: "Together AI", endpoint: "https://api.together.xyz/v1/chat/completions", defaultModel: "meta-llama/Llama-3.3-70b-Instruct-Turbo-Free", shape: "openai", keyHost: "api.together.xyz", note: null },
  { id: "huggingface", label: "Hugging Face", shortLabel: "Hugging Face", endpoint: "https://router.huggingface.co/v1/chat/completions", defaultModel: "meta-llama/Llama-3.3-70B-Instruct", shape: "openai", keyHost: "router.huggingface.co", note: null },
  { id: "cerebras", label: "Cerebras", shortLabel: "Cerebras", endpoint: "https://api.cerebras.ai/v1/chat/completions", defaultModel: "llama-3.3-70b", shape: "openai", keyHost: "api.cerebras.ai", note: null },
  { id: "mistral", label: "Mistral", shortLabel: "Mistral", endpoint: "https://api.mistral.ai/v1/chat/completions", defaultModel: "mistral-small-latest", shape: "openai", keyHost: "api.mistral.ai", note: null },
  { id: "custom", label: "Custom (OpenAI-compatible)", shortLabel: "Custom", endpoint: null, defaultModel: "", shape: "openai", keyHost: null, note: "Point it at any OpenAI-compatible API. The base URL must be https:// — http:// is only allowed for a server on this computer (localhost), so a key never travels in the clear over a network." },
];

export function providerDef(id: AiProviderId | null | undefined): AiProviderDef | null {
  if (!id) return null;
  return AI_PROVIDERS.find((p) => p.id === id) ?? null;
}

/** Groq's fixed endpoint, kept for the v2.0.0 callers/tests that name it directly. */
export const AI_CLOUD_PROVIDER = "groq" as const;
export const AI_CLOUD_MODEL_DEFAULT = "llama-3.3-70b-versatile";
/** Groq chat-completions endpoint. */
export const AI_CLOUD_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export interface AiSettings {
  /** Cloud LLM opt-in. Default false — the template path needs no configuration at all. */
  cloudEnabled: boolean;
  /** The named provider, or null when none is chosen. */
  provider: AiProviderId | null;
  /** Model name for the cloud call (a plain string the user may change). */
  model: string;
  /** Custom provider only: the user-typed base URL (validated at call time, never trusted raw). */
  customBaseUrl: string;
}

export interface AiTokens {
  /** One BYOK key per provider. Empty = no cloud path for that provider. */
  groqApiKey: string;
  geminiApiKey: string;
  nvidiaApiKey: string;
  openrouterApiKey: string;
  togetherApiKey: string;
  huggingfaceApiKey: string;
  cerebrasApiKey: string;
  mistralApiKey: string;
  customApiKey: string;
}

/** Storage field name for a provider's key. */
export function aiTokenKeyFor(provider: AiProviderId): keyof AiTokens {
  switch (provider) {
    case "groq": return "groqApiKey";
    case "gemini": return "geminiApiKey";
    case "nvidia": return "nvidiaApiKey";
    case "openrouter": return "openrouterApiKey";
    case "together": return "togetherApiKey";
    case "huggingface": return "huggingfaceApiKey";
    case "cerebras": return "cerebrasApiKey";
    case "mistral": return "mistralApiKey";
    case "custom": return "customApiKey";
  }
}

/** The stored key for a provider ("" when none). Pure. */
export function aiKeyFor(provider: AiProviderId | null | undefined, tokens: AiTokens | null | undefined): string {
  if (!provider || !tokens) return "";
  const value = tokens[aiTokenKeyFor(provider)];
  return typeof value === "string" ? value : "";
}

/**
 * Build a tokens object from "stored or not" booleans (what the
 * dashboard keeps in memory — it never holds real keys). Only used
 * to answer "is there a key for this provider" without reading the
 * key itself. Pure.
 */
export function aiTokensFromStored(stored: Partial<Record<AiProviderId, boolean>>): AiTokens {
  const out = defaultAiTokens();
  for (const def of AI_PROVIDERS) {
    if (stored[def.id] === true) out[aiTokenKeyFor(def.id)] = "stored";
  }
  return out;
}

export function defaultAiSettings(): AiSettings {
  return { cloudEnabled: false, provider: null, model: AI_CLOUD_MODEL_DEFAULT, customBaseUrl: "" };
}

export function defaultAiTokens(): AiTokens {
  return { groqApiKey: "", geminiApiKey: "", nvidiaApiKey: "", openrouterApiKey: "", togetherApiKey: "", huggingfaceApiKey: "", cerebrasApiKey: "", mistralApiKey: "", customApiKey: "" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A model name is a plain string: trimmed, ≤120 chars, no control chars or newlines. Pure. */
export function sanitizeAiModel(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const text = raw.trim();
  if (!text || text.length > 120) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(text)) return fallback;
  return text;
}

/** Clean a stored AI settings value. Never throws; unusable input is the default (cloud off). Pure. */
export function sanitizeAiSettings(raw: unknown): AiSettings {
  const fallback = defaultAiSettings();
  if (!isRecord(raw)) return fallback;
  const def = providerDef(typeof raw.provider === "string" ? (raw.provider as AiProviderId) : null);
  const provider = def ? def.id : null;
  // The model falls back to the SELECTED provider's default, so a
  // stored model from another provider never leaks into the wrong call.
  const modelFallback = def ? def.defaultModel || AI_CLOUD_MODEL_DEFAULT : AI_CLOUD_MODEL_DEFAULT;
  const customBaseUrl = typeof raw.customBaseUrl === "string" ? raw.customBaseUrl.trim().slice(0, 500) : "";
  return {
    cloudEnabled: raw.cloudEnabled === true,
    provider,
    model: sanitizeAiModel(raw.model, modelFallback),
    customBaseUrl,
  };
}

/** Clean a stored AI tokens value. Never throws; unusable input is empty keys. Pure. */
export function sanitizeAiTokens(raw: unknown): AiTokens {
  const out = defaultAiTokens();
  if (!isRecord(raw)) return out;
  for (const def of AI_PROVIDERS) {
    const field = aiTokenKeyFor(def.id);
    const value = raw[field];
    if (typeof value === "string" && value) out[field] = value.slice(0, 4096);
  }
  return out;
}

/**
 * Validate a Custom provider base URL. Returns the normalized base
 * (no trailing slash) or an honest error — the input is NEVER
 * silently fixed (except stripping one trailing slash, which the
 * call path needs to join "/chat/completions").
 *
 * Rules: must parse as a URL; https:// required, EXCEPT a server
 * on this computer (localhost / 127.0.0.1 / ::1) where plain http://
 * is allowed — the same rule the sync WebDAV target uses, because
 * a loopback request never travels over a network. Rejected: a
 * remote http:// URL (the key would travel in the clear),
 * javascript:/file:/data: schemes, userinfo in the authority,
 * query or fragment parts. Pure.
 */
export function validateCustomBaseUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, error: "Paste the base URL of an OpenAI-compatible API first." };
  if (text.length > 500) return { ok: false, error: "That base URL is too long." };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, error: "That is not a valid URL — paste the base URL of an OpenAI-compatible API, starting with https://" };
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (parsed.protocol === "http:" && !isLoopback) {
    return { ok: false, error: "Remote endpoints must be https:// — over plain http:// your API key would travel in the clear. (http:// is only allowed for a server on this computer.)" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "That URL scheme is not allowed — the base URL must start with https://" };
  }
  if (parsed.username || parsed.password || text.includes("@")) {
    return { ok: false, error: "Do not put a username or password in the base URL." };
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, error: "The base URL must not contain a ?query or #fragment — just the address, e.g. https://your-endpoint.example.com/v1" };
  }
  if (!host) return { ok: false, error: "That URL has no host — paste the base URL of an OpenAI-compatible API." };
  const normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`;
  return { ok: true, url: normalized };
}

/**
 * True when the cloud path is actually usable: the opt-in is on, a
 * provider is named, AND the user's own key for THAT provider is
 * stored (a Groq key does not enable Gemini), and for Custom the
 * base URL is valid. When false the cloud button simply does not
 * exist in the UI (beyond the opt-in text). Pure.
 */
export function cloudAvailable(settings: AiSettings, tokens: AiTokens): boolean {
  if (settings.cloudEnabled !== true) return false;
  const def = providerDef(settings.provider);
  if (!def) return false;
  if (aiKeyFor(def.id, tokens).trim().length === 0) return false;
  if (def.id === "custom") return validateCustomBaseUrl(settings.customBaseUrl).ok;
  return true;
}

// ---------------------------------------------------------------------------
// Slot validation — the only values a template may substitute
// ---------------------------------------------------------------------------

/**
 * Parse a hostname out of free text ("example.com", "https://example.com/page",
 * "on example.com"). Returns the bare lowercase hostname, or null when
 * the text is not a usable host. Rejects userinfo, ports, paths with
 * tricks, whitespace, and anything that is not a plain hostname / IP /
 * localhost. Pure.
 */
export function parseAiHost(raw: string): string | null {
  let text = String(raw ?? "").trim().toLowerCase();
  if (!text) return null;
  // Strip a leading scheme and a leading www. (kept in the match, not the host).
  text = text.replace(/^https?:\/\//, "");
  // Take only the authority — a path, query or fragment ends the host.
  const authority = text.split(/[/\?#\s]/)[0];
  if (!authority) return null;
  // A port or userinfo in the authority is REJECTED, not silently
  // stripped: "example.com:8080" must not become a draft for plain
  // example.com, which would match the wrong site.
  if (authority.includes(":")) return null;
  text = authority.replace(/^\.+/, "").replace(/\.+$/, "");
  if (!text) return null;
  if (text === "localhost") return "localhost";
  // IPv4.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) {
    const parts = text.split(".").map(Number);
    if (parts.every((n) => n >= 0 && n <= 255)) return text;
    return null;
  }
  // Plain hostname: labels of letters/digits/hyphens, at least one dot,
  // no leading/trailing hyphen per label, TLD of 2+ letters.
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(text)) return null;
  return text;
}

/**
 * Validate a CSS selector slot: a tag, `.class`, `#id`, `tag.class`,
 * `tag#id`, or up to two class/id segments — letters, digits, `-` and
 * `_` only. Anything else (spaces, brackets, quotes, `>`, `*`, `:`)
 * is rejected: the template cannot inject it, and the draft fails
 * with a plain-English hint instead. Pure.
 */
export function validateAiSelector(raw: string): string | null {
  const text = String(raw ?? "").trim();
  if (!text || text.length > 80) return null;
  if (!/^(?:[a-zA-Z][\w-]*(?:[.#][\w-]+){0,2}|[.#][\w-]+(?:[.#][\w-]+)?)$/.test(text)) return null;
  return text;
}

/** A short free-text slot (button label, fill value): trimmed, ≤200 chars, no control chars. Pure. */
export function validateAiText(raw: string, maxLength: number = 200): string | null {
  const text = String(raw ?? "").trim();
  if (!text || text.length > maxLength) return null;
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

/** Title-case a host's first label for the draft name ("example" → "Example"). Pure. */
export function hostTitle(host: string): string {
  const first = (host ?? "").split(".")[0] || "Site";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

// ---------------------------------------------------------------------------
// Templates — static strings, validated slots only
// ---------------------------------------------------------------------------

export interface AiTemplate {
  id: string;
  title: string;
  description: string;
  example: string;
  /** Parse the prompt into slots, or null when this template does not match it. */
  match: (prompt: string) => Record<string, string> | null;
  /** Build the draft code from validated slots. */
  build: (slots: Record<string, string>) => string;
}

function metadataBlock(name: string, host: string, description: string): string {
  return [
    "// ==UserScript==",
    `// @name        ${name}`,
    "// @namespace   hiddengem-flow",
    "// @version     1.0",
    `// @description ${description}`,
    `// @match       https://*.${host}/*`,
    `// @match       https://${host}/*`,
    "// @grant       none",
    "// ==/UserScript==",
    "",
  ].join("\n");
}

const hideElementTemplate: AiTemplate = {
  id: "hide-element",
  title: "Hide an element",
  description: "Removes one element (by class, id or tag) whenever the page loads.",
  example: "Hide the sidebar on example.com",
  match(prompt: string): Record<string, string> | null {
    const m = /^(?:hide|remove)\s+(?:the\s+)?(.+?)\s+(?:on|from)\s+(.+?)\s*$/i.exec(prompt.trim());
    if (!m) return null;
    let rawSelector = m[1].replace(/^["']|["']$/g, "").trim();
    // A bare word ("sidebar") means the class .sidebar — the design's
    // own example ("Hide the sidebar on example.com" → '.sidebar').
    // A dotted/id/tag form is used as written.
    if (/^[a-zA-Z][\w-]*$/.test(rawSelector)) rawSelector = `.${rawSelector}`;
    const selector = validateAiSelector(rawSelector);
    const host = parseAiHost(m[2]);
    if (!selector || !host) return null;
    return { selector, host };
  },
  build(slots: Record<string, string>): string {
    const host = slots.host;
    const name = `Hide ${slots.selector.replace(/^[.#]/, "").replace(/[-_]/g, " ")} on ${hostTitle(host)}`;
    return (
      metadataBlock(name, host, `Hides ${slots.selector} on ${host}.`) +
      `// AI draft — preview only, NOT installed. Review it, then Save as script.\n` +
      `document.querySelector(${JSON.stringify(slots.selector)})?.remove();\n`
    );
  },
};

const clickButtonTemplate: AiTemplate = {
  id: "click-button",
  title: "Click a button when it appears",
  description: "Clicks a button by its visible label, once per appearance, as soon as it shows up.",
  example: "Click the 'Claim' button on example.com",
  match(prompt: string): Record<string, string> | null {
    const m = /^(?:click|press)\s+(?:the\s+)?(?:"([^"]+)"|'([^']+)'|(.+?))\s+button\s+(?:on|at|in)\s+(.+?)\s*$/i.exec(prompt.trim());
    if (!m) return null;
    const label = validateAiText(m[1] ?? m[2] ?? m[3] ?? "", 60);
    const host = parseAiHost(m[4]);
    if (!label || !host) return null;
    return { label, host };
  },
  build(slots: Record<string, string>): string {
    const host = slots.host;
    const name = `Click ${slots.label} on ${hostTitle(host)}`;
    const labelJson = JSON.stringify(slots.label);
    return (
      metadataBlock(name, host, `Clicks the "${slots.label}" button on ${host} when it appears.`) +
      `// AI draft — preview only, NOT installed. Review it, then Save as script.\n` +
      `(() => {\n` +
      `  'use strict';\n` +
      `  const label = ${labelJson};\n` +
      `  const clicked = new WeakSet();\n` +
      `  function tryClick() {\n` +
      `    for (const btn of document.querySelectorAll('button')) {\n` +
      `      if (clicked.has(btn)) continue;\n` +
      `      if ((btn.textContent || '').trim().toLowerCase().includes(label.toLowerCase())) {\n` +
      `        clicked.add(btn);\n` +
      `        btn.click();\n` +
      `      }\n` +
      `    }\n` +
      `  }\n` +
      `  tryClick();\n` +
      `  new MutationObserver(tryClick).observe(document.documentElement, { childList: true, subtree: true });\n` +
      `})();\n`
    );
  },
};

const autoFillTemplate: AiTemplate = {
  id: "auto-fill",
  title: "Fill a field",
  description: "Fills one input (by its name, placeholder or label) with the text you give.",
  example: "Fill the search box on example.com with 'hello'",
  match(prompt: string): Record<string, string> | null {
    const m = /^fill\s+(?:the\s+)?(.+?)\s+(?:field|box|input)?\s*(?:on\s+(.+?))?\s+with\s+["'](.+?)["']\s*$/i.exec(prompt.trim());
    if (!m) return null;
    const field = validateAiText(m[1], 60);
    const host = parseAiHost(m[2] ?? "");
    const value = validateAiText(m[3], 200);
    if (!field || !host || !value) return null;
    return { field, host, value };
  },
  build(slots: Record<string, string>): string {
    const host = slots.host;
    const name = `Fill ${slots.field} on ${hostTitle(host)}`;
    const fieldJson = JSON.stringify(slots.field.toLowerCase());
    const valueJson = JSON.stringify(slots.value);
    return (
      metadataBlock(name, host, `Fills the "${slots.field}" field on ${host}.`) +
      `// AI draft — preview only, NOT installed. Review it, then Save as script.\n` +
      `(() => {\n` +
      `  'use strict';\n` +
      `  const needle = ${fieldJson};\n` +
      `  const input = [...document.querySelectorAll('input, textarea')].find((el) => {\n` +
      `    const hay = [el.name, el.placeholder, el.getAttribute('aria-label'), el.id].filter(Boolean).join(' ').toLowerCase();\n` +
      `    return hay.includes(needle);\n` +
      `  });\n` +
      `  if (!input) return;\n` +
      `  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set\n` +
      `    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;\n` +
      `  if (setter) setter.call(input, ${valueJson});\n` +
      `  else input.value = ${valueJson};\n` +
      `  input.dispatchEvent(new Event('input', { bubbles: true }));\n` +
      `  input.dispatchEvent(new Event('change', { bubbles: true }));\n` +
      `})();\n`
    );
  },
};

const redirectTemplate: AiTemplate = {
  id: "redirect",
  title: "Redirect one site to another",
  description: "Sends every page on one host to the same path on another host.",
  example: "Redirect example.com to example.org",
  match(prompt: string): Record<string, string> | null {
    const m = /^redirect\s+(.+?)\s+to\s+(.+?)\s*$/i.exec(prompt.trim());
    if (!m) return null;
    const from = parseAiHost(m[1]);
    const to = parseAiHost(m[2]);
    if (!from || !to || from === to) return null;
    return { from, to };
  },
  build(slots: Record<string, string>): string {
    const name = `Redirect ${hostTitle(slots.from)} to ${hostTitle(slots.to)}`;
    return (
      metadataBlock(name, slots.from, `Redirects ${slots.from} to ${slots.to}.`) +
      `// AI draft — preview only, NOT installed. Review it, then Save as script.\n` +
      `(() => {\n` +
      `  'use strict';\n` +
      `  const toHost = ${JSON.stringify(slots.to)};\n` +
      `  const target = 'https://' + toHost + location.pathname + location.search + location.hash;\n` +
      `  if (location.href !== target) location.replace(target);\n` +
      `})();\n`
    );
  },
};

const darkModeTemplate: AiTemplate = {
  id: "dark-mode",
  title: "Dark mode for a site",
  description: "Darkens a bright site with a small injected stylesheet.",
  example: "Make example.com dark",
  match(prompt: string): Record<string, string> | null {
    const m = /^make\s+(.+?)\s+dark\s*$/i.exec(prompt.trim());
    if (!m) return null;
    const host = parseAiHost(m[1]);
    if (!host) return null;
    return { host };
  },
  build(slots: Record<string, string>): string {
    const host = slots.host;
    const name = `Dark mode for ${hostTitle(host)}`;
    return (
      metadataBlock(name, host, `Darkens ${host}.`) +
      `// AI draft — preview only, NOT installed. Review it, then Save as script.\n` +
      `(() => {\n` +
      `  'use strict';\n` +
      `  const style = document.createElement('style');\n` +
      `  style.textContent = 'html { filter: invert(1) hue-rotate(180deg); background: #111 !important; } img, video, svg { filter: invert(1) hue-rotate(180deg); }';\n` +
      `  (document.head || document.documentElement).appendChild(style);\n` +
      `})();\n`
    );
  },
};

export const AI_TEMPLATES: AiTemplate[] = [hideElementTemplate, clickButtonTemplate, autoFillTemplate, redirectTemplate, darkModeTemplate];

export type AiDraftResult =
  | { ok: true; code: string; templateId: string; templateTitle: string; name: string; host: string }
  | { ok: false; error: string; suggestions: string[] };

/**
 * Turn a prompt into a draft from the built-in templates. No network,
 * no configuration. When no template matches, or a slot cannot be
 * validated, the result is an honest error + the examples to try —
 * never a half-built draft with an unvalidated slot in it. Pure.
 */
export function generateAiDraft(prompt: string, now: number = Date.now()): AiDraftResult {
  void now; // Templates are deterministic; `now` is kept for symmetry with the other generators.
  const text = String(prompt ?? "").trim();
  if (!text) {
    return { ok: false, error: "Type what you want the script to do first.", suggestions: AI_TEMPLATES.map((t) => t.example) };
  }
  if (text.length > 500) {
    return { ok: false, error: "That prompt is too long — keep it to one sentence.", suggestions: AI_TEMPLATES.map((t) => t.example) };
  }
  for (const template of AI_TEMPLATES) {
    let slots: Record<string, string> | null = null;
    try {
      slots = template.match(text);
    } catch {
      slots = null;
    }
    if (!slots) continue;
    const code = template.build(slots);
    const host = slots.host ?? slots.from ?? "";
    const name = (code.match(/^\/\/ @name\s+(.+)$/m) ?? [])[1] ?? template.title;
    return { ok: true, code, templateId: template.id, templateTitle: template.title, name, host };
  }
  // No template matched — say which part was understood, if any.
  const hostHint = /on\s+(\S+)/i.exec(text)?.[1] ?? /to\s+(\S+)/i.exec(text)?.[1] ?? null;
  const host = hostHint ? parseAiHost(hostHint) : null;
  const error = host
    ? `I understood the site (${host}) but not the action — the local templates cover hiding an element, clicking a button, filling a field, redirecting, and dark mode.`
    : "I could not understand that yet — the local templates need a site name and one action (hide, click, fill, redirect, or dark mode).";
  return { ok: false, error, suggestions: AI_TEMPLATES.map((t) => t.example) };
}

/** The system prompt for every cloud provider — identical for the OpenAI shape and Gemini. It bans eval/new Function/document.write/innerHTML. */
export const AI_CLOUD_SYSTEM_PROMPT =
  "You write userscripts for a browser extension. Output ONLY the complete userscript code, starting with the // ==UserScript== metadata block (@name, @version 1.0, @description, @match lines for the site, @grant none unless the script needs a GM function) and then the JavaScript. No explanation, no markdown fences, no extra text. Never use eval, new Function, document.write, or innerHTML with page data. Keep the script short and safe.";

/**
 * Build the cloud-LLM request body for a prompt (OpenAI-compatible
 * chat completions shape, used by every provider except Gemini).
 * The system prompt tells the model to output ONLY a userscript —
 * the dashboard strips any markdown fence from the reply and shows
 * it as a preview, never executes it. Pure.
 */
export function buildCloudRequestBody(prompt: string, model: string): Record<string, unknown> {
  return {
    model: model || AI_CLOUD_MODEL_DEFAULT,
    messages: [
      { role: "system", content: AI_CLOUD_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 4000,
  };
}

/**
 * Build the Gemini request body (generateContent shape): the system
 * prompt goes in systemInstruction, the user's prompt in contents.
 * Same system prompt, same limits. Pure.
 */
export function buildGeminiRequestBody(prompt: string): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: AI_CLOUD_SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4000 },
  };
}

/** Max draft size, in bytes — the cap applies to the extracted code. */
const AI_DRAFT_MAX_BYTES = 100 * 1024;

/** What a provider reply carried, before any code extraction. Pure. */
export type AiReplyText =
  | { status: "bad-json" }
  | { status: "no-choices" }
  | { status: "no-candidates" }
  | { status: "empty" }
  | { status: "no-text" }
  | { status: "ok"; text: string };

function textPart(p: unknown): string {
  return isRecord(p) && typeof p.text === "string" ? p.text : "";
}

/**
 * Read the message text out of an OpenAI-shape reply. Content may be
 * a plain string or an array of parts (their text fields joined in
 * order). An empty content falls back to reasoning_content — some
 * reasoning models put the draft there. Pure.
 */
function readOpenAiReplyText(parsed: unknown): AiReplyText {
  const choices = isRecord(parsed) && Array.isArray(parsed.choices) ? parsed.choices : null;
  if (!choices || choices.length === 0) return { status: "no-choices" };
  const message = isRecord(choices[0]) ? choices[0].message : null;
  if (!isRecord(message)) return { status: "no-text" };
  const content = message.content as unknown;
  if (typeof content === "string") {
    if (content.trim()) return { status: "ok", text: content };
    if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
      return { status: "ok", text: message.reasoning_content };
    }
    return { status: "empty" };
  }
  if (Array.isArray(content)) {
    const joined = content.map(textPart).filter(Boolean).join("\n").trim();
    if (joined) return { status: "ok", text: joined };
    return { status: "no-text" };
  }
  if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
    return { status: "ok", text: message.reasoning_content };
  }
  return { status: "no-text" };
}

/** Read the message text out of a Gemini reply (candidates[0] parts). Pure. */
function readGeminiReplyText(parsed: unknown): AiReplyText {
  const candidates = isRecord(parsed) && Array.isArray(parsed.candidates) ? parsed.candidates : null;
  if (!candidates || candidates.length === 0) return { status: "no-candidates" };
  const content = isRecord(candidates[0]) ? candidates[0].content : null;
  const parts = isRecord(content) ? content.parts : null;
  if (!Array.isArray(parts)) return { status: "no-text" };
  const joined = parts.map(textPart).filter(Boolean).join("\n").trim();
  if (!joined) return { status: "empty" };
  return { status: "ok", text: joined };
}

/**
 * Find the first fenced code block in reply text and return its body.
 * Preference: a ```javascript / ```js fence, then a fence whose body
 * holds a ==UserScript== header, then any fence whose body looks like
 * JavaScript (function/const/let/var/arrow/document/GM_ …). Prose
 * before and after the fence is ignored. A fence whose body opens a
 * ==UserScript== header but never closes it was cut short by a ```
 * inside a string literal, so the scan extends to the next closing
 * fence. Returns null when no fence yields usable code. Pure.
 */
function findFencedCode(text: string): string | null {
  const openRe = /```([A-Za-z0-9_-]*)[ \t]*\r?\n/g;
  type Cand = { lang: string; body: string };
  const cands: Cand[] = [];
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(text)) !== null) {
    const bodyStart = m.index + m[0].length;
    let close = text.indexOf("```", bodyStart);
    if (close === -1) break;
    let body = text.slice(bodyStart, close);
    while (body.includes("// ==UserScript==") && !body.includes("// ==/UserScript==")) {
      const next = text.indexOf("```", close + 3);
      if (next === -1) break;
      body = text.slice(bodyStart, next);
      close = next;
    }
    cands.push({ lang: (m[1] || "").toLowerCase(), body: body.trim() });
    openRe.lastIndex = close + 3;
  }
  const jsLike = (body: string): boolean =>
    /\b(function|const|let|var)\b|=>|document\.|window\.|GM_|addEventListener|querySelector/.test(body);
  const pick =
    cands.find((c) => (c.lang === "javascript" || c.lang === "js") && c.body.length > 0) ??
    cands.find((c) => c.body.includes("// ==UserScript==")) ??
    cands.find((c) => c.body.length > 0 && jsLike(c.body));
  return pick ? pick.body : null;
}

/**
 * Pull the draft code out of reply text (already lifted out of the
 * provider envelope): a fenced block anywhere in the text, else from
 * the ==UserScript== header to the end. Returns null for prose with
 * no code block and no header marker — prose is never returned as a
 * "draft". The 100 KB cap applies to the extracted code. Pure.
 */
function extractCodeFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = findFencedCode(trimmed);
  if (fenced) {
    return fenced.length > 0 && fenced.length <= AI_DRAFT_MAX_BYTES ? fenced : null;
  }
  const marker = trimmed.indexOf("// ==UserScript==");
  if (marker !== -1) {
    const code = trimmed.slice(marker).trim();
    return code.length > 0 && code.length <= AI_DRAFT_MAX_BYTES ? code : null;
  }
  return null;
}

/**
 * Collapse whitespace and strip anything that could carry a secret
 * (URLs, key/token assignments, Bearer/Basic credentials) from a
 * reply excerpt. The excerpt is status-line text only — never stored
 * or logged. Pure.
 */
export function safeReplyExcerpt(text: string, maxChars = 120): string {
  let out = text.replace(/\s+/g, " ").trim();
  out = out.replace(/https?:\/\/\S+/gi, "[link]");
  out = out.replace(/(?:Bearer|Basic)\s+\S+/gi, "[credentials]");
  out = out.replace(/[A-Za-z0-9_-]*(?:api[-_]?key|secret|token|password)[A-Za-z0-9_-]*\s*[:=]\s*\S+/gi, "[key]");
  if (out.length > maxChars) out = `${out.slice(0, maxChars)}…`;
  return out;
}

/**
 * Say WHAT a provider reply contained when extraction found no usable
 * script — from the parsed reply only. The excerpt is truncated and
 * scrubbed (see safeReplyExcerpt); the reply itself is never logged
 * or stored. Pure.
 */
export function describeDraftFailure(responseText: string, shape: "openai" | "gemini"): string {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return "the reply was not a JSON response";
  }
  const read = shape === "gemini" ? readGeminiReplyText(parsed) : readOpenAiReplyText(parsed);
  switch (read.status) {
    case "no-choices":
      return "the reply had no choices";
    case "no-candidates":
      return "the reply had no candidates";
    case "empty":
      return "the reply was empty";
    case "no-text":
      return "the reply had no text in it";
    case "ok": {
      const excerpt = safeReplyExcerpt(read.text);
      return excerpt ? `the reply had no code block — it began: '${excerpt}'` : "the reply had no code block";
    }
    default:
      return "the reply had no usable script in it";
  }
}

/**
 * Pull the draft code out of a Gemini reply: join the text parts of
 * candidates[0].content, then take a fenced block anywhere in the
 * text (or from the ==UserScript== header). Requires a non-empty
 * result ≤100 KB. Returns null when the reply carries no usable
 * code. Pure.
 */
export function extractGeminiDraft(responseText: string): string | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return null;
  }
  const read = readGeminiReplyText(parsed);
  if (read.status !== "ok") return null;
  return extractCodeFromText(read.text);
}

export interface AiCloudCall {
  /** Provider label for status lines ("Groq", "Google Gemini", "Custom", …). Never a URL. */
  providerLabel: string;
  /** Full request URL. For Gemini it carries ?key= — the caller must NEVER log or display this URL. */
  url: string;
  /** Request headers. Gemini carries no Authorization header (its key travels in the URL). */
  headers: Record<string, string>;
  /** JSON-serializable request body. */
  body: Record<string, unknown>;
  /** Which extractor reads the reply. */
  shape: "openai" | "gemini";
  /** Origin pattern for the host-access fallback (e.g. "https://api.groq.com/*"). */
  originPattern: string;
}

/**
 * Build the complete cloud call for the SELECTED provider — the
 * single place a key meets an endpoint. Returns an error (never a
 * half-built call) when the provider is unknown, the key is missing,
 * the model is empty, or the Custom base URL is invalid. The key is
 * sent ONLY to this call's URL: a fixed table endpoint for the eight
 * named providers, or the validated Custom base URL. Pure.
 */
export function buildCloudCall(
  settings: AiSettings,
  tokens: AiTokens,
  prompt: string,
): { ok: true; call: AiCloudCall } | { ok: false; error: string } {
  const def = providerDef(settings.provider);
  if (!def) return { ok: false, error: "Pick a cloud provider first." };
  const key = aiKeyFor(def.id, tokens).trim();
  if (!key) return { ok: false, error: `No ${def.label} API key is saved — paste your own key above first.` };
  const model = (settings.model || "").trim() || def.defaultModel;
  if (!model) return { ok: false, error: "Type a model name for the Custom endpoint first." };
  if (def.shape === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    return {
      ok: true,
      call: {
        providerLabel: def.shortLabel,
        url,
        headers: { "Content-Type": "application/json" },
        body: buildGeminiRequestBody(prompt),
        shape: "gemini",
        originPattern: "https://generativelanguage.googleapis.com/*",
      },
    };
  }
  let endpoint: string;
  if (def.id === "custom") {
    const checked = validateCustomBaseUrl(settings.customBaseUrl);
    if (!checked.ok) return { ok: false, error: checked.error };
    endpoint = `${checked.url}/chat/completions`;
  } else if (def.endpoint) {
    endpoint = def.endpoint;
  } else {
    return { ok: false, error: "That provider has no endpoint configured." };
  }
  let originPattern: string;
  try {
    const parsed = new URL(endpoint);
    originPattern = `${parsed.protocol}//${parsed.host}/*`;
  } catch {
    return { ok: false, error: "That provider endpoint is not a valid URL." };
  }
  return {
    ok: true,
    call: {
      providerLabel: def.shortLabel,
      url: endpoint,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: buildCloudRequestBody(prompt, model),
      shape: "openai",
      originPattern,
    },
  };
}

/**
 * Pull the draft code out of a cloud-LLM reply: prefer the
 * choices[0].message.content text, strip one surrounding markdown
 * fence if present, and require a non-empty result ≤100 KB. Returns
 * null when the reply carries no usable code. Pure.
 */

// ---------------------------------------------------------------------------
// Model detection (v2.0.2) — after the user pastes a key, the panel can
// ask the SELECTED provider for its model list and show it as a
// dropdown. The fetched list is panel-session only (never persisted);
// only the SELECTED model is saved, in the same AiSettings.model
// field as a typed model. The key meets its endpoint in exactly one
// place here too — buildModelsCall — the same discipline as
// buildCloudCall. Manual typing stays: a failed fetch never clears
// the saved model, and the user can always type a model instead.
// ---------------------------------------------------------------------------

/** Max models shown in the picker — more than that, the status line says so and the rest stay typeable. */
export const AI_MODELS_CAP = 100;

export interface AiModelsCall {
  /** Provider label for status lines ("Groq", "Google Gemini", "Custom", …). Never a URL. */
  providerLabel: string;
  /** Full request URL. For Gemini it carries ?key= — the caller must NEVER log or display this URL. */
  url: string;
  /** Request headers. Gemini carries no Authorization header (its key travels in the URL). */
  headers: Record<string, string>;
  /** Which parser reads the reply. */
  shape: "openai" | "gemini";
  /** Origin pattern for the host-access fallback (e.g. "https://api.groq.com/*"). */
  originPattern: string;
}

/**
 * Build the models-list request for the SELECTED provider — the
 * single place a key meets a models endpoint. `key` is the key the
 * user just typed OR the stored key for that provider (the dashboard
 * resolves which; this function never reads storage). Returns an
 * error (never a half-built call) when the provider is unknown, the
 * key is missing, or the Custom base URL is invalid. Pure.
 */
export function buildModelsCall(
  providerId: AiProviderId | null,
  key: string,
  customBaseUrl: string,
): { ok: true; call: AiModelsCall } | { ok: false; error: string } {
  const def = providerDef(providerId);
  if (!def) return { ok: false, error: "Pick a cloud provider first." };
  const trimmedKey = (key ?? "").trim();
  if (!trimmedKey) return { ok: false, error: `Paste your ${def.label} API key first — detection needs the key to ask ${def.label} for its model list.` };
  const originPatternOf = (endpoint: string): { ok: true; pattern: string } | { ok: false; error: string } => {
    try {
      const parsed = new URL(endpoint);
      return { ok: true, pattern: `${parsed.protocol}//${parsed.host}/*` };
    } catch {
      return { ok: false, error: "That provider endpoint is not a valid URL." };
    }
  };
  if (def.shape === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmedKey)}`;
    return {
      ok: true,
      call: {
        providerLabel: def.shortLabel,
        url,
        headers: { "Content-Type": "application/json" },
        shape: "gemini",
        originPattern: "https://generativelanguage.googleapis.com/*",
      },
    };
  }
  let endpoint: string;
  if (def.id === "custom") {
    const checked = validateCustomBaseUrl(customBaseUrl);
    if (!checked.ok) return { ok: false, error: checked.error };
    endpoint = `${checked.url}/models`;
  } else if (def.endpoint) {
    if (!def.endpoint.endsWith("/chat/completions")) return { ok: false, error: "That provider has no models endpoint configured." };
    endpoint = def.endpoint.replace(/\/chat\/completions$/, "/models");
  } else {
    return { ok: false, error: "That provider has no endpoint configured." };
  }
  const pattern = originPatternOf(endpoint);
  if (!pattern.ok) return { ok: false, error: pattern.error };
  return {
    ok: true,
    call: {
      providerLabel: def.shortLabel,
      url: endpoint,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${trimmedKey}` },
      shape: "openai",
      originPattern: pattern.pattern,
    },
  };
}

export interface AiModelsParsed {
  /** Deduplicated model ids, in reply order (ordering is orderModels' job). */
  ids: string[];
}

/**
 * Pull model ids out of a models-list reply. OpenAI shape:
 * `{data: [{id}]}`. Gemini shape: `{models: [{name:
 * "models/gemini-2.0-flash", supportedGenerationMethods: [...]}]}` —
 * the `models/` prefix is stripped, and ONLY models whose
 * supportedGenerationMethods includes "generateContent" are kept: a
 * model without that field cannot be proven to generate, so it is
 * left out of the list (the user can still type it manually).
 * Unknown fields are tolerated; a bad body yields an empty list,
 * never a throw. Pure.
 */
export function parseModelsResponse(shape: "openai" | "gemini", responseText: string): AiModelsParsed {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return { ids: [] };
  }
  const ids: string[] = [];
  const push = (raw: unknown): void => {
    if (typeof raw !== "string") return;
    const id = raw.trim();
    if (!id || id.length > 120) return;
    if (!ids.includes(id)) ids.push(id);
  };
  if (shape === "gemini") {
    const list = isRecord(parsed) && Array.isArray(parsed.models) ? parsed.models : [];
    for (const entry of list) {
      if (!isRecord(entry) || typeof entry.name !== "string") continue;
      const methods = entry.supportedGenerationMethods;
      if (!Array.isArray(methods) || !methods.includes("generateContent")) continue;
      const name = entry.name.trim();
      push(name.startsWith("models/") ? name.slice("models/".length) : name);
    }
    return { ids };
  }
  const list = isRecord(parsed) && Array.isArray(parsed.data) ? parsed.data : [];
  for (const entry of list) {
    if (isRecord(entry)) push(entry.id);
  }
  return { ids };
}

export interface AiModelsOrdered {
  /** The models to show (capped at AI_MODELS_CAP). */
  models: string[];
  /** How many the provider returned in total (before the cap). */
  total: number;
  /** True when the list was cut at the cap. */
  truncated: boolean;
}

/**
 * Order + cap a parsed model list for the picker. Gemini keeps the
 * provider's own order (the default model first when present);
 * OpenRouter puts free models (`:free`) first, then the rest;
 * everyone else is alphabetical. The list is capped at
 * AI_MODELS_CAP — the status line says so, and the rest stay
 * typeable in the manual field. Pure.
 */
export function orderModels(providerId: AiProviderId, ids: string[], defaultModel: string): AiModelsOrdered {
  const total = ids.length;
  let ordered: string[];
  if (providerId === "gemini") {
    ordered = [...ids];
    const at = ordered.indexOf(defaultModel);
    if (at > 0) {
      ordered.splice(at, 1);
      ordered.unshift(defaultModel);
    }
  } else if (providerId === "openrouter") {
    const free = ids.filter((id) => id.endsWith(":free")).sort();
    const rest = ids.filter((id) => !id.endsWith(":free")).sort();
    ordered = [...free, ...rest];
  } else {
    ordered = [...ids].sort();
  }
  const truncated = ordered.length > AI_MODELS_CAP;
  return { models: truncated ? ordered.slice(0, AI_MODELS_CAP) : ordered, total, truncated };
}

/**
 * Honest error text for a refused models request. 400/401 means the
 * key is wrong (or not accepted for this provider) — say to check
 * it, never guess anything else. Pure.
 */
export function modelsFetchError(status: number, label: string): string {
  if (status === 400 || status === 401) return `${label} refused the request (HTTP ${status}) — check your API key and try again.`;
  if (status === 403) return `${label} refused the request (HTTP 403) — that key does not have access to the model list.`;
  if (status === 429) return `${label} refused the request (HTTP 429) — the provider is rate-limiting the request. Wait a minute and try again.`;
  return `${label} refused the request (HTTP ${status}).`;
}

/**
 * Pull the draft code out of a cloud-LLM reply (OpenAI shape): take
 * choices[0].message.content as a string or an array of text parts
 * (reasoning_content when the content is empty), then take a fenced
 * block anywhere in the text (or from the ==UserScript== header).
 * Prose before/after the fence is ignored. Requires a non-empty
 * result ≤100 KB. Returns null when the reply carries no usable
 * code. Pure.
 */
export function extractCloudDraft(responseText: string): string | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return null;
  }
  const read = readOpenAiReplyText(parsed);
  if (read.status !== "ok") return null;
  return extractCodeFromText(read.text);
}

// ---------------------------------------------------------------------------
// Storage wrappers (chrome.storage.local only — not part of the pure half)
// ---------------------------------------------------------------------------

function storageAvailable(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome?.storage?.local;
  } catch {
    return false;
  }
}

/** Load the AI settings; the default (cloud off) when nothing is saved. */
export async function loadAiSettings(): Promise<AiSettings> {
  if (!storageAvailable()) return defaultAiSettings();
  try {
    const data = await chrome.storage.local.get(AI_KEY);
    return sanitizeAiSettings(data?.[AI_KEY]);
  } catch {
    return defaultAiSettings();
  }
}

/** Persist the AI settings (replaces the stored value). */
export async function saveAiSettings(settings: AiSettings): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [AI_KEY]: sanitizeAiSettings(settings) });
}

/** Load the cloud API key; empty when nothing is saved. */
export async function loadAiTokens(): Promise<AiTokens> {
  if (!storageAvailable()) return defaultAiTokens();
  try {
    const data = await chrome.storage.local.get(AI_TOKENS_KEY);
    return sanitizeAiTokens(data?.[AI_TOKENS_KEY]);
  } catch {
    return defaultAiTokens();
  }
}

/** Persist the cloud API key (replaces the stored value). Never called with anything else. */
export async function saveAiTokens(tokens: AiTokens): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [AI_TOKENS_KEY]: sanitizeAiTokens(tokens) });
}
