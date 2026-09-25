/**
 * What a stored selection means: chosen, chosen-nothing, or not chosen at all. The three are
 * different facts, and a collector that read one as another would read far more than anyone
 * agreed to.
 */

import { describe, expect, test as it } from "bun:test";

import { needsScope, parseScope } from "./connectionScope.ts";

describe("parseScope", () => {
  it("a Gmail selection with no file types recorded defaults to PDF only", () => {
    const scope = parseScope("gmail", JSON.stringify({ labels: [] }));
    expect(scope).toMatchObject({ fileTypes: ["application/pdf"] });
  });

  it("an explicit file-type allow-list is read back exactly", () => {
    const scope = parseScope(
      "drive",
      JSON.stringify({ files: [], fileTypes: ["application/vnd.ms-excel", "text/csv"] }),
    );
    expect(scope).toMatchObject({ fileTypes: ["application/vnd.ms-excel", "text/csv"] });
  });

  it("an empty file-type list is a recorded decision: any file type", () => {
    const scope = parseScope("drive", JSON.stringify({ files: [], fileTypes: [] }));
    expect(scope).toMatchObject({ fileTypes: [] });
  });

  it("a Drive selection with no recursion recorded reads one level, as it always did", () => {
    // Every selection saved before `recurse` existed carries no such key. Parsing one as
    // `true` would widen a recorded consent in the whole estate by deploying. ADR 0031.
    const scope = parseScope(
      "drive",
      JSON.stringify({ files: [{ id: "f1", name: "Statements", kind: "folder" }] }),
    );
    expect(scope).toMatchObject({ recurse: false });
  });

  it("a Drive selection that asked for sub-folders is read back asking for them", () => {
    const scope = parseScope("drive", JSON.stringify({ files: [], recurse: true }));
    expect(scope).toMatchObject({ recurse: true });
  });

  it("reads a Xero selection: the organisation, and which entities", () => {
    const scope = parseScope(
      "xero",
      JSON.stringify({
        organisation: { id: "org-1", name: "Acme Pte Ltd" },
        entities: ["invoices"],
      }),
    );
    expect(scope).toEqual({
      kind: "xero",
      organisation: { id: "org-1", name: "Acme Pte Ltd" },
      entities: ["invoices"],
    });
  });

  it("an empty entity list is a recorded decision: every entity the spec declares", () => {
    const scope = parseScope("xero", JSON.stringify({ organisation: { id: "org-1", name: "A" } }));
    expect(scope).toMatchObject({ kind: "xero", entities: [] });
  });

  it("no organisation is no selection, and a Gmail shape under xero is none either", () => {
    expect(parseScope("xero", "{}")).toBeNull();
    expect(parseScope("xero", JSON.stringify({ labels: [] }))).toBeNull();
    expect(parseScope("xero", JSON.stringify({ organisation: "org-1" }))).toBeNull();
  });

  it("a Xero shape under hubspot is no selection", () => {
    expect(
      parseScope("hubspot", JSON.stringify({ organisation: { id: "x", name: "y" } })),
    ).toBeNull();
  });

  it("reads a HubSpot selection: the properties each object reads beyond its spec", () => {
    const scope = parseScope(
      "hubspot",
      JSON.stringify({ properties: { companies: ["annualrevenue", "x_onboarding_stage"] } }),
    );
    expect(scope).toEqual({
      kind: "hubspot",
      properties: { companies: ["annualrevenue", "x_onboarding_stage"] },
    });
  });

  it("refuses a HubSpot property name that would carry a second one in with it", () => {
    // The list endpoint takes ONE comma-separated string; "city,phone" is two properties.
    expect(
      parseScope("hubspot", JSON.stringify({ properties: { companies: ["city,phone"] } })),
    ).toBeNull();
  });
});

describe("needsScope", () => {
  it("fires for a scoped source with nothing chosen and stays quiet otherwise", () => {
    expect(needsScope("xero", "{}")).toBe(true);
    expect(needsScope("xero", JSON.stringify({ organisation: { id: "o", name: "n" } }))).toBe(
      false,
    );
    expect(needsScope("hubspot", "{}")).toBe(false);
  });
});
