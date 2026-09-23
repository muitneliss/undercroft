/**
 * Full-text search over the raw lake, pinned: the fold, the two indexes, and the isolation.
 *
 * These run in the gate because PGlite is real Postgres: the same `normalize`, the same
 * `translate`, the same GIN planner. There is no extension to install, which is the point --
 * `unaccent` is the usual answer to Vietnamese diacritics and PGlite does not ship it, so a
 * design that needed it would be enforced nowhere until production.
 *
 * The length-preservation test is the load-bearing one. `raw.search_excerpt` cuts the snippet
 * out of the ORIGINAL text using an offset found in the FOLDED text, which is only valid while
 * folding maps one character to one character. Break that and the excerpt silently slides off
 * the match -- a wrong answer that looks like a right one.
 *
 * WHICH TESTS SHARE A DATABASE. A describe whose tests only read -- the pure search functions,
 * or a fixture seeded once and then queried -- opens one database for all of them. The one
 * describe whose test writes the row under test opens one per test, so no test's write is
 * another's precondition.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test as it } from "bun:test";

import { createMigratedTestDatabase, type TestDatabase } from "./testing.ts";

let db: TestDatabase;

/** One database for every test in the enclosing describe, seeded once. Its tests only read. */
function sharedDatabase(seed?: () => Promise<void>): void {
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    if (seed !== undefined) {
      await seed();
    }
  });
  afterAll(async () => {
    await db.close();
  });
}

/** The one-column answer to a one-row query, typed at the call site. */
async function one<T>(sql: string, params: readonly unknown[] = []): Promise<T> {
  const { rows } = await db.query<{ v: T }>(sql, params);
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`no row from: ${sql}`);
  }
  return row.v;
}

async function matches(body: string, query: string): Promise<boolean> {
  return one<boolean>("SELECT raw.search_tsv($1) @@ raw.search_query($2) AS v", [body, query]);
}

describe("the search functions, which read nothing", () => {
  sharedDatabase();

  describe("raw.fold", () => {
    it("strips Vietnamese diacritics and lowercases", async () => {
      expect(await one<string>("SELECT raw.fold($1) AS v", ["Hợp Đồng Thuê Nhà"])).toBe(
        "hop dong thue nha",
      );
    });

    it("folds đ and Đ, which no Unicode decomposition touches", async () => {
      // NFD leaves đ alone -- it is a distinct letter, not d-with-a-mark. A fold built on
      // normalize() alone silently leaves every Vietnamese `đ` unsearchable from an ASCII
      // keyboard, which is most of the words an operator types.
      expect(await one<string>("SELECT raw.fold($1) AS v", ["Đường Đi Đẹp"])).toBe("duong di dep");
    });

    it("is length-preserving against NFC, which is what makes an excerpt offset valid", async () => {
      // Pinned over a corpus rather than one string: every tone mark on every vowel, both
      // cases, mixed with ASCII and punctuation.
      const corpus = [
        "àáảãạăằắẳẵặâầấẩẫậ èéẻẽẹêềếểễệ ìíỉĩị",
        "òóỏõọôồốổỗộơờớởỡợ ùúủũụưừứửữự ỳýỷỹỵ đ",
        "ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ ÈÉẺẼẸÊỀẾỂỄỆ ÌÍỈĨỊ",
        "ÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ ÙÚỦŨỤƯỪỨỬỮỰ ỲÝỶỸỴ Đ",
        "Hợp đồng số 42/2026/HĐ-MB ký ngày 01/03.",
        "Plain ASCII, unchanged — 12,345.67",
      ];
      for (const line of corpus) {
        const same = await one<boolean>(
          "SELECT length(raw.fold($1)) = length(normalize($1, NFC)) AS v",
          [line],
        );
        expect(same).toBe(true);
      }
    });

    it("leaves a string with nothing to fold alone but for case", async () => {
      // The quiet side: a fold that mangled ASCII would corrupt every English document.
      expect(
        await one<string>("SELECT raw.fold($1) AS v", ["Invoice INV-001 due 2026-03-01"]),
      ).toBe("invoice inv-001 due 2026-03-01");
    });
  });

  describe("matching Vietnamese", () => {
    it("finds diacritics from a query typed without them", async () => {
      expect(await matches("Hợp đồng thuê nhà số 42", "hop dong")).toBe(true);
    });

    it("finds the same text from a query typed with them", async () => {
      expect(await matches("Hợp đồng thuê nhà số 42", "Hợp đồng")).toBe(true);
    });

    it("does not match a word the text does not hold", async () => {
      // The quiet side of the guard: folding must not make everything match everything.
      expect(await matches("Hợp đồng thuê nhà số 42", "hoa don")).toBe(false);
    });

    it("requires every bare term, so a half-match is not a match", async () => {
      expect(await matches("Hợp đồng thuê nhà", "hop dong xe")).toBe(false);
    });
  });

  describe("matching English", () => {
    it("stems, so a singular query finds the plural in the text", async () => {
      expect(await matches("two signed contracts were returned", "contract")).toBe(true);
    });

    it("still refuses an unrelated word", async () => {
      expect(await matches("two signed contracts were returned", "invoice")).toBe(false);
    });

    it("matches a mixed Vietnamese and English document from either language", async () => {
      const body = "Hợp đồng — signed contracts attached";
      expect(await matches(body, "hop dong")).toBe(true);
      expect(await matches(body, "contract")).toBe(true);
    });
  });

  describe("what websearch syntax buys", () => {
    it("honours a quoted phrase", async () => {
      expect(await matches("Hợp đồng thuê nhà", '"hop dong"')).toBe(true);
      expect(await matches("đồng phục hợp lệ", '"hop dong"')).toBe(false);
    });

    it("honours a negated term", async () => {
      expect(await matches("Hợp đồng thuê nhà", "hop -dong")).toBe(false);
      expect(await matches("Hợp lệ, thuê nhà", "hop -dong")).toBe(true);
    });

    it("makes a blank query match nothing rather than everything", async () => {
      // An empty tsquery matches no row. Pinned because the opposite -- a blank box returning
      // the whole lake -- is the failure a caller would never see in a test of the happy path.
      expect(await matches("Hợp đồng thuê nhà", "   ")).toBe(false);
    });
  });

  describe("raw.record_tsv indexes values, not the shape of the JSON", () => {
    it("finds a value", async () => {
      const hit = await one<boolean>(
        "SELECT raw.record_tsv($1::jsonb) @@ raw.search_query($2) AS v",
        ['{"deal_name":"Hợp đồng thuê nhà","amount":"1200.00"}', "hop dong"],
      );
      expect(hit).toBe(true);
    });

    it("does not find a key, which would match every record the source ever sent", async () => {
      const hit = await one<boolean>(
        "SELECT raw.record_tsv($1::jsonb) @@ raw.search_query($2) AS v",
        ['{"deal_name":"Hợp đồng thuê nhà","amount":"1200.00"}', "deal_name"],
      );
      expect(hit).toBe(false);
    });

    it("keeps a JSON number searchable, not only a JSON string", async () => {
      // `"numeric"` in the jsonb_to_tsvector filter is what this pins: with `"string"` alone a
      // source that sends its amounts as JSON numbers would have none of them findable.
      const hit = await one<boolean>(
        "SELECT raw.record_tsv($1::jsonb) @@ raw.search_query($2) AS v",
        ['{"amount":1200.5}', "1200.5"],
      );
      expect(hit).toBe(true);
    });
  });

  describe("raw.search_excerpt", () => {
    const BODY = `Phần mở đầu của tài liệu này không nói gì đáng chú ý, và nó kéo dài một đoạn.
Điều khoản thanh toán: bên thuê trả tiền Hợp đồng thuê nhà trước ngày 05 hằng tháng.
Phần kết thúc.`;

    it("cuts the snippet from the original text around the match, diacritics intact", async () => {
      const excerpt = await one<string>("SELECT raw.search_excerpt($1, $2) AS v", [
        BODY,
        "hop dong",
      ]);
      expect(excerpt).toContain("Hợp đồng");
      // Centred on the match rather than returning the head of the document.
      expect(excerpt).not.toContain("Phần mở đầu");
    });

    it("returns the head of the text when no term appears literally, and does not invent one", async () => {
      // `contract` matches `contracts` through the English stemmer, so a match can be real
      // while no query term appears verbatim. The excerpt says so by being the head of the
      // document, rather than guessing at an offset -- a guessed location reads exactly like a
      // found one.
      const excerpt = await one<string>("SELECT raw.search_excerpt($1, $2) AS v", [
        "Two signed contracts were returned on Tuesday.",
        "contract",
      ]);
      expect(excerpt.startsWith("Two signed contracts")).toBe(true);
    });
  });
});

describe("a payload or a document too large to index whole", () => {
  /** Comfortably past `raw.SEARCH_CAP` (200_000 characters), as the migration documents it. */
  const OVER_CAP = 260_000;

  beforeEach(async () => {
    db = await createMigratedTestDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  it("does not raise, so an oversized payload still lands", async () => {
    // The firing case for the `left()` guard. Without it `to_tsvector` raises past the 1 MB
    // tsvector ceiling, and inside an expression index that error fails the INSERT that lands
    // the row -- data loss caused by a search feature.
    await db.exec("CREATE TABLE raw.records_big PARTITION OF raw.records FOR VALUES IN ('big')");
    await db.query(
      `INSERT INTO raw.records (source, tenant_id, entity, source_record_id, payload,
         content_sha256, observed_at, lake_key, lake_stamp, run_id)
       VALUES ('big', 'CASE-0042', 'things', '1',
               jsonb_build_object('note', 'Hợp đồng ' || repeat('x ', $1::int)),
               repeat('0', 64), now(), 'k', 's', 'r')`,
      [Math.ceil(OVER_CAP / 2)],
    );
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM raw.records WHERE source = 'big'",
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("stays searchable in its first characters rather than vanishing", async () => {
    // The quiet side: an over-cap row must not become invisible. Truncated is a stated
    // limit; unfindable would be a silent one.
    const hit = await one<boolean>(
      `SELECT raw.record_tsv(jsonb_build_object('note', 'Hợp đồng ' || repeat('x ', $1::int)))
              @@ raw.search_query($2) AS v`,
      [Math.ceil(OVER_CAP / 2), "hop dong"],
    );
    expect(hit).toBe(true);
  });
});

describe("the indexes are live", () => {
  // Seeded once: both tests only ask the planner. `enable_seqscan = off` is what makes an
  // unusable index visible -- with it on, a tiny table is scanned and the plan proves nothing.
  sharedDatabase(async () => {
    await db.exec("CREATE TABLE raw.records_demo PARTITION OF raw.records FOR VALUES IN ('demo')");
    await db.exec("SET enable_seqscan = off");
  });

  /** Postgres's own plan for the search predicate, as one string. */
  async function planFor(sql: string, params: readonly unknown[]): Promise<string> {
    const { rows } = await db.query<Record<string, string>>(`EXPLAIN ${sql}`, params);
    return rows.map((r) => Object.values(r).join(" ")).join("\n");
  }

  it("uses the GIN index on raw.records, in a partition made after the migration ran", async () => {
    // A dead index is invisible: the query still answers, just by reading every payload in the
    // lake. This is the only thing that tells us the expression ON the index and the expression
    // IN the statement are still the same expression -- when they drift, the plan cannot use the
    // index at all, not even with sequential scans switched off.
    //
    // The scan names the PARTITION's index (`records_demo_record_tsv_idx`), not the parent's,
    // and `records_demo` was created by this describe's seed -- after 190 ran. A partition
    // made later only has an index because the parent declares one, so this also proves the
    // parent index exists: a new connector's partition is searchable without a migration.
    const plan = await planFor(
      "SELECT source_record_id FROM raw.records WHERE raw.record_tsv(payload) @@ raw.search_query($1)",
      ["hop dong"],
    );
    expect(plan).toContain("Bitmap Index Scan on records_demo_record_tsv_idx");
  });

  it("uses the GIN index on raw.document_text", async () => {
    const plan = await planFor(
      "SELECT document_id FROM raw.document_text WHERE raw.search_tsv(text) @@ raw.search_query($1)",
      ["hop dong"],
    );
    expect(plan).toContain("document_text_search");
  });
});

describe("a tenant's login searches its own rows and no other", () => {
  // Seeded once: both tests only read, each as the tenant's own role.
  sharedDatabase(async () => {
    await db.exec("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
    await db.query("SELECT ops.provision_tenant('CASE-0042')");
    await db.query("SELECT ops.provision_tenant('CASE-0043')");
    await db.exec("CREATE TABLE raw.records_demo PARTITION OF raw.records FOR VALUES IN ('demo')");
    await db.exec(
      `INSERT INTO raw.records (source, tenant_id, entity, source_record_id, payload,
         content_sha256, observed_at, lake_key, lake_stamp, run_id)
       VALUES ('demo', 'CASE-0042', 'things', '1', '{"note":"Hợp đồng thuê nhà"}'::jsonb,
               repeat('0', 64), now(), 'k', 's', 'r'),
              ('demo', 'CASE-0043', 'things', '1', '{"note":"Hợp đồng thuê xe"}'::jsonb,
               repeat('0', 64), now(), 'k', 's', 'r')`,
    );
    await db.exec(
      `INSERT INTO raw.document_text (source, tenant_id, document_id, source_sha256, method,
         text, chars, extracted_at, run_id)
       VALUES ('demo', 'CASE-0042', 'd1', repeat('0', 64), 'pdf_text', 'Hợp đồng thuê nhà', 17, now(), 'r'),
              ('demo', 'CASE-0043', 'd1', repeat('0', 64), 'pdf_text', 'Hợp đồng thuê xe', 16, now(), 'r')`,
    );
  });

  /** The role `ops.provision_tenant` minted for this tenant's dbt sessions. */
  async function dbtRole(tenantId: string): Promise<string> {
    return one<string>(
      "SELECT role_name AS v FROM ops.tenant_role WHERE tenant_id = $1 AND kind = 'dbt'",
      [tenantId],
    );
  }

  it("sees its own record and document", async () => {
    const role = await dbtRole("CASE-0042");
    await db.asRole(role, async (tx) => {
      const records = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM raw.records
         WHERE raw.record_tsv(payload) @@ raw.search_query($1)`,
        ["hop dong"],
      );
      expect(records.rows[0]?.n).toBe(1);
      const documents = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM raw.document_text
         WHERE raw.search_tsv(text) @@ raw.search_query($1)`,
        ["hop dong"],
      );
      expect(documents.rows[0]?.n).toBe(1);
    });
  });

  it("cannot reach the other tenant's, even on a term only that tenant holds", async () => {
    // The row-level policy, not the grant, is what does this -- and a search that bypassed it
    // would read every customer's contracts to one customer's admin.
    const role = await dbtRole("CASE-0042");
    await db.asRole(role, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM raw.document_text
         WHERE raw.search_tsv(text) @@ raw.search_query($1)`,
        ["thue xe"],
      );
      expect(rows[0]?.n).toBe(0);
    });
  });
});
