/**
 * Where the search statement spends its work, read from Postgres's own plan of it, for both of
 * the ways it ranks documents.
 *
 * The excerpt is the cost #447 named: `raw.search_excerpt` folds a body again and scans it once
 * per term, and it was computed for every match before the page was cut. What a test can
 * observe without timing anything is WHERE in the plan it is evaluated -- above the page's
 * LIMIT, over the rows it lets through, or below it, over every candidate. The vector rebuild is
 * the cost ADR 0155 moved documents to the BM25 door for, and the same reading shows whether a
 * document's vector is rebuilt at all. The plan is asked for as the tenant's login, the way the
 * statement runs.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { type DocumentRanking, SEARCH_STATEMENTS } from "./rawSearch.ts";

const TENANT = "CASE-1";
let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.query("SELECT ops.provision_tenant($1)", [TENANT]);
  await db.exec("CREATE TABLE raw.records_demo PARTITION OF raw.records FOR VALUES IN ('demo')");
});

afterEach(async () => {
  await db.close();
});

/** One node of `EXPLAIN (VERBOSE, FORMAT JSON)`, as far as these tests read it. */
interface PlanNode {
  readonly "Node Type": string;
  readonly Output?: readonly string[];
  readonly Plans?: readonly PlanNode[];
}

function* walk(node: PlanNode): Generator<PlanNode> {
  yield node;
  for (const child of node.Plans ?? []) {
    yield* walk(child);
  }
}

function outputs(node: PlanNode, text: string): boolean {
  return (node.Output ?? []).some((column) => column.includes(text));
}

async function planOfSearch(ranking: DocumentRanking): Promise<PlanNode> {
  const role = `undercroft_dbt_${TENANT.toLowerCase().replace("-", "_")}`;
  return db.asRole(role, async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(
      `EXPLAIN (VERBOSE, FORMAT JSON) ${SEARCH_STATEMENTS[ranking]}`,
      [
        "hop dong",
        TENANT,
        21,
        0,
        2000,
        ranking === "bm25" ? 21 : 100,
        ["record", "document"],
        null,
        null,
      ],
    );
    const [raw] = Object.values(rows[0] ?? {});
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as { Plan: PlanNode }[];
    const plan = parsed[0]?.Plan;
    if (plan === undefined) {
      throw new Error("EXPLAIN returned no plan");
    }
    return plan;
  });
}

describe.each(["bm25", "newest"] as const)(
  "the search statement's plan, documents by %s",
  (ranking) => {
    it("cuts the excerpt above the page's LIMIT, over the page alone", async () => {
      const plan = await planOfSearch(ranking);
      const limits = [...walk(plan)].filter((node) => node["Node Type"] === "Limit");
      expect(limits).toHaveLength(1);
      const [page] = limits;
      // Nothing at or below the page computes an excerpt...
      expect([...walk(page as PlanNode)].some((node) => outputs(node, "search_excerpt"))).toBe(
        false,
      );
      // ...and something above it does. Without this side, a plan that never excerpted at all
      // would pass.
      expect([...walk(plan)].some((node) => outputs(node, "search_excerpt"))).toBe(true);
    });

    it("ranks below the page's LIMIT, because ranking is what orders the page", async () => {
      // The other half of the same fact: the rank is computed for the candidates, before the cut,
      // and the excerpt is not. Were both below it, the test above would have caught the excerpt;
      // were both above it, the page would be ordered by nothing. Records are ranked this way on
      // both paths (ADR 0155 decision 6).
      const plan = await planOfSearch(ranking);
      const [page] = [...walk(plan)].filter((node) => node["Node Type"] === "Limit");
      expect([...walk(page as PlanNode)].some((node) => outputs(node, "ts_rank_cd"))).toBe(true);
    });
  },
);

describe("where a document's vector is rebuilt", () => {
  // `raw.search_tsv` over a document's text is the rebuild that made ADR 0123 cap documents at
  // the newest 100. Through the door nothing in the statement rebuilds one -- the door ranks from
  // the index and filters through the GIN keys, inside its own body -- and ADR 0123's path
  // still does, for the documents it ranks. Both sides, so a reading that never found the
  // expression cannot pass.
  function rebuildsDocumentVectors(plan: PlanNode): boolean {
    return [...walk(plan)].some((node) => outputs(node, "search_tsv"));
  }

  it("never happens on the BM25 path", async () => {
    expect(rebuildsDocumentVectors(await planOfSearch("bm25"))).toBe(false);
  });

  it("happens on ADR 0123's path, for the documents it ranks", async () => {
    expect(rebuildsDocumentVectors(await planOfSearch("newest"))).toBe(true);
  });
});
