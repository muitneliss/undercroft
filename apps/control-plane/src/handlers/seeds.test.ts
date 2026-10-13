/**
 * A tenant's reference tables -- dbt seeds -- over tRPC. ADR 0128.
 *
 * The promises worth pinning are the ones that fail silently when broken: a cell that dbt would
 * load as a different value (a rounded amount, a NULL for an empty string) is refused naming its
 * row and column rather than stored; an amount survives as exactly the text it was written as; a
 * seed and a model never share a name, whichever is saved second; and a seed a model still reads
 * is not deleted from under it.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { MAX_SEED_COLUMNS, MAX_SEED_ROWS } from "@undercroft/contracts";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { InMemoryWorkerClient } from "../services/inMemoryWorkerClient.ts";
import type { WorkerClient } from "../services/workerClient.ts";
import { appRouter } from "./router.ts";
import { type Context, type Role, refusalFacts } from "./trpc.ts";

const TENANT = "CASE-0042";

let db: TestDatabase;

async function seedMember(email: string, role: Role): Promise<string> {
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

function caller(
  userId: string,
  email: string,
  locale: "vi" | "en" = "en",
  worker: WorkerClient | null = null,
) {
  const ctx: Context = {
    exec: db,
    user: { userId, email },
    credentialId: "s1",
    via: "session",
    grant: "write",
    superadmin: false,
    locale,
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

/** The refusal's code, sentence and facts, as an agent at either door receives them. */
async function refusal(
  fn: () => Promise<unknown>,
): Promise<{ code: string; message: string; facts: unknown }> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof TRPCError) {
      return { code: error.code, message: error.message, facts: refusalFacts(error) };
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

/** Accounts mapped to the groups a reviewer chose, with a budget each: a typical seed. */
const GROUPS = {
  tenantId: TENANT,
  name: "account_groups",
  columns: [
    { name: "account_code", type: "text" as const },
    { name: "account_group", type: "text" as const },
    { name: "budget", type: "numeric(18,4)" as const },
    { name: "active", type: "boolean" as const },
  ],
  rows: [
    ["511", "Doanh thu bán hàng", "12345678901234.5678", "true"],
    ["0632", 'Giá vốn, "trực tiếp"', "-0.0001", "false"],
    ["642", "Chi phí quản lý\ndoanh nghiệp", null, null],
  ],
};

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

describe("seeds.save", () => {
  it("an admin saves a table, and any member lists it without cells and reads it back exactly", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const viewer = await seedMember("v@example.test", "viewer");

    expect(await caller(admin, "a@example.test").seeds.save({ ...GROUPS, create: true })).toEqual({
      ok: true,
      unchanged: false,
    });

    const as = caller(viewer, "v@example.test");
    const listed = await as.seeds.list({ tenantId: TENANT });
    expect(listed.map(({ name, columnCount, rowCount }) => [name, columnCount, rowCount])).toEqual([
      ["account_groups", 4, 3],
    ]);
    expect(listed[0]?.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.keys(listed[0] ?? {})).not.toContain("rows");

    const got = await as.seeds.get({ tenantId: TENANT, name: "account_groups" });
    // Every amount is the string it was written as: no float ever held it (money.md). A leading
    // zero, a quote, a line feed and a NULL all come back as they went in.
    expect(got.rows).toEqual(GROUPS.rows);
    expect(got.columns).toEqual(GROUPS.columns);
    expect(got.sha256).toBe(listed[0]?.sha256 ?? "");
  });

  it("a member is refused, and so is a delete: a seed changes what every model reading it builds", async () => {
    const member = await seedMember("m@example.test", "member");
    const as = caller(member, "m@example.test", "en", new InMemoryWorkerClient());
    expect((await refusal(() => as.seeds.save(GROUPS))).code).toBe("FORBIDDEN");
    expect(
      (await refusal(() => as.seeds.delete({ tenantId: TENANT, name: "account_groups" }))).code,
    ).toBe("FORBIDDEN");
  });

  it("a cell its column cannot hold is BAD_REQUEST naming the row and column, worded Vietnamese first", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const rows = [GROUPS.rows[0] ?? [], ["512", "Doanh thu khác", "1.23456", "true"]];

    const vi = await refusal(() =>
      caller(admin, "a@example.test", "vi").seeds.save({ ...GROUPS, rows }),
    );
    const en = await refusal(() => caller(admin, "a@example.test").seeds.save({ ...GROUPS, rows }));

    expect(vi.code).toBe("BAD_REQUEST");
    expect(vi.facts).toEqual({ reason: "too-many-decimals", row: "1", column: "budget" });
    expect(vi.message).toBe(
      "rows[1], cột budget: có hơn 4 chữ số sau dấu chấm, mà numeric(18,4) sẽ làm tròn mất. Hãy gửi tối đa 4 chữ số thập phân.",
    );
    expect(en.facts).toEqual(vi.facts);
    expect(en.message).toContain("rows[1]");
    expect(await caller(admin, "a@example.test").seeds.list({ tenantId: TENANT })).toEqual([]);
  });

  it("an empty text cell is refused, since dbt would load it as NULL; null itself is admitted", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const as = caller(admin, "a@example.test");
    function table(cell: string | null) {
      return { ...GROUPS, rows: [["511", cell, "1", "true"]] };
    }

    const got = await refusal(() => as.seeds.save(table("  ")));

    expect(got.facts).toEqual({ reason: "reads-as-null", row: "0", column: "account_group" });
    expect(await as.seeds.save(table(null))).toEqual({ ok: true, unchanged: false });
  });

  it("holds the row bound at exactly its limit and refuses one row past it", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const as = caller(admin, "a@example.test", "vi");
    function table(count: number) {
      return {
        tenantId: TENANT,
        name: "codes",
        columns: [{ name: "code", type: "integer" as const }],
        rows: Array.from({ length: count }, (_, at) => [String(at)]),
      };
    }

    expect((await as.seeds.save(table(MAX_SEED_ROWS))).ok).toBe(true);
    const got = await refusal(() => as.seeds.save(table(MAX_SEED_ROWS + 1)));

    expect(got.code).toBe("BAD_REQUEST");
    expect(got.facts).toEqual({ reason: "too-many-rows", row: null, column: null });
    expect(got.message).toContain("10.000");
    expect((await as.seeds.get({ tenantId: TENANT, name: "codes" })).rows).toHaveLength(
      MAX_SEED_ROWS,
    );
  });

  it("refuses a table past the column bound, past one megabyte, or with a column named twice", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const as = caller(admin, "a@example.test");
    const wide = Array.from({ length: MAX_SEED_COLUMNS + 1 }, (_, at) => ({
      name: `c${String(at)}`,
      type: "text" as const,
    }));
    const big = Array.from({ length: 9000 }, (_, at) => [String(at), "x".repeat(120)]);
    const twoColumns = [
      { name: "code", type: "text" as const },
      { name: "label", type: "text" as const },
    ];

    const reasons = [
      await refusal(() => as.seeds.save({ tenantId: TENANT, name: "t", columns: wide, rows: [] })),
      await refusal(() =>
        as.seeds.save({ tenantId: TENANT, name: "t", columns: twoColumns, rows: big }),
      ),
      await refusal(() =>
        as.seeds.save({
          tenantId: TENANT,
          name: "t",
          columns: [
            twoColumns[0] ?? { name: "code", type: "text" },
            { name: "code", type: "date" },
          ],
          rows: [],
        }),
      ),
    ].map((got) => got.facts);

    expect(reasons).toEqual([
      { reason: "too-many-columns", row: null, column: null },
      { reason: "too-large", row: null, column: null },
      { reason: "duplicate-column", row: null, column: "code" },
    ]);
  });

  it("an identical re-save answers unchanged and writes no audit row; a changed cell is recorded by name", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const as = caller(admin, "a@example.test");
    async function trail(): Promise<unknown[]> {
      const { rows } = await db.query<{ detail: unknown }>(
        "SELECT detail FROM ops.audit_log WHERE tenant_id = $1 AND action = 'seeds.save' ORDER BY id",
        [TENANT],
      );
      return rows.map((row) => row.detail);
    }
    await as.seeds.save(GROUPS);
    const before = await as.seeds.get({ tenantId: TENANT, name: "account_groups" });

    expect(await as.seeds.save(GROUPS)).toEqual({ ok: true, unchanged: true });
    expect((await as.seeds.get({ tenantId: TENANT, name: "account_groups" })).sha256).toBe(
      before.sha256,
    );
    expect(await trail()).toHaveLength(1);

    const edited = {
      ...GROUPS,
      rows: [...GROUPS.rows.slice(0, 2), ["642", "Chi phí", null, null]],
    };
    expect(await as.seeds.save(edited)).toEqual({ ok: true, unchanged: false });
    expect((await as.seeds.get({ tenantId: TENANT, name: "account_groups" })).sha256).not.toBe(
      before.sha256,
    );
    // The seed's name, never a cell of it: the cells are in the table.
    expect(await trail()).toEqual([
      { name: "account_groups", created: false },
      { name: "account_groups", created: false },
    ]);
  });

  it("a taken name under create is a CONFLICT, and the stored table is untouched", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const as = caller(admin, "a@example.test");
    await as.seeds.save({ ...GROUPS, create: true });

    const got = await refusal(() => as.seeds.save({ ...GROUPS, rows: [], create: true }));

    expect(got.code).toBe("CONFLICT");
    expect((await as.seeds.get({ tenantId: TENANT, name: "account_groups" })).rows).toHaveLength(3);
  });
});

describe("a seed and a model never share a name", () => {
  it("a seed may not take a model's name", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const as = caller(admin, "a@example.test");
    await as.models.save({
      tenantId: TENANT,
      name: "account_groups",
      sql: "select 1 as id",
      tests: { columns: {} },
    });

    const got = await refusal(() => as.seeds.save(GROUPS));

    expect(got.code).toBe("CONFLICT");
    expect(got.message).toContain("A model named account_groups already exists");
    expect(await as.seeds.list({ tenantId: TENANT })).toEqual([]);
  });

  it("a model may not take a seed's name, and one of another name is saved", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const as = caller(admin, "a@example.test");
    await as.seeds.save(GROUPS);
    const model = { tenantId: TENANT, sql: "select 1 as id", tests: { columns: {} } };

    const got = await refusal(() => as.models.save({ ...model, name: "account_groups" }));

    expect(got.code).toBe("CONFLICT");
    expect(got.message).toContain("A reference table (seed) named account_groups already exists");
    expect(await as.models.save({ ...model, name: "stg_accounts" })).toEqual({
      ok: true,
      unchanged: false,
    });
  });
});

describe("a model reading a seed", () => {
  const READS = {
    tenantId: TENANT,
    name: "stg_accounts",
    sql: "select account_code, account_group from {{ ref('account_groups') }}",
    tests: { columns: {} },
  };

  it("is told of no unknown ref once the seed is saved, and draws it as a seed node", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const as = caller(admin, "a@example.test");

    const before = await as.models.check(READS);
    await as.seeds.save(GROUPS);
    const after = await as.models.check(READS);
    await as.models.save(READS);
    const graph = await as.models.lineage({ tenantId: TENANT, name: "account_groups" });

    expect(before.findings.map((f) => [f.code, f.subject])).toEqual([
      ["unknown-ref", "account_groups"],
    ]);
    expect(after.findings).toEqual([]);
    expect(graph.nodes.map((node) => [node.kind, node.name])).toEqual([
      ["seed", "account_groups"],
      ["model", "stg_accounts"],
    ]);
    expect(graph.edges).toEqual([
      { from: "seed:account_groups", to: "model:stg_accounts", via: null },
    ]);
  });

  it("may declare a relationships test to the seed (ADR 0130), refused while there is none", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const as = caller(admin, "a@example.test");
    const tested = {
      ...READS,
      tests: {
        columns: {
          account_code: [
            { kind: "relationships" as const, to: "account_groups", field: "account_code" },
          ],
        },
      },
    };

    expect((await refusal(() => as.models.save(tested))).code).toBe("BAD_REQUEST");
    await as.seeds.save(GROUPS);
    expect((await as.models.save(tested)).ok).toBe(true);
  });
});

describe("seeds.delete", () => {
  it("is refused naming the models that ref() it, and nothing is dropped", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient();
    const as = caller(admin, "a@example.test", "en", worker);
    await as.seeds.save(GROUPS);
    await as.models.save({
      tenantId: TENANT,
      name: "stg_accounts",
      sql: "select * from {{ ref('account_groups') }}",
      tests: { columns: {} },
    });

    const got = await refusal(() => as.seeds.delete({ tenantId: TENANT, name: "account_groups" }));

    expect(got).toMatchObject({
      code: "CONFLICT",
      message:
        "The reference table account_groups was not deleted: stg_accounts still read it. Change them so they no longer read account_groups, then try again.",
    });
    expect(worker.dropped).toEqual([]);
    expect((await as.seeds.list({ tenantId: TENANT })).map((s) => s.name)).toEqual([
      "account_groups",
    ]);
  });

  it("is refused while only a model's relationships test names it: dbt compiles every test", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient();
    const as = caller(admin, "a@example.test", "en", worker);
    await as.seeds.save(GROUPS);
    await as.models.save({
      tenantId: TENANT,
      name: "stg_ledger",
      sql: "select '511' as account_code",
      tests: {
        columns: {
          account_code: [{ kind: "relationships", to: "account_groups", field: "account_code" }],
        },
      },
    });

    const got = await refusal(() => as.seeds.delete({ tenantId: TENANT, name: "account_groups" }));

    expect(got.code).toBe("CONFLICT");
    expect(got.message).toContain("stg_ledger still read it");
    expect(worker.dropped).toEqual([]);
  });

  it("drops the loaded table through the worker, then removes the row", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient();
    const as = caller(admin, "a@example.test", "en", worker);
    await as.seeds.save(GROUPS);

    expect(await as.seeds.delete({ tenantId: TENANT, name: "account_groups" })).toEqual({
      ok: true,
    });

    expect(worker.dropped).toEqual([{ tenantId: TENANT, seed: "account_groups" }]);
    expect(await as.seeds.list({ tenantId: TENANT })).toEqual([]);
  });

  it("keeps the row when the worker could not drop the table, or there is no worker", async () => {
    const admin = await seedMember("a@example.test", "admin");
    await caller(admin, "a@example.test").seeds.save(GROUPS);
    const failing = new InMemoryWorkerClient().failing("unreachable");

    const unreached = await refusal(() =>
      caller(admin, "a@example.test", "en", failing).seeds.delete({
        tenantId: TENANT,
        name: "account_groups",
      }),
    );
    const workerless = await refusal(() =>
      caller(admin, "a@example.test").seeds.delete({ tenantId: TENANT, name: "account_groups" }),
    );

    expect([unreached.code, workerless.code]).toEqual([
      "PRECONDITION_FAILED",
      "PRECONDITION_FAILED",
    ]);
    expect(
      (await caller(admin, "a@example.test").seeds.list({ tenantId: TENANT })).map((s) => s.name),
    ).toEqual(["account_groups"]);
  });
});
