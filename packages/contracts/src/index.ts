// biome-ignore-all lint/performance/noBarrelFile: `index.ts` is each package's public entry point, which is the seam `.claude/rules/layering.md` is built on and what `.claude/rules/tests.md` means by testing through the public API. The re-export cost the rule is about applies to a bundle; these are workspace packages consumed by name.

export {
  type ConnectorAuth,
  type ConnectorEntity,
  type ConnectorPagination,
  ConnectorSpec,
} from "./connectorSpec.ts";
export {
  ApiError,
  LandRecordInput,
  LandRecordResult,
  LandRecordsRequest,
  LandRecordsResponse,
  MAX_BATCH_BYTES,
  MAX_RECORDS_PER_BATCH,
} from "./lakeApi.ts";
export { parseSpec, SpecError } from "./loadSpec.ts";
export { lakeKeyOf, RawRecord, streamOf } from "./rawRecord.ts";
