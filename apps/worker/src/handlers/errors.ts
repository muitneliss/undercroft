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

const INTERNAL: Failure = {
  status: 500,
  code: "internal_error",
  message: "the worker could not complete the request",
};

export interface Failure {
  readonly status: 409 | 502 | 500;
  readonly code: ApiError["code"];
  readonly message: string;
}

export function failureOf(error: unknown): Failure {
  if (error instanceof ScopeNotChosen) {
    return { status: 409, code: "scope_not_chosen", message: error.message };
  }
  // Matched by name, not by class. The registry error lives in `@undercroft/db/repos`, which
  // a handler may not import even for a type (`layer-handler-no-repo`), and the class sets
  // its own `name` so that a caller two layers up can recognise it without reaching down.
  if (error instanceof Error && error.name === "ConnectionRegistryError") {
    return { status: 409, code: "credential_unusable", message: error.message };
  }
  // A source that failed mid-read is the source's fault, not ours: 502, with the message,
  // because a `ConnectorError` carries the count that tells a credential problem from a
  // transient one and nothing else.
  if (error instanceof ConnectorError || error instanceof HttpError) {
    return { status: 502, code: "source_failed", message: error.message };
  }
  return INTERNAL;
}
