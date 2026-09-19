// biome-ignore-all lint/performance/noBarrelFile: `index.ts` is each package's public entry point, which is the seam `.claude/rules/layering.md` is built on and what `.claude/rules/tests.md` means by testing through the public API. The re-export cost the rule is about applies to a bundle; these are workspace packages consumed by name.

export {
  type ConnectorAuth,
  type ConnectorEntity,
  type ConnectorPagination,
  ConnectorSpec,
} from "./connectorSpec.ts";
export {
  BrowseScopeRequest,
  BrowseScopeResponse,
  CredentialInput,
  RevokeConnectionRequest,
  RevokeConnectionResponse,
  StoreCredentialRequest,
  StoreCredentialResponse,
} from "./connectionApi.ts";
export {
  CADENCE_INTERVAL_MS,
  CADENCES,
  Cadence,
  isDue,
  nextRunAt,
  type ScheduleFacts,
} from "./cadence.ts";
export {
  ConnectionScope,
  DriveScope,
  GmailScope,
  needsScope,
  parseScope,
  SCOPED_SOURCES,
} from "./connectionScope.ts";
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
export { documentKeyOf, documentPrefixOf, RawDocument } from "./rawDocument.ts";
export { lakeKeyOf, RawRecord, streamOf } from "./rawRecord.ts";
