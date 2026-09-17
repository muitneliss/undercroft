import { TestClock } from "@undercroft/core";
import { type ConnectorSpec, parseSpec } from "@undercroft/contracts";
import { describe, expect, test } from "bun:test";
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
  for await (const r of gen) out.push(r);
  return out;
}

describe("page-number pagination stops on an empty page", () => {
  test("reads successive pages until one comes back empty", async () => {
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
