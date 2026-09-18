/**
 * The service layer of `@undercroft/db`, reached as `@undercroft/db/services`.
 *
 * Credential refresh lives here rather than in the app that happens to need it: the worker
 * needs a usable token, and the rule for when to rotate one belongs beside the tables it
 * rotates, not copied into every caller.
 */

// biome-ignore-all lint/performance/noBarrelFile: `index.ts` is each package's public entry point, which is the seam `.claude/rules/layering.md` is built on and what `.claude/rules/tests.md` means by testing through the public API. The re-export cost the rule is about applies to a bundle; these are workspace packages consumed by name.

export { accessToken, needsRefresh, REFRESH_SKEW_MS } from "./credentials.ts";
