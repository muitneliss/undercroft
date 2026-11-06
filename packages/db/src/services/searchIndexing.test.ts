/**
 * `search-index`: who builds a tenant's BM25 indexes, and how one pass mends them (ADR 0155,
 * ADR 0156).
 *
 * Against PGlite with pg_textsearch, which runs `CREATE INDEX CONCURRENTLY`, `DROP INDEX
 * CONCURRENTLY` and `REINDEX INDEX CONCURRENTLY` for real. What it cannot show is a second
 * session: a build another backend is still running, a lock `ops.provision_search_indexes` could
 * not take at once, or the advisory lock held elsewhere -- PGlite has one connection. Those are
 * the integration tier's. A cut-short build is planted the way Postgres leaves one: an index
 * whose `indisvalid` is false.
 *
 * The growth rule a pass decides by is pure, and pinned without a database from both sides.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { createLogger } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "../testing.ts";
import {
  indexSearch,
  REINDEX_MIN_GROWTH_BYTES,
  type SearchIndexPass,
  upkeepOf,
} from "./searchIndexing.ts";

const MIB = 1024 * 1024;

describe("the growth rule a pass decides by", () => {
  it("reindexes an index at twice its built size and 64 MiB larger", () => {
    expect(upkeepOf({ bytes: 200 * MIB, builtBytes: 100 * MIB })).toBe("reindexed");
    expect(upkeepOf({ bytes: 64 * MIB + 16_384, builtBytes: 16_384 })).toBe("reindexed");
  });

  it("keeps one that has grown less than either", () => {
    // Doubled but small -- an index built empty by provisioning, then a few documents.
    expect(upkeepOf({ bytes: 10 * MIB, builtBytes: 16_384 })).toBe("kept");
    // Much larger, but not doubled.
    expect(upkeepOf({ bytes: 300 * MIB, builtBytes: 200 * MIB })).toBe("kept");
    expect(REINDEX_MIN_GROWTH_BYTES).toBe(64 * MIB);
  });

  it("records a baseline for a valid index with no size on record", () => {
    expect(upkeepOf({ bytes: 16_384, builtBytes: null })).toBe("recorded");
  });
});

let db: TestDatabase;
let lines: Record<string, unknown>[];

/** One pass, with its log lines captured as the JSON the container would print. */
function pass(): Promise<SearchIndexPass> {
  const log = createLogger({
    component: "search-index",
    sink: (line) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  return indexSearch({ exec: db, log });
}

async function indexName(tenant: string, config: string): Promise<string> {
  const { rows } = await db.query<{ name: string }>(
    "SELECT raw.search_index_name($1, $2)::text AS name",
    [tenant, config],
  );
  return rows[0]?.name ?? "";
}

/** The tenant's indexes that exist, by configuration, with their oid and validity. */
async function indexesOf(
  tenant: string,
): Promise<{ config: string; oid: number; valid: boolean }[]> {
  const { rows } = await db.query<{ config: string; oid: number; valid: boolean }>(
    `SELECT c.config, x.oid::int AS oid, i.indisvalid AS valid
     FROM raw.search_index_configs() AS c(config)
     JOIN pg_class x ON x.relname = raw.search_index_name($1, c.config)
     JOIN pg_index i ON i.indexrelid = x.oid
     ORDER BY c.config`,
    [tenant],
  );
  return rows;
}

async function ready(role: string): Promise<boolean> {
  const { rows } = await db.query<{ ready: boolean }>(
    "SELECT raw.search_document_bm25_ready($1) AS ready",
    [role],
  );
  return rows[0]?.ready === true;
}

describe("a tenant's BM25 indexes, from provisioning to a pass of search-index", () => {
  // CASE-0042 is provisioned empty, the way a new customer arrives; CASE-0043 already holds a
  // document when it is provisioned, the way every customer did the day this shipped.
  beforeEach(async () => {
    lines = [];
    db = await createMigratedTestDatabase();
    await db.exec("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
    await db.query("SELECT ops.provision_tenant('CASE-0042')");
    await db.exec(
      `INSERT INTO raw.document_text (source, tenant_id, document_id, source_sha256, method, text,
         chars, extracted_at, run_id)
       VALUES ('demo', 'CASE-0043', 'd1', repeat('0', 64), 'pdf_text', 'hợp đồng thuê nhà', 17,
               now(), 'r')`,
    );
    await db.query("SELECT ops.provision_tenant('CASE-0043')");
  });

  afterEach(async () => {
    await db.close();
  });

  it("provisioning makes them for a tenant with no documents, and not for one that has some", async () => {
    expect(await indexesOf("CASE-0042")).toEqual([
      { config: "english", oid: expect.any(Number), valid: true },
      { config: "simple", oid: expect.any(Number), valid: true },
    ]);
    expect(await indexesOf("CASE-0043")).toEqual([]);
    expect(await ready("undercroft_dbt_case_0043")).toBe(false);
  });

  it("builds the missing ones, one log line each, and the door then answers", async () => {
    const done = await pass();

    expect(done.actions).toEqual([
      { index: await indexName("CASE-0042", "simple"), action: "recorded" },
      { index: await indexName("CASE-0042", "english"), action: "recorded" },
      { index: await indexName("CASE-0043", "simple"), action: "built" },
      { index: await indexName("CASE-0043", "english"), action: "built" },
    ]);
    expect(
      lines
        .filter((line) => line.tenantId === "CASE-0043")
        .map((line) => [line.component, line.event, line.config]),
    ).toEqual([
      ["search-index", "search_index.built", "simple"],
      ["search-index", "search_index.built", "english"],
    ]);
    expect(await ready("undercroft_dbt_case_0043")).toBe(true);
    const { rows } = await db.asRole("undercroft_dbt_case_0043", (tx) =>
      tx.query("SELECT document_id FROM raw.search_document_bm25(current_user, 'hop dong', 5)"),
    );
    expect(rows).toEqual([{ document_id: "d1" }]);
  });

  it("leaves valid indexes alone", async () => {
    await pass();
    const before = await indexesOf("CASE-0043");

    const again = await pass();

    expect(new Set(again.actions.map((a) => a.action))).toEqual(new Set(["kept"]));
    expect(await indexesOf("CASE-0043")).toEqual(before);
  });

  it("drops and rebuilds an index a cut-short build left invalid", async () => {
    await pass();
    const name = await indexName("CASE-0043", "simple");
    await db.query(
      "UPDATE pg_index SET indisvalid = false WHERE indexrelid = format('raw.%I', $1::text)::regclass",
      [name],
    );
    const [, before] = await indexesOf("CASE-0043");
    expect(await ready("undercroft_dbt_case_0043")).toBe(false);

    const done = await pass();

    expect(done.actions.filter((a) => a.action !== "kept")).toEqual([
      { index: name, action: "rebuilt" },
    ]);
    const [, after] = await indexesOf("CASE-0043");
    expect(after?.valid).toBe(true);
    expect(after?.oid).not.toBe(before?.oid);
    expect(await ready("undercroft_dbt_case_0043")).toBe(true);
  });

  it("drops the invalid copy a cut-short reindex leaves beside the original", async () => {
    // `REINDEX CONCURRENTLY` builds `<name>_ccnew` and swaps it in; killed first, the copy stays,
    // invalid, and is still written to on every insert.
    await pass();
    const name = await indexName("CASE-0043", "simple");
    await db.exec(
      `CREATE INDEX ${name}_ccnew ON raw.document_text USING bm25 (raw.fold(left(text, raw.search_cap())))
         WITH (text_config = 'simple') WHERE tenant_id = 'CASE-0043';
       UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'raw.${name}_ccnew'::regclass;`,
    );

    const done = await pass();

    expect(done.actions.filter((a) => a.action !== "kept")).toEqual([
      { index: `raw.${name}_ccnew`, action: "dropped" },
    ]);
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_class WHERE relname = $1",
      [`${name}_ccnew`],
    );
    expect(rows).toEqual([{ n: 0 }]);
    expect(await ready("undercroft_dbt_case_0043")).toBe(true);
  });
});
