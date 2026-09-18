/**
 * The raw document contract: the byte-oriented half of the raw layer.
 *
 * `raw.records` holds what a source says; `raw.documents` catalogues the files a source
 * carries -- a PDF attached to an invoice email, a statement in a Drive folder. The bytes
 * live in the lake; this is the entry that lets SQL and the UI know a document exists
 * without being able to read it out of Postgres.
 *
 * THE LINE THIS FILE DRAWS. `raw.documents` is granted to `undercroft_dbt`, so anything in
 * it is one `dbt run` from a mart a dashboard reads. Therefore:
 *
 *   - **The key and the metadata carry only opaque provider ids**, timestamps, enumerated
 *     types and counts.
 *   - **Anything a human wrote goes in the lake manifest** -- a filename, a mail subject,
 *     an address, a folder name. The manifest sits in the access-controlled object store,
 *     which BI and dbt cannot reach at all.
 *
 * A filename in a lake *key* would defeat this, because `raw.documents.lake_key` is a
 * granted column. So `documentKeyOf` takes an id and nothing else, and there is no
 * overload that takes a name.
 */

import { z } from "zod";

export const RawDocument = z.object({
  source: z.string().min(1),
  tenantId: z.string().min(1),
  /**
   * Stable upstream identity for the document. "Stable" is load-bearing: Gmail's
   * `attachmentId` is scoped to a single message read and changes between fetches, so the
   * Gmail collector keys on `{messageId}:{partIndex}` instead. Keying on a value that
   * rotates re-lands the same PDF under a new key on every run.
   */
  documentId: z.string().min(1, "a document with no id cannot be traced"),
  contentType: z.string().min(1),
  /** Bytes as a decimal string. `bigint` in Postgres; a JS number would round at 2^53. */
  byteLength: z.string().regex(/^\d+$/u),
  /** When the source last changed it. Null is honest; a guess is not. */
  sourceUpdatedAt: z.string().datetime().nullable(),
});

export type RawDocument = z.infer<typeof RawDocument>;

/** The `documents/source/tenant` prefix a tenant's documents share. */
export function documentPrefixOf(document: Pick<RawDocument, "source" | "tenantId">): string {
  return `documents/${document.source}/${document.tenantId}`;
}

/**
 * The lake key for a document.
 *
 * Deliberately not under `records/`: the record loader walks a journal and decodes every
 * object it finds as JSON text for `payload jsonb`. A PDF on that path becomes a
 * `TextDecoder` failure at best and mojibake in a jsonb column at worst. Documents are
 * landed with no journal stream and catalogued directly instead.
 */
export function documentKeyOf(
  document: Pick<RawDocument, "source" | "tenantId" | "documentId">,
): string {
  return `${documentPrefixOf(document)}/${document.documentId}`;
}
