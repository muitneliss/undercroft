/**
 * Content hashes, the project revision and the identical re-save (issue 445, ADR 0127).
 *
 * Every hash is pinned against the bytes Postgres holds, read back here separately: a hash the
 * server computed over anything else would match nothing a client can check. The revision moves
 * on every save that writes and every delete, and holds still on a save that writes nothing --
 * which leaves `updatedAt`, `updatedBy` and the audit log exactly as they were.
 */

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { appRouter } from "./router.ts";
import type { Context } from "./trpc.ts";

const TENANT = "CASE-0042";

/** A list asked no page answers its array (ADR 0133); a page here is the contract broken. */
function whole<T>(answer: T[] | { readonly items: T[] }): T[] {
  if (!Array.isArray(answer)) {
    throw new Error("a page of a list that was asked for no page");
  }
  return answer;
}
/** Non-ASCII on purpose: a hash of UTF-16 or of Latin-1 would differ here. */
const MODEL_SQL = "select 1 as id -- doanh thu theo tháng\n";
const TESTS = { columns: { id: ["not_null" as const] } };
const MACRO_SQL = "{% macro tidy(value) %}\n  trim({{ value }})\n{% endmacro %}\n";
const DESCRIPTION = "Bỏ khoảng trắng thừa.";
const DEFINITION = { kind: "sql" as const, sql: "select 1 as n" };
const CHART = { type: "table" as const, y: [], options: {} };
const SEED = {
  tenantId: TENANT,
  name: "account_groups",
  columns: [
    { name: "code", type: "text" as const },
    { name: "budget", type: "numeric(18,4)" as const },
  ],
  rows: [
    ["511", "1200.5000"],
    ["642", null],
  ],
};
/** A time no save in this suite could stamp: what an untouched row still says. */
const LONG_AGO = "2020-01-01T00:00:00.000Z";

let db: TestDatabase;
let api: ReturnType<typeof appRouter.createCaller>;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function callerFor(userId: string): ReturnType<typeof appRouter.createCaller> {
  const ctx: Context = {
    exec: db,
    user: { userId, email: "a@example.test" },
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
    worker: null,
    specReads: new Map(),
    googlePicker: null,
    signInMethods: [],
    channel: "web",
    publicUrl: null,
    holdOpen: () => undefined,
  };
  return appRouter.createCaller(ctx);
}

/** The audit rows of `action` so far, in order. */
async function audited(action: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM ops.audit_log WHERE tenant_id = $1 AND action = $2",
    [TENANT, action],
  );
  return Number.parseInt(rows[0]?.n ?? "0", 10);
}

/** Back-date a row, as the superuser, so a save that touched it cannot hide inside one ms. */
async function backdate(
  table: "app.model" | "app.macro" | "app.seed",
  name: string,
): Promise<void> {
  await db.asSuperuser((tx) =>
    tx.query(`UPDATE ${table} SET updated_at = $3 WHERE tenant_id = $1 AND name = $2`, [
      TENANT,
      name,
      LONG_AGO,
    ]),
  );
}

async function storedText(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await db.query<{ text: string }>(sql, params);
  return rows[0]?.text ?? "";
}

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.become("undercroft_app");
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ('a@example.test') RETURNING id",
  );
  const admin = rows[0]?.id ?? "";
  await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    TENANT,
    admin,
    "admin",
  ]);
  api = callerFor(admin);
});

afterEach(async () => {
  await db.close();
});

describe("content hashes", () => {
  it("are the SHA-256 of the bytes stored, the same on the list and on get", async () => {
    await api.models.save({ tenantId: TENANT, name: "stg_deals", sql: MODEL_SQL, tests: TESTS });
    await api.macros.save({
      tenantId: TENANT,
      name: "tidy",
      description: DESCRIPTION,
      sql: MACRO_SQL,
    });
    await api.seeds.save(SEED);
    const { id } = await api.bi.questions.save({
      tenantId: TENANT,
      name: "Revenue",
      definition: DEFINITION,
      chart: CHART,
    });

    const model = await api.models.get({ tenantId: TENANT, name: "stg_deals" });
    expect(model.sqlSha256).toBe(sha256(MODEL_SQL));
    expect(model.testsSha256).toBe(
      sha256(
        await storedText("SELECT tests::text AS text FROM app.model WHERE name = $1", [
          "stg_deals",
        ]),
      ),
    );
    expect(whole(await api.models.list({ tenantId: TENANT }))[0]).toMatchObject({
      sqlSha256: model.sqlSha256,
      testsSha256: model.testsSha256,
    });

    const macro = await api.macros.get({ tenantId: TENANT, name: "tidy" });
    expect(macro.sqlSha256).toBe(sha256(MACRO_SQL));
    expect(macro.descriptionSha256).toBe(sha256(DESCRIPTION));
    expect(whole(await api.macros.list({ tenantId: TENANT }))[0]).toMatchObject({
      sqlSha256: macro.sqlSha256,
      descriptionSha256: macro.descriptionSha256,
    });

    // A seed's hash is over its columns and rows together, as Postgres prints them (ADR 0128).
    const seed = await api.seeds.get({ tenantId: TENANT, name: "account_groups" });
    expect(seed.sha256).toBe(
      sha256(
        await storedText(
          "SELECT jsonb_build_array(columns, rows)::text AS text FROM app.seed WHERE name = $1",
          ["account_groups"],
        ),
      ),
    );
    expect((await api.seeds.list({ tenantId: TENANT }))[0]?.sha256).toBe(seed.sha256);

    const question = await api.bi.questions.get({ tenantId: TENANT, id });
    expect(question.definitionSha256).toBe(
      sha256(
        await storedText("SELECT definition::text AS text FROM app.bi_question WHERE id = $1", [
          id,
        ]),
      ),
    );
    expect(whole(await api.bi.questions.list({ tenantId: TENANT }))[0]?.definitionSha256).toBe(
      question.definitionSha256,
    );
  });
});

describe("models.revision", () => {
  it("moves on a create, a real change and a delete of each kind, and holds on an identical re-save", async () => {
    const revisions = [await api.models.revision({ tenantId: TENANT })];
    async function next(): Promise<Awaited<ReturnType<typeof api.models.revision>>> {
      const revision = await api.models.revision({ tenantId: TENANT });
      revisions.push(revision);
      return revision;
    }
    const [empty] = revisions;
    const model = { tenantId: TENANT, name: "stg_deals", sql: MODEL_SQL, tests: TESTS };
    const macro = { tenantId: TENANT, name: "tidy", description: DESCRIPTION, sql: MACRO_SQL };

    await api.models.save(model);
    const withModel = await next();
    expect(withModel.models).not.toBe(empty?.models ?? "");
    await api.models.save(model);
    expect(await next()).toEqual(withModel);
    await api.models.save({ ...model, tests: { columns: {} } });
    const edited = await next();
    expect(edited.models).not.toBe(withModel.models);

    await api.macros.save(macro);
    const withMacro = await next();
    expect(withMacro.macros).not.toBe(edited.macros);
    expect(withMacro.models).toBe(edited.models);
    await api.macros.save(macro);
    expect(await next()).toEqual(withMacro);
    await api.macros.delete({ tenantId: TENANT, name: "tidy" });
    expect((await next()).macros).toBe(empty?.macros ?? "");

    await api.seeds.save(SEED);
    const withSeed = await next();
    expect(withSeed.seeds).not.toBe(empty?.seeds ?? "");
    expect(withSeed.models).toBe(edited.models);
    await api.seeds.save(SEED);
    expect(await next()).toEqual(withSeed);
    await api.seeds.save({ ...SEED, rows: [["511", "1200.5001"]] });
    expect((await next()).seeds).not.toBe(withSeed.seeds);

    const { id } = await api.bi.questions.save({
      tenantId: TENANT,
      name: "Revenue",
      definition: DEFINITION,
      chart: CHART,
    });
    const withQuestion = await next();
    expect(withQuestion.questions).not.toBe(empty?.questions ?? "");
    await api.bi.questions.save({
      tenantId: TENANT,
      id,
      name: "Revenue (net)",
      definition: DEFINITION,
      chart: CHART,
    });
    expect((await next()).questions).not.toBe(withQuestion.questions);
    await api.bi.questions.delete({ tenantId: TENANT, id });
    expect((await next()).questions).toBe(empty?.questions ?? "");

    // The combined revision moved exactly when some part did.
    for (const [index, revision] of revisions.entries()) {
      const before = revisions[index - 1];
      if (before !== undefined) {
        const partsMoved =
          revision.models !== before.models ||
          revision.macros !== before.macros ||
          revision.seeds !== before.seeds ||
          revision.questions !== before.questions;
        expect(revision.revision !== before.revision).toBe(partsMoved);
      }
    }
  });
});

describe("an identical re-save", () => {
  it("of a model answers unchanged, keeps updatedAt and writes no audit row", async () => {
    const model = { tenantId: TENANT, name: "stg_deals", sql: MODEL_SQL, tests: TESTS };
    expect(await api.models.save(model)).toEqual({ ok: true, unchanged: false });
    await backdate("app.model", "stg_deals");
    const rows = await audited("models.save");

    expect(await api.models.save(model)).toEqual({ ok: true, unchanged: true });
    expect((await api.models.get({ tenantId: TENANT, name: "stg_deals" })).updatedAt).toBe(
      LONG_AGO,
    );
    expect(await audited("models.save")).toBe(rows);
  });

  it("is told apart from a real change, which moves updatedAt and is recorded", async () => {
    const model = { tenantId: TENANT, name: "stg_deals", sql: MODEL_SQL, tests: TESTS };
    await api.models.save(model);
    await backdate("app.model", "stg_deals");
    const rows = await audited("models.save");

    expect(await api.models.save({ ...model, tests: { columns: {} } })).toEqual({
      ok: true,
      unchanged: false,
    });
    expect((await api.models.get({ tenantId: TENANT, name: "stg_deals" })).updatedAt).not.toBe(
      LONG_AGO,
    );
    expect(await audited("models.save")).toBe(rows + 1);
  });

  it("of a macro answers unchanged and touches nothing; a new description is a change", async () => {
    const macro = { tenantId: TENANT, name: "tidy", description: DESCRIPTION, sql: MACRO_SQL };
    await api.macros.save(macro);
    await backdate("app.macro", "tidy");
    const rows = await audited("macros.save");

    expect(await api.macros.save(macro)).toEqual({ ok: true, unchanged: true });
    expect((await api.macros.get({ tenantId: TENANT, name: "tidy" })).updatedAt).toBe(LONG_AGO);
    expect(await audited("macros.save")).toBe(rows);

    expect(await api.macros.save({ ...macro, description: "Trims." })).toEqual({
      ok: true,
      unchanged: false,
    });
    expect(await audited("macros.save")).toBe(rows + 1);
  });

  it("of a seed answers unchanged and touches nothing (ADR 0128)", async () => {
    await api.seeds.save(SEED);
    await backdate("app.seed", "account_groups");
    const rows = await audited("seeds.save");

    expect(await api.seeds.save(SEED)).toEqual({ ok: true, unchanged: true });
    expect((await api.seeds.get({ tenantId: TENANT, name: "account_groups" })).updatedAt).toBe(
      LONG_AGO,
    );
    expect(await audited("seeds.save")).toBe(rows);
  });

  it("under create is still refused: the name is taken whatever the text", async () => {
    const model = { tenantId: TENANT, name: "stg_deals", sql: MODEL_SQL, tests: TESTS };
    await api.models.save(model);

    const refused = await api.models
      .save({ ...model, create: true })
      .catch((error: unknown) => error);
    expect(refused instanceof TRPCError ? refused.code : null).toBe("CONFLICT");
  });
});
