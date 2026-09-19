/**
 * Wire types for the lake write API.
 *
 * These are the one definition shared by the worker's Hono routes and any OpenAPI
 * document generated from them. A Kestra task, a shell script or a third-party tool sees
 * the same shapes the runtime validates against -- there is no second, hand-written copy
 * to drift.
 */

import { z } from "zod";

/** Ceiling on a records batch. A caller that needs more makes more calls. */
export const MAX_RECORDS_PER_BATCH = 1000;
export const MAX_BATCH_BYTES = 10 * 1024 * 1024;

export const LandRecordInput = z.object({
  entity: z.string().min(1),
  sourceRecordId: z.string().min(1),
  sourceUpdatedAt: z.string().datetime().nullable().default(null),
  /** The record body as JSON text, hashed and stored verbatim. Never re-serialised. */
  payloadText: z.string(),
});

export const LandRecordsRequest = z.object({
  source: z.string().min(1),
  tenantId: z.string().min(1),
  runId: z.string().min(1),
  reason: z.string().default(""),
  records: z.array(LandRecordInput).min(1).max(MAX_RECORDS_PER_BATCH),
});
export type LandRecordsRequest = z.infer<typeof LandRecordsRequest>;

export const LandRecordResult = z.object({
  entity: z.string(),
  sourceRecordId: z.string(),
  status: z.enum(["created", "unchanged", "failed"]),
  sha256: z.string().optional(),
  lakeKey: z.string().optional(),
  stamp: z.string().optional(),
  reason: z.string().optional(),
});

export const LandRecordsResponse = z.object({
  runId: z.string(),
  created: z.number().int(),
  unchanged: z.number().int(),
  failed: z.number().int(),
  results: z.array(LandRecordResult),
});
export type LandRecordsResponse = z.infer<typeof LandRecordsResponse>;

/**
 * The error envelope every non-2xx response uses. `message` never carries a payload value.
 *
 * The last seven codes are what the worker's error boundary answers when a verb throws
 * rather than refuses: a run that cannot start because nobody chose a scope, a credential
 * that cannot be refreshed, a source that failed mid-read, a run already in progress, a
 * pasted token the source rejected, a thing that does not exist, and everything else --
 * which is answered with no message at all, because an unexpected error's text is the one
 * place a row value can leak into a response.
 */
export const ApiError = z.object({
  code: z.enum([
    "invalid_request",
    "unauthenticated",
    "out_of_scope",
    "object_exists",
    "payload_too_large",
    "digest_mismatch",
    "record_rejected",
    "rate_limited",
    "store_unavailable",
    "scope_not_chosen",
    "credential_unusable",
    "source_failed",
    "run_in_progress",
    "credential_rejected",
    "query_failed",
    "not_found",
    "internal_error",
  ]),
  message: z.string(),
  details: z.array(z.string()).default([]),
});
export type ApiError = z.infer<typeof ApiError>;
