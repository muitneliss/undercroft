import { describe, expect, test as it } from "bun:test";
import { type ConnectorSpec, parseSpec } from "@undercroft/contracts";
import { TestClock } from "@undercroft/core";
import { readEntity } from "./run.ts";
import { InMemoryFetcher } from "./testing.ts";

const BASE = "https://api.test";

/** One list of link records shaped like HubSpot's v4 association answer, `to` declared a set. */
const spec: ConnectorSpec = parseSpec(`
apiVersion: undercroft.dev/v1
kind: Connector
id: demo
displayName: Demo
baseUrl: ${BASE}
auth: { kind: bearer, token: { from: connection } }
entities:
  - name: links
    request: { kind: list, path: /links }
    envelopePath: results
    idPath: from.id
    unorderedArrays: [to, "to[].associationTypes"]
`);

const PRIMARY = { category: "HUBSPOT_DEFINED", label: "Primary", typeId: 1 };
const UNLABELLED = { category: "HUBSPOT_DEFINED", label: null, typeId: 279 };

/** The payload text one read lands for the record the source answers as `record`. */
async function landed(record: unknown): Promise<string> {
  const fetcher = new InMemoryFetcher().on("GET", `${BASE}/links`, {
    body: { results: [record] },
  });
  const ctx = { fetcher, clock: new TestClock(), token: (): string => "t" };
  const texts: string[] = [];
  for await (const out of readEntity(spec, spec.entities[0]!, ctx)) {
    texts.push(out.payloadText);
  }
  expect(texts).toHaveLength(1);
  return texts[0]!;
}

describe("an entity's unordered arrays", () => {
  it("lands one set the same bytes whatever order the source answered it in", async () => {
    const first = await landed({
      from: { id: "101" },
      to: [
        { toObjectId: 7, associationTypes: [PRIMARY, UNLABELLED] },
        { toObjectId: 8, associationTypes: [UNLABELLED] },
      ],
    });
    const shuffled = await landed({
      from: { id: "101" },
      to: [
        { toObjectId: 8, associationTypes: [UNLABELLED] },
        { toObjectId: 7, associationTypes: [UNLABELLED, PRIMARY] },
      ],
    });
    expect(shuffled).toBe(first);
  });

  it("keeps the order of an array the spec did not declare", async () => {
    const first = await landed({ from: { id: "101" }, to: [], notes: ["a", "b"] });
    const reversed = await landed({ from: { id: "101" }, to: [], notes: ["b", "a"] });
    expect(reversed).not.toBe(first);
    expect(reversed).toContain('"notes":["b","a"]');
  });
});
