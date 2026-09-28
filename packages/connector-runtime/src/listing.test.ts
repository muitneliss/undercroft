/**
 * Which finished reads hand back a listing -- the set a caller marks every other held record
 * removed against (`listing.ts`, ADR 0071).
 *
 * Each `null` here is a read that must NOT decide anything, and each is paired with the read
 * that must: a client filter pages the whole source whatever its watermark, so it names every
 * record including the ones it skips, while a watermark SENT to the source leaves out whatever
 * has not changed. The empty listing is the case with the largest blast radius -- a provider
 * fault answering "nothing" would otherwise mark the whole lake removed.
 */

import { describe, expect, test as it } from "bun:test";
import { parseSpec } from "@undercroft/contracts";
import { TestClock } from "@undercroft/core";

import { type RawRecordOut, type ReadEnd, readEntity } from "./run.ts";
import { InMemoryFetcher } from "./testing.ts";

const BASE = "https://api.test";

function spec(strategy: "client-filter" | "query-param"): ReturnType<typeof parseSpec> {
  return parseSpec(`
apiVersion: undercroft.dev/v1
kind: Connector
id: demo
displayName: Demo
baseUrl: ${BASE}
auth: { kind: none }
entities:
  - name: things
    request: { kind: list, path: /things }
    envelopePath: results
    idPath: id
    pagination: { kind: none }
    incremental: { strategy: ${strategy}, param: since, sourcePath: changedAt, format: epoch-millis }
    removedWhen: absent
`);
}

/** Drain a read, answering with what it said once it was over. */
async function endOf(reading: AsyncGenerator<RawRecordOut, ReadEnd>): Promise<ReadEnd> {
  for (;;) {
    const next = await reading.next();
    if (next.done === true) {
      return next.value;
    }
  }
}

function read(
  strategy: "client-filter" | "query-param",
  url: string,
  results: unknown[],
): Promise<ReadEnd> {
  const connector = spec(strategy);
  const fetcher = new InMemoryFetcher().on("GET", url, { body: { results } });
  return endOf(
    readEntity(connector, connector.entities[0]!, {
      fetcher,
      clock: new TestClock(),
      since: "500",
    }),
  );
}

describe("a finished read hands back a listing only when it listed everything", () => {
  it("a client filter names every record it listed, the ones it skipped included", async () => {
    const end = await read("client-filter", `${BASE}/things`, [
      { id: "old", changedAt: "100" },
      { id: "new", changedAt: "900" },
    ]);

    expect([...(end.listed ?? [])].sort()).toEqual(["new", "old"]);
  });

  it("a watermark sent to the source answers null: what it left out may just be unchanged", async () => {
    const end = await read("query-param", `${BASE}/things?since=500`, [
      { id: "new", changedAt: "900" },
    ]);

    expect(end.listed).toBeNull();
  });

  it("an empty listing answers null rather than marking everything removed", async () => {
    const end = await read("client-filter", `${BASE}/things`, []);

    expect(end.listed).toBeNull();
  });
});
