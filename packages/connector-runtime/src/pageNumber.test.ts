// biome-ignore-all lint/style/noNonNullAssertion: Almost all of these are tests asserting on a fixture they created three lines earlier, which the ESLint config this replaced also exempted for the same reason. Biome's unsafe autofix for the rule deletes the `!` and leaves `string | undefined` flowing into a `string`, so it does not compile.

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { describe, expect, test as it } from "bun:test";
import { type ConnectorSpec, parseSpec } from "@undercroft/contracts";
import { TestClock } from "@undercroft/core";
import type { RawRecordOut } from "./run.ts";
import { readEntity } from "./run.ts";
import { InMemoryFetcher } from "./testing.ts";

const BASE = "https://api.xero.test";

/** A page-number spec shaped like Xero's: envelope key, stop on an empty page. */
function xeroLikeSpec(): ConnectorSpec {
  return parseSpec(`
apiVersion: undercroft.dev/v1
kind: Connector
id: xerolike
displayName: Xero-like
baseUrl: ${BASE}
auth: { kind: bearer, token: { from: connection } }
defaults:
  pagination: { kind: page-number, param: page, startAt: 1, stopOn: empty-page }
entities:
  - name: invoices
    request: { kind: list, path: /Invoices }
    envelopePath: Invoices
    idPath: InvoiceID
`);
}

async function collect(gen: AsyncGenerator<RawRecordOut>): Promise<RawRecordOut[]> {
  const out: RawRecordOut[] = [];
  for await (const r of gen) {
    out.push(r);
  }
  return out;
}

describe("page-number pagination stops on an empty page", () => {
  it("reads successive pages until one comes back empty", async () => {
    const fetcher = new InMemoryFetcher()
      .on("GET", `${BASE}/Invoices`, {
        body: { Invoices: [{ InvoiceID: "a" }, { InvoiceID: "b" }] },
      })
      .on("GET", `${BASE}/Invoices?page=2`, { body: { Invoices: [{ InvoiceID: "c" }] } })
      .on("GET", `${BASE}/Invoices?page=3`, { body: { Invoices: [] } });

    const spec = xeroLikeSpec();
    const records = await collect(
      readEntity(spec, spec.entities[0]!, {
        fetcher,
        clock: new TestClock(),
        token: () => Promise.resolve("t"),
      }),
    );
    expect(records.map((r) => r.sourceRecordId)).toEqual(["a", "b", "c"]);
    // Page 3 was fetched (to discover it is empty) but yielded nothing.
    expect(fetcher.calls.map((c) => c.url)).toContain(`${BASE}/Invoices?page=3`);
  });
});
