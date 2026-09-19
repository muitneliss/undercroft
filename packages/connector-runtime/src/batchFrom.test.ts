// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: The 50 sites whose type the compiler could print are annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type is supplied contextually and writing it out means naming a library-internal type that will drift on the next upgrade.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and not done here: hoisting these 45 literals is a real change to 22 files and belongs in its own commit where the diff is reviewable, not buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/style/noNonNullAssertion: Almost all of these are tests asserting on a fixture they created three lines earlier, which the ESLint config this replaced also exempted for the same reason. Biome's unsafe autofix for the rule deletes the `!` and leaves `string | undefined` flowing into a `string`, so it does not compile.

import { describe, expect, test as it } from "bun:test";
import { type ConnectorSpec, parseSpec } from "@undercroft/contracts";
import { TestClock } from "@undercroft/core";
import type { RawRecordOut } from "./run.ts";
import { readEntity } from "./run.ts";
import { InMemoryFetcher } from "./testing.ts";

const BASE = "https://api.batch.test";

/** A spec with a list entity and a batch-from relation reading against it. */
function relationSpec(chunkSize = 2): ConnectorSpec {
  return parseSpec(`
apiVersion: undercroft.dev/v1
kind: Connector
id: rel
displayName: Relation
baseUrl: ${BASE}
auth: { kind: none }
entities:
  - name: deals
    request: { kind: list, path: /deals }
    envelopePath: results
    idPath: id
    pagination: { kind: none }
  - name: associations
    request:
      kind: batch-from
      entity: deals
      idPath: id
      chunkSize: ${chunkSize}
      path: /associations/batch/read
      bodyTemplate: hubspot-batch-inputs
    envelopePath: results
    idPath: from.id
    pagination: { kind: none }
    guards: { failOnEmpty: false }
`);
}

async function collect(gen: AsyncGenerator<RawRecordOut>): Promise<RawRecordOut[]> {
  const out: RawRecordOut[] = [];
  for await (const r of gen) {
    out.push(r);
  }
  return out;
}

function relation(spec: ConnectorSpec) {
  return spec.entities[1]!;
}

describe("batch-from reads a relation against ids from another entity", () => {
  it("chunks the ids and POSTs each chunk", async () => {
    const spec = relationSpec(2);
    const fetcher = new InMemoryFetcher()
      .on("POST", `${BASE}/associations/batch/read`, {
        body: { results: [{ from: { id: "d1" } }, { from: { id: "d2" } }] },
      })
      .on("POST", `${BASE}/associations/batch/read`, {
        body: { results: [{ from: { id: "d3" } }] },
      });

    const records = await collect(
      readEntity(spec, relation(spec), {
        fetcher,
        clock: new TestClock(),
        sourceIds: ["d1", "d2", "d3"],
      }),
    );

    expect(records.map((r) => r.sourceRecordId)).toEqual(["d1", "d2", "d3"]);
    // Three ids at chunkSize 2 is two requests, not three.
    expect(fetcher.calls.length).toBe(2);
  });

  it("sends the ids as a hubspot-shaped inputs body", async () => {
    const spec = relationSpec(10);
    const fetcher = new InMemoryFetcher().on("POST", `${BASE}/associations/batch/read`, {
      body: { results: [{ from: { id: "d1" } }] },
    });

    await collect(
      readEntity(spec, relation(spec), {
        fetcher,
        clock: new TestClock(),
        sourceIds: ["d1"],
      }),
    );

    expect(JSON.parse(fetcher.calls[0]!.body!)).toEqual({ inputs: [{ id: "d1" }] });
  });

  it("no ids means no requests, and no invented records", async () => {
    // A portal with no deals has no associations. That is a real state, not a failure --
    // the relation's failOnEmpty is off for exactly this reason.
    const spec = relationSpec();
    const fetcher = new InMemoryFetcher();
    const records = await collect(
      readEntity(spec, relation(spec), { fetcher, clock: new TestClock(), sourceIds: [] }),
    );
    expect(records).toEqual([]);
    expect(fetcher.calls.length).toBe(0);
  });

  it("a relation record with no id at its idPath is still fatal", async () => {
    const spec = relationSpec(10);
    const fetcher = new InMemoryFetcher().on("POST", `${BASE}/associations/batch/read`, {
      body: { results: [{ notFrom: { id: "d1" } }] },
    });
    await expect(
      collect(
        readEntity(spec, relation(spec), {
          fetcher,
          clock: new TestClock(),
          sourceIds: ["d1"],
        }),
      ),
    ).rejects.toThrow(/idPath/u);
  });
});
