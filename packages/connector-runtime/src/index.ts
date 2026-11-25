export type { RecordDocument } from "./documents.ts";
export {
  createFetcher,
  type Fetcher,
  type HttpRequest,
  type HttpResponse,
  raiseForStatus,
} from "./fetcher.ts";
// `laterStamp` and not `isOlder`: the caller owns where a cursor lives and therefore has to
// build one, while deciding whether a record is already read is the runtime's own business
// and stays inside it. `requestKey` for the same reason: the caller stores the key, and only the
// runtime knows what a request is made of.
export {
  type Incremental,
  type IncrementalFormat,
  laterStamp,
  requestKey,
} from "./incremental.ts";
// `refusedScopes` as well as the error it raises: the scope picker lists a portal's properties
// outside any read, and must tell the same refusal apart in the same words.
export { EntityNotGranted, refusedScopes } from "./refusal.ts";
// The one way a payload becomes the text the lake stores, for anything that must agree with what
// a read lands -- re-canonicalising a payload already in the lake above all (ADR 0158).
export { canonicalPayload } from "./unordered.ts";
export {
  type RawRecordOut,
  type ReadEnd,
  type RequestBudget,
  type RunContext,
  readEntity,
} from "./run.ts";
