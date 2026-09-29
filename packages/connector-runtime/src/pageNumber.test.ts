import { describe, expect, test as it } from "bun:test";
import { type ConnectorSpec, parseSpec } from "@undercroft/contracts";
import { TestClock } from "@undercroft/core";
import type { RawRecordOut, ReadEnd, RequestBudget } from "./run.ts";
import { readEntity } from "./run.ts";
import { InMemoryFetcher } from "./testing.ts";

const BASE = "https://api.xero.test";

/** A page-number spec shaped like Xero's: envelope key, stop on an empty page. */
function xeroLikeSpec(over: { startAt?: number; incremental?: string } = {}): ConnectorSpec {
  return parseSpec(`
apiVersion: undercroft.dev/v1
kind: Connector
id: xerolike
displayName: Xero-like
baseUrl: ${BASE}
auth: { kind: bearer, token: { from: connection } }
defaults:
  pagination: { kind: page-number, param: page, startAt: ${over.startAt ?? 1}, stopOn: empty-page }
entities:
  - name: invoices
    request: { kind: list, path: /Invoices, query: { pageSize: "100" } }
    envelopePath: Invoices
    idPath: InvoiceID
${over.incremental ?? ""}
`);
}

async function collect(gen: AsyncGenerator<RawRecordOut>): Promise<RawRecordOut[]> {
  const out: RawRecordOut[] = [];
  for await (const r of gen) {
    out.push(r);
  }
  return out;
}

function read(
  spec: ConnectorSpec,
  fetcher: InMemoryFetcher,
  since?: string,
): Promise<RawRecordOut[]> {
  return collect(
    readEntity(spec, spec.entities[0]!, {
      fetcher,
      clock: new TestClock(),
      token: () => Promise.resolve("t"),
      ...(since === undefined ? {} : { since }),
    }),
  );
}

describe("page-number pagination stops on an empty page", () => {
  it("reads successive pages until one comes back empty", async () => {
    const fetcher = new InMemoryFetcher()
      .on("GET", `${BASE}/Invoices?pageSize=100&page=1`, {
        body: { Invoices: [{ InvoiceID: "a" }, { InvoiceID: "b" }] },
      })
      .on("GET", `${BASE}/Invoices?pageSize=100&page=2`, {
        body: { Invoices: [{ InvoiceID: "c" }] },
      })
      .on("GET", `${BASE}/Invoices?pageSize=100&page=3`, { body: { Invoices: [] } });

    const records = await read(xeroLikeSpec(), fetcher);

    expect(records.map((r) => r.sourceRecordId)).toEqual(["a", "b", "c"]);
    // Page 3 was fetched (to discover it is empty) but yielded nothing.
    expect(fetcher.calls.map((c) => c.url)).toContain(`${BASE}/Invoices?pageSize=100&page=3`);
  });
});

describe("the first page names its page", () => {
  // Leaving `page` off is not "page one" to every source. Xero answers a list with no `page`
  // with EVERY record, in a summary that drops invoices' and credit notes' line items -- so the
  // first hundred records only ever landed in summary, and everything after was read twice
  // (#268). The fetcher refuses an unmodelled request, so a first page without `page=` fails.
  it("carries startAt, and the next page follows on from it", async () => {
    const fetcher = new InMemoryFetcher()
      .on("GET", `${BASE}/Invoices?pageSize=100&page=1`, {
        body: { Invoices: [{ InvoiceID: "a" }] },
      })
      .on("GET", `${BASE}/Invoices?pageSize=100&page=2`, { body: { Invoices: [] } });

    await read(xeroLikeSpec(), fetcher);

    expect(fetcher.calls.map((c) => c.url)).toEqual([
      `${BASE}/Invoices?pageSize=100&page=1`,
      `${BASE}/Invoices?pageSize=100&page=2`,
    ]);
  });

  it("carries a startAt of zero as page zero", async () => {
    const fetcher = new InMemoryFetcher()
      .on("GET", `${BASE}/Invoices?pageSize=100&page=0`, {
        body: { Invoices: [{ InvoiceID: "a" }] },
      })
      .on("GET", `${BASE}/Invoices?pageSize=100&page=1`, { body: { Invoices: [] } });

    await read(xeroLikeSpec({ startAt: 0 }), fetcher);

    expect(fetcher.calls.map((c) => c.url)).toEqual([
      `${BASE}/Invoices?pageSize=100&page=0`,
      `${BASE}/Invoices?pageSize=100&page=1`,
    ]);
  });

  it("carries it on an incremental read too, where a summary would overwrite a full record", async () => {
    // The read `If-Modified-Since` narrows is exactly the one that lands a CHANGED record over
    // the full one already held; without `page` it landed Xero's summary in its place.
    const spec = xeroLikeSpec({
      incremental: `    incremental:
      strategy: header
      header: If-Modified-Since
      sourcePath: UpdatedDateUTC
      format: ms-json-date
      send: rfc3339-seconds`,
    });
    const fetcher = new InMemoryFetcher()
      .on("GET", `${BASE}/Invoices?pageSize=100&page=1`, {
        body: { Invoices: [{ InvoiceID: "a", UpdatedDateUTC: "/Date(1573755099000+0000)/" }] },
      })
      .on("GET", `${BASE}/Invoices?pageSize=100&page=2`, { body: { Invoices: [] } });

    await read(spec, fetcher, "/Date(1573755038314+0000)/");

    expect(fetcher.calls[0]?.url).toBe(`${BASE}/Invoices?pageSize=100&page=1`);
    expect(fetcher.calls[0]?.headers?.["If-Modified-Since"]).toBe("2019-11-14T18:10:38Z");
  });
});

describe("a request budget ends a read part-way, as a truncated read", () => {
  // ADR 0082: a whole read may spend only its share of the provider's day. The caller decides
  // how much; the runtime asks before each page and reports what each answer said.
  function budgetOf(pages: number, seen: string[]): RequestBudget {
    let left = pages;
    return {
      admit: (): boolean => {
        left -= 1;
        return left >= 0;
      },
      spent: (headers): void => {
        seen.push(headers["x-daylimit-remaining"] ?? "");
      },
    };
  }

  async function drain(
    spec: ConnectorSpec,
    fetcher: InMemoryFetcher,
    budget: RequestBudget,
  ): Promise<{ ids: string[]; end: ReadEnd }> {
    const gen = readEntity(spec, spec.entities[0]!, {
      fetcher,
      clock: new TestClock(),
      token: () => Promise.resolve("t"),
      budget,
    });
    const ids: string[] = [];
    for (;;) {
      const next = await gen.next();
      if (next.done === true) {
        return { ids, end: next.value };
      }
      ids.push(next.value.sourceRecordId);
    }
  }

  it("keeps what the admitted pages held, asks for no page past them, and says why it stopped", async () => {
    const fetcher = new InMemoryFetcher()
      .on("GET", `${BASE}/Invoices?pageSize=100&page=1`, {
        body: { Invoices: [{ InvoiceID: "a" }] },
        headers: { "x-daylimit-remaining": "4001" },
      })
      .on("GET", `${BASE}/Invoices?pageSize=100&page=2`, {
        body: { Invoices: [{ InvoiceID: "b" }] },
        headers: { "x-daylimit-remaining": "4000" },
      });
    const remaining: string[] = [];

    const { ids, end } = await drain(xeroLikeSpec(), fetcher, budgetOf(2, remaining));

    expect(ids).toEqual(["a", "b"]);
    expect(fetcher.calls).toHaveLength(2);
    expect(remaining).toEqual(["4001", "4000"]);
    expect(end).toMatchObject({ exhausted: true, requests: 2, listed: null });
  });

  it("is not an empty source when the budget refused the first page", async () => {
    // `failOnEmpty` would read a whole read that asked for nothing as a credential problem.
    const { ids, end } = await drain(xeroLikeSpec(), new InMemoryFetcher(), budgetOf(0, []));

    expect(ids).toEqual([]);
    expect(end).toMatchObject({ exhausted: true, requests: 0 });
  });
});
