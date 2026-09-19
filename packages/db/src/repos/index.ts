/**
 * The repo layer of `@undercroft/db`, reached as `@undercroft/db/repos`.
 *
 * A subpath rather than part of the root export, so an import statement says which layer it
 * belongs to. Behind one barrel a handler importing a repo and a handler importing the
 * `SqlExecutor` seam look identical, and `layer-handler-no-repo` cannot tell them apart.
 * See docs/adr/0011.
 */

// biome-ignore-all lint/performance/noBarrelFile: `index.ts` is each package's public entry point, which is the seam `.claude/rules/layering.md` is built on and what `.claude/rules/tests.md` means by testing through the public API. The re-export cost the rule is about applies to a bundle; these are workspace packages consumed by name.

export {
  type Cadence,
  claimExpiringGrants,
  type Connection,
  type ConnectionDetail,
  ConnectionRegistryError,
  type Credential,
  deleteCredential,
  type ConnectionView,
  type DueCandidate,
  type ExpiringGrant,
  getConnection,
  type LastRun,
  listConnections,
  listConnectionViews,
  listDueCandidates,
  readConnectionDetail,
  readCredential,
  setCadence,
  setExternalAccount,
  setStatus,
  upsertConnection,
  writeConnectionDetail,
  writeCredential,
} from "./connections.ts";
export {
  claimExpiringKeys,
  type ExpiringKey,
  findByDigest,
  type IngestKey,
  type IngestKeyRow,
  insertKey,
  listKeys,
  revokeKey,
  touchLastUsed,
} from "./ingestKeys.ts";
export { type CursorKey, decodeCursor, encodeCursor } from "./cursor.ts";
export {
  deleteModel,
  getModel,
  insertModel,
  type LastBuild,
  lastBuildPerModel,
  listModels,
  type Model,
  type ModelTestsJson,
  saveModel,
  setModelColumns,
} from "./models.ts";
export {
  claimExternalRun,
  claimFailedRuns,
  closeAbandoned,
  closeRun,
  entitiesForRuns,
  type FailedRunNotice,
  findRunById,
  getRun,
  listRuns,
  MAX_ERROR_CHARS,
  type OpenOutcome,
  openRun,
  recordEntities,
  recordExternalBatch,
  recordRefusals,
  recordSteps,
  refusalsFor,
  type Run,
  type RunEntity,
  type RunRefusal,
  type RunStatus,
  type RunStep,
  type RunTrigger,
  type RunVerb,
  SOURCE_OF_TRANSFORM,
  stepsFor,
} from "./runs.ts";
export {
  isRoleCollision,
  provisionTenantRoles,
  rotateTenantPassword,
  type TenantRoleKind,
  type TenantRoles,
  tenantRolesFor,
} from "./tenantRoles.ts";
export { tenantExists } from "./tenants.ts";
