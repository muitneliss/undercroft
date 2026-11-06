/**
 * The BM25 door (680, ADR 0155, ADR 0156), as the logins that call it.
 *
 * PGlite carries pg_textsearch (`testing.ts`), so what is pinned here is the extension's own
 * ranking, not a stand-in: the door's order, its query language, its stream narrowing, when it
 * refuses, and that its two scans are index scans. Which logins may call it, and that none may
 * reach the extension itself, are `privileges.test.ts`'s.
 *
 * The fixture is one tenant whose indexes `ops.provision_tenant` made while it was empty, with
 * documents landed afterwards -- the path a new customer takes -- and a second tenant holding the
 * same words, so "only its own" has something to be measured against. Dates run the other way to
 * relevance, so a page in BM25 order cannot be mistaken for ADR 0123's newest-first one.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test as it } from "bun:test";
import { createMigratedTestDatabase, type TestDatabase } from "./testing.ts";

const OWN = "undercroft_dbt_case_0042";
const OTHER = "undercroft_dbt_case_0043";

let db: TestDatabase;

async function seed(): Promise<void> {
  db = await createMigratedTestDatabase();
  await db.exec("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
  await db.query("SELECT ops.provision_tenant('CASE-0042')");
  await db.query("SELECT ops.provision_tenant('CASE-0043')");
  await db.exec(
    `INSERT INTO raw.document_text (source, tenant_id, document_id, source_sha256, method, text,
       chars, extracted_at, run_id)
     VALUES ('demo', 'CASE-0042', 'd1', repeat('0', 64), 'pdf_text',
             'Hợp đồng hợp đồng thuê nhà ký với bà Đặng Thị Bình', 1, '2026-01-01', 'r'),
            ('demo', 'CASE-0042', 'd2', repeat('0', 64), 'pdf_text',
             'signed contracts for the warehouse', 1, '2026-01-02', 'r'),
            ('demo', 'CASE-0042', 'd3', repeat('0', 64), 'pdf_text',
             'hợp đồng thuê xe cùng rất nhiều chữ khác nữa trong một văn bản rất dài', 1,
             '2026-01-03', 'r'),
            ('drive', 'CASE-0042', 'd4', repeat('0', 64), 'pdf_text', 'hợp đồng thuê nhà', 1,
             '2026-01-04', 'r'),
            ('demo', 'CASE-0042', 'd5', repeat('0', 64), 'pdf_text',
             'có một hợp đồng thuê cho nhà này', 1, '2026-01-05', 'r'),
            ('demo', 'CASE-0043', 'd1', repeat('0', 64), 'pdf_text',
             'hợp đồng thuê nhà ký với bà Đặng Thị Bình', 1, '2026-01-06', 'r')`,
  );
}

interface Key {
  source: string;
  document_id: string;
}

/** The door's page for `q`, as the tenant's own login, keys and ordinal. */
function door(
  q: string,
  limit = 10,
  streams: { sources: string[]; entities: (string | null)[] } | null = null,
): Promise<(Key & { ordinal: number })[]> {
  return db.asRole(OWN, async (tx) => {
    const { rows } = await tx.query<Key & { ordinal: number }>(
      `SELECT source, document_id, ordinal::int AS ordinal
       FROM raw.search_document_bm25(current_user, $1, $2, $3::text[], $4::text[])`,
      [q, limit, streams?.sources ?? null, streams?.entities ?? null],
    );
    return rows;
  });
}

/** Just the keys, as `source/id`, in the door's order. */
async function keys(q: string): Promise<string[]> {
  return (await door(q)).map((row) => `${row.source}/${row.document_id}`);
}

/** What a call was refused with, or `""` when it was answered. */
async function refusalOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("the door ranks a tenant's own documents through its two BM25 indexes", () => {
  // Every test here only reads.
  beforeAll(seed);
  afterAll(async () => {
    await db.close();
  });

  it("answers its own matches in fused BM25 order, numbered, and not newest first", async () => {
    // d4 holds the words once in four; d1 twice in eleven; d5 once in six; d3 once in a long
    // text. Newest first would be d5, d4, d3, d1.
    expect(await door("hop dong")).toEqual([
      { source: "drive", document_id: "d4", ordinal: 1 },
      { source: "demo", document_id: "d1", ordinal: 2 },
      { source: "demo", document_id: "d5", ordinal: 3 },
      { source: "demo", document_id: "d3", ordinal: 4 },
    ]);
  });

  it("stops at the page asked for, which is the head of the same order", async () => {
    expect(await door("hop dong", 2)).toEqual([
      { source: "drive", document_id: "d4", ordinal: 1 },
      { source: "demo", document_id: "d1", ordinal: 2 },
    ]);
  });

  it("requires every term", async () => {
    expect(await keys("hop dong xe")).toEqual(["demo/d3"]);
  });

  it("honours a quoted phrase", async () => {
    // d5 holds both words, but not side by side.
    expect(await keys('"thue nha"')).toEqual(["drive/d4", "demo/d1"]);
  });

  it("honours a negation, and still ranks what is left", async () => {
    // The regression ADR 0156 records: ranked whole, `-xe hop dong` put the documents holding
    // `xe` first, the filter removed them, and past the depth nothing was left.
    expect(await keys("-xe hop dong")).toEqual(["drive/d4", "demo/d1", "demo/d5"]);
  });

  it("ranks the positive terms alone, folded", async () => {
    const terms = await db.query<{ t: string }>("SELECT raw.search_bm25_terms($1) AS t", [
      '-xe "Hợp Đồng" or -"thuê nhà" nhà OR -',
    ]);
    expect(terms.rows).toEqual([{ t: "hop dong nha" }]);
  });

  it("stems English through the second index: contract finds contracts", async () => {
    expect(await keys("contract")).toEqual(["demo/d2"]);
  });

  it("folds: a name typed without its diacritics finds it with them", async () => {
    expect(await keys("dang thi binh")).toEqual(["demo/d1"]);
  });

  it("narrows to the streams the reader reaches before it ranks", async () => {
    expect(await door("hop dong", 10, { sources: ["drive"], entities: [null] })).toEqual([
      { source: "drive", document_id: "d4", ordinal: 1 },
    ]);
    expect(await door("hop dong", 10, { sources: ["drive"], entities: ["documents"] })).toEqual([
      { source: "drive", document_id: "d4", ordinal: 1 },
    ]);
    // A source's other entities are not its documents.
    expect(await door("hop dong", 10, { sources: ["demo"], entities: ["files"] })).toEqual([]);
  });

  it("refuses a page shorter than the matches, rather than present it as all of them", async () => {
    // `-xe` alone matches every document without `xe`, and has no positive term to rank by.
    expect(await refusalOf(() => door("-xe"))).toMatch(/4 documents match and the ranked heads/u);
  });

  it("answers an empty page, not a refusal, when nothing matches", async () => {
    expect(await door("zebra")).toEqual([]);
  });

  it.each(["simple", "english"])(
    "reads the %s order by an index scan, never by scoring rows from their text",
    async (config) => {
      // pg_textsearch's scans move no scan counter, so the plan is the evidence -- of the very
      // statement the door runs, which `raw.search_document_bm25_head_sql` writes, under the
      // settings the head function itself carries, read off it rather than copied here.
      await db.exec("BEGIN");
      try {
        await db.query(
          `SELECT set_config(split_part(c, '=', 1), split_part(c, '=', 2), true)
           FROM pg_proc p, unnest(p.proconfig) AS c
           WHERE p.oid = 'raw.search_document_bm25_head(text, text, text, text[])'::regprocedure
             AND c NOT LIKE 'search_path=%'`,
        );
        const { rows: statement } = await db.query<{ sql: string; index: string }>(
          `SELECT raw.search_document_bm25_head_sql('CASE-0042', $1, 'hop dong', NULL) AS sql,
                  raw.search_index_name('CASE-0042', $1)::text AS index`,
          [config],
        );
        const [head] = statement;
        if (head === undefined) {
          throw new Error("no head statement");
        }
        const { rows } = await db.query<Record<string, string>>(`EXPLAIN ${head.sql}`);
        const text = rows.map((row) => Object.values(row).join(" ")).join("\n");
        expect(text).toContain(`Index Scan using ${head.index}`);
        expect(text).not.toContain("Sort");
      } finally {
        await db.exec("ROLLBACK");
      }
    },
  );
});

/** The tests that change the indexes or the session's own user, each on its own database. */
describe("the door answers only its own tenant, and only while both indexes are ready", () => {
  beforeEach(seed);
  afterEach(async () => {
    await db.close();
  });

  async function ready(role: string): Promise<boolean> {
    const { rows } = await db.query<{ ready: boolean }>(
      "SELECT raw.search_document_bm25_ready($1) AS ready",
      [role],
    );
    return rows[0]?.ready === true;
  }

  async function indexName(config: string): Promise<string> {
    const { rows } = await db.query<{ name: string }>(
      "SELECT raw.search_index_name('CASE-0042', $1)::text AS name",
      [config],
    );
    return rows[0]?.name ?? "";
  }

  it("answers nothing to a login naming another tenant's role", async () => {
    // As the LOGIN, not a `SET ROLE` of the superuser: `raw.tenant_of` checks `session_user`.
    await db.exec("BEGIN");
    try {
      await db.exec(`SET LOCAL SESSION AUTHORIZATION ${OTHER}`);
      const { rows } = await db.query(
        `SELECT * FROM raw.search_document_bm25('${OWN}', 'hop dong', 10)`,
      );
      expect(rows).toEqual([]);
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  it("is ready when both are valid, and answers", async () => {
    expect(await ready(OWN)).toBe(true);
    expect(await door("hop dong")).toHaveLength(4);
  });

  it("is not ready while one is missing, and the door refuses rather than answer", async () => {
    await db.exec(`DROP INDEX raw.${await indexName("english")}`);
    expect(await ready(OWN)).toBe(false);
    expect(await refusalOf(() => door("hop dong"))).toMatch(
      /search indexes of CASE-0042 are not ready/u,
    );
  });

  it("is not ready while one is invalid, as a build cut short leaves it", async () => {
    await db.query(
      "UPDATE pg_index SET indisvalid = false WHERE indexrelid = format('raw.%I', $1::text)::regclass",
      [await indexName("simple")],
    );
    expect(await ready(OWN)).toBe(false);
  });

  it("is never ready for a login that is not a tenant's", async () => {
    expect(await ready("undercroft_worker")).toBe(false);
  });
});
