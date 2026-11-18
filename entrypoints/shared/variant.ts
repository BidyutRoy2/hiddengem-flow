// HiddenGem Flow — build variant (v2.1.0, two builds, one codebase).
//
// OWNER build: every feature + the Studio tab (Dashboard only).
// PUBLIC build: every feature, NO Studio code at all.
//
// The flag is a compile-time constant: wxt.config.ts sets
// `__HGF_OWNER_BUILD__` through Vite's `define` from the
// HGF_OWNER_BUILD environment variable ("1" = owner build, anything
// else = public build). The bundler replaces the identifier with a
// literal `true`/`false`, so `if (IS_OWNER_BUILD) { ... }` branches
// — including the dynamic import of the Studio module — are
// eliminated from the public bundle entirely. The acceptance test is
// a grep of the built public output for the Studio name: zero hits.
//
// Outside a Vite build (plain-Node smoke bundles, which do not define
// the identifier) the `typeof` guard falls back to the public
// variant — never to the owner one. Smoke tests can pass the variant
// explicitly where a function takes it as a parameter.
declare const __HGF_OWNER_BUILD__: boolean | undefined;

/** True only in the owner build (HGF_OWNER_BUILD=1 at build time). */
export const IS_OWNER_BUILD: boolean =
  typeof __HGF_OWNER_BUILD__ !== "undefined" ? __HGF_OWNER_BUILD__ === true : false;

export type HGFVariant = "owner" | "public";

/** "owner" in the owner build, "public" everywhere else. */
export const HGF_VARIANT: HGFVariant = IS_OWNER_BUILD ? "owner" : "public";

/** Release-asset filename for a variant at a given version + date stamp. */
export function variantAssetName(variant: HGFVariant, version: string, dateStamp: string): string {
  const v = String(version ?? "").replace(/^v/, "");
  const d = String(dateStamp ?? "");
  return variant === "owner"
    ? `hiddengem-flow-v${v}-owner-${d}.zip`
    : `hiddengem-flow-v${v}-${d}.zip`;
}
