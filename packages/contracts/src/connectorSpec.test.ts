import { describe, expect, test as it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpec, SpecError } from "./loadSpec.ts";
import { lakeKeyOf, RawRecord, streamOf } from "./rawRecord.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

function hubspotYaml(): string {
  return readFileSync(join(repoRoot, "specs", "connectors", "hubspot.yaml"), "utf8");
}

describe("the shipped HubSpot spec is valid", () => {
  it("parses and fills defaults", () => {
    const spec = parseSpec(hubspotYaml());
    expect(spec.id).toBe("hubspot");
    expect(spec.entities.map((e) => e.name)).toContain("deals");
    // A default the author did not write is present, proving defaults resolve.
    expect(spec.defaults.retry.attempts).toBe(5);
  });

  it("contacts use their own last-modified field, not the default one", () => {
    // The exact HubSpot footgun the per-entity incremental path exists for.
    const spec = parseSpec(hubspotYaml());
    const contacts = spec.entities.find((e) => e.name === "contacts");
    const deals = spec.entities.find((e) => e.name === "deals");
    expect(contacts?.incremental?.sourcePath).toBe("properties.lastmodifieddate");
    expect(deals?.incremental?.sourcePath).toBe("properties.hs_lastmodifieddate");
  });
});

describe("an invalid spec fails with a path-qualified message", () => {
  it("names the missing field and its path", () => {
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
      if (!(error instanceof SpecError)) {
        throw error;
      }
      expect(error.issues.some((i) => i.includes("entities.0.idPath"))).toBe(true);
    }
  });

  it("rejects a batch-from that references an unknown entity", () => {
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
      if (!(error instanceof SpecError)) {
        throw error;
      }
      expect(error.issues.some((i) => i.includes("unknown entity 'nonexistent'"))).toBe(true);
    }
  });

  it("holds each entity of a scoped oauth2 consent to a scope that consent asks for", () => {
    // An entity with no readScope would be read on any grant and meet the provider's 401
    // part-way through a run; one naming a scope never asked for could never be read.
    function scoped(readScope: string | null): string {
      return `
apiVersion: undercroft.dev/v1
kind: Connector
id: scoped
displayName: Scoped
baseUrl: https://example.test
auth: { kind: oauth2, tokenUrl: https://example.test/token, scopes: [offline_access, things.read] }
entities:
  - name: things
    idPath: id
    request: { kind: list, path: /things }
${readScope === null ? "" : `    readScope: ${readScope}`}
`;
    }
    function issues(yaml: string): readonly string[] {
      try {
        parseSpec(yaml);
        return [];
      } catch (error) {
        if (!(error instanceof SpecError)) {
          throw error;
        }
        return error.issues;
      }
    }

    expect(issues(scoped("things.read"))).toEqual([]);
    expect(issues(scoped(null)).some((i) => i.includes("entities.things.readScope"))).toBe(true);
    expect(issues(scoped("other.read")).some((i) => i.includes("'other.read'"))).toBe(true);
  });

  it("rejects malformed YAML before it reaches schema validation", () => {
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

  it("accepts a well-formed record", () => {
    expect(RawRecord.parse(valid).sourceRecordId).toBe("42");
  });

  it("rejects an empty source id, because it cannot be traced or upserted", () => {
    expect(() => RawRecord.parse({ ...valid, sourceRecordId: "" })).toThrow();
  });

  it("derives the stream and lake key from identity", () => {
    expect(streamOf(valid)).toBe("records/hubspot/CASE-1/deals");
    expect(lakeKeyOf(valid)).toBe("records/hubspot/CASE-1/deals/42");
  });
});
