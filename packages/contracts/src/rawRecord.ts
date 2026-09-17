/**
 * The raw record contract.
 *
 * One record as a connector yields it, before anything downstream. The Python enforced
 * this at construction (`__post_init__` rejected an empty id from any caller, typed or
 * not); TypeScript's types vanish at runtime, so the equivalent guarantee comes from
 * `RawRecord.parse()` and the rule that a `RawRecord` is only ever constructed through
 * it -- never a bare object literal, never `as RawRecord`.
 */

import { z } from "zod";

export const RawRecord = z.object({
  source: z.string().min(1),
  tenantId: z.string().min(1),
  entity: z.string().min(1),
  /**
   * Upstream identity. A record without one cannot be upserted or traced back, so it is
   * rejected here rather than landed under a guessed key.
   */
  sourceRecordId: z.string().min(1, "a record with no source id cannot be traced"),
  /**
   * The record body, kept as its original JSON *text*. Not a parsed object: `JSON.parse`
   * turns every number into a float, and an invoice total must not round-trip through
   * one. The bytes of this string are what the lake hashes and stores.
   */
  payloadText: z.string(),
  /** When the source last changed it. Null is honest; a guess is not. */
  sourceUpdatedAt: z.string().datetime().nullable(),
});

export type RawRecord = z.infer<typeof RawRecord>;

/** The `source/tenant/entity` stream a record belongs to -- the loader's cursor unit. */
export function streamOf(record: Pick<RawRecord, "source" | "tenantId" | "entity">): string {
  return `records/${record.source}/${record.tenantId}/${record.entity}`;
}

/** The content-addressed lake key for a record. */
export function lakeKeyOf(
  record: Pick<RawRecord, "source" | "tenantId" | "entity" | "sourceRecordId">,
): string {
  return `${streamOf(record)}/${record.sourceRecordId}`;
}
