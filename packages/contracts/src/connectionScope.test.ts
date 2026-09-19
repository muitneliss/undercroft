/**
 * What a stored selection means: chosen, chosen-nothing, or not chosen at all. The three are
 * different facts, and a collector that read one as another would read far more than anyone
 * agreed to.
 */

import { describe, expect, test as it } from "bun:test";

import { needsScope, parseScope } from "./connectionScope.ts";

describe("parseScope", () => {
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

  it("a source that takes no scope never parses to one", () => {
    expect(
      parseScope("hubspot", JSON.stringify({ organisation: { id: "x", name: "y" } })),
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
