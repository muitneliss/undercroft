/**
 * The worker's public surface, by layer.
 *
 * The HTTP handler first, then the services behind it. Nothing from `repos/` is exported:
 * a caller outside this app gets the verb, not the tables it writes.
 */

export { createLakeApi, type LakeApiDeps } from "./handlers/lake.ts";
export { type AuthOutcome, authenticate } from "./services/auth.ts";
export { type IngestResult, type RunDeps, runIngest } from "./services/ingest.ts";
export {
  type LandedRecord,
  type LandResult,
  landRecords,
  type RecordToLand,
} from "./services/land.ts";
export {
  type DocumentToLand,
  type LandDocumentsResult,
  type LandedDocument,
  landDocuments,
  MAX_DOCUMENT_BYTES,
} from "./services/landDocument.ts";
export { type LoadResult, loadStreamToRaw } from "./services/loadToRaw.ts";
export { runTransform, type TransformDeps, type TransformResult } from "./services/transform.ts";
