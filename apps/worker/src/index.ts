/**
 * The worker's public surface, by layer.
 *
 * The HTTP handler first, then the services behind it. Nothing from `repos/` is exported:
 * a caller outside this app gets the verb, not the tables it writes.
 */

export { createLakeApi, type LakeApiDeps } from "./handlers/lake.ts";
export { authenticate, type AuthOutcome } from "./services/auth.ts";
export { runIngest, type IngestResult, type RunDeps } from "./services/ingest.ts";
export {
  landRecords,
  type LandedRecord,
  type LandResult,
  type RecordToLand,
} from "./services/land.ts";
export { loadStreamToRaw, type LoadResult } from "./services/loadToRaw.ts";
export { runTransform, type TransformDeps, type TransformResult } from "./services/transform.ts";
