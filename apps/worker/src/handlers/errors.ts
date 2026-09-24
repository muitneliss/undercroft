/**
 * What a thrown failure means over HTTP, decided once.
 *
 * Every verb used to let its exceptions escape, so a run that could not start because
 * nobody had chosen a scope, a credential Google refused to refresh, and a genuine crash
 * all reached the caller as the same bodiless 500 -- and the control plane, which can only
 * read a status, told the operator the processing service was down when what had happened
 * was that nobody ticked a box. These four outcomes want four different responses, and the
 * status is the only channel the caller has.
 *
 * The last case is deliberately wordless. An unexpected error's message is the one place a
 * row value can leak into a response: a Postgres constraint violation quotes the offending
 * key, a parse failure quotes the text it choked on. Those belong in the log, where
 * `describeError` already keeps them to a type and a message, not in an HTTP body a
 * scheduler stores.
 */

import type { ApiError } from "@undercroft/contracts";
import { ConnectorError, HttpError } from "@undercroft/core";

import { ScopeNotChosen } from "../services/google/collect.ts";
import { GrantTooNarrow } from "../services/google/grant.ts";
import {
  ConnectionUnusable,
  RunInProgress,
  UnknownSource,
  UnknownTenant,
} from "../services/ingest.ts";
import { QueryFailed } from "../services/queryRunner.ts";
import { TenantNotProvisioned } from "../services/tenantSession.ts";

const INTERNAL: Failure = {
  status: 500,
  code: "internal_error",
  message: "the worker could not complete the request",
  details: [],
};

export interface Failure {
  readonly status: 400 | 404 | 409 | 502 | 500;
  readonly code: ApiError["code"];
  readonly message: string;
  /** Structured detail a caller acts on -- the id of the run in progress -- never a payload. */
  readonly details: string[];
}

export function failureOf(error: unknown): Failure {
  if (error instanceof ScopeNotChosen) {
    return { status: 409, code: "scope_not_chosen", message: error.message, details: [] };
  }
  // The author's SQL, refused by Postgres: the message quotes their own text and is the
  // one thing that lets them fix it. A 400, because the request was the fault.
  if (error instanceof QueryFailed) {
    return { status: 400, code: "query_failed", message: error.message, details: [] };
  }
  if (error instanceof TenantNotProvisioned) {
    return { status: 404, code: "not_found", message: error.message, details: [] };
  }
  // The id of the run in progress rides in `details`, so a caller can watch it without
  // parsing a sentence.
  if (error instanceof RunInProgress) {
    return {
      status: 409,
      code: "run_in_progress",
      message: error.message,
      details: [error.runId],
    };
  }
  // A grant too narrow to read its source has the remedy an unconnected one has: a reconnect.
  // Its message names the scope it lacks.
  if (error instanceof ConnectionUnusable || error instanceof GrantTooNarrow) {
    return { status: 409, code: "credential_unusable", message: error.message, details: [] };
  }
  if (error instanceof UnknownTenant || error instanceof UnknownSource) {
    return { status: 404, code: "not_found", message: error.message, details: [] };
  }
  // Matched by name, not by class. The registry error lives in `@undercroft/db/repos`, which
  // a handler may not import even for a type (`layer-handler-no-repo`), and the class sets
  // its own `name` so that a caller two layers up can recognise it without reaching down.
  if (error instanceof Error && error.name === "ConnectionRegistryError") {
    return { status: 409, code: "credential_unusable", message: error.message, details: [] };
  }
  // A source that failed mid-read is the source's fault, not ours: 502, with the message,
  // because a `ConnectorError` carries the count that tells a credential problem from a
  // transient one and nothing else.
  if (error instanceof ConnectorError || error instanceof HttpError) {
    return { status: 502, code: "source_failed", message: error.message, details: [] };
  }
  return INTERNAL;
}
