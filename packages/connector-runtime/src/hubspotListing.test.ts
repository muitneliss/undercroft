/**
 * The shipped HubSpot spec reads a list past 10,000 records to its end (issue 279).
 *
 * HubSpot's search endpoint stops at 10,000 results for any query; its objects list, paged by
 * `after`, does not, and line items grow past that size. Two things could still stop a read
 * there: a spec that pages by something that runs out, and a guard that takes a count of exactly
 * 10,000 for a truncation. So the read is driven over the shipped spec's `line_items`, at 10,001
 * records -- served in pages far larger than the spec's `limit`, which a source is free to do and
 * which keeps this to six requests.
 */

import { describe, expect, test as it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpec } from "@undercroft/contracts";
import { TestClock } from "@undercroft/core";

import { readEntity } from "./run.ts";
import { InMemoryFetcher } from "./testing.ts";

const SPEC = parseSpec(
  readFileSync(
    join(import.meta.dirname, "..", "..", "..", "specs", "connectors", "hubspot.yaml"),
    "utf8",
  ),
);
const PAGE = 2000;

/** The spec's own first-page URL for line items, and each later page by its `after`. */
function pageUrl(after: number | null): string {
  const entity = SPEC.entities.find((e) => e.name === "line_items");
  const url = new URL(`${SPEC.baseUrl}/crm/v3/objects/line_items`);
  const query = entity?.request.kind === "list" ? entity.request.query : {};
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  if (after !== null) {
    url.searchParams.set("after", String(after));
  }
  return url.toString();
}

/** A portal holding `total` line items, answering them `PAGE` at a time by `after`. */
function portal(total: number): InMemoryFetcher {
  const fetcher = new InMemoryFetcher();
  for (let start = 0; start < total; start += PAGE) {
    const end = Math.min(start + PAGE, total);
    const results = Array.from({ length: end - start }, (_, i) => ({
      id: String(start + i + 1),
      properties: { name: "Widget", hs_lastmodifieddate: "2026-01-01T00:00:00.000Z" },
    }));
    fetcher.on("GET", pageUrl(start === 0 ? null : start), {
      body: { results, ...(end < total ? { paging: { next: { after: String(end) } } } : {}) },
    });
  }
  return fetcher;
}

/** Every line item id the read handed on, in order. */
async function readIds(total: number): Promise<string[]> {
  const entity = SPEC.entities.find((e) => e.name === "line_items");
  const ids: string[] = [];
  for await (const record of readEntity(SPEC, entity!, {
    fetcher: portal(total),
    clock: new TestClock(),
    token: () => "pat",
  })) {
    ids.push(record.sourceRecordId);
  }
  return ids;
}

describe("a HubSpot list past the search endpoint's 10,000", () => {
  it("is read to its end by `after`", async () => {
    expect(await readIds(10_001)).toHaveLength(10_001);
  });

  it("is not taken for a truncation at exactly 10,000", async () => {
    expect(await readIds(10_000)).toHaveLength(10_000);
  });
});
