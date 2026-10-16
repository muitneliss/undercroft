/**
 * Object reach (ADR 0142), through the real router against PGlite: a customer's own role reads
 * only the models, raw streams and reports granted to it, a built-in reads the whole customer as
 * before, a read the control plane makes itself is narrowed here, and a read the worker makes is
 * sent with the scope Postgres enforces. Which tables a scope login can read is proven against
 * the database in `packages/db/src/scopeLogins.test.ts` and the Docker tier.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { Permission } from "@undercroft/contracts/access";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryWorkerClient } from "../services/inMemoryWorkerClient.ts";
import type { WorkerClient } from "../services/workerClient.ts";
import { appRouter } from "./router.ts";
import { type Context, refusalFacts } from "./trpc.ts";

const TENANT = "CASE-0042";
const QUESTION = { kind: "sql" as const, sql: "select * from fct_sales" };
const CHART = { type: "table" as const, y: [], options: {} };

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  for (const name of ["fct_sales", "fct_costs"]) {
    await db.query("INSERT INTO app.model (tenant_id, name, sql) VALUES ($1, $2, 'select 1')", [
      TENANT,
      name,
    ]);
  }
  await db.query(
    `INSERT INTO app.seed (tenant_id, name, columns, rows)
     VALUES ($1, 'fx_rates', '[{"name":"code","type":"text"}]', '[["VND"]]')`,
    [TENANT],
  );
  for (const [source, entity, id] of [
    ["hubspot", "deals", "d-1"],
    ["hubspot", "companies", "c-1"],
    ["gmail", "messages", "m-1"],
  ]) {
    await db.query(
      `INSERT INTO raw.records (source, tenant_id, entity, source_record_id, payload,
         content_sha256, observed_at, lake_key, lake_stamp, run_id)
       VALUES ($1, $2, $3, $4, '{}'::jsonb, repeat('0', 64), now(), 'k', 's', 'r-1')`,
      [source, TENANT, entity, id],
    );
  }
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

async function seedMember(email: string, role: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [email],
  );
  const userId = rows[0]?.id ?? "";
  await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    TENANT,
    userId,
    role,
  ]);
  return userId;
}

function caller(email: string, userId: string, worker: WorkerClient | null) {
  const ctx: Context = {
    exec: db,
    user: { userId, email },
    credentialId: "s1",
    via: "session",
    grant: "write",
    superadmin: false,
    locale: "en",
    endSession: () => Promise.resolve(),
    apps: null,
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () =>
      Promise.resolve({
        ok: false as const,
        reason: "not-configured" as const,
        provider: "google" as const,
      }),
    worker,
    specReads: new Map(),
    googlePicker: null,
    signInMethods: [],
    channel: "web",
    publicUrl: null,
    holdOpen: () => undefined,
  };
  return appRouter.createCaller(ctx);
}

async function as(email: string, role: string, worker: WorkerClient | null = null) {
  return caller(email, await seedMember(email, role), worker);
}

async function refused(fn: () => Promise<unknown>): Promise<{ code: string; facts: unknown }> {
  try {
    await fn();
    return { code: "NO_ERROR", facts: null };
  } catch (error) {
    if (!(error instanceof TRPCError)) {
      throw error;
    }
    return { code: error.code, facts: refusalFacts(error) };
  }
}

/**
 * A customer's own role holding `permissions`, granted `objects` to read, by an admin through the
 * router -- and a person holding it, as a caller.
 */
async function holding(
  key: string,
  permissions: Permission[],
  objects: string[],
  worker: WorkerClient | null = null,
) {
  const admin = await as(`admin-${key}@example.test`, "admin");
  await admin.roles.save({ tenantId: TENANT, key, label: key, permissions, create: true });
  for (const object of objects) {
    await admin.grants.save({ tenantId: TENANT, role: key, object });
  }
  return await as(`${key}@example.test`, key, worker);
}

async function saveQuestion(name: string): Promise<string> {
  const admin = await as(`q-${name}@example.test`, "admin");
  return (
    await admin.bi.questions.save({ tenantId: TENANT, name, definition: QUESTION, chart: CHART })
  ).id;
}

describe("models and reference tables", () => {
  it("a role granted one model lists and reads that one, and the rest are not there", async () => {
    const sales = await holding("sales", [], ["model:fct_sales"]);

    const listed = await sales.models.list({ tenantId: TENANT });
    const other = await refused(() => sales.models.get({ tenantId: TENANT, name: "fct_costs" }));
    const named = await refused(() =>
      sales.models.list({ tenantId: TENANT, names: ["fct_costs"] }),
    );

    expect(Array.isArray(listed) ? listed.map((model) => model.name) : null).toEqual(["fct_sales"]);
    expect((await sales.models.get({ tenantId: TENANT, name: "fct_sales" })).name).toBe(
      "fct_sales",
    );
    expect(other.code).toBe("NOT_FOUND");
    // A name it does not reach is as unknown to the filter as a name nobody has.
    expect(named.code).toBe("NOT_FOUND");
    expect(await sales.seeds.list({ tenantId: TENANT })).toEqual([]);
  });

  it("a built-in role reads every model and reference table, as before", async () => {
    const viewer = await as("v@example.test", "viewer");

    const listed = await viewer.models.list({ tenantId: TENANT });

    expect(Array.isArray(listed) ? listed.map((model) => model.name) : null).toEqual([
      "fct_costs",
      "fct_sales",
    ]);
    expect((await viewer.seeds.list({ tenantId: TENANT })).map((seed) => seed.name)).toEqual([
      "fx_rates",
    ]);
  });

  it("writing the dbt project needs the whole reach beside models:write, and a builder has it", async () => {
    const narrow = await holding("modeller", ["models:write"], ["model:fct_sales", "raw:*"]);
    const builder = await as("b@example.test", "builder");
    const draft = { tenantId: TENANT, name: "stg_x", sql: "select 1", tests: { columns: {} } };

    const refusal = await refused(() => narrow.models.save({ ...draft, create: true }));

    expect(refusal).toEqual({
      code: "FORBIDDEN",
      facts: {
        reason: "WHOLE_REACH_REQUIRED",
        object: "model:*",
        objects: "model:*",
        tenantId: TENANT,
      },
    });
    expect((await builder.models.save({ ...draft, create: true })).ok).toBe(true);
  });

  it("the lineage leaves out the models a reader does not reach, with their edges", async () => {
    const admin = await as("a@example.test", "admin");
    await admin.models.save({
      tenantId: TENANT,
      name: "fct_sales",
      sql: "select * from {{ ref('fct_costs') }}",
      tests: { columns: {} },
    });
    const sales = await holding("sales", [], ["model:fct_sales"]);

    const graph = await sales.models.lineage({ tenantId: TENANT });
    const whole = await admin.models.lineage({ tenantId: TENANT });

    expect(graph.nodes.map((node) => node.name)).toEqual(["fct_sales"]);
    expect(graph.edges).toEqual([]);
    expect(whole.edges.length).toBe(1);
  });
});

describe("the raw lake", () => {
  it("a role granted one stream pages it, and another stream is an empty page", async () => {
    const reader = await holding("deals_reader", ["lake:read"], ["raw:hubspot/deals"]);

    const deals = await reader.lake.records({
      tenantId: TENANT,
      source: "hubspot",
      entity: "deals",
    });
    const companies = await reader.lake.records({
      tenantId: TENANT,
      source: "hubspot",
      entity: "companies",
    });
    const summary = await reader.lake.summary({ tenantId: TENANT });

    expect(deals.items.map((record) => record.sourceRecordId)).toEqual(["d-1"]);
    expect(companies).toEqual({ items: [], nextCursor: null, ofRun: null });
    expect(summary.records.map((stream) => `${stream.source}/${stream.entity}`)).toEqual([
      "hubspot/deals",
    ]);
  });

  it("a whole source reaches its streams and no other source's", async () => {
    const reader = await holding("hubspot_reader", ["lake:read"], ["raw:hubspot/*"]);

    const summary = await reader.lake.summary({ tenantId: TENANT });

    expect(summary.records.map((stream) => `${stream.source}/${stream.entity}`).sort()).toEqual([
      "hubspot/companies",
      "hubspot/deals",
    ]);
  });

  it("the search is narrowed to the streams the reader reaches, and a builder's is not", async () => {
    const worker = new InMemoryWorkerClient();
    const reader = await holding(
      "searcher",
      ["lake:read"],
      ["raw:hubspot/*", "raw:gmail/messages"],
      worker,
    );
    const builder = await as("b@example.test", "builder", worker);

    await reader.lake.search({ tenantId: TENANT, q: "invoice" });
    await builder.lake.search({ tenantId: TENANT, q: "invoice" });

    expect(worker.searches.map((search) => search.streams)).toEqual([
      [
        { source: "hubspot", entity: null },
        { source: "gmail", entity: "messages" },
      ],
      null,
    ]);
  });

  it("the console needs the whole lake and every model, and a builder's opens", async () => {
    const worker = new InMemoryWorkerClient();
    const reader = await holding("console", ["lake:read"], ["raw:hubspot/deals"], worker);
    const builder = await as("b@example.test", "builder", worker);

    const refusal = await refused(() => reader.lake.query({ tenantId: TENANT, sql: "select 1" }));
    const dq = await refused(() =>
      reader.dq.failures({ tenantId: TENANT, runId: "run-1", uniqueId: "test.x" }),
    );

    expect(refusal).toEqual({
      code: "FORBIDDEN",
      facts: {
        reason: "WHOLE_REACH_REQUIRED",
        object: "model:*",
        objects: "model:*,raw:*",
        tenantId: TENANT,
      },
    });
    expect(dq.code).toBe("FORBIDDEN");
    expect((await builder.lake.query({ tenantId: TENANT, sql: "select 1" })).rows).toEqual([]);
  });
});

describe("reports", () => {
  it("a role granted one question lists, opens and answers it, and the other is not there", async () => {
    const revenue = await saveQuestion("Revenue");
    const costs = await saveQuestion("Costs");
    const worker = new InMemoryWorkerClient();
    const sales = await holding(
      "sales",
      [],
      [`report:question:${revenue}`, "model:fct_sales"],
      worker,
    );

    const listed = await sales.bi.questions.list({ tenantId: TENANT });
    const hidden = await refused(() => sales.bi.questions.get({ tenantId: TENANT, id: costs }));
    const unanswered = await refused(() =>
      sales.bi.questions.answer({ tenantId: TENANT, id: costs }),
    );
    await sales.bi.questions.answer({ tenantId: TENANT, id: revenue });

    expect(Array.isArray(listed) ? listed.map((question) => question.id) : null).toEqual([revenue]);
    expect([hidden.code, unanswered.code]).toEqual(["NOT_FOUND", "NOT_FOUND"]);
    // Answered under the reader's scope: Postgres, not this process, keeps it to fct_sales.
    expect(worker.queries.map((query) => query.scope)).toEqual([{ models: ["fct_sales"] }]);
  });

  it("a built-in's answer reads as the BI login, with no scope", async () => {
    const revenue = await saveQuestion("Revenue");
    const worker = new InMemoryWorkerClient();
    const viewer = await as("v@example.test", "viewer", worker);

    await viewer.bi.questions.answer({ tenantId: TENANT, id: revenue });
    await viewer.bi.schema({ tenantId: TENANT });

    expect(worker.queries.map((query) => query.scope)).toEqual([null]);
    expect(worker.schemaScopes).toEqual([null]);
  });

  it("a dashboard names the tiles a reader may not open, rather than leaving them out", async () => {
    const revenue = await saveQuestion("Revenue");
    const costs = await saveQuestion("Costs");
    const admin = await as("a@example.test", "admin");
    const tile = { x: 0, y: 0, w: 6, h: 4 };
    const { id } = await admin.bi.dashboards.save({
      tenantId: TENANT,
      name: "Board",
      layout: {
        tiles: [
          { questionId: revenue, ...tile },
          { questionId: costs, ...tile, x: 6 },
        ],
      },
      filters: [],
    });
    const sales = await holding(
      "sales",
      [],
      [`report:dashboard:${id}`, `report:question:${revenue}`],
    );
    const outsider = await holding("outsider", [], [`report:question:${revenue}`]);

    const board = await sales.bi.dashboards.get({ tenantId: TENANT, id });

    expect(board.layout.tiles.map((t) => t.questionId)).toEqual([revenue, costs]);
    expect(board.ungranted).toEqual([costs]);
    expect((await admin.bi.dashboards.get({ tenantId: TENANT, id })).ungranted).toEqual([]);
    expect(await outsider.bi.dashboards.list({ tenantId: TENANT })).toEqual([]);
    expect((await refused(() => outsider.bi.dashboards.get({ tenantId: TENANT, id }))).code).toBe(
      "NOT_FOUND",
    );
  });

  it("a reader who reaches only some reports keeps what they make, by a grant to themselves", async () => {
    const author = await holding("author", ["reports:author"], ["model:fct_sales"]);

    const { id } = await author.bi.questions.save({
      tenantId: TENANT,
      name: "Mine",
      definition: QUESTION,
      chart: CHART,
    });

    expect((await author.bi.questions.get({ tenantId: TENANT, id })).name).toBe("Mine");
  });

  it("an export is read under the asker's scope, narrowed to what they still reach", async () => {
    const worker = new InMemoryWorkerClient();
    const sales = await holding(
      "sales",
      ["reports:author"],
      ["model:fct_sales", "model:fct_costs"],
      worker,
    );

    const asked = await sales.bi.exports.create({
      tenantId: TENANT,
      source: { kind: "definition", definition: QUESTION },
    });
    const admin = await as("a@example.test", "admin");
    const grants = await admin.grants.list({ tenantId: TENANT, role: "sales" });
    const costs = grants.find((grant) => grant.object === "model:fct_costs");
    if (costs === undefined) {
      throw new Error("expected the grant on fct_costs");
    }
    await admin.grants.delete({ tenantId: TENANT, id: costs.id });

    const opened = await sales.bi.exports.get({ tenantId: TENANT, id: asked.id });

    expect(opened.scope).toEqual({ models: ["fct_sales"] });
  });
});

describe("object grants under the subset rule", () => {
  it("a role manager grants only what they reach, and a wildcard only if they reach the whole", async () => {
    const manager = await holding("manager", ["roles:manage"], ["model:fct_sales"]);
    await holding("target", [], []);

    const owned = await manager.grants.save({
      tenantId: TENANT,
      role: "target",
      object: "model:fct_sales",
    });
    const beyond = await refused(() =>
      manager.grants.save({ tenantId: TENANT, role: "target", object: "model:fct_costs" }),
    );
    const wildcard = await refused(() =>
      manager.grants.save({ tenantId: TENANT, role: "target", object: "model:*" }),
    );

    expect(owned.unchanged).toBe(false);
    expect([beyond.facts, wildcard.facts]).toEqual([
      {
        reason: "REACH_NOT_HELD",
        object: "model:fct_costs",
        objects: "model:fct_costs",
        tenantId: TENANT,
      },
      { reason: "REACH_NOT_HELD", object: "model:*", objects: "model:*", tenantId: TENANT },
    ]);
  });

  it("nor takes away reading what they do not reach", async () => {
    await holding("target", [], ["model:fct_costs"]);
    const manager = await holding(
      "manager",
      ["roles:manage", "people:manage"],
      ["model:fct_sales"],
    );
    const [grant] = await manager.grants.list({ tenantId: TENANT, role: "target" });
    if (grant === undefined) {
      throw new Error("expected the target's grant");
    }

    const refusal = await refused(() => manager.grants.delete({ tenantId: TENANT, id: grant.id }));

    expect(refusal.code).toBe("FORBIDDEN");
    expect(await manager.grants.list({ tenantId: TENANT, role: "target" })).toHaveLength(1);
  });

  it("cannot make anybody a viewer, who reads every model, while reaching only some", async () => {
    const hr = await holding("hr", ["people:manage"], ["model:fct_sales"]);

    // A viewer holds no permission, so reach alone is what refuses this.
    const refusal = await refused(() =>
      hr.people.invite({ tenantId: TENANT, email: "new@example.test", role: "viewer" }),
    );

    expect(refusal.facts).toMatchObject({ reason: "REACH_NOT_HELD", object: "model:*" });
  });

  it("refuses an object of no shape, and one naming a model the customer does not have", async () => {
    const admin = await as("a@example.test", "admin");
    await holding("target", [], []);

    const shape = await refused(() =>
      admin.grants.save({ tenantId: TENANT, role: "target", object: "model:fct_*" }),
    );
    const missing = await refused(() =>
      admin.grants.save({ tenantId: TENANT, role: "target", object: "model:nope" }),
    );
    const both = await refused(() =>
      admin.grants.save({
        tenantId: TENANT,
        role: "target",
        object: "model:*",
        permission: "lake:read",
      }),
    );

    expect([shape.code, missing.code, both.code]).toEqual([
      "BAD_REQUEST",
      "NOT_FOUND",
      "BAD_REQUEST",
    ]);
  });
});

describe("a grant on something that is gone", () => {
  it("goes with the model it names, so a new model of the same name is not reached", async () => {
    const admin = await as("a@example.test", "admin");
    const sales = await holding("sales", [], ["model:fct_costs"]);
    await db.asSuperuser((tx) =>
      tx.query("DELETE FROM app.model WHERE tenant_id = $1 AND name = 'fct_costs'", [TENANT]),
    );
    await db.asSuperuser((tx) =>
      tx.query(
        "INSERT INTO app.model (tenant_id, name, sql) VALUES ($1, 'fct_costs', 'select 2')",
        [TENANT],
      ),
    );

    expect(await admin.grants.list({ tenantId: TENANT, role: "sales" })).toEqual([]);
    expect((await sales.grants.reach({ tenantId: TENANT })).reach.models).toEqual([]);
  });

  it("projects nothing when it outlived what it names, and its neighbour still holds", async () => {
    const sales = await holding("sales", [], ["model:fct_sales"]);
    // Planted past the cascade, as a grant saved in the instant its model went would be.
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO app.access_grant (tenant_id, subject_kind, role_key, object, action)
         VALUES ($1, 'role', 'sales', 'model:fct_gone', 'read'),
                ($1, 'role', 'sales', 'report:question:00000000-0000-4000-8000-000000000001', 'read')`,
        [TENANT],
      ),
    );

    const { reach } = await sales.grants.reach({ tenantId: TENANT });

    expect(reach.models).toEqual(["fct_sales"]);
    expect(reach.reports).toEqual({ questions: [], dashboards: [] });
  });
});

describe("grants.reach", () => {
  it("answers the caller's own reach, and another's only to a holder of people:manage", async () => {
    const sales = await holding("sales", [], ["model:fct_sales"]);
    const admin = await as("a@example.test", "admin");

    const own = await sales.grants.reach({ tenantId: TENANT });
    const asked = await refused(() => sales.grants.reach({ tenantId: TENANT, role: "admin" }));
    const role = await admin.grants.reach({ tenantId: TENANT, role: "sales" });

    expect(own.reach.models).toEqual(["fct_sales"]);
    expect(asked.facts).toMatchObject({
      reason: "PERMISSION_REQUIRED",
      permission: "people:manage",
    });
    expect(role.reach.models).toEqual(["fct_sales"]);
    expect((await admin.grants.reach({ tenantId: TENANT })).reach).toEqual({
      models: "all",
      raw: "all",
      reports: "all",
    });
  });
});
