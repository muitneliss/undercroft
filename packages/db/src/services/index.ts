/**
 * The service layer of `@undercroft/db`, reached as `@undercroft/db/services`.
 *
 * Credential refresh lives here rather than in the app that happens to need it: the worker
 * needs a usable token, and the rule for when to rotate one belongs beside the tables it
 * rotates, not copied into every caller.
 */

export { accessToken, needsRefresh, REFRESH_SKEW_MS } from "./credentials.ts";
export {
  MACROS,
  parseRunResults,
  PASSWORD_VAR,
  type ProjectInput,
  type ProjectModel,
  renderProject,
  SOURCES_YML,
} from "./dbtProject.ts";
export { grantExpiryFor } from "./grantExpiry.ts";
