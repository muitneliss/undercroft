/**
 * A list read in partitions is one entity: every partition's records, and one listing over all of
 * them (ADR 0075).
 *
 * HubSpot lists archived products only when asked `archived=true`, and a line item still names the
 * product it was sold as. The ways this goes quietly wrong are a listing that only covers the
 * first partition -- every archived product then marked removed on every run -- and a two-step
 * read whose batch read forgets the partition, which HubSpot answers "not found" and the batch
 * read accepts as a deletion.
 */

import { describe, expect, test as it } from "bun:test";
import { type ConnectorSpec, parseSpec } from "@undercroft/contracts";
import { TestClock } from "@undercroft/core";

import { type RawRecordOut, type ReadEnd, readEntity } from "./run.ts";
import { InMemoryFetcher } from "./testing.ts";

const BASE = "https://api.partitions.test";

function spec(batchRead: boolean): ConnectorSpec {
  return parseSpec(`
apiVersion: undercroft.dev/v1
kind: Connector
id: parts
displayName: Partitions
baseUrl: ${BASE}
auth: { kind: none }
entities:
  - name: products
    request:
      kind: list
      path: /products
      partitions:
        - { archived: "false" }
        - { archived: "true" }
${
  batchRead
    ? `      batchRead:
        path: /products/batch/read
        bodyTemplate: hubspot-batch-read
        properties: [name, x_margin]`
    : ""
}
    envelopePath: results
    idPath: id
    pagination: { kind: none }
    removedWhen: absent
`);
}

async function read(
  connector: ConnectorSpec,
  fetcher: InMemoryFetcher,
): Promise<{ records: RawRecordOut[]; end: ReadEnd }> {
  const reading = readEntity(connector, connector.entities[0]!, {
    fetcher,
    clock: new TestClock(),
  });
  const records: RawRecordOut[] = [];
  for (;;) {
    const next = await reading.next();
    if (next.done === true) {
      return { records, end: next.value };
    }
    records.push(next.value);
  }
}

describe("a list read in partitions", () => {
  it("lands every partition under one entity, and lists them all", async () => {
    const fetcher = new InMemoryFetcher()
      .on("GET", `${BASE}/products?archived=false`, { body: { results: [{ id: "p1" }] } })
      .on("GET", `${BASE}/products?archived=true`, {
        body: { results: [{ id: "p2", archived: true }] },
      });

    const { records, end } = await read(spec(false), fetcher);

    expect(records.map((r) => [r.entity, r.sourceRecordId])).toEqual([
      ["products", "p1"],
      ["products", "p2"],
    ]);
    // Listing only the live partition would mark p2 removed on every run.
    expect([...(end.listed ?? [])]).toEqual(["p1", "p2"]);
  });

  it("asks the batch read for a page in the partition the page came from", async () => {
    const fetcher = new InMemoryFetcher()
      .on("GET", `${BASE}/products?archived=false`, { body: { results: [{ id: "p1" }] } })
      .on("GET", `${BASE}/products?archived=true`, { body: { results: [{ id: "p2" }] } })
      .on("POST", `${BASE}/products/batch/read?archived=false`, {
        body: { results: [{ id: "p1", properties: { x_margin: "0.2" } }] },
      })
      .on("POST", `${BASE}/products/batch/read?archived=true`, {
        body: { results: [{ id: "p2", archived: true, properties: { x_margin: "0.1" } }] },
      });

    const { records } = await read(spec(true), fetcher);

    expect(records.map((r) => r.sourceRecordId)).toEqual(["p1", "p2"]);
    expect(records[1]?.payloadText).toContain("x_margin");
  });
});
