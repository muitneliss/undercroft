/**
 * Test support for the worker's suites. Nothing here is imported by the process.
 *
 * `noDatabase` is for a test whose subject never reaches the database -- a request refused
 * before its credential is looked at, a body that fails its schema, a listing that is pure
 * HTTP -- but whose handler or service needs an executor to be constructed at all. It is an
 * executor that REFUSES, not one that answers nothing: a test that did touch it, because the
 * code under it quietly started asking Postgres something, fails loudly with this message
 * instead of passing against an empty result. And it costs nothing, where a migrated PGlite
 * per test is the fixture `tests.md` says such a test must not sit under.
 *
 * The same shape as `apps/control-plane/src/handlers/server.test.ts`'s, kept here so the
 * worker's suites share one copy rather than six.
 */

import type { SqlExecutor } from "@undercroft/db";

function refused(): Promise<never> {
  return Promise.reject(new Error("this test must not touch the database"));
}

export const noDatabase: SqlExecutor = { query: refused, exec: refused };
