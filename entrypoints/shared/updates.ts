// HiddenGem Flow — extension update checker (Unreleased).
//
// WHY THIS EXISTS: the extension is installed unpacked (Load unpacked),
// so Chrome NEVER auto-updates it, and no extension can replace its own
// files — there is no self-update API. The best an unpacked install can
// do is NOTICE that a newer build exists and point the user at it. This
// module does exactly that, and nothing more: it asks the public GitHub
// releases API for the latest release of this repo and compares it with
// the running build. The update itself stays manual (download the zip,
// replace the files in the unpacked folder, press Reload in
// chrome://extensions) — the UI copy says so plainly, and nothing here
// ever claims the extension updates itself.
//
// Split in two halves (same pattern as shared/store.ts):
//  * PURE half (up to the "Storage / network" section): no `chrome`
//    APIs, no fetch — all inputs are parameters. Unit-testable in plain
//    Node.
//  * Storage/network half: thin wrappers around chrome.storage.local
//    and fetch. Only the background and the dashboard import these; the
//    floating windows only READ the stored record (loadUpdateRecord),
//    never fetch.
//
// CHECK POLICY (privacy + honesty):
//  * One unauthenticated GET to the public releases list, at most once
//    every 6 hours (startup/install + dashboard open share the same
//    gate), plus whenever the user clicks "Check for updates" in
//    Settings. The unauthenticated GitHub API limit is 60/hr/IP — a
//    6-hour cadence is far below it. No token, no account, no data
//    about the user is sent; the request is a plain public listing.
//  * A 403 (rate limit) or any network failure fails SILENTLY: no
//    banner, no error shown anywhere; the next check is backed off by
//    1 hour, and the last good record keeps showing as before.
//  * Dismissing hides the banner until a NEWER release appears (the
//    dismiss is keyed by tag + asset updated_at).

declare const chrome: any;

import { HGF_VARIANT, type HGFVariant } from "./variant";

export const UPDATE_KEY = "hiddengemflow.update.v1";
export const MSG_CHECK_UPDATES = "hiddengemflow:check-updates";

export const RELEASES_URL = "https://api.github.com/repos/BidyutRoy2/hiddengem-flow/releases";
export const RELEASE_ZIP_ASSET = "hiddengem-flow-extension.zip";
/**
 * v2.1.0: two builds, two release assets. The checker picks the asset
 * matching the installed variant, by filename:
 *  * owner:  hiddengem-flow-v<version>-owner-<YYYYMMDD>.zip
 *  * public: hiddengem-flow-v<version>-<YYYYMMDD>.zip (no "-owner-")
 * The patterns are version/date agnostic on purpose — the next
 * release keeps the same shape with a new stamp. The legacy
 * hiddengem-flow-extension.zip name is still accepted as a fallback
 * (older releases only carried that one asset), so an old release
 * never reads as "no build available" for either variant.
 */
export const RELEASE_ZIP_ASSET_OWNER_PATTERN = /^hiddengem-flow-v[0-9.]+-owner-[0-9]+\.zip$/;
export const RELEASE_ZIP_ASSET_PUBLIC_PATTERN = /^hiddengem-flow-v[0-9.]+-[0-9]+\.zip$/;

/** Does this asset filename belong to the given variant's build? Pure. */
export function assetNameForVariant(name: string, variant: HGFVariant): boolean {
  if (typeof name !== "string" || !name) return false;
  if (variant === "owner") return RELEASE_ZIP_ASSET_OWNER_PATTERN.test(name);
  return RELEASE_ZIP_ASSET_PUBLIC_PATTERN.test(name) && !name.includes("-owner-");
}

/**
 * Pick the zip asset's updated_at out of a release's asset list for
 * the given variant: a variant-matching asset first, the legacy
 * single-asset name second, "" when neither exists. Pure.
 */
export function pickReleaseAssetUpdatedAt(assets: unknown, variant: HGFVariant): string {
  const list = Array.isArray(assets) ? assets : [];
  let legacy = "";
  for (const a of list) {
    if (!isPlainObject(a) || typeof a.name !== "string") continue;
    if (assetNameForVariant(a.name, variant) && typeof a.updated_at === "string") return a.updated_at;
    if (a.name === RELEASE_ZIP_ASSET && typeof a.updated_at === "string" && !legacy) legacy = a.updated_at;
  }
  return legacy;
}
/** Pre-release page — the distribution channel for unpacked builds. */
export const RELEASE_PAGE_URL = "https://github.com/BidyutRoy2/hiddengem-flow/releases/tag/v2.1.1-dev-20261118";

/** The releases list page — always live, newest build on top. The footer
 *  Download button points here (not at one tag), so it works before a new
 *  release is published and after. */
export const RELEASES_PAGE_URL = "https://github.com/BidyutRoy2/hiddengem-flow/releases";

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const RETRY_AFTER_MS = 60 * 60 * 1000; // 1 hour after a failed check

/**
 * First-check grace window: 24 hours. See isNewerOnFirstCheck — the
 * release asset's `updated_at` is its UPLOAD time, always AFTER
 * BUILD_DATE, so without this window every fresh install would
 * report an update available pointing at ITSELF. Upload lag is NOT
 * minutes in practice: v2.1.1 was built 2026-11-17T21:55:06Z and its
 * asset was uploaded 2026-11-18T00:17:02Z — 2h 22m later, just
 * outside the old 2h window, so the shipped v2.1.1 reported an
 * update pointing at itself on every fresh install (finding A-89).
 * The publish workflow (live test → owner approval → source push →
 * release) spans hours, so the grace must cover a full day. The
 * cost: a same-tag asset re-upload within 24h of BUILD_DATE is
 * missed on a FIRST check — but a rebuild always gets a new version
 * (semver signal, ungraced), and isNewerThanStored still catches a
 * replaced asset on later checks. A genuinely older build is days
 * older than the asset, so 24h still separates the two.
 */
export const FIRST_CHECK_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * When THIS build was made (ISO date-time, UTC). UPDATE THIS ON EVERY
 * RELEASE BUILD — the checker compares it against the release asset's
 * `updated_at`. When a new build is published, the release asset is
 * replaced, so its `updated_at` moves past the previous build's date
 * and the checker reports the newer build. A build whose BUILD_DATE is
 * later than the asset's `updated_at` reports "up to date".
 *
 * NOTE (finding A-06, fixed): the asset's `updated_at` is the time
 * the file was UPLOADED, not the time the code was built — always a
 * few minutes LATER than BUILD_DATE. Before the fix, a fresh install
 * of this very build reported an update available pointing at itself
 * (permanently for fresh profiles, not briefly). The first check now
 * uses the grace window in isNewerOnFirstCheck: an asset updated
 * within 24h of BUILD_DATE is the normal upload lag (v2.1.1's lag
 * was 2h 22m — finding A-89) and counts as up to date; only a
 * bigger gap counts as a genuinely older build.
 * The same upload-lag trap hit LATER checks too, in the other
 * direction: comparing the asset's updated_at against BUILD_DATE on
 * a later check is always true for the installed build, so the
 * Settings manual check permanently reported an update pointing at
 * itself even though the background first check was correctly up to
 * date (A-06 second bug). The first attempt at a fix — later checks
 * comparing ONLY against the stored record — swung too far the
 * other way: it forgot an old build's verdict the moment a second
 * check ran (probe23 Phase A: the banner appeared, then the manual
 * check said "up to date"). So later checks now OR both rules: the
 * grace rule against BUILD_DATE preserves the installed build's
 * verdict (and clears it after an upgrade), and isNewerThanStored
 * catches a replaced asset under the same tag within the grace
 * window. BUILD_DATE is therefore a first-check AND a later-check
 * input, never the sole later-check input.
 */
export const BUILD_DATE = "2026-11-18T09:16:30Z";

/** What a check found, as stored in chrome.storage.local. */
export interface UpdateRecord {
  /** Release tag, e.g. "v2.1.1-dev-20261118". "" when no release exists yet. */
  tag: string;
  /** Release published_at (ISO). "" when unknown. */
  publishedAt: string;
  /** The extension-zip asset's updated_at (ISO). "" when the asset is missing. */
  assetUpdatedAt: string;
  /** The release page URL (html_url). The download link points here, never at a raw file. */
  downloadUrl: string;
  /** When the last check ran (attempted, success or not), ms since epoch. */
  checkedAt: number;
  /** Whether the last check found a newer build (before the dismiss rule). */
  available: boolean;
  /** Tag the user dismissed the banner for. "" when nothing dismissed. */
  dismissedTag: string;
  /** Asset updated_at the user dismissed the banner for. "" when nothing dismissed. */
  dismissedAssetUpdatedAt: string;
  /** Do not check again before this time (ms since epoch). 0 = no backoff. */
  retryAfter: number;
}

export function emptyUpdateRecord(): UpdateRecord {
  return {
    tag: "",
    publishedAt: "",
    assetUpdatedAt: "",
    downloadUrl: "",
    checkedAt: 0,
    available: false,
    dismissedTag: "",
    dismissedAssetUpdatedAt: "",
    retryAfter: 0,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Compare two version strings. Strips a leading "v". Numeric core
 * segments compare numerically; a "-suffix" counts as OLDER than the
 * same version without one (so "1.0.0-dev-20261115" < "1.0.0"); when
 * both have a suffix, its dot-separated parts compare numerically
 * where both are numbers, lexically otherwise. Returns -1, 0 or 1.
 */
export function compareBuildVersions(a: string, b: string): number {
  const strip = (v: string): { core: string[]; pre: string | null } => {
    const cleaned = String(v ?? "").trim().replace(/^[vV]/, "");
    const dash = cleaned.indexOf("-");
    if (dash === -1) return { core: cleaned.split("."), pre: null };
    return { core: cleaned.slice(0, dash).split("."), pre: cleaned.slice(dash + 1) };
  };
  const pa = strip(a);
  const pb = strip(b);
  const len = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < len; i++) {
    const sa = pa.core[i] ?? "0";
    const sb = pb.core[i] ?? "0";
    const na = Number.parseInt(sa, 10);
    const nb = Number.parseInt(sb, 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na < nb ? -1 : 1;
      continue;
    }
    if (sa < sb) return -1;
    if (sa > sb) return 1;
  }
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1; // plain release is newer than its own pre-release
  if (pb.pre === null) return -1;
  const ap = pa.pre.split(".");
  const bp = pb.pre.split(".");
  const plen = Math.max(ap.length, bp.length);
  for (let i = 0; i < plen; i++) {
    const xa = ap[i] ?? "";
    const xb = bp[i] ?? "";
    const na = Number.parseInt(xa, 10);
    const nb = Number.parseInt(xb, 10);
    if (xa !== "" && xb !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na < nb ? -1 : 1;
      continue;
    }
    if (xa < xb) return -1;
    if (xa > xb) return 1;
  }
  return 0;
}

/** The release fields the checker reads (from the GitHub releases API). */
export interface ReleaseInfo {
  tag: string;
  publishedAt: string;
  assetUpdatedAt: string;
  downloadUrl: string;
}

/** Pull the checker's fields out of one raw release object. Null when it has no tag.
 * The `variant` parameter (default: the installed build's variant)
 * decides which zip asset counts: the owner build watches the
 * -owner- asset, the public build watches the plain one. A release
 * carrying only the legacy hiddengem-flow-extension.zip asset counts
 * for both (old releases). Pure. */
export function parseRelease(raw: unknown, variant: HGFVariant = HGF_VARIANT): ReleaseInfo | null {
  if (!isPlainObject(raw)) return null;
  const tag = typeof raw.tag_name === "string" ? raw.tag_name : "";
  if (!tag) return null;
  const publishedAt = typeof raw.published_at === "string" ? raw.published_at : "";
  const downloadUrl = typeof raw.html_url === "string" ? raw.html_url : "";
  const assetUpdatedAt = pickReleaseAssetUpdatedAt(raw.assets, variant);
  return { tag, publishedAt, assetUpdatedAt, downloadUrl };
}

/**
 * Is this release newer than the running build? Two signals, either one
 * is enough: (a) the zip asset's updated_at (falling back to the release
 * published_at when the asset is missing) is later than BUILD_DATE, or
 * (b) the release tag is a later semver than the manifest version.
 * Signal (b) alone cannot catch a newer BUILD of the same version (the
 * dev pre-release tag is stable while builds change), which is why (a)
 * exists — and why BUILD_DATE must be updated on every release build.
 */
export function isNewerRelease(release: ReleaseInfo, buildDate: string, manifestVersion: string): boolean {
  const effective = release.assetUpdatedAt || release.publishedAt;
  const effMs = Date.parse(effective);
  const buildMs = Date.parse(buildDate);
  if (!Number.isNaN(effMs) && !Number.isNaN(buildMs) && effMs > buildMs) return true;
  if (manifestVersion && compareBuildVersions(release.tag, manifestVersion) > 0) return true;
  return false;
}

/**
 * Is this release newer than the running build, on the FIRST check
 * ever (no release stored yet — see checkForUpdates)? Same two
 * signals as isNewerRelease, but the timestamp signal gets the 24h
 * grace window: an asset updated at most 24h after BUILD_DATE is the
 * normal upload lag (the asset is uploaded hours after the build
 * is made — v2.1.1's lag was 2h 22m, finding A-89), so it counts as
 * up to date and the release is stored as seen. Only a gap over 24h
 * counts as a genuinely older build (e.g. installed from an old
 * chat zip, days after the build). The semver signal is NOT
 * graced — a later tag is unambiguous evidence of a newer release
 * whatever the timestamps say. Unparseable timestamps fall back to
 * the plain rule.
 */
export function isNewerOnFirstCheck(release: ReleaseInfo, buildDate: string, manifestVersion: string): boolean {
  if (manifestVersion && compareBuildVersions(release.tag, manifestVersion) > 0) return true;
  const effective = release.assetUpdatedAt || release.publishedAt;
  const effMs = Date.parse(effective);
  const buildMs = Date.parse(buildDate);
  if (Number.isNaN(effMs) || Number.isNaN(buildMs)) {
    return isNewerRelease(release, buildDate, manifestVersion);
  }
  return effMs - buildMs > FIRST_CHECK_GRACE_MS;
}

/**
 * Is this release newer than the release STORED by a previous check?
 * LATER CHECKS ONLY — see checkForUpdates. Comparing against
 * BUILD_DATE here is WRONG: the zip asset's `updated_at` is its
 * UPLOAD time, always minutes after the build, so it is ALWAYS later
 * than BUILD_DATE for the currently installed build — every later
 * check would permanently report an update pointing at the installed
 * build itself (finding A-06, second bug, caught by the post-upload
 * Phase B: the background first check was correctly up to date, but
 * the Settings manual check said "a newer build is available").
 * Instead compare against what the previous check stored:
 *  * a different tag → newer (the release changed);
 *  * the same tag, but the asset's updated_at differs → newer (the
 *    asset was replaced under the same tag — exactly how dev builds
 *    are republished);
 *  * stored assetUpdatedAt "" and the release now HAS one → newer
 *    (the downloadable build did not exist at the first check);
 *  * assetUpdatedAt "" on the release side (asset removed) or both
 *    "" (no zip asset at all) → NOT newer on the timestamp signal.
 * The semver signal stays: a tag later than the manifest version is
 * newer whatever the timestamps say (so an already-reported update
 * stays reported until the user actually upgrades).
 */
export function isNewerThanStored(release: ReleaseInfo, stored: UpdateRecord, manifestVersion: string): boolean {
  if (release.tag !== stored.tag) return true;
  if (manifestVersion && compareBuildVersions(release.tag, manifestVersion) > 0) return true;
  const now = release.assetUpdatedAt;
  const then = stored.assetUpdatedAt;
  if (now !== then) return now !== "";
  return false;
}

/** Is an update available AND not dismissed? Dismiss is keyed by tag + asset updated_at. */
export function isUpdateAvailable(record: UpdateRecord | null): boolean {
  if (!record || !record.available) return false;
  if (
    record.dismissedTag === record.tag &&
    record.dismissedTag !== "" &&
    record.dismissedAssetUpdatedAt === record.assetUpdatedAt
  ) {
    return false;
  }
  return true;
}

/** May a check run now? No record → yes. Inside the 1h failure backoff → no. Otherwise only after 6h. */
export function shouldCheckNow(record: UpdateRecord | null, now: number): boolean {
  if (!record) return true;
  if (typeof record.retryAfter === "number" && record.retryAfter > 0 && now < record.retryAfter) return false;
  if (typeof record.checkedAt !== "number" || record.checkedAt <= 0) return true;
  return now - record.checkedAt >= CHECK_INTERVAL_MS;
}

// ---------------------------------------------------------------------------
// Storage / network
// ---------------------------------------------------------------------------

function storageAvailable(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome?.storage?.local;
  } catch {
    return false;
  }
}

/** Load the stored check result, or null when there is none / it is malformed. */
export async function loadUpdateRecord(): Promise<UpdateRecord | null> {
  if (!storageAvailable()) return null;
  try {
    const data = await chrome.storage.local.get(UPDATE_KEY);
    const raw = data?.[UPDATE_KEY];
    if (!isPlainObject(raw) || typeof raw.checkedAt !== "number") return null;
    const rec: UpdateRecord = {
      tag: typeof raw.tag === "string" ? raw.tag : "",
      publishedAt: typeof raw.publishedAt === "string" ? raw.publishedAt : "",
      assetUpdatedAt: typeof raw.assetUpdatedAt === "string" ? raw.assetUpdatedAt : "",
      downloadUrl: typeof raw.downloadUrl === "string" ? raw.downloadUrl : "",
      checkedAt: raw.checkedAt,
      available: raw.available === true,
      dismissedTag: typeof raw.dismissedTag === "string" ? raw.dismissedTag : "",
      dismissedAssetUpdatedAt: typeof raw.dismissedAssetUpdatedAt === "string" ? raw.dismissedAssetUpdatedAt : "",
      retryAfter: typeof raw.retryAfter === "number" ? raw.retryAfter : 0,
    };
    return rec;
  } catch {
    return null;
  }
}

/** Persist a check result. */
export async function saveUpdateRecord(record: UpdateRecord): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [UPDATE_KEY]: record });
}

/** Dismiss the banner for the currently recorded release (no-op when nothing is available). */
export async function dismissUpdate(): Promise<void> {
  const record = await loadUpdateRecord();
  if (!record || !record.available) return;
  await saveUpdateRecord({
    ...record,
    dismissedTag: record.tag,
    dismissedAssetUpdatedAt: record.assetUpdatedAt,
  });
}

export interface UpdateCheckResult {
  /** True when the API call itself succeeded (a "no update" answer is ok:true). */
  ok: boolean;
  /**
   * A newer build exists (RAW — before the dismiss rule). The banner
   * and the floating line apply the dismiss rule themselves via
   * isUpdateAvailable(); the Settings check reports this raw answer,
   * so a manual check after a dismiss still tells the truth instead
   * of claiming "up to date".
   */
  available: boolean;
  /** The stored record after this call (null when storage is unavailable). */
  record: UpdateRecord | null;
  /** True when this call actually fetched (not a gated skip). */
  checked: boolean;
  /** Failure reason (rate limit, network error) — callers must not show it as a banner. */
  error?: string;
}

function manifestVersion(): string {
  try {
    const v = chrome?.runtime?.getManifest?.()?.version;
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

/**
 * Check the latest release, respecting the 6h gate unless `force` is
 * true (the Settings "Check for updates" button). A failure (403 rate
 * limit, network error, bad JSON) is silent by design: the previous
 * record keeps its availability, the next check is backed off by 1h,
 * and the returned `ok` is false — callers must not turn it into a
 * banner or an error message beyond the manual-check status line.
 *
 * Later checks use BOTH rules, OR-ed (see the branch below): the
 * first-check rule against BUILD_DATE (with its 24h grace) preserves
 * the verdict about the INSTALLED build — an old build keeps
 * reporting available, and after the user upgrades the verdict
 * clears because BUILD_DATE moved past the asset. The stored rule
 * (isNewerThanStored) catches what the grace window would hide: a
 * replaced asset under the same tag, published within 24h of the
 * build. Either rule alone is wrong: BUILD_DATE alone makes every
 * later check self-point (A-06 second bug), and the stored rule
 * alone forgets an old build's verdict the moment a second check
 * runs (caught by probe23 Phase A: the banner appeared, then the
 * manual check said "up to date").
 */
export async function checkForUpdates(force = false): Promise<UpdateCheckResult> {
  const now = Date.now();
  const stored = await loadUpdateRecord();
  if (!force && stored && !shouldCheckNow(stored, now)) {
    return { ok: true, available: stored.available, record: stored, checked: false };
  }
  const fail = async (error: string): Promise<UpdateCheckResult> => {
    const base = stored ?? emptyUpdateRecord();
    const record: UpdateRecord = { ...base, checkedAt: now, retryAfter: now + RETRY_AFTER_MS };
    try {
      await saveUpdateRecord(record);
    } catch {
      // Storage unavailable — the failure is still silent.
    }
    return { ok: false, available: stored?.available ?? false, record: stored, checked: false, error };
  };
  let res: Response;
  try {
    res = await fetch(RELEASES_URL);
  } catch (err) {
    return fail(`Network error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    return fail(`GitHub answered ${res.status}.`);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return fail("The releases list is not valid JSON.");
  }
  const list = Array.isArray(data) ? data : [];
  const release = list.length > 0 ? parseRelease(list[0]) : null;
  if (!release) {
    const record: UpdateRecord = {
      ...(stored ?? emptyUpdateRecord()),
      tag: "",
      publishedAt: "",
      assetUpdatedAt: "",
      downloadUrl: "",
      checkedAt: now,
      retryAfter: 0,
      available: false,
    };
    try {
      await saveUpdateRecord(record);
    } catch {
      // Non-fatal.
    }
    return { ok: true, available: false, record, checked: true };
  }
  // First check ever (no release stored yet — a failed check or an
  // empty release list leaves tag ""): the 24h grace window applies.
  // Later checks use BOTH rules, OR-ed. The grace rule against
  // BUILD_DATE preserves the verdict about the INSTALLED build:
  // an old build keeps reporting available on every later check,
  // and after the user upgrades to a newer build the verdict clears
  // (BUILD_DATE moved past the asset). The stored rule
  // (isNewerThanStored) catches what the grace window would hide:
  // a replaced asset under the same tag, published within 24h of the
  // build. Either rule alone is wrong — BUILD_DATE alone makes every
  // later check self-point (A-06 second bug), and the stored rule
  // alone forgets an old build's verdict on the second check
  // (probe23 Phase A caught exactly that).
  const firstCheck = !stored || !stored.tag;
  const graceVerdict = isNewerOnFirstCheck(release, BUILD_DATE, manifestVersion());
  const available = firstCheck
    ? graceVerdict
    : graceVerdict || isNewerThanStored(release, stored, manifestVersion());
  const record: UpdateRecord = {
    ...(stored ?? emptyUpdateRecord()),
    tag: release.tag,
    publishedAt: release.publishedAt,
    assetUpdatedAt: release.assetUpdatedAt,
    downloadUrl: release.downloadUrl || RELEASE_PAGE_URL,
    checkedAt: now,
    retryAfter: 0,
    available,
  };
  try {
    await saveUpdateRecord(record);
  } catch {
    // Non-fatal: the returned record still carries the answer.
  }
  // Raw availability — the dismiss rule is applied by the callers
  // that render the banner / floating line, not by the check itself.
  return { ok: true, available, record, checked: true };
}
