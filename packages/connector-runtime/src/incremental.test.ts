/**
 * Reading only what has changed: the three strategies, and what a watermark may not do.
 *
 * Every test here drives the real `readEntity` over a real `InMemoryFetcher`, which refuses
 * an unmodelled request -- so "the parameter was sent" is proved by the read succeeding
 * against a route recorded WITH it, not by inspecting a call that might have gone anywhere.
 * The requests are asserted over as well, because a route that silently matched a second
 * recorded response would otherwise pass.
 *
 * The one that matters most is `a page that goes newer, older, newer reads all the way
 * through`. A client filter that STOPPED instead of skipping would pass every other test in
 * this file and lose every record behind an out-of-order one, permanently -- the next run
 * asks only for what is after a watermark those records are already below.
 */

import { describe, expect, test as it } from "bun:test";
import { type ConnectorSpec, parseSpec } from "@undercroft/contracts";
import { ConnectorError, TestClock } from "@undercroft/core";
import type { RawRecordOut, RunContext } from "./run.ts";
import { readEntity } from "./run.ts";
import { InMemoryFetcher } from "./testing.ts";

const BASE = "https://api.test";

/** A single-entity spec whose `incremental` block the caller writes. */
function spec(
  incremental: string,
  guards: { failOnEmpty?: boolean; failOnExactCount?: number } = {},
): ConnectorSpec {
  return parseSpec(`
apiVersion: undercroft.dev/v1
kind: Connector
id: demo
displayName: Demo
baseUrl: ${BASE}
auth: { kind: none }
defaults:
  pagination: { kind: json-link, nextPath: paging.next.link }
entities:
  - name: things
    request: { kind: list, path: /things }
    envelopePath: results
    idPath: id
    guards:
      failOnEmpty: ${guards.failOnEmpty ?? true}
      ${guards.failOnExactCount === undefined ? "" : `failOnExactCount: ${guards.failOnExactCount}`}
${incremental}
`);
}

const CLIENT_FILTER = `    incremental:
      strategy: client-filter
      sourcePath: changedAt
      format: epoch-millis`;

const QUERY_PARAM = `    incremental:
      strategy: query-param
      param: updatedAfter
      sourcePath: changedAt
      format: epoch-millis`;

const HEADER = `    incremental:
      strategy: header
      header: If-Modified-Since
      sourcePath: changedAt
      format: iso8601`;

function ctx(fetcher: InMemoryFetcher, since?: string): RunContext {
  return { fetcher, clock: new TestClock(), ...(since === undefined ? {} : { since }) };
}

async function read(connector: ConnectorSpec, context: RunContext): Promise<RawRecordOut[]> {
  const out: RawRecordOut[] = [];
  for await (const record of readEntity(connector, connector.entities[0]!, context)) {
    out.push(record);
  }
  return out;
}

describe("client-filter skips a record; it never stops the read", () => {
  it("a record older than the watermark is not landed", async () => {
    const connector = spec(CLIENT_FILTER);
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: {
        results: [
          { id: "old", changedAt: "100" },
          { id: "new", changedAt: "300" },
        ],
        paging: {},
      },
    });

    const records = await read(connector, ctx(fetcher, "200"));

    expect(records.map((r) => r.sourceRecordId)).toEqual(["new"]);
  });

  it("a page that goes newer, older, newer reads all the way through", async () => {
    // The quiet side of the same guard, and the one a stop-on-first-older implementation
    // fails. Nothing in a REST API promises a page is ordered by the field being filtered
    // on -- Xero's `/Invoices?page=N` is not -- so a read that stopped at `stale` would
    // lose `later` and the whole second page with it, from the one layer that cannot be
    // recomputed.
    const connector = spec(CLIENT_FILTER);
    const fetcher = new InMemoryFetcher()
      .on("GET", `${BASE}/things`, {
        body: {
          results: [
            { id: "fresh", changedAt: "300" },
            { id: "stale", changedAt: "100" },
            { id: "later", changedAt: "400" },
          ],
          paging: { next: { link: `${BASE}/things?page=2` } },
        },
      })
      .on("GET", `${BASE}/things?page=2`, {
        body: { results: [{ id: "overleaf", changedAt: "500" }], paging: {} },
      });

    const records = await read(connector, ctx(fetcher, "200"));

    expect(records.map((r) => r.sourceRecordId)).toEqual(["fresh", "later", "overleaf"]);
    // And it really did ask for the second page rather than ending early.
    expect(fetcher.calls.map((call) => call.url)).toEqual([
      `${BASE}/things`,
      `${BASE}/things?page=2`,
    ]);
  });

  it("a record at exactly the watermark is landed again rather than dropped", async () => {
    // Strictly older, deliberately. A source that shares one timestamp across several
    // records would otherwise lose all but the one that set the mark; re-landing is an
    // `unchanged` row and costs nothing.
    const connector = spec(CLIENT_FILTER);
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "edge", changedAt: "200" }], paging: {} },
    });

    const records = await read(connector, ctx(fetcher, "200"));

    expect(records.map((r) => r.sourceRecordId)).toEqual(["edge"]);
  });

  it("a value the declared format cannot read is landed, not skipped", async () => {
    // The direction that cannot lose data. A spec naming the wrong `sourcePath`, or a source
    // that changed its rendering, degrades to the full read we do today.
    const connector = spec(CLIENT_FILTER);
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: {
        results: [{ id: "unreadable", changedAt: "last Tuesday" }, { id: "absent" }],
        paging: {},
      },
    });

    const records = await read(connector, ctx(fetcher, "200"));

    expect(records.map((r) => r.sourceRecordId)).toEqual(["unreadable", "absent"]);
  });

  it("with no watermark yet, nothing is filtered", async () => {
    const connector = spec(CLIENT_FILTER);
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: {
        results: [
          { id: "old", changedAt: "100" },
          { id: "new", changedAt: "300" },
        ],
        paging: {},
      },
    });

    const records = await read(connector, ctx(fetcher));

    expect(records.map((r) => r.sourceRecordId)).toEqual(["old", "new"]);
  });
});

describe("the watermark reaches the source", () => {
  it("query-param puts it on the request", async () => {
    const connector = spec(QUERY_PARAM);
    // Recorded ONLY at the URL carrying the parameter: the fetcher refuses an unmodelled
    // request, so a read that forgot it fails rather than quietly returning everything.
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things?updatedAfter=200`, {
      body: { results: [{ id: "new", changedAt: "300" }], paging: {} },
    });

    const records = await read(connector, ctx(fetcher, "200"));

    expect(records.map((r) => r.sourceRecordId)).toEqual(["new"]);
    expect(fetcher.calls[0]?.url).toBe(`${BASE}/things?updatedAfter=200`);
  });

  it("query-param sends nothing at all on a first read", async () => {
    const connector = spec(QUERY_PARAM);
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "new", changedAt: "300" }], paging: {} },
    });

    await read(connector, ctx(fetcher));

    // Not `updatedAfter=` and not an epoch: a parameter we never meant is one the provider
    // is free to read differently from how we meant it.
    expect(fetcher.calls[0]?.url).toBe(`${BASE}/things`);
  });

  it("header puts it on every request of the read", async () => {
    const connector = spec(HEADER);
    const fetcher = new InMemoryFetcher()
      .on("GET", `${BASE}/things`, {
        body: {
          results: [{ id: "new", changedAt: "2026-09-20T00:00:00Z" }],
          paging: { next: { link: `${BASE}/things?page=2` } },
        },
      })
      .on("GET", `${BASE}/things?page=2`, { body: { results: [], paging: {} } });

    await read(connector, ctx(fetcher, "2026-09-01T00:00:00Z"));

    expect(fetcher.calls.map((call) => call.headers?.["If-Modified-Since"])).toEqual([
      "2026-09-01T00:00:00Z",
      "2026-09-01T00:00:00Z",
    ]);
  });

  it("header sends none on a first read", async () => {
    const connector = spec(HEADER);
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "new", changedAt: "2026-09-20T00:00:00Z" }], paging: {} },
    });

    await read(connector, ctx(fetcher));

    expect(fetcher.calls[0]?.headers?.["If-Modified-Since"]).toBeUndefined();
  });
});

describe("a strategy with nowhere to put its watermark is a spec defect", () => {
  it("query-param naming no param is refused", async () => {
    const connector = spec(`    incremental:
      strategy: query-param
      sourcePath: changedAt`);
    const fetcher = new InMemoryFetcher();

    await expect(read(connector, ctx(fetcher))).rejects.toThrow(/needs a param/u);
  });

  it("client-filter needs neither, and is not refused", async () => {
    const connector = spec(CLIENT_FILTER);
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "one", changedAt: "300" }], paging: {} },
    });

    const records = await read(connector, ctx(fetcher));

    expect(records.map((r) => r.sourceRecordId)).toEqual(["one"]);
  });
});

describe("failOnEmpty is relaxed by a watermark, and by nothing else", () => {
  function emptySource(): InMemoryFetcher {
    return new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [], paging: {} },
    });
  }

  it("fires on an empty FULL read, even where incremental is declared", async () => {
    // The case the guard exists for. A first run has no cursor, and "failed after 0" is what
    // a credential or permission problem looks like -- keying the relaxation on the spec
    // rather than on the cursor would throw that away for every entity that grows an
    // `incremental` block.
    const connector = spec(CLIENT_FILTER);

    await expect(read(connector, ctx(emptySource()))).rejects.toThrow(/no records/u);
  });

  it("stays quiet on an empty INCREMENTAL read", async () => {
    const connector = spec(QUERY_PARAM);
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things?updatedAfter=200`, {
      body: { results: [], paging: {} },
    });

    expect(await read(connector, ctx(fetcher, "200"))).toEqual([]);
  });

  it("failOnExactCount still fires on an incremental read", async () => {
    // The relaxation must not widen into the other guard. Truncation is truncation, whatever
    // was asked for: a page that stops exactly on a cap is silent data loss either way.
    const connector = spec(QUERY_PARAM, { failOnExactCount: 2 });
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things?updatedAfter=200`, {
      body: {
        results: [
          { id: "a", changedAt: "300" },
          { id: "b", changedAt: "400" },
        ],
        paging: {},
      },
    });

    await expect(read(connector, ctx(fetcher, "200"))).rejects.toBeInstanceOf(ConnectorError);
  });

  it("a client filter cannot talk a truncated read out of being reported", async () => {
    // `seen` counts what the SOURCE handed over, including what the filter then dropped.
    // Counting only what was landed would make a filtered page look short of the cap.
    const connector = spec(CLIENT_FILTER, { failOnExactCount: 2 });
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: {
        results: [
          { id: "stale", changedAt: "100" },
          { id: "fresh", changedAt: "400" },
        ],
        paging: {},
      },
    });

    await expect(read(connector, ctx(fetcher, "200"))).rejects.toThrow(/truncation ceiling/u);
  });
});

describe("incrementalAt is reported beside the record", () => {
  it("carries the value at sourcePath, verbatim", async () => {
    const connector = spec(CLIENT_FILTER);
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "one", changedAt: "1758326400000" }], paging: {} },
    });

    const [record] = await read(connector, ctx(fetcher));

    expect(record?.incrementalAt).toBe("1758326400000");
  });

  it("is null where the entity declares no incremental read", async () => {
    const connector = spec("");
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "one", changedAt: "1758326400000" }], paging: {} },
    });

    const [record] = await read(connector, ctx(fetcher));

    expect(record?.incrementalAt).toBeNull();
  });
});
