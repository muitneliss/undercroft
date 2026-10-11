import { describe, expect, test as it } from "bun:test";
import { createCatalog } from "@/prototype/fixtures.ts";
import { filteredModels, groupKey, orderedModels, related, scopeIds } from "./catalog.ts";
import type { Catalog } from "./types.ts";

describe("Models workspace catalogue and scope", () => {
  const catalog = createCatalog();
  it("250 unique models have the explicitly declared role counts", () => {
    expect(catalog.models).toHaveLength(250);
    expect(new Set(catalog.models.map((model) => model.id)).size).toBe(250);
    expect(
      ["input", "transform", "output", "unclassified"].map(
        (layer) => filteredModels(catalog, new URLSearchParams({ layer })).length,
      ),
    ).toEqual([50, 100, 90, 10]);
  });
  it("1000 model scale fixture remains deterministic", () => {
    expect(createCatalog(1000).models).toHaveLength(1000);
    expect(createCatalog(1000)).toEqual(createCatalog(1000));
  });
  it("search covers aliases, technical names and descriptions", () => {
    for (const q of ["int_invoice_balance", "Đối chiếu công nợ", "outstanding balances"]) {
      expect(
        filteredModels(catalog, new URLSearchParams({ q })).map((model) => model.id),
      ).toContain("int_invoice_balance");
    }
  });
  it("filters intersect, and an empty result does not silently widen scope", () => {
    expect(
      filteredModels(catalog, new URLSearchParams({ layer: "output", q: "stg_invoices" })),
    ).toEqual([]);
    expect(
      filteredModels(
        catalog,
        new URLSearchParams({ layer: "input", source: "xero", status: "failed" }),
      ).map((model) => model.id),
    ).toEqual(["stg_payments"]);
  });
  it("legacy build aliases retain their meaning", () => {
    expect(
      filteredModels(catalog, new URLSearchParams("build=failed")).map((model) => model.id),
    ).toEqual(["stg_payments"]);
    expect(
      filteredModels(catalog, new URLSearchParams("build=failed&status=success")).every(
        (model) => model.status === "success",
      ),
    ).toBe(true);
  });
  it("partial coverage wins over an apparently single or multiple source", () => {
    const model = catalog.models[0]!;
    expect(groupKey({ ...model, coverage: "partial", sources: ["xero", "hubspot"] }, "input")).toBe(
      "unknown",
    );
    expect(
      groupKey({ ...model, coverage: "complete", sources: ["xero", "hubspot"] }, "input"),
    ).toBe("multiple");
    expect(groupKey({ ...model, coverage: "complete", sources: [] }, "input")).toBe("none");
  });
  it("a technical prefix cannot invent a role", () => {
    const model = { ...catalog.models[0]!, id: "mart_unknown", layer: "unclassified" as const };
    expect(groupKey(model, "")).toBe("unclassified");
  });
  it("groups remain contiguous across page boundaries without duplicate IDs", () => {
    const rows = orderedModels(
      catalog.models.filter((model) => model.layer === "input"),
      "input",
      "name_asc",
      "vi",
    );
    const first = rows.slice(0, 25);
    const second = rows.slice(25, 50);
    expect(new Set([...first, ...second].map((model) => model.id)).size).toBe(50);
    const keys = rows.map((model) => groupKey(model, "input"));
    expect(new Set(keys).size).toBe(keys.filter((key, index) => key !== keys[index - 1]).length);
  });
  it("direct and indirect downstream relationships are distinct", () => {
    const direct = related(catalog, "stg_invoices", "down", 1);
    expect(direct.has("mart_receivables")).toBe(false);
    expect(related(catalog, "stg_invoices", "down", 2).get("mart_receivables")?.distance).toBe(2);
  });
  it("both directions do not traverse up then down into a sibling", () => {
    expect(related(catalog, "stg_invoices", "both", 1000).has("stg_payments")).toBe(false);
  });
  it("raw roots are valid and are not counted as their own relations", () => {
    const relatedRaw = related(catalog, "raw.records", "down", 1);
    expect([...relatedRaw.keys()]).toEqual(["stg_invoices", "stg_payments"]);
    expect(relatedRaw.has("raw.records")).toBe(false);
  });
  it("cycles and repeated edges terminate without counting the root twice", () => {
    const cyclic: Catalog = {
      models: [],
      revision: "cycle",
      edges: [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "c", target: "a" },
        { source: "a", target: "b" },
      ],
    };
    expect([...related(cyclic, "a", "down", 1000).keys()]).toEqual(["b", "c"]);
  });
  it("opening a branch changes scope by one step while keeping the root", () => {
    const ids = scopeIds(catalog, "stg_invoices", "down", {
      depth: 1,
      expanded: ["int_invoice_balance"],
    });
    expect(ids[0]).toBe("stg_invoices");
    expect(ids).toContain("mart_receivables");
    expect(new Set(ids).size).toBe(ids.length);
  });
});
