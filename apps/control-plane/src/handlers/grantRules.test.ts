/**
 * Row and column rules on model grants (ADR 0143), through the real router against PGlite: what a
 * grant may say, the subset rule over how much of a model it gives, how grants add up, what
 * `scopes.preview` answers and who may ask it, and what a narrowed reader is told -- a model's
 * columns without the hidden ones, an answer that says its total is partial, a refused column
 * named. That the database enforces the rows and the columns is `packages/db/src/scopeLogins.test.ts`
 * and the Docker tier's.
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
const SALES = { column: "dept", op: "eq" as const, values: ["Sales"] };
const SUPPORT = { column: "dept", op: "eq" as const, values: ["Support"] };
const QUESTION = { kind: "sql" as const, sql: "select sum(amount) from fct_sales" };

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.query(
    `INSERT INTO app.model (tenant_id, name, sql, columns, tests) VALUES
       ($1, 'fct_sales', 'select 1', '["dept", "amount", "salary"]',
        '{"columns": {"dept": ["not_null"], "salary": ["not_null"]}}'),
       ($1, 'fct_costs', 'select 1', '["dept", "cost"]', '{"columns": {}}'),
       ($1, 'fct_new', 'select 1', '[]', '{"columns": {}}')`,
    [TENANT],
  );
  await db.query(
    `INSERT INTO ops.run (id, tenant_id, source, verb, trigger, status, ended_at)
     VALUES ('run-built', $1, '*', 'transform', 'schedule', 'ok', now())`,
    [TENANT],
  );
  await db.exec(
    `INSERT INTO ops.run_step (run_id, unique_id, kind, name, status) VALUES
       ('run-built', 'model.p.fct_sales', 'model', 'fct_sales', 'success'),
       ('run-built', 'model.p.fct_costs', 'model', 'fct_costs', 'success')`,
  );
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

/** A customer's own role holding `permissions`, defined by `admin`. */
async function defineRole(
  admin: ReturnType<typeof caller>,
  key: string,
  permissions: Permission[] = [],
): Promise<void> {
  await admin.roles.save({ tenantId: TENANT, key, label: key, permissions, create: true });
}

describe("what a rule may say, at grants.save", () => {
  it("is refused for a column the model's last build did not find, and saved for one it did", async () => {
    const admin = await as("admin@example.test", "admin");
    await defineRole(admin, "sales");

    const unknown = await refused(() =>
      admin.grants.save({
        tenantId: TENANT,
        role: "sales",
        object: "model:fct_sales",
        rowRule: [{ column: "region", op: "eq", values: ["north"] }],
      }),
    );
    const hiddenUnknown = await refused(() =>
      admin.grants.save({
        tenantId: TENANT,
        role: "sales",
        object: "model:fct_sales",
        hiddenColumns: ["wage"],
      }),
    );
    const saved = await admin.grants.save({
      tenantId: TENANT,
      role: "sales",
      object: "model:fct_sales",
      rowRule: [SALES],
      hiddenColumns: ["salary"],
    });

    expect(unknown).toEqual({
      code: "BAD_REQUEST",
      facts: { reason: "COLUMN_NOT_FOUND", model: "fct_sales", columns: "region" },
    });
    expect(hiddenUnknown.facts).toEqual({
      reason: "COLUMN_NOT_FOUND",
      model: "fct_sales",
      columns: "wage",
    });
    const listed = await admin.grants.list({ tenantId: TENANT, role: "sales" });
    expect(listed.map((grant) => [grant.id, grant.rowRule, grant.hiddenColumns])).toEqual([
      [saved.id, [SALES], ["salary"]],
    ]);
  });

  it("is refused on model:*, on a permission and on a model never built, and for an eq of two values", async () => {
    const admin = await as("admin@example.test", "admin");
    await defineRole(admin, "sales");

    const wildcard = await refused(() =>
      admin.grants.save({ tenantId: TENANT, role: "sales", object: "model:*", rowRule: [SALES] }),
    );
    const permission = await refused(() =>
      admin.grants.save({
        tenantId: TENANT,
        role: "sales",
        permission: "lake:read",
        hiddenColumns: ["salary"],
      }),
    );
    const unbuilt = await refused(() =>
      admin.grants.save({
        tenantId: TENANT,
        role: "sales",
        object: "model:fct_new",
        rowRule: [SALES],
      }),
    );
    const eqOfTwo = await refused(() =>
      admin.grants.save({
        tenantId: TENANT,
        role: "sales",
        object: "model:fct_sales",
        rowRule: [{ column: "dept", op: "eq", values: ["Sales", "Support"] }],
      }),
    );

    expect([wildcard.facts, permission.facts]).toEqual([
      { reason: "RULES_NEED_ONE_MODEL" },
      { reason: "RULES_NEED_ONE_MODEL" },
    ]);
    expect(unbuilt.facts).toEqual({
      reason: "COLUMN_NOT_FOUND",
      model: "fct_new",
      columns: "dept",
    });
    expect(eqOfTwo.facts).toEqual({ reason: "RULE_SHAPE" });
  });

  it("replaces a grant's rules when it is saved again, and is unchanged when they are the same", async () => {
    const admin = await as("admin@example.test", "admin");
    await defineRole(admin, "sales");
    const first = await admin.grants.save({
      tenantId: TENANT,
      role: "sales",
      object: "model:fct_sales",
      rowRule: [SALES],
    });

    const same = await admin.grants.save({
      tenantId: TENANT,
      role: "sales",
      object: "model:fct_sales",
      rowRule: [SALES],
    });
    const widened = await admin.grants.save({
      tenantId: TENANT,
      role: "sales",
      object: "model:fct_sales",
    });

    expect(same).toEqual({ id: first.id, unchanged: true });
    expect(widened).toEqual({ id: first.id, unchanged: false });
    const [grant] = await admin.grants.list({ tenantId: TENANT, role: "sales" });
    expect([grant?.rowRule, grant?.hiddenColumns]).toEqual([null, null]);
  });
});

describe("the subset rule over how much of a model a grant gives", () => {
  /** A holder of roles:manage who reads Sales's rows of fct_sales, and not its salary column. */
  async function lead() {
    const admin = await as("admin@example.test", "admin");
    await defineRole(admin, "lead", ["roles:manage"]);
    await defineRole(admin, "team");
    await admin.grants.save({
      tenantId: TENANT,
      role: "lead",
      object: "model:fct_sales",
      rowRule: [SALES],
      hiddenColumns: ["salary"],
    });
    return { admin, lead: await as("lead@example.test", "lead") };
  }

  it("lets a narrowed reader give a rule at least as narrow as their own", async () => {
    const { lead: narrowed } = await lead();

    const narrower = await narrowed.grants.save({
      tenantId: TENANT,
      role: "team",
      object: "model:fct_sales",
      rowRule: [SALES, { column: "amount", op: "in", values: ["1", "2"] }],
      hiddenColumns: ["salary", "amount"],
    });

    expect(narrower.unchanged).toBe(false);
  });

  it("refuses them more rows, every row, or a column they cannot see", async () => {
    const { lead: narrowed } = await lead();

    const wider = await refused(() =>
      narrowed.grants.save({
        tenantId: TENANT,
        role: "team",
        object: "model:fct_sales",
        rowRule: [{ column: "dept", op: "in", values: ["Sales", "Support"] }],
        hiddenColumns: ["salary"],
      }),
    );
    const everyRow = await refused(() =>
      narrowed.grants.save({
        tenantId: TENANT,
        role: "team",
        object: "model:fct_sales",
        hiddenColumns: ["salary"],
      }),
    );
    const salary = await refused(() =>
      narrowed.grants.save({
        tenantId: TENANT,
        role: "team",
        object: "model:fct_sales",
        rowRule: [SALES],
      }),
    );

    for (const refusal of [wider, everyRow, salary]) {
      expect(refusal).toEqual({
        code: "FORBIDDEN",
        facts: {
          reason: "REACH_NOT_HELD",
          object: "model:fct_sales",
          objects: "model:fct_sales",
          tenantId: TENANT,
        },
      });
    }
  });

  it("refuses them taking away, or replacing, a grant of more than they read", async () => {
    const { admin, lead: narrowed } = await lead();
    const whole = await admin.grants.save({
      tenantId: TENANT,
      role: "team",
      object: "model:fct_sales",
    });

    const replaced = await refused(() =>
      narrowed.grants.save({
        tenantId: TENANT,
        role: "team",
        object: "model:fct_sales",
        rowRule: [SALES],
        hiddenColumns: ["salary"],
      }),
    );
    const removed = await refused(() => narrowed.grants.delete({ tenantId: TENANT, id: whole.id }));

    expect([replaced.code, removed.code]).toEqual(["FORBIDDEN", "FORBIDDEN"]);
  });
});

describe("how grants on one model add up", () => {
  it("is every row when the person's own grant has no rule, whatever their role's says", async () => {
    const admin = await as("admin@example.test", "admin");
    await defineRole(admin, "sales", ["reports:author"]);
    await admin.grants.save({
      tenantId: TENANT,
      role: "sales",
      object: "model:fct_sales",
      rowRule: [SALES],
      hiddenColumns: ["salary"],
    });
    const worker = new InMemoryWorkerClient();
    const lan = await as("lan@example.test", "sales", worker);
    await admin.grants.save({
      tenantId: TENANT,
      email: "lan@example.test",
      object: "model:fct_sales",
    });

    const seen = await lan.scopes.preview({ tenantId: TENANT });
    await lan.bi.answer({ tenantId: TENANT, definition: QUESTION });

    expect(seen.models.reached).toEqual([
      { name: "fct_sales", kind: "model", rows: null, hidden: [], broken: null },
    ]);
    expect(worker.queries.map((query) => query.scope)).toEqual([
      { models: ["fct_sales"], limits: [] },
    ]);
  });

  it("ORs two rules, and hides only what both hide", async () => {
    const admin = await as("admin@example.test", "admin");
    await defineRole(admin, "sales", ["reports:author"]);
    await admin.grants.save({
      tenantId: TENANT,
      role: "sales",
      object: "model:fct_sales",
      rowRule: [SALES],
      hiddenColumns: ["amount", "salary"],
    });
    const worker = new InMemoryWorkerClient();
    const lan = await as("lan@example.test", "sales", worker);
    await admin.grants.save({
      tenantId: TENANT,
      email: "lan@example.test",
      object: "model:fct_sales",
      rowRule: [SUPPORT],
      hiddenColumns: ["salary"],
    });

    await lan.bi.answer({ tenantId: TENANT, definition: QUESTION });

    expect(worker.queries.map((query) => query.scope)).toEqual([
      {
        models: ["fct_sales"],
        limits: [{ model: "fct_sales", rows: [[SALES], [SUPPORT]], hidden: ["salary"] }],
      },
    ]);
  });

  it("never narrows a built-in role, which reads every model whole", async () => {
    const admin = await as("admin@example.test", "admin");
    await as("viewer@example.test", "viewer");
    await admin.grants.save({
      tenantId: TENANT,
      role: "viewer",
      object: "model:fct_sales",
      rowRule: [SALES],
    });

    const seen = await admin.scopes.preview({ tenantId: TENANT, role: "viewer" });

    expect(seen.models.whole).toBe(true);
    expect(seen.models.reached.every((model) => model.rows === null)).toBe(true);
  });
});

describe("scopes.preview", () => {
  it("answers what a role sees, model by model, out of how many", async () => {
    const admin = await as("admin@example.test", "admin");
    await defineRole(admin, "sales");
    await admin.grants.save({
      tenantId: TENANT,
      role: "sales",
      object: "model:fct_sales",
      rowRule: [SALES],
      hiddenColumns: ["salary"],
    });
    await admin.grants.save({ tenantId: TENANT, role: "sales", object: "raw:hubspot/deals" });

    const seen = await admin.scopes.preview({ tenantId: TENANT, role: "sales" });

    expect(seen).toEqual({
      permissions: [],
      models: {
        whole: false,
        total: 3,
        reached: [
          { name: "fct_sales", kind: "model", rows: [[SALES]], hidden: ["salary"], broken: null },
        ],
      },
      raw: { sources: [], streams: [{ source: "hubspot", entity: "deals" }] },
      reports: { questions: [], dashboards: [] },
    });
  });

  it("is anyone's to ask about themselves, and needs people:manage about anyone else", async () => {
    const admin = await as("admin@example.test", "admin");
    await defineRole(admin, "sales");
    const lan = await as("lan@example.test", "sales");
    await as("minh@example.test", "sales");

    const own = await lan.scopes.preview({ tenantId: TENANT });
    const other = await refused(() =>
      lan.scopes.preview({ tenantId: TENANT, email: "minh@example.test" }),
    );
    const aRole = await refused(() => lan.scopes.preview({ tenantId: TENANT, role: "sales" }));
    const byAdmin = await admin.scopes.preview({ tenantId: TENANT, email: "minh@example.test" });

    expect(own.models.reached).toEqual([]);
    expect([other.code, aRole.code]).toEqual(["FORBIDDEN", "FORBIDDEN"]);
    expect(other.facts).toMatchObject({
      reason: "PERMISSION_REQUIRED",
      permission: "people:manage",
    });
    expect(byAdmin.models.reached).toEqual([]);
  });

  it("names a rule that no longer compiles against the published table, which shows no row", async () => {
    await db.asSuperuser(async (su) => {
      await su.query("SELECT ops.provision_tenant($1)", [TENANT]);
      await su.exec("SET ROLE undercroft_dbt_case_0042");
      await su.exec(
        "CREATE TABLE analytics_case_0042.fct_sales AS SELECT 'Sales'::text AS dept, 1 AS amount",
      );
      await su.exec("RESET ROLE");
    });
    const admin = await as("admin@example.test", "admin");
    await defineRole(admin, "sales");
    // The last build recorded a column the table now standing does not have.
    await admin.grants.save({
      tenantId: TENANT,
      role: "sales",
      object: "model:fct_sales",
      rowRule: [{ column: "salary", op: "eq", values: ["1"] }],
    });
    await admin.grants.save({
      tenantId: TENANT,
      role: "sales",
      object: "model:fct_costs",
      rowRule: [SALES],
    });

    const seen = await admin.scopes.preview({ tenantId: TENANT, role: "sales" });

    expect(seen.models.reached.map((model) => [model.name, model.broken])).toEqual([
      // Nothing of fct_costs is published, so nothing of it can be broken.
      ["fct_costs", null],
      ["fct_sales", { fault: "column-missing", columns: ["salary"] }],
    ]);
  });
});

describe("what a narrowed reader is told", () => {
  async function staff(worker: WorkerClient | null = null) {
    const admin = await as("admin@example.test", "admin");
    // `models:read` for the model's own reads, `reports:author` for its answers (ADR 0146).
    await defineRole(admin, "staff", ["reports:author", "models:read"]);
    await admin.grants.save({
      tenantId: TENANT,
      role: "staff",
      object: "model:fct_sales",
      rowRule: [SALES],
      hiddenColumns: ["salary"],
    });
    await admin.grants.save({ tenantId: TENANT, role: "staff", object: "model:fct_costs" });
    return as("staff@example.test", "staff", worker);
  }

  it("lists and reads a model without the columns hidden from them", async () => {
    const reader = await staff();

    const detail = await reader.models.get({ tenantId: TENANT, name: "fct_sales" });
    const listed = await reader.models.list({ tenantId: TENANT, include: ["columns"] });
    const whole = await reader.models.get({ tenantId: TENANT, name: "fct_costs" });
    const byAdmin = await (await as("admin2@example.test", "admin")).models.get({
      tenantId: TENANT,
      name: "fct_sales",
    });

    expect([detail.lastBuild?.columns, detail.lastBuild?.columnCount]).toEqual([
      ["dept", "amount"],
      2,
    ]);
    expect(Object.keys(detail.tests.columns)).toEqual(["dept"]);
    const items = Array.isArray(listed) ? listed : listed.items;
    expect(items.map((item) => [item.name, item.lastBuild?.columns])).toEqual([
      ["fct_costs", ["dept", "cost"]],
      ["fct_sales", ["dept", "amount"]],
    ]);
    expect(whole.lastBuild?.columns).toEqual(["dept", "cost"]);
    expect(byAdmin.lastBuild?.columns).toEqual(["dept", "amount", "salary"]);
  });

  it("is told an answer over a row-limited table is partial, and not over a whole one", async () => {
    const worker = new InMemoryWorkerClient().answering({
      columns: [{ name: "sum", type: "numeric" }],
      rows: [["10.00"]],
      truncated: false,
      relations: ["fct_sales", "fct_costs"],
    });
    const reader = await staff(worker);
    const admin = await as("admin2@example.test", "admin", worker);

    const narrowed = await reader.bi.answer({ tenantId: TENANT, definition: QUESTION });
    const unlimited = await admin.bi.answer({ tenantId: TENANT, definition: QUESTION });

    expect(narrowed.rowsLimited).toEqual(["fct_sales"]);
    expect(unlimited.rowsLimited).toEqual([]);
    expect(worker.queries.map((query) => query.scope?.limits ?? null)).toEqual([
      [{ model: "fct_sales", rows: [[SALES]], hidden: ["salary"] }],
      null,
    ]);
  });

  it("is told which columns a refused query asked for, and nothing of a table they do not reach", async () => {
    const hidden = await staff(
      new InMemoryWorkerClient().refusingQueries("permission denied for table fct_sales"),
    );
    const elsewhere = await as(
      "other@example.test",
      "staff",
      new InMemoryWorkerClient().refusingQueries("permission denied for table fct_secret"),
    );

    const column = await refused(() =>
      hidden.bi.answer({ tenantId: TENANT, definition: QUESTION }),
    );
    const table = await refused(() =>
      elsewhere.bi.answer({ tenantId: TENANT, definition: QUESTION }),
    );

    expect(column).toEqual({
      code: "BAD_REQUEST",
      facts: { reason: "COLUMN_NOT_GRANTED", model: "fct_sales", columns: "salary" },
    });
    expect(table).toEqual({ code: "BAD_REQUEST", facts: null });
  });
});

describe("an export under rules", () => {
  it("downloads under the rules it was asked under, joined with the ones in force now", async () => {
    const admin = await as("admin@example.test", "admin");
    await defineRole(admin, "staff", ["reports:author"]);
    const rule = await admin.grants.save({
      tenantId: TENANT,
      role: "staff",
      object: "model:fct_sales",
      rowRule: [SALES],
      hiddenColumns: ["salary"],
    });
    const worker = new InMemoryWorkerClient();
    const reader = await as("staff@example.test", "staff", worker);
    const asked = await reader.bi.exports.create({
      tenantId: TENANT,
      source: { kind: "definition", definition: QUESTION },
    });

    // Widened after the export was asked: every row, and salary no longer hidden.
    await admin.grants.save({ tenantId: TENANT, role: "staff", object: "model:fct_sales" });
    const widened = await reader.bi.exports.get({ tenantId: TENANT, id: asked.id });
    // Narrowed after it was asked: Support's rows only, amount hidden as well.
    await admin.grants.save({
      tenantId: TENANT,
      role: "staff",
      object: "model:fct_sales",
      rowRule: [SUPPORT],
      hiddenColumns: ["amount"],
    });
    const narrowed = await reader.bi.exports.get({ tenantId: TENANT, id: asked.id });

    expect(rule.unchanged).toBe(false);
    expect(widened.scope).toEqual({
      models: ["fct_sales"],
      limits: [{ model: "fct_sales", rows: [[SALES]], hidden: ["salary"] }],
    });
    expect(narrowed.scope).toEqual({
      models: ["fct_sales"],
      limits: [{ model: "fct_sales", rows: [[SALES, SUPPORT]], hidden: ["amount", "salary"] }],
    });
  });
});
