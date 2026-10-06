/**
 * What a model's business context promises (ADR 0105): it is read with its state, never
 * stored with one; the state follows the definition the context was approved against -- the
 * model's own SQL, tests and built columns, and those of each model it reads directly -- and
 * nothing that leaves the definition as it was (an order, an empty test, a first build) moves
 * it; an approval is of the definition its reader saw, or nothing is written; and the save,
 * build and delete of a model behave exactly as they did before contexts existed.
 *
 * Runs as `undercroft_app`; a build's columns are written as `undercroft_worker`, the role that
 * writes them in production, so a scheduled build the control plane never hears about is what
 * these tests exercise.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import type { ContextChangeKind, ModelContext } from "@undercroft/contracts";
import { setModelColumns } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { InMemoryWorkerClient } from "./inMemoryWorkerClient.ts";
import { save as saveMacro } from "./macros.ts";
import { setContext } from "./modelContext.ts";
import { build, get, list, remove, save } from "./models.ts";

const TENANT = "CASE-0042";
const OTHER = "CASE-0043";
const ACTOR = {
  actor: { userId: null, email: "ada@example.test", channel: "web", credential: null },
  actorId: "u-ada",
} as const;
const RECORDS = "select source_record_id as id from {{ source('undercroft', 'records') }}";
const PURPOSE = "One row per open deal, for the pipeline report.";

const COMPLETE: ModelContext = {
  purpose: PURPOSE,
  grain: "One deal.",
  key: { kind: "declared", columns: ["id"] },
  columns: [{ name: "id", definition: "The deal's id in the CRM." }],
  rules: { kind: "none" },
};

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1), ($2)", [TENANT, OTHER]);
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

async function saveModel(
  name: string,
  sql: string,
  tests: Record<string, ("not_null" | "unique")[]> = {},
  tenantId = TENANT,
): Promise<void> {
  await save(db, { ...ACTOR, tenantId, name, sql, tests: { columns: tests }, create: false });
}

/** What a build records, written as the worker writes it. */
async function built(name: string, columns: string[]): Promise<void> {
  await db.asRole("undercroft_worker", (tx) => setModelColumns(tx, TENANT, name, columns));
}

async function contextOf(name: string, tenantId = TENANT) {
  const model = await get(db, tenantId, name);
  if (model === null) {
    throw new Error(`no model ${name}`);
  }
  return model.context;
}

/** Approve `context` against what `get` shows now, as a reader would. */
async function approve(name: string, context: ModelContext = COMPLETE, tenantId = TENANT) {
  const { basis } = await contextOf(name, tenantId);
  return setContext(db, { ...ACTOR, tenantId, name, basis, context });
}

function ref(name: string): string {
  return `select id from {{ ref('${name}') }}`;
}

describe("a model's context, read", () => {
  it("with none approved it is incomplete, every section missing, and no text", async () => {
    await saveModel("stg_deals", RECORDS);
    const context = await contextOf("stg_deals");
    expect(context.state).toBe("incomplete");
    expect(context.missing).toEqual(["purpose", "grain", "key", "columns", "rules"]);
    expect(context.body).toBeNull();
    expect(context.changes).toEqual([]);
  });

  it("approved complete it is current, and reads back exactly as written", async () => {
    await saveModel("stg_deals", RECORDS);
    expect((await approve("stg_deals")).ok).toBe(true);

    const context = await contextOf("stg_deals");
    expect(context.state).toBe("current");
    expect(context.body).toEqual(COMPLETE);
    expect(context.reviewedBy).toBe("u-ada");
  });

  it("a changed SQL needs review with the old text kept; the old SQL saved back is current", async () => {
    await saveModel("stg_deals", RECORDS);
    await approve("stg_deals");

    await saveModel("stg_deals", `${RECORDS} where false`);
    const changed = await contextOf("stg_deals");
    expect(changed.state).toBe("needs_review");
    expect(changed.changes).toEqual([{ model: "stg_deals", kind: "sql" }]);
    expect(changed.body).toEqual(COMPLETE);

    await saveModel("stg_deals", RECORDS);
    expect((await contextOf("stg_deals")).state).toBe("current");
  });

  it("changed tests need review; tests reordered or a column with none do not", async () => {
    await saveModel("stg_deals", RECORDS, { id: ["not_null", "unique"] });
    await approve("stg_deals");

    await saveModel("stg_deals", RECORDS, { id: ["unique", "not_null"], stage: [] });
    expect((await contextOf("stg_deals")).state).toBe("current");

    await saveModel("stg_deals", RECORDS, { id: ["not_null"] });
    expect((await contextOf("stg_deals")).changes).toEqual([{ model: "stg_deals", kind: "tests" }]);
  });

  it("a build that changes the column set needs review; reordered columns do not", async () => {
    await saveModel("stg_deals", RECORDS);
    await built("stg_deals", ["id", "stage"]);
    await approve("stg_deals");

    await built("stg_deals", ["stage", "id"]);
    expect((await contextOf("stg_deals")).state).toBe("current");

    await built("stg_deals", ["id", "stage", "amount"]);
    expect((await contextOf("stg_deals")).changes).toEqual([
      { model: "stg_deals", kind: "columns" },
    ]);
  });

  it("the first build of a model approved before it was built is not a change", async () => {
    await saveModel("stg_deals", RECORDS);
    await approve("stg_deals");

    await built("stg_deals", ["id"]);
    const context = await contextOf("stg_deals");
    expect(context.state).toBe("current");
    expect(context.absentColumns).toEqual([]);
  });

  it("names a key or defined column the last build did not have, and nothing before a build", async () => {
    await saveModel("stg_deals", RECORDS);
    await approve("stg_deals");
    expect((await contextOf("stg_deals")).absentColumns).toBeNull();

    await built("stg_deals", ["deal_id"]);
    expect((await contextOf("stg_deals")).absentColumns).toEqual(["id"]);
  });
});

describe("a change upstream", () => {
  /** a -> b -> c, built, with b and c approved. */
  async function chain(): Promise<void> {
    await saveModel("a", RECORDS);
    await saveModel("b", ref("a"));
    await saveModel("c", ref("b"));
    await built("a", ["id"]);
    await approve("b");
    await approve("c");
  }

  async function expectOnlyB(kind: ContextChangeKind): Promise<void> {
    const b = await contextOf("b");
    expect(b.state).toBe("needs_review");
    expect(b.changes).toEqual([{ model: "a", kind }]);
    expect((await contextOf("c")).state).toBe("current");
  }

  it("a's SQL flags b, naming a, and leaves c alone", async () => {
    await chain();
    await saveModel("a", `${RECORDS} where true`);
    await expectOnlyB("sql");
  });

  it("a's tests flag b, naming a, and leave c alone", async () => {
    await chain();
    await saveModel("a", RECORDS, { id: ["unique"] });
    await expectOnlyB("tests");
  });

  it("a's columns flag b, naming a, and leave c alone", async () => {
    await chain();
    await built("a", ["id", "stage"]);
    await expectOnlyB("columns");
  });

  it("b approved again, unchanged, leaves c current", async () => {
    await chain();
    await saveModel("a", `${RECORDS} where true`);
    await approve("b");

    expect((await contextOf("b")).state).toBe("current");
    expect((await contextOf("c")).state).toBe("current");
  });

  it("a macro that starts reading another model is a changed dependency", async () => {
    await saveModel("a", RECORDS);
    function base(body: string) {
      return {
        ...ACTOR,
        tenantId: TENANT,
        name: "deals_base",
        description: "The deals.",
        sql: `{% macro deals_base() %}${body}{% endmacro %}`,
        create: false,
      };
    }
    await saveMacro(db, base("{{ source('undercroft', 'records') }}"));
    await saveModel("b", "select id from {{ deals_base() }} d");
    await approve("b");

    await saveMacro(db, base("{{ ref('a') }}"));
    expect((await contextOf("b")).changes).toEqual([{ model: "a", kind: "dependency" }]);
  });

  it("an upstream model deleted is missing", async () => {
    await saveModel("a", RECORDS);
    await saveModel("b", ref("a"));
    await approve("b");

    const removed = await remove(db, new InMemoryWorkerClient(), {
      ...ACTOR,
      tenantId: TENANT,
      name: "a",
    });
    expect(removed).toEqual({ ok: true });
    expect((await contextOf("b")).changes).toEqual([{ model: "a", kind: "missing" }]);
  });
});

describe("approving", () => {
  it("against a definition that changed since it was read writes nothing", async () => {
    await saveModel("stg_deals", RECORDS);
    const { basis } = await contextOf("stg_deals");
    await saveModel("stg_deals", `${RECORDS} where false`);

    const stale = await setContext(db, {
      ...ACTOR,
      tenantId: TENANT,
      name: "stg_deals",
      basis,
      context: COMPLETE,
    });
    expect(stale).toEqual({ ok: false, reason: "changed" });
    expect((await contextOf("stg_deals")).body).toBeNull();

    expect((await approve("stg_deals")).ok).toBe(true);
    expect((await contextOf("stg_deals")).state).toBe("current");
  });

  it("the trail names the model and the state, never the text", async () => {
    await saveModel("stg_deals", RECORDS);
    await approve("stg_deals");

    const { rows } = await db.query<{ detail: string }>(
      "SELECT detail::text AS detail FROM ops.audit_log WHERE action = 'models.setContext'",
    );
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.detail ?? "{}")).toEqual({ name: "stg_deals", state: "current" });
    expect(rows[0]?.detail).not.toContain(PURPOSE);
  });
});

describe("the model around its context", () => {
  it("saves and builds as before whether its context is incomplete or needs review", async () => {
    const worker = new InMemoryWorkerClient();
    await saveModel("stg_deals", RECORDS);
    expect((await contextOf("stg_deals")).state).toBe("incomplete");
    expect((await build(db, worker, { ...ACTOR, tenantId: TENANT, name: "stg_deals" })).ok).toBe(
      true,
    );

    await approve("stg_deals");
    await saveModel("stg_deals", `${RECORDS} where false`);
    expect((await contextOf("stg_deals")).state).toBe("needs_review");
    const saved = await save(db, {
      ...ACTOR,
      tenantId: TENANT,
      name: "stg_deals",
      sql: RECORDS,
      tests: { columns: {} },
      create: false,
    });
    expect(saved).toEqual({ ok: true });
    expect((await build(db, worker, { ...ACTOR, tenantId: TENANT, name: "stg_deals" })).ok).toBe(
      true,
    );
    expect(worker.built).toHaveLength(2);
  });

  it("deleted and created again under the same name, it starts with no context", async () => {
    await saveModel("stg_deals", RECORDS);
    await approve("stg_deals");
    await remove(db, new InMemoryWorkerClient(), { ...ACTOR, tenantId: TENANT, name: "stg_deals" });

    await saveModel("stg_deals", RECORDS);
    const context = await contextOf("stg_deals");
    expect(context.state).toBe("incomplete");
    expect(context.body).toBeNull();
  });

  it("the list carries every model's state in one call, and only this tenant's", async () => {
    await saveModel("stg_deals", RECORDS);
    await saveModel("stg_notes", RECORDS);
    await approve("stg_deals");
    await saveModel("stg_theirs", RECORDS, {}, OTHER);
    await approve("stg_theirs", COMPLETE, OTHER);

    const listed = await list(db, TENANT);
    expect(listed.map((m) => [m.name, m.context.state])).toEqual([
      ["stg_deals", "current"],
      ["stg_notes", "incomplete"],
    ]);
  });
});
