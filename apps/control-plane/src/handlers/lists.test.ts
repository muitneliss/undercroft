/**
 * Lists answer summaries, and a body only when asked (issue 444, ADR 0127).
 *
 * Through the router, as an agent reaches them: each list leaves out what it used to carry --
 * a question's SQL, a connection's every chosen name, a build's columns, a macro's definition
 * -- and `include` brings exactly that back. `names` and `match` narrow every list by one rule,
 * and a name nothing carries is refused, never answered with a shorter list.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import {
  closeRun,
  openRun,
  recordSteps,
  setModelColumns,
  upsertConnection,
  writeConnectionDetail,
} from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { appRouter } from "./router.ts";
import { type Context, type RefusalFacts, refusalFacts } from "./trpc.ts";

const TENANT = "CASE-0042";
const SQL_QUESTION = { kind: "sql" as const, sql: "select 1 as n" };
const BAR = { type: "bar" as const, x: "n", y: ["n"], options: {} };
const MACRO_SQL = "{% macro tidy(value) %}\n  trim({{ value }})\n{% endmacro %}\n";

/** A list asked no page answers its array (ADR 0133); a page here is the contract broken. */
function whole<T>(answer: T[] | { readonly items: T[] }): T[] {
  if (!Array.isArray(answer)) {
    throw new Error("a page of a list that was asked for no page");
  }
  return answer;
}

let db: TestDatabase;
let api: ReturnType<typeof appRouter.createCaller>;

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

async function refusal(
  fn: () => Promise<unknown>,
): Promise<{ code: string; facts: RefusalFacts | null }> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof TRPCError) {
      return { code: error.code, facts: refusalFacts(error) };
    }
    throw error;
  }
  throw new Error("expected a refusal");
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

/** A model built once, successfully, finding `columns`: written as the worker writes it. */
async function builtModel(name: string, columns: readonly string[]): Promise<void> {
  await api.models.save({ tenantId: TENANT, name, sql: "select 1 as id", tests: { columns: {} } });
  await db.asSuperuser(async (tx) => {
    await openRun(tx, {
      id: `t-${name}`,
      tenantId: TENANT,
      source: "*",
      verb: "transform",
      trigger: "build",
    });
    await recordSteps(tx, `t-${name}`, [
      {
        uniqueId: `model.t.${name}`,
        kind: "model",
        name,
        status: "success",
        failures: null,
        relation: null,
        message: null,
        executionMs: 1,
      },
    ]);
    await closeRun(tx, `t-${name}`, { status: "ok" });
    await setModelColumns(tx, TENANT, name, columns);
  });
}

describe("models.list", () => {
  it("counts a build's columns, and lists them only when asked", async () => {
    await builtModel("stg_deals", ["deal_id", "amount"]);

    const [summary] = whole(await api.models.list({ tenantId: TENANT }));
    expect(summary?.lastBuild).toMatchObject({ status: "success", columnCount: 2 });
    expect(summary?.lastBuild).not.toHaveProperty("columns");

    const [full] = whole(await api.models.list({ tenantId: TENANT, include: ["columns"] }));
    expect(full?.lastBuild?.columns).toEqual(["deal_id", "amount"]);
  });
});

describe("bi.questions.list", () => {
  it("answers a summary with no SQL, and the definition and chart in full when asked", async () => {
    const { id } = await api.bi.questions.save({
      tenantId: TENANT,
      name: "Revenue",
      definition: SQL_QUESTION,
      chart: BAR,
    });

    const [summary] = whole(await api.bi.questions.list({ tenantId: TENANT }));
    expect(summary).toMatchObject({ id, name: "Revenue", kind: "sql", chartType: "bar" });
    expect(summary).not.toHaveProperty("definition");
    expect(summary).not.toHaveProperty("chart");

    const [full] = whole(
      await api.bi.questions.list({ tenantId: TENANT, include: ["definition", "chart"] }),
    );
    expect(full).toEqual(await api.bi.questions.get({ tenantId: TENANT, id }));
  });
});

describe("connections.list", () => {
  it("counts what a scope chose, and names it only when asked for the config", async () => {
    await upsertConnection(db, { tenantId: TENANT, source: "hubspot", status: "connected" });
    await writeConnectionDetail(db, {
      tenantId: TENANT,
      source: "hubspot",
      selectionJson: JSON.stringify({ properties: { deals: ["amount", "stage"] } }),
    });

    const summary = (await api.connections.list({ tenantId: TENANT })).find(
      (card) => card.source === "hubspot",
    );
    expect(summary?.chosen).toEqual({
      labels: null,
      folders: null,
      files: null,
      entities: null,
      properties: { deals: 2 },
    });
    expect(summary).not.toHaveProperty("config");

    const full = (await api.connections.list({ tenantId: TENANT, include: ["config"] })).find(
      (card) => card.source === "hubspot",
    );
    expect(full?.config).toEqual({ properties: { deals: ["amount", "stage"] } });
  });

  it("counts nothing for a source with no readable scope recorded: unknown is not zero", async () => {
    const xero = (await api.connections.list({ tenantId: TENANT })).find(
      (card) => card.source === "xero",
    );
    expect(xero?.chosen).toBeNull();
  });
});

describe("macros.list", () => {
  it("answers each macro without its definition, which get carries", async () => {
    await api.macros.save({
      tenantId: TENANT,
      name: "tidy",
      description: "Trims a value.",
      sql: MACRO_SQL,
    });

    const [listed] = whole(await api.macros.list({ tenantId: TENANT }));
    expect(listed).toMatchObject({ name: "tidy", params: ["value"] });
    expect(listed).not.toHaveProperty("sql");
    expect((await api.macros.get({ tenantId: TENANT, name: "tidy" })).sql).toBe(MACRO_SQL);
  });
});

function names(answer: { name: string }[] | { readonly items: { name: string }[] }): string[] {
  return whole(answer).map((item) => item.name);
}

describe("names and match", () => {
  it("narrow every list by name, case-insensitively for match", async () => {
    for (const name of ["stg_deals", "stg_contacts", "mart_revenue"]) {
      await api.models.save({ tenantId: TENANT, name, sql: "select 1", tests: { columns: {} } });
    }
    for (const name of ["1. Revenue", "1. Refunds", "2. Ledger"]) {
      await api.bi.questions.save({ tenantId: TENANT, name, definition: SQL_QUESTION, chart: BAR });
    }
    await api.macros.save({ tenantId: TENANT, name: "tidy", description: "x", sql: MACRO_SQL });

    expect(names(await api.models.list({ tenantId: TENANT, match: "STG_" }))).toEqual([
      "stg_contacts",
      "stg_deals",
    ]);
    expect(names(await api.models.list({ tenantId: TENANT, names: ["mart_revenue"] }))).toEqual([
      "mart_revenue",
    ]);
    expect(names(await api.bi.questions.list({ tenantId: TENANT, match: "1." }))).toEqual([
      "1. Refunds",
      "1. Revenue",
    ]);
    expect(names(await api.macros.list({ tenantId: TENANT, names: ["tidy"] }))).toEqual(["tidy"]);
    const cards = await api.connections.list({ tenantId: TENANT, names: ["gmail", "xero"] });
    expect(cards.map((card) => card.source)).toEqual(["xero", "gmail"]);
  });

  it("refuse a name nothing carries, naming every one missing, rather than answer fewer", async () => {
    await api.models.save({
      tenantId: TENANT,
      name: "stg_deals",
      sql: "select 1",
      tests: { columns: {} },
    });

    const got = await refusal(() =>
      api.models.list({ tenantId: TENANT, names: ["stg_deals", "stg_dealz", "stg_x"] }),
    );
    expect(got.code).toBe("NOT_FOUND");
    expect(got.facts).toEqual({ reason: "unknown-names", names: "stg_dealz,stg_x" });
  });
});

/** A list's answer: the array when no page was asked, else one page. */
type Answer<T> = T[] | { readonly items: T[]; readonly nextCursor: string | null };

/** Every page of a read, each asked after the last until `nextCursor` is null. */
async function everyPage<T>(
  read: (cursor: string | undefined) => Promise<Answer<T>>,
): Promise<T[][]> {
  const pages: T[][] = [];
  let cursor: string | undefined;
  do {
    const answer = await read(cursor);
    if (Array.isArray(answer)) {
      throw new Error("the whole list, though a page was asked");
    }
    pages.push(answer.items);
    cursor = answer.nextCursor ?? undefined;
  } while (cursor !== undefined && pages.length < 10);
  return pages;
}

function atCursor(cursor: string | undefined): { cursor?: string } {
  return cursor === undefined ? {} : { cursor };
}

describe("limit and cursor", () => {
  it("walk every list a page at a time: each item once, in the list's own order, narrowed by match", async () => {
    for (const name of ["stg_e", "stg_a", "stg_c", "mart_x", "stg_b", "stg_d"]) {
      await api.models.save({ tenantId: TENANT, name, sql: "select 1", tests: { columns: {} } });
    }
    for (const name of ["tidy_e", "tidy_a", "tidy_c", "other", "tidy_b", "tidy_d"]) {
      await api.macros.save({
        tenantId: TENANT,
        name,
        description: "x",
        sql: MACRO_SQL.replace("tidy", name),
      });
    }
    // Two questions share a name: a page keyed by name would lose one of them.
    for (const name of [
      "1. Refunds",
      "1. Revenue",
      "1. Revenue",
      "2. Ledger",
      "1. Costs",
      "1. Aged",
    ]) {
      await api.bi.questions.save({ tenantId: TENANT, name, definition: SQL_QUESTION, chart: BAR });
    }

    const models = await everyPage((cursor) =>
      api.models.list({ tenantId: TENANT, match: "stg_", limit: 2, ...atCursor(cursor) }),
    );
    const macros = await everyPage((cursor) =>
      api.macros.list({ tenantId: TENANT, match: "tidy_", limit: 2, ...atCursor(cursor) }),
    );
    const questions = await everyPage((cursor) =>
      api.bi.questions.list({ tenantId: TENANT, match: "1.", limit: 2, ...atCursor(cursor) }),
    );

    expect([models, macros, questions].map((pages) => pages.map((page) => page.length))).toEqual([
      [2, 2, 1],
      [2, 2, 1],
      [2, 2, 1],
    ]);
    expect(models.flat().map((model) => model.name)).toEqual(
      names(await api.models.list({ tenantId: TENANT, match: "stg_" })),
    );
    expect(macros.flat().map((macro) => macro.name)).toEqual([
      "tidy_a",
      "tidy_b",
      "tidy_c",
      "tidy_d",
      "tidy_e",
    ]);
    const listed = whole(await api.bi.questions.list({ tenantId: TENANT, match: "1." }));
    expect(questions.flat().map((question) => question.id)).toEqual(listed.map((q) => q.id));
    expect(new Set(listed.map((q) => q.id)).size).toBe(5);
  });

  it("a cursor whose item has left the list is refused, never restarted from the top", async () => {
    for (const name of ["tidy_a", "tidy_b", "tidy_c"]) {
      await api.macros.save({
        tenantId: TENANT,
        name,
        description: "x",
        sql: MACRO_SQL.replace("tidy", name),
      });
    }
    const first = await api.macros.list({ tenantId: TENANT, limit: 1 });
    const cursor = Array.isArray(first) ? undefined : (first.nextCursor ?? undefined);
    await api.macros.delete({ tenantId: TENANT, name: "tidy_a" });

    const got = await refusal(() => api.macros.list({ tenantId: TENANT, ...atCursor(cursor) }));

    expect(cursor).toBeDefined();
    expect(got.code).toBe("BAD_REQUEST");
    expect(got.facts).toEqual({
      procedure: "macros.list",
      reason: "unknown-cursor",
      remedy: "restart",
    });
  });
});

describe("models.reference", () => {
  it("answers only the parts named, marked with what was asked", async () => {
    await api.macros.save({ tenantId: TENANT, name: "tidy", description: "x", sql: MACRO_SQL });

    const part = await api.models.reference({ tenantId: TENANT, parts: ["tenantMacros"] });
    expect(part).toEqual({
      parts: ["tenantMacros"],
      tenantMacros: [{ name: "tidy", description: "x", sql: MACRO_SQL }],
    });
  });
});
