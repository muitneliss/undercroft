import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpec, SpecError } from "./loadSpec.ts";
import { lakeKeyOf, RawRecord, streamOf } from "./rawRecord.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

function hubspotYaml() {
  return readFileSync(join(repoRoot, "specs", "connectors", "hubspot.yaml"), "utf8");
}

describe("the shipped HubSpot spec is valid", () => {
  test("parses and fills defaults", () => {
    const spec = parseSpec(hubspotYaml());
    expect(spec.id).toBe("hubspot");
    expect(spec.entities.map((e) => e.name)).toContain("deals");
    // A default the author did not write is present, proving defaults resolve.
    expect(spec.defaults.retry.attempts).toBe(5);
  });

  test("contacts use their own last-modified field, not the default one", () => {
    // The exact HubSpot footgun the per-entity incremental path exists for.
    const spec = parseSpec(hubspotYaml());
    const contacts = spec.entities.find((e) => e.name === "contacts");
    const deals = spec.entities.find((e) => e.name === "deals");
    expect(contacts?.incremental?.sourcePath).toBe("properties.lastmodifieddate");
    expect(deals?.incremental?.sourcePath).toBe("properties.hs_lastmodifieddate");
  });
});

describe("an invalid spec fails with a path-qualified message", () => {
  test("names the missing field and its path", () => {
    const broken = `
apiVersion: undercroft.dev/v1
kind: Connector
id: broken
displayName: Broken
baseUrl: https://example.test
auth: { kind: none }
entities:
  - name: things
    request: { kind: list, path: /things }
`; // idPath is missing
    try {
      parseSpec(broken);
      throw new Error("expected parseSpec to throw");
    } catch (error) {
      if (!(error instanceof SpecError)) throw error;
      expect(error.issues.some((i) => i.includes("entities.0.idPath"))).toBe(true);
    }
  });

  test("rejects a batch-from that references an unknown entity", () => {
    const broken = `
apiVersion: undercroft.dev/v1
kind: Connector
id: broken
displayName: Broken
baseUrl: https://example.test
auth: { kind: none }
entities:
  - name: things
    idPath: id
    request:
      kind: batch-from
      entity: nonexistent
      idPath: id
      path: /batch
      bodyTemplate: hubspot-batch-inputs
`;
    try {
      parseSpec(broken);
      throw new Error("expected parseSpec to throw");
    } catch (error) {
      if (!(error instanceof SpecError)) throw error;
      expect(error.issues.some((i) => i.includes("unknown entity 'nonexistent'"))).toBe(true);
    }
  });

  test("rejects malformed YAML before it reaches schema validation", () => {
    expect(() => parseSpec("key: [unclosed")).toThrow(SpecError);
  });
});

describe("RawRecord refuses an untraceable record", () => {
  const valid = {
    source: "hubspot",
    tenantId: "CASE-1",
    entity: "deals",
    sourceRecordId: "42",
    payloadText: '{"id":"42"}',
    sourceUpdatedAt: null,
  };

  test("accepts a well-formed record", () => {
    expect(RawRecord.parse(valid).sourceRecordId).toBe("42");
  });

  test("rejects an empty source id, because it cannot be traced or upserted", () => {
    expect(() => RawRecord.parse({ ...valid, sourceRecordId: "" })).toThrow();
  });

  test("derives the stream and lake key from identity", () => {
    expect(streamOf(valid)).toBe("records/hubspot/CASE-1/deals");
    expect(lakeKeyOf(valid)).toBe("records/hubspot/CASE-1/deals/42");
  });
});
