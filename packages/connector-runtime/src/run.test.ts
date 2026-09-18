// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and not done here: hoisting these 45 literals is a real change to 22 files and belongs in its own commit where the diff is reviewable, not buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/security/noSecrets: False positives. The rule flags high-entropy string literals, and these are test fixtures with invented values (per .claude/rules/pii.md, fixtures are invented rather than anonymised), plus base64url sample tokens and SQL role names. No real credential is in any tracked file; CI enforces that separately.
// biome-ignore-all lint/style/noNonNullAssertion: Almost all of these are tests asserting on a fixture they created three lines earlier, which the ESLint config this replaced also exempted for the same reason. Biome's unsafe autofix for the rule deletes the `!` and leaves `string | undefined` flowing into a `string`, so it does not compile.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.

// biome-ignore-all lint/correctness/useQwikValidLexicalScope: Qwik-domain rule about what may cross a `$()` serialization boundary. There is no Qwik in this repo.
// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { describe, expect, test as it } from "bun:test";
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

function ctx(fetcher: InMemoryFetcher): {
  fetcher: InMemoryFetcher;
  clock: TestClock;
  token: () => Promise<string>;
} {
  return {
    fetcher,
    clock: new TestClock(),
    token: (): Promise<string> => Promise.resolve("t"),
  };
}

describe("pagination and extraction", () => {
  it("follows json next-links across pages", async () => {
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

  it("a next-link equal to the current URL stops rather than looping forever", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "1" }], paging: { next: { link: `${BASE}/things` } } },
    });
    const records = await collect(readEntity(spec(), spec().entities[0]!, ctx(fetcher)));
    expect(records.map((r) => r.sourceRecordId)).toEqual(["1"]);
  });

  it("preserves large numbers in the payload without turning them into floats", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      // A raw JSON string so the big number is never a JS number in the test either.
      body: '{"results":[{"id":"1","amount":8500.0001,"big":1234567890123456789012345}],"paging":{}}',
    });
    const [record] = await collect(readEntity(spec(), spec().entities[0]!, ctx(fetcher)));
    const payload = parseLossless(record!.payloadText) as { amount: unknown; big: unknown };
    expect(String(payload.amount)).toBe("8500.0001");
    expect(String(payload.big)).toBe("1234567890123456789012345");
  });

  it("reads the updatedAt path when present", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "1", updatedAt: "2026-01-01T00:00:00Z" }], paging: {} },
    });
    const [record] = await collect(readEntity(spec(), spec().entities[0]!, ctx(fetcher)));
    expect(record!.sourceUpdatedAt).toBe("2026-01-01T00:00:00Z");
  });
});

describe("a record with no id is fatal, not skipped", () => {
  it("raises rather than landing a record under a guessed key", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "1" }, { notId: "2" }], paging: {} },
    });
    await expect(
      collect(readEntity(spec(), spec().entities[0]!, ctx(fetcher))),
    ).rejects.toBeInstanceOf(ConnectorError);
  });
});

describe("guards", () => {
  it("failOnEmpty raises when a source yields nothing", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [], paging: {} },
    });
    await expect(collect(readEntity(spec(), spec().entities[0]!, ctx(fetcher)))).rejects.toThrow(
      /no records/u,
    );
  });

  it("failOnEmpty=false lets an empty source pass", async () => {
    const s = spec({ failOnEmpty: false });
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [], paging: {} },
    });
    expect(await collect(readEntity(s, s.entities[0]!, ctx(fetcher)))).toEqual([]);
  });

  it("failOnExactCount raises on exactly the ceiling", async () => {
    const s = spec({ failOnExactCount: 2 });
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "1" }, { id: "2" }], paging: {} },
    });
    await expect(collect(readEntity(s, s.entities[0]!, ctx(fetcher)))).rejects.toThrow(
      /truncation/u,
    );
  });

  it("failOnExactCount does not fire one below the ceiling", async () => {
    const s = spec({ failOnExactCount: 2 });
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "1" }], paging: {} },
    });
    expect((await collect(readEntity(s, s.entities[0]!, ctx(fetcher)))).length).toBe(1);
  });
});

describe("an unmodelled request is an error", () => {
  it("the fetcher refuses a request nobody recorded", async () => {
    const fetcher = new InMemoryFetcher(); // nothing recorded
    await expect(collect(readEntity(spec(), spec().entities[0]!, ctx(fetcher)))).rejects.toThrow(
      /no recorded response/u,
    );
  });
});
