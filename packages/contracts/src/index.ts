export {
  type ConnectorAuth,
  type ConnectorEntity,
  type ConnectorPagination,
  ConnectorSpec,
} from "./connectorSpec.ts";
export { ConnectionScope, DriveScope, GmailScope, parseScope } from "./connectionScope.ts";
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
