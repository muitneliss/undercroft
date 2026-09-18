/**
 * The worker's public surface, by layer.
 *
 * The HTTP handler first, then the services behind it. Nothing from `repos/` is exported:
 * a caller outside this app gets the verb, not the tables it writes.
 */

// biome-ignore-all lint/performance/noBarrelFile: `index.ts` is each package's public entry point, which is the seam `.claude/rules/layering.md` is built on and what `.claude/rules/tests.md` means by testing through the public API. The re-export cost the rule is about applies to a bundle; these are workspace packages consumed by name.

export { createLakeApi, type LakeApiDeps } from "./handlers/lake.ts";
export { type AuthOutcome, authenticate } from "./services/auth.ts";
export { type IngestResult, type RunDeps, runIngest } from "./services/ingest.ts";
export {
  type LandedRecord,
  type LandResult,
  landRecords,
  type RecordToLand,
} from "./services/land.ts";
export { type LoadResult, loadStreamToRaw } from "./services/loadToRaw.ts";
export { runTransform, type TransformDeps, type TransformResult } from "./services/transform.ts";
