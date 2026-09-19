import { describe, expect, test as it } from "bun:test";
import { ConnectorError, HttpError } from "@undercroft/core";
import { ConnectionRegistryError } from "@undercroft/db/repos";

import { ScopeNotChosen } from "../services/google/collect.ts";
import { failureOf } from "./errors.ts";

describe("what a thrown failure means over HTTP", () => {
  it("a run with no chosen scope is a 409 the caller can act on, with the reason", () => {
    const failure = failureOf(new ScopeNotChosen("gmail", "CASE-1"));
    expect(failure.status).toBe(409);
    expect(failure.code).toBe("scope_not_chosen");
    expect(failure.message).toContain("no recorded scope");
  });

  it("a credential that cannot be refreshed is a 409, recognised without importing the repo", () => {
    const failure = failureOf(new ConnectionRegistryError("no credential for CASE-1/xero"));
    expect(failure.status).toBe(409);
    expect(failure.code).toBe("credential_unusable");
    expect(failure.message).toBe("no credential for CASE-1/xero");
  });

  it("a source that failed mid-read is a 502 carrying the count that names the kind of fault", () => {
    const failure = failureOf(new ConnectorError("hubspot", "deals", 412, "HTTP 429"));
    expect(failure.status).toBe(502);
    expect(failure.code).toBe("source_failed");
    expect(failure.message).toContain("failed after 412 records");

    expect(failureOf(new HttpError(401, "https://api.example.test/x")).code).toBe("source_failed");
  });

  it("anything else is a 500 that repeats none of the error's text", () => {
    const failure = failureOf(new Error('duplicate key value violates "records_pkey": (CASE-1)'));
    expect(failure.status).toBe(500);
    expect(failure.code).toBe("internal_error");
    expect(failure.message).not.toContain("CASE-1");
    expect(failure.message).not.toContain("records_pkey");
  });
});
