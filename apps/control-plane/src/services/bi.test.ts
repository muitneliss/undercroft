/**
 * What questions and dashboards promise: a save stores the definition and hands back an
 * id, an update of a question that is not this tenant's is refused, a read gives the shape
 * back parsed, one tenant's questions are never another's, and answering a saved question
 * compiles it, binds the dashboard's values as literals, and hands the worker exactly that
 * SQL -- or refuses before sending when a parameter has no value.
 *
 * Runs as `undercroft_app`, so a missing grant on the two tables fails here.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import {
  answerQuestion,
  getDashboardView,
  getQuestionView,
  listQuestionViews,
  removeQuestion,
  saveDashboard,
  saveQuestion,
} from "./bi.ts";
import { InMemoryWorkerClient } from "./inMemoryWorkerClient.ts";

const TENANT = "CASE-0042";
const OTHER = "CASE-0043";
const ACTOR = { actor: "ada@example.test", actorId: "u-ada" };

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1), ($2)", [TENANT, OTHER]);
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

const DEALS_BY_STAGE = {
  kind: "visual" as const,
  table: "stg_deals",
  fields: [{ column: "stage" }, { column: "amount", aggregate: "sum" as const }],
  filters: [{ column: "closed_at", op: "gte" as const, value: "{{period_from}}" }],
  groupBy: ["stage"],
  orderBy: [],
  limit: 100,
};

describe("questions", () => {
  it("are saved, read back parsed, updated in place, and kept to their tenant", async () => {
    const saved = await saveQuestion(db, {
      ...ACTOR,
      tenantId: TENANT,
      name: "Deals by stage",
      definition: DEALS_BY_STAGE,
      chart: { type: "bar", x: "stage", y: ["sum_amount"], options: {} },
    });
    if (!saved.ok) {
      throw new Error("expected the question to be saved");
    }

    const read = await getQuestionView(db, TENANT, saved.id);
    expect(read?.name).toBe("Deals by stage");
    expect(read?.definition).toEqual(DEALS_BY_STAGE);
    expect(read?.chart.type).toBe("bar");
    expect(read?.updatedBy).toBe("u-ada");

    const updated = await saveQuestion(db, {
      ...ACTOR,
      tenantId: TENANT,
      id: saved.id,
      name: "Deals by stage, won",
      definition: { kind: "sql", sql: "select 1" },
      chart: { type: "table", y: [], options: {} },
    });
    expect(updated).toEqual({ ok: true, id: saved.id });
    expect((await getQuestionView(db, TENANT, saved.id))?.definition).toEqual({
      kind: "sql",
      sql: "select 1",
    });

    // Another tenant cannot see it, update it, or delete it.
    expect(await getQuestionView(db, OTHER, saved.id)).toBeNull();
    expect(
      await saveQuestion(db, {
        ...ACTOR,
        tenantId: OTHER,
        id: saved.id,
        name: "theirs",
        definition: { kind: "sql", sql: "select 2" },
        chart: { type: "table", y: [], options: {} },
      }),
    ).toEqual({ ok: false, reason: "not-found" });
    expect(
      await removeQuestion(db, { tenantId: OTHER, id: saved.id, actor: "x@example.test" }),
    ).toBe(false);
    expect((await listQuestionViews(db, OTHER)).length).toBe(0);
    expect(await removeQuestion(db, { tenantId: TENANT, id: saved.id, actor: ACTOR.actor })).toBe(
      true,
    );
  });

  it("a saved question is answered as the compiled SQL with the dashboard's values bound", async () => {
    const saved = await saveQuestion(db, {
      ...ACTOR,
      tenantId: TENANT,
      name: "Deals by stage",
      definition: DEALS_BY_STAGE,
      chart: { type: "table", y: [], options: {} },
    });
    if (!saved.ok) {
      throw new Error("expected the question to be saved");
    }
    const worker = new InMemoryWorkerClient();

    const outcome = await answerQuestion(db, worker, {
      tenantId: TENANT,
      questionId: saved.id,
      params: { period_from: "2026-01-01" },
    });
    expect(outcome.ok).toBe(true);
    expect(worker.queries).toEqual([
      {
        tenantId: TENANT,
        sql: [
          'SELECT "stage", sum("amount") AS "sum_amount"',
          'FROM "stg_deals"',
          `WHERE "closed_at" >= '2026-01-01'`,
          'GROUP BY "stage"',
          "LIMIT 100",
        ].join("\n"),
        limit: 100,
      },
    ]);

    // With the parameter unbound, nothing is sent.
    const refused = await answerQuestion(db, worker, {
      tenantId: TENANT,
      questionId: saved.id,
      params: {},
    });
    expect(refused).toEqual({ ok: false, reason: "param-missing", param: "period_from" });
    expect(worker.queries).toHaveLength(1);
  });
});

describe("dashboards", () => {
  it("are saved with their grid and filters and read back parsed", async () => {
    const question = await saveQuestion(db, {
      ...ACTOR,
      tenantId: TENANT,
      name: "q",
      definition: { kind: "sql", sql: "select 1" },
      chart: { type: "number", y: [], options: {} },
    });
    if (!question.ok) {
      throw new Error("expected the question to be saved");
    }
    const saved = await saveDashboard(db, {
      ...ACTOR,
      tenantId: TENANT,
      name: "Sales",
      layout: { tiles: [{ questionId: question.id, x: 0, y: 0, w: 6, h: 4 }] },
      filters: [{ name: "period", kind: "date_range", label: "Kỳ" }],
    });
    if (!saved.ok) {
      throw new Error("expected the dashboard to be saved");
    }

    const read = await getDashboardView(db, TENANT, saved.id);
    expect(read?.layout.tiles).toEqual([{ questionId: question.id, x: 0, y: 0, w: 6, h: 4 }]);
    expect(read?.filters).toEqual([{ name: "period", kind: "date_range", label: "Kỳ" }]);
    expect(await getDashboardView(db, OTHER, saved.id)).toBeNull();
  });
});
