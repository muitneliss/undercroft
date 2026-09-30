/**
 * A tenant's own macros over tRPC: who may write one, which definitions are refused outright,
 * why a macro in use cannot be deleted, and that a model calling one is not told it is unknown.
 * ADR 0086.
 *
 * The refusals are the promise worth pinning. A macro named like one dbt or the platform relies
 * on, or a file holding more than the one macro its row shows, would change what the tenant's
 * whole project builds and still build green -- so each is refused before it is stored, in the
 * words `macros.check` uses for it.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { appRouter } from "./router.ts";
import type { Context, Role } from "./trpc.ts";

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

function caller(userId: string, email: string) {
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
    worker: null,
    specReads: new Map(),
    googlePicker: null,
    signInMethods: [],
  };
  return appRouter.createCaller(ctx);
}

async function refusal(fn: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof TRPCError) {
      return { code: error.code, message: error.message };
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

const NORMALISE = {
  tenantId: TENANT,
  name: "normalise_name",
  description: "Upper-cases a name and squeezes its spaces.",
  sql: "{% macro normalise_name(value) %}\n  regexp_replace(upper({{ value }}), '\\s+', ' ', 'g')\n{% endmacro %}\n",
  create: true,
};

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

describe("macros.save", () => {
  it("an admin saves one macro, and any member lists it with what it is for", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const viewer = await seedMember("v@example.test", "viewer");

    await caller(admin, "a@example.test").macros.save(NORMALISE);

    const listed = await caller(viewer, "v@example.test").macros.list({ tenantId: TENANT });
    expect(listed.map((m) => [m.name, m.description, m.params])).toEqual([
      ["normalise_name", "Upper-cases a name and squeezes its spaces.", ["value"]],
    ]);
  });

  it("a member is refused: a macro changes what every model calling it builds", async () => {
    const member = await seedMember("m@example.test", "member");
    const got = await refusal(() => caller(member, "m@example.test").macros.save(NORMALISE));
    expect(got.code).toBe("FORBIDDEN");
  });

  const refused: [string, { name: string; sql: string }, string][] = [
    [
      "a name dbt relies on",
      {
        name: "generate_schema_name",
        sql: "{% macro generate_schema_name(custom_schema_name, node) %}x{% endmacro %}",
      },
      "generate_schema_name is reserved: a macro of that name would silently replace one dbt or the platform relies on. Choose another name.",
    ],
    [
      "a definition named other than its row",
      { name: "normalise_name", sql: "{% macro other_name(value) %}{{ value }}{% endmacro %}" },
      "The definition is named other_name, not the name it is being saved under. Give both the same name.",
    ],
    [
      "a materialization beside the macro",
      {
        name: "normalise_name",
        sql: "{% macro normalise_name(value) %}{{ value }}{% endmacro %}\n{% materialization table, default %}{% endmaterialization %}",
      },
      "A macro may not hold a materialization block. It would change how the whole project builds, not add something a model calls.",
    ],
    [
      // Regression: a block reader that ignored quotes took `%}{#` inside the string as the
      // tag's end and a comment's start, hiding the second macro from the refusal.
      "a reserved macro hidden behind a quoted %}{# in a tag",
      {
        name: "normalise_name",
        sql: '{% macro normalise_name(value) %}{% set a = "%}{#" %}{% endmacro %}\n{% macro generate_schema_name(c, n) %}x{% set b = "#}" %}{{ value }}{% endmacro %}',
      },
      "A macro is exactly one {% macro name(...) %} ... {% endmacro %} block. Nothing may stand outside it but comments, and there is no second block.",
    ],
  ];

  for (const [what, definition, sentence] of refused) {
    it(`refuses ${what}, worded, and stores nothing`, async () => {
      const admin = await seedMember("a@example.test", "admin");

      const got = await refusal(() =>
        caller(admin, "a@example.test").macros.save({ ...NORMALISE, ...definition }),
      );

      expect(got).toEqual({ code: "BAD_REQUEST", message: sentence });
      expect(await caller(admin, "a@example.test").macros.list({ tenantId: TENANT })).toEqual([]);
    });
  }
});

describe("macros.delete", () => {
  it("a macro nothing calls is deleted; one a model calls is refused, naming the model, and stays", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const as = caller(admin, "a@example.test");
    await as.macros.save(NORMALISE);
    await as.macros.save({
      ...NORMALISE,
      name: "unused",
      sql: "{% macro unused() %}1{% endmacro %}",
    });
    await as.models.save({
      tenantId: TENANT,
      name: "stg_names",
      sql: "select {{ normalise_name('name') }} as name",
      tests: { columns: {} },
      create: true,
    });

    await as.macros.delete({ tenantId: TENANT, name: "unused" });
    const got = await refusal(() => as.macros.delete({ tenantId: TENANT, name: "normalise_name" }));

    expect(got).toEqual({
      code: "CONFLICT",
      message:
        "The macro normalise_name was not deleted: it is still called by stg_names. Remove those calls first, then try again.",
    });
    expect((await as.macros.list({ tenantId: TENANT })).map((m) => m.name)).toEqual([
      "normalise_name",
    ]);
  });
});

describe("models.check", () => {
  it("a call to the tenant's own macro is unknown until it is saved, and quiet after", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const as = caller(admin, "a@example.test");
    const draft = {
      tenantId: TENANT,
      name: "stg_names",
      sql: "select {{ normalise_name('name') }} as name",
      tests: { columns: {} },
    };

    const before = await as.models.check(draft);
    await as.macros.save(NORMALISE);
    const after = await as.models.check(draft);

    expect(before.findings.map((f) => [f.code, f.subject])).toEqual([
      ["unknown-macro", "normalise_name"],
    ]);
    expect(after.findings).toEqual([]);
  });
});
