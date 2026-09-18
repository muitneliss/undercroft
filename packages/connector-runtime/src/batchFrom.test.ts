import { describe, expect, test } from "bun:test";
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

const relation = (spec: ConnectorSpec) => spec.entities[1]!;

describe("batch-from reads a relation against ids from another entity", () => {
  test("chunks the ids and POSTs each chunk", async () => {
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

  test("sends the ids as a hubspot-shaped inputs body", async () => {
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

  test("no ids means no requests, and no invented records", async () => {
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

  test("a relation record with no id at its idPath is still fatal", async () => {
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
