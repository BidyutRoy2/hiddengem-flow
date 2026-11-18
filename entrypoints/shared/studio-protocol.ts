// HiddenGem Flow — Studio test protocol: background ↔ dashboard (v2.1.0).
//
// This module is deliberately TINY: the background imports it (message
// types + test-run sanitizers). The background answers these messages
// in BOTH builds by design — the messages carry no Studio UI and are
// unreachable without the Studio tab, which only the OWNER build
// ships (finding A-75, accepted). The Studio UI itself lives in
// shared/studio.ts, which only the OWNER build imports.
//
// Message types:
//  * studio-test-start { code, url } → { ok, tabId?, error? }
//  * studio-test-stop  { tabId }     → { ok }
//  * studio-test-steps { tabId }     → { ok, steps, status, finished }
//  * studio-step       { step }      → sent by the gm-relay content
//    script (ISOLATED world) when a test draft posts a step-signal
//    node; the background stores it under the sender tab's id.
//    The draft posts the node; the relay forwards it — the userscript
//    world never calls chrome.runtime.sendMessage (A-04).

/** Start a Studio test: register the draft temporarily + open its site. */
export const MSG_STUDIO_TEST_START = "hiddengemflow:studio-test-start";
/** Stop a Studio test: unregister the temporary entry. */
export const MSG_STUDIO_TEST_STOP = "hiddengemflow:studio-test-stop";
/** Poll a Studio test's steps. */
export const MSG_STUDIO_TEST_STEPS = "hiddengemflow:studio-test-steps";
/** One step event, forwarded by the gm-relay from a test tab. */
export const MSG_STUDIO_STEP = "hiddengemflow:studio-step";

/** Storage key for the last 20 Studio test runs — NOT backed up (local working state, like the run log). */
export const STUDIO_TESTS_KEY = "hiddengemflow.studio.tests.v1";

/** DOM attribute a test draft uses to report one step (drained by public/gm-relay.js). */
export const STUDIO_STEP_SIGNAL_ATTR = "data-hgf-studio-step";

/** One step as reported by a test draft. `status` is free text from the draft; the Studio maps it. */
export interface StudioStep {
  id: string;
  step: number;
  status: string;
  detail: string;
  at: number;
}

/** One finished/stopped test run, for the last-20 history. */
export interface StudioTestRun {
  name: string;
  site: string;
  result: string;
  failedStep: string;
  at: number;
}

export const STUDIO_TESTS_MAX = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Clean one stored test run. Never throws; unusable input is null. Pure. */
export function sanitizeStudioTestRun(raw: unknown): StudioTestRun | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 120) : "";
  const site = typeof raw.site === "string" && raw.site.trim() ? raw.site.trim().slice(0, 2048) : "";
  const result = typeof raw.result === "string" && raw.result.trim() ? raw.result.trim().slice(0, 120) : "";
  const failedStep = typeof raw.failedStep === "string" ? raw.failedStep.slice(0, 200) : "";
  const at = typeof raw.at === "number" && Number.isFinite(raw.at) ? raw.at : 0;
  if (!name || !site || !result || at <= 0) return null;
  return { name, site, result, failedStep, at };
}

/** Clean a stored test-run list (newest first, capped at 20). Pure. */
export function sanitizeStudioTests(raw: unknown): StudioTestRun[] {
  if (!Array.isArray(raw)) return [];
  const out: StudioTestRun[] = [];
  for (const entry of raw) {
    const clean = sanitizeStudioTestRun(entry);
    if (clean) out.push(clean);
    if (out.length >= STUDIO_TESTS_MAX) break;
  }
  return out;
}

/** Prepend one run (newest first, capped at 20). Pure. */
export function addStudioTestRun(runs: StudioTestRun[], run: StudioTestRun): StudioTestRun[] {
  return [run, ...runs].slice(0, STUDIO_TESTS_MAX);
}

/**
 * Clean one step event as posted by a draft (textContent of the
 * signal node, JSON). The draft is user-generated code, so the
 * payload is treated as untrusted page data: only the four known
 * fields are read, everything is length-capped, and anything
 * unusable is null (never thrown, never executed). Pure.
 */
export function sanitizeStudioStep(rawText: string, now: number = Date.now()): StudioStep | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const step = typeof parsed.step === "number" && Number.isFinite(parsed.step) ? Math.floor(parsed.step) : 0;
  const status = typeof parsed.status === "string" ? parsed.status.trim().slice(0, 40) : "";
  const detail = typeof parsed.detail === "string" ? parsed.detail.trim().slice(0, 400) : "";
  if (step <= 0 || !status) return null;
  const id = typeof parsed.id === "string" && parsed.id ? parsed.id.slice(0, 80) : `s${now.toString(36)}${step}`;
  return { id, step, status, detail, at: now };
}

/** Map a draft's raw step status to the Test view's display state. Pure. */
export function studioStepState(status: string): "ok" | "failed" | "waiting-wallet" | "running" {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "ok" || s === "passed" || s === "pass" || s === "done" || s === "success") return "ok";
  if (s === "failed" || s === "fail" || s === "error") return "failed";
  if (s === "waiting-wallet" || s === "waiting_wallet" || s === "waiting wallet" || s === "wallet") return "waiting-wallet";
  return "running";
}
