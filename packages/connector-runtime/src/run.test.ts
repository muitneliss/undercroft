// biome-ignore-all lint/correctness/useQwikValidLexicalScope: Qwik-domain rule about what may cross a `$()` serialization boundary. There is no Qwik in this repo.
// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { describe, expect, test } from "bun:test";
import { type ConnectorSpec, parseSpec } from "@undercroft/contracts";
import { ConnectorError, parseLossless, TestClock } from "@undercroft/core";
import type { RawRecordOut } from "./run.ts";
import { readEntity } from "./run.ts";
import { InMemoryFetcher } from "./testing.ts";

const BASE = "https://api.test";

/** A minimal single-entity spec with json-link pagination and bearer auth. */
function spec(over: { failOnEmpty?: boolean; failOnExactCount?: number } = {}): ConnectorSpec {
  return parseSpec(`
apiVersion: undercroft.dev/v1
kind: Connector
id: demo
displayName: Demo
baseUrl: ${BASE}
auth: { kind: bearer, token: { from: connection } }
defaults:
  pagination: { kind: json-link, nextPath: paging.next.link }
entities:
  - name: things
    request: { kind: list, path: /things }
    envelopePath: results
    idPath: id
    updatedAtPath: updatedAt
    guards:
      failOnEmpty: ${over.failOnEmpty ?? true}
      ${over.failOnExactCount === undefined ? "" : `failOnExactCount: ${over.failOnExactCount}`}
`);
}

async function collect(gen: AsyncGenerator<RawRecordOut>): Promise<RawRecordOut[]> {
  const out: RawRecordOut[] = [];
  for await (const r of gen) {
    out.push(r);
  }
  return out;
}

const ctx = (fetcher: InMemoryFetcher) => ({
  fetcher,
  clock: new TestClock(),
  token: () => Promise.resolve("t"),
});

describe("pagination and extraction", () => {
  test("follows json next-links across pages", async () => {
    const fetcher = new InMemoryFetcher()
      .on("GET", `${BASE}/things`, {
        body: {
          results: [{ id: "1" }, { id: "2" }],
          paging: { next: { link: `${BASE}/things?page=2` } },
        },
      })
      .on("GET", `${BASE}/things?page=2`, {
        body: { results: [{ id: "3" }], paging: {} },
      });

    const records = await collect(readEntity(spec(), spec().entities[0]!, ctx(fetcher)));
    expect(records.map((r) => r.sourceRecordId)).toEqual(["1", "2", "3"]);
  });

  test("a next-link equal to the current URL stops rather than looping forever", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "1" }], paging: { next: { link: `${BASE}/things` } } },
    });
    const records = await collect(readEntity(spec(), spec().entities[0]!, ctx(fetcher)));
    expect(records.map((r) => r.sourceRecordId)).toEqual(["1"]);
  });

  test("preserves large numbers in the payload without turning them into floats", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      // A raw JSON string so the big number is never a JS number in the test either.
      body: '{"results":[{"id":"1","amount":8500.0001,"big":1234567890123456789012345}],"paging":{}}',
    });
    const [record] = await collect(readEntity(spec(), spec().entities[0]!, ctx(fetcher)));
    const payload = parseLossless(record!.payloadText) as { amount: unknown; big: unknown };
    expect(String(payload.amount)).toBe("8500.0001");
    expect(String(payload.big)).toBe("1234567890123456789012345");
  });

  test("reads the updatedAt path when present", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "1", updatedAt: "2026-01-01T00:00:00Z" }], paging: {} },
    });
    const [record] = await collect(readEntity(spec(), spec().entities[0]!, ctx(fetcher)));
    expect(record!.sourceUpdatedAt).toBe("2026-01-01T00:00:00Z");
  });
});

describe("a record with no id is fatal, not skipped", () => {
  test("raises rather than landing a record under a guessed key", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "1" }, { notId: "2" }], paging: {} },
    });
    await expect(
      collect(readEntity(spec(), spec().entities[0]!, ctx(fetcher))),
    ).rejects.toBeInstanceOf(ConnectorError);
  });
});

describe("guards", () => {
  test("failOnEmpty raises when a source yields nothing", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [], paging: {} },
    });
    await expect(collect(readEntity(spec(), spec().entities[0]!, ctx(fetcher)))).rejects.toThrow(
      /no records/u,
    );
  });

  test("failOnEmpty=false lets an empty source pass", async () => {
    const s = spec({ failOnEmpty: false });
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [], paging: {} },
    });
    expect(await collect(readEntity(s, s.entities[0]!, ctx(fetcher)))).toEqual([]);
  });

  test("failOnExactCount raises on exactly the ceiling", async () => {
    const s = spec({ failOnExactCount: 2 });
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "1" }, { id: "2" }], paging: {} },
    });
    await expect(collect(readEntity(s, s.entities[0]!, ctx(fetcher)))).rejects.toThrow(
      /truncation/u,
    );
  });

  test("failOnExactCount does not fire one below the ceiling", async () => {
    const s = spec({ failOnExactCount: 2 });
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "1" }], paging: {} },
    });
    expect((await collect(readEntity(s, s.entities[0]!, ctx(fetcher)))).length).toBe(1);
  });
});

describe("an unmodelled request is an error", () => {
  test("the fetcher refuses a request nobody recorded", async () => {
    const fetcher = new InMemoryFetcher(); // nothing recorded
    await expect(collect(readEntity(spec(), spec().entities[0]!, ctx(fetcher)))).rejects.toThrow(
      /no recorded response/u,
    );
  });
});
