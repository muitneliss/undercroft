/**
 * The service layer of `@undercroft/db`, reached as `@undercroft/db/services`.
 *
 * Credential refresh lives here rather than in the app that happens to need it: the worker
 * needs a usable token, and the rule for when to rotate one belongs beside the tables it
 * rotates, not copied into every caller.
 */

export { accessToken, needsRefresh, REFRESH_SKEW_MS, RefreshRefused } from "./credentials.ts";
export {
  MACROS,
  parseRunResults,
  PASSWORD_VAR,
  type ProjectInput,
  type ProjectMacro,
  type ProjectModel,
  relationsOfModel,
  renderProject,
  SOURCES_YML,
  testRelationPrefix,
} from "./dbtProject.ts";
export { grantExpiryFor } from "./grantExpiry.ts";
export {
  callersOf,
  type MacroDefinition,
  type MacroRefusal,
  readMacroDefinition,
} from "./macroDefinition.ts";
export {
  checkMacro,
  checkModel,
  type Finding,
  type FindingCode,
  type MacroCheckInput,
  type ModelCheck,
  type ModelCheckInput,
  type Severity,
  type UnverifiedCode,
} from "./modelCheck.ts";
