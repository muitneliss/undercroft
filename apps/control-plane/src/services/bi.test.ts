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
import { closeRun, openRun, recordSteps } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { answer, answerQuestion, getDashboardView, saveDashboard } from "./bi.ts";
import { getQuestionView, listQuestionViews, removeQuestion, saveQuestion } from "./biQuestions.ts";
import { InMemoryWorkerClient } from "./inMemoryWorkerClient.ts";
import type { Actor } from "../repos/auditLog.ts";

/** An address acting through the browser, as a router would name it from a session. */
function asActor(email: string): Actor {
  return { userId: null, email, channel: "web", credential: null };
}

const TENANT = "CASE-0042";
const OTHER = "CASE-0043";
const ACTOR = { actor: asActor("ada@example.test"), actorId: "u-ada" };

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
      await removeQuestion(db, { tenantId: OTHER, id: saved.id, actor: asActor("x@example.test") }),
    ).toBe(false);
    expect(await listQuestionViews(db, OTHER)).toEqual({ ok: true, items: [] });
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

describe("an answer's qualifiers (issue 456)", () => {
  /** A build in the ledger: each model built, and one test on it that passed or failed. */
  async function built(runId: string, tests: Record<string, "pass" | "fail">): Promise<void> {
    await db.asSuperuser(async (tx) => {
      await openRun(tx, {
        id: runId,
        tenantId: TENANT,
        source: "*",
        verb: "transform",
        trigger: "build",
      });
      await recordSteps(
        tx,
        runId,
        Object.entries(tests).flatMap(([model, status]) => [
          {
            uniqueId: `model.undercroft.${model}`,
            kind: "model" as const,
            name: model,
            status: "success",
            failures: null,
            relation: null,
            message: null,
            executionMs: 10,
          },
          {
            uniqueId: `test.undercroft.not_null_${model}_id.a1`,
            kind: "test" as const,
            name: `not_null_${model}_id`,
            status,
            failures: status === "fail" ? 1 : 0,
            relation: null,
            message: null,
            executionMs: 5,
            model,
          },
        ]),
      );
      await closeRun(tx, runId, { status: "ok", testsFailed: 1 });
    });
  }

  const ROWS = {
    columns: [{ name: "amount", type: "numeric" }],
    rows: [["12345678901234.5678"], [null]],
    truncated: false,
  };
  const SQL = { kind: "sql" as const, sql: "select amount from t_demo" };

  it("names each table read whose tests fail or are unknown, and serves every row", async () => {
    await built("run-1", { t_demo: "fail", fct_ok: "pass" });
    const worker = new InMemoryWorkerClient().answering({
      ...ROWS,
      relations: ["fct_ok", "never_built", "t_demo"],
    });

    const outcome = await answer(db, worker, { tenantId: TENANT, definition: SQL, params: {} });
    if (!outcome.ok) {
      throw new Error("expected an answer");
    }
    // The rows are not withheld, and the amount is the string the database sent.
    expect(outcome.value.rows).toEqual(ROWS.rows);
    expect(outcome.value.qualifiers).toEqual([
      {
        table: "never_built",
        state: "unknown",
        failing: null,
        failingTests: [],
        runId: null,
        endedAt: null,
      },
      {
        table: "t_demo",
        state: "failing",
        failing: 1,
        failingTests: ["not_null_t_demo_id"],
        runId: "run-1",
        endedAt: expect.any(String),
      },
    ]);
    expect("relations" in outcome.value).toBe(false);
  });

  it("says nothing for a table whose tests pass, and 'not known' when the tables read are not", async () => {
    await built("run-1", { fct_ok: "pass" });
    const passing = await answer(
      db,
      new InMemoryWorkerClient().answering({ ...ROWS, relations: ["fct_ok"] }),
      { tenantId: TENANT, definition: SQL, params: {} },
    );
    expect(passing.ok && passing.value.qualifiers).toEqual([]);

    // A worker older than the plan read sends no relations: not "none read", which `[]` would say.
    const older = await answer(db, new InMemoryWorkerClient().answering(ROWS), {
      tenantId: TENANT,
      definition: SQL,
      params: {},
    });
    expect(older.ok && older.value.qualifiers).toBeNull();
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
