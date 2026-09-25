/**
 * A two-step list read must account for every record its list named. ADR 0054.
 *
 * The batch read is where a two-step read could lose a record without a word: an answer one
 * record short looks exactly like a complete one. So the one shortfall the source explains -- a
 * record deleted between the list and the batch read, answered as "not found" -- is accepted,
 * and every other shortfall raises. Both sides are pinned: a guard with only its firing case can
 * be satisfied by code that always throws.
 */

import { describe, expect, test as it } from "bun:test";
import { type ConnectorSpec, parseSpec } from "@undercroft/contracts";
import { TestClock } from "@undercroft/core";
import { readEntity, type RawRecordOut } from "./run.ts";
import { InMemoryFetcher } from "./testing.ts";

const BASE = "https://api.twostep.test";
const BATCH = `${BASE}/objects/contacts/batch/read`;

const SPEC: ConnectorSpec = parseSpec(`
apiVersion: undercroft.dev/v1
kind: Connector
id: twostep
displayName: Two step
baseUrl: ${BASE}
auth: { kind: none }
entities:
  - name: contacts
    request:
      kind: list
      path: /objects/contacts
      batchRead:
        path: /objects/contacts/batch/read
        bodyTemplate: hubspot-batch-read
        properties: [email, x_segment]
    envelopePath: results
    idPath: id
    pagination: { kind: none }
`);

/** The list names three contacts; the batch read answers with `answer`. */
function source(answer: unknown): InMemoryFetcher {
  return new InMemoryFetcher()
    .on("GET", `${BASE}/objects/contacts`, {
      body: { results: [{ id: "1" }, { id: "2" }, { id: "3" }] },
    })
    .on("POST", BATCH, { status: 207, body: answer });
}

function contact(id: string): unknown {
  return { id, properties: { email: `c${id}@example.test`, x_segment: "b" } };
}

async function read(fetcher: InMemoryFetcher): Promise<RawRecordOut[]> {
  const out: RawRecordOut[] = [];
  const [entity] = SPEC.entities;
  if (entity === undefined) {
    throw new Error("the spec has no entity");
  }
  for await (const record of readEntity(SPEC, entity, { fetcher, clock: new TestClock() })) {
    out.push(record);
  }
  return out;
}

describe("a two-step list read", () => {
  it("lands the batch read's records, and not one HubSpot says was deleted in between", async () => {
    const fetcher = source({
      status: "COMPLETE",
      results: [contact("3"), contact("1")],
      errors: [{ status: "error", category: "OBJECT_NOT_FOUND", context: { ids: ["2"] } }],
    });

    const records = await read(fetcher);

    // In the order the list named them, each carrying what the batch read was asked for.
    expect(records.map((r) => r.sourceRecordId)).toEqual(["1", "3"]);
    expect(records[0]?.payloadText).toContain("x_segment");
    expect(JSON.parse(fetcher.calls[1]?.body ?? "{}")).toEqual({
      inputs: [{ id: "1" }, { id: "2" }, { id: "3" }],
      properties: ["email", "x_segment"],
    });
  });

  it("raises when an id is answered by neither a record nor a not-found", async () => {
    const fetcher = source({ status: "COMPLETE", results: [contact("1"), contact("3")] });

    // "after 3": the list was read in full, so this is not a credential problem.
    await expect(read(fetcher)).rejects.toThrow(/failed after 3.*"2"/u);
  });

  it("raises when it answers a record nobody asked for, rather than landing it under that id", async () => {
    // A contact merged between the two calls comes back under the id it was merged into.
    const fetcher = source({
      status: "COMPLETE",
      results: [contact("1"), contact("3"), contact("9")],
      errors: [{ status: "error", category: "OBJECT_NOT_FOUND", context: { ids: ["2"] } }],
    });

    await expect(read(fetcher)).rejects.toThrow(/not asked for.*"9"/u);
  });

  it("raises on any other error, rather than reading it as a deletion", async () => {
    const fetcher = source({
      status: "COMPLETE",
      results: [contact("1"), contact("3")],
      errors: [{ status: "error", category: "VALIDATION_ERROR", message: "bad property" }],
    });

    await expect(read(fetcher)).rejects.toThrow("VALIDATION_ERROR");
  });
});
