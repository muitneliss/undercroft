/**
 * Where the search statement spends its work, read from Postgres's own plan of it.
 *
 * The excerpt is the cost #447 named: `raw.search_excerpt` folds a body again and scans it once
 * per term, and it was computed for every match before the page was cut. What a test can
 * observe without timing anything is WHERE in the plan it is evaluated -- above the page's
 * LIMIT, over the rows it lets through, or below it, over every candidate. The plan is asked for
 * as the tenant's login, the way the statement runs.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { SEARCH_STATEMENT } from "./rawSearch.ts";

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

async function planOfSearch(): Promise<PlanNode> {
  const role = `undercroft_dbt_${TENANT.toLowerCase().replace("-", "_")}`;
  return db.asRole(role, async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(
      `EXPLAIN (VERBOSE, FORMAT JSON) ${SEARCH_STATEMENT}`,
      ["hop dong", TENANT, 21, 0, 2000, 200, ["record", "document"]],
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

describe("the search statement's plan", () => {
  it("cuts the excerpt above the page's LIMIT, over the page alone", async () => {
    const plan = await planOfSearch();
    const limits = [...walk(plan)].filter((node) => node["Node Type"] === "Limit");
    expect(limits).toHaveLength(1);
    const [page] = limits;
    // Nothing at or below the page computes an excerpt...
    expect([...walk(page as PlanNode)].some((node) => outputs(node, "search_excerpt"))).toBe(false);
    // ...and something above it does. Without this side, a plan that never excerpted at all
    // would pass.
    expect([...walk(plan)].some((node) => outputs(node, "search_excerpt"))).toBe(true);
  });

  it("ranks below the page's LIMIT, because ranking is what orders the page", async () => {
    // The other half of the same fact: the rank is computed for the candidates, before the cut,
    // and the excerpt is not. Were both below it, the test above would have caught the excerpt;
    // were both above it, the page would be ordered by nothing.
    const plan = await planOfSearch();
    const [page] = [...walk(plan)].filter((node) => node["Node Type"] === "Limit");
    expect([...walk(page as PlanNode)].some((node) => outputs(node, "ts_rank_cd"))).toBe(true);
  });
});
