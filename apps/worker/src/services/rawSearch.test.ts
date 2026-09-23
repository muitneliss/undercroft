/**
 * What the lake search promises, proven as the login that actually runs it.
 *
 * The statement is exercised through `sessionsBySetRole`, so it runs as `undercroft_dbt_<slug>`
 * exactly as in production: a grant it does not hold, or a row the policy does not show it,
 * fails here rather than at 02:00. The one thing PGlite cannot prove is that a hostile
 * connection cannot escape `SET ROLE`; that is the Docker tier's, as everywhere else.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import type { QueryDeps } from "./queryRunner.ts";
import { searchRaw } from "./rawSearch.ts";
import { sessionsBySetRole } from "./tenantSession.ts";

const TENANT = "CASE-1";
const OTHER = "CASE-2";

let db: TestDatabase;
let deps: QueryDeps;

/** One landed record, as the loader would have written it. */
async function landRecord(tenantId: string, id: string, payload: string): Promise<void> {
  await db.asSuperuser((tx) =>
    tx.query(
      `INSERT INTO raw.records (source, tenant_id, entity, source_record_id, payload,
         content_sha256, observed_at, lake_key, lake_stamp, run_id)
       VALUES ('demo', $1, 'deals', $2, $3::jsonb, repeat('0', 64), now(), 'k', 's', 'r')`,
      [tenantId, id, payload],
    ),
  );
}

/** One landed document and the text an extract run read out of it. */
async function landDocument(
  tenantId: string,
  id: string,
  text: string,
  options: { deleted?: boolean } = {},
): Promise<void> {
  await db.asSuperuser(async (tx) => {
    await tx.query(
      `INSERT INTO raw.documents (source, tenant_id, document_id, lake_key, sha256, byte_length,
         observed_at, run_id, deleted_at)
       VALUES ('demo', $1, $2, 'k', repeat('0', 64), 10, now(), 'r', $3)`,
      [tenantId, id, options.deleted === true ? new Date().toISOString() : null],
    );
    await tx.query(
      `INSERT INTO raw.document_text (source, tenant_id, document_id, source_sha256, method,
         text, chars, truncated, extracted_at, run_id)
       VALUES ('demo', $1, $2, repeat('0', 64), 'pdf_text', $3, length($3), false, now(), 'r')`,
      [tenantId, id, text],
    );
  });
}

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1), ($2)", [TENANT, OTHER]);
  await db.query("SELECT ops.provision_tenant($1)", [TENANT]);
  await db.query("SELECT ops.provision_tenant($1)", [OTHER]);
  await db.exec("CREATE TABLE raw.records_demo PARTITION OF raw.records FOR VALUES IN ('demo')");
  await db.become("undercroft_worker");
  deps = { exec: db, sessions: sessionsBySetRole(db, (role, fn) => db.asRole(role, fn)) };
});

afterEach(async () => {
  await db.close();
});

describe("searchRaw finds a tenant's own data in both languages", () => {
  beforeEach(async () => {
    await landRecord(TENANT, "1", '{"deal_name":"Hợp đồng thuê nhà","stage":"won"}');
    await landRecord(TENANT, "2", '{"deal_name":"Signed contracts","stage":"open"}');
    await landDocument(TENANT, "d1", "Điều khoản thanh toán của Hợp đồng thuê nhà số 42.");
  });

  it("finds a Vietnamese record from a query typed without diacritics", async () => {
    const found = await searchRaw(deps, {
      tenantId: TENANT,
      q: "hop dong",
      kinds: ["record"],
      limit: 10,
      offset: 0,
    });
    expect(found.hits.map((h) => (h.kind === "record" ? h.sourceRecordId : h.kind))).toEqual(["1"]);
    expect(found.truncated).toBe(false);
  });

  it("finds an English record by its stem", async () => {
    const found = await searchRaw(deps, {
      tenantId: TENANT,
      q: "contract",
      kinds: ["record"],
      limit: 10,
      offset: 0,
    });
    expect(found.hits.map((h) => (h.kind === "record" ? h.sourceRecordId : h.kind))).toEqual(["2"]);
  });

  it("finds a document and hands back its diacritics, not the folded form", async () => {
    const found = await searchRaw(deps, {
      tenantId: TENANT,
      q: "hop dong",
      kinds: ["document"],
      limit: 10,
      offset: 0,
    });
    expect(found.hits).toHaveLength(1);
    expect(found.hits[0]?.excerpt).toContain("Hợp đồng");
    expect(found.hits[0]?.kind === "document" ? found.hits[0].method : null).toBe("pdf_text");
  });

  it("searches both halves at once, which is what one search box means", async () => {
    const found = await searchRaw(deps, {
      tenantId: TENANT,
      q: "hop dong",
      kinds: ["record", "document"],
      limit: 10,
      offset: 0,
    });
    expect(found.hits.map((h) => h.kind).sort()).toEqual(["document", "record"]);
  });

  it("answers nothing for a term the lake does not hold", async () => {
    // The quiet side. A search that always found something would be useless in exactly the
    // case it is asked -- "do we have this at all".
    const found = await searchRaw(deps, {
      tenantId: TENANT,
      q: "hoa don dien",
      kinds: ["record", "document"],
      limit: 10,
      offset: 0,
    });
    expect(found.hits).toEqual([]);
  });
});

describe("searchRaw keeps one tenant out of another's lake", () => {
  beforeEach(async () => {
    await landRecord(TENANT, "1", '{"note":"Hợp đồng thuê nhà"}');
    await landRecord(OTHER, "1", '{"note":"Hợp đồng thuê xe"}');
    await landDocument(TENANT, "d1", "Hợp đồng thuê nhà");
    await landDocument(OTHER, "d1", "Hợp đồng thuê xe");
  });

  it("returns only the asking tenant's hits for a term they share", async () => {
    const found = await searchRaw(deps, {
      tenantId: TENANT,
      q: "hop dong",
      kinds: ["record", "document"],
      limit: 10,
      offset: 0,
    });
    expect(found.hits).toHaveLength(2);
    for (const hit of found.hits) {
      expect(hit.excerpt).toContain("nhà");
    }
  });

  it("returns nothing for a term only the other tenant holds", async () => {
    const found = await searchRaw(deps, {
      tenantId: TENANT,
      q: "thue xe",
      kinds: ["record", "document"],
      limit: 10,
      offset: 0,
    });
    expect(found.hits).toEqual([]);
  });
});

describe("paging and tombstones", () => {
  beforeEach(async () => {
    for (let i = 0; i < 5; i += 1) {
      await landRecord(TENANT, String(i), `{"note":"Hợp đồng số ${String(i)}"}`);
    }
  });

  it("says the page was cut rather than leaving it to be inferred", async () => {
    const found = await searchRaw(deps, {
      tenantId: TENANT,
      q: "hop dong",
      kinds: ["record"],
      limit: 2,
      offset: 0,
    });
    expect(found.hits).toHaveLength(2);
    expect(found.truncated).toBe(true);
  });

  it("says the last page was not cut", async () => {
    const found = await searchRaw(deps, {
      tenantId: TENANT,
      q: "hop dong",
      kinds: ["record"],
      limit: 2,
      offset: 4,
    });
    expect(found.hits).toHaveLength(1);
    expect(found.truncated).toBe(false);
  });

  it("pages over a total order, so no hit is shown twice or skipped", async () => {
    const first = await searchRaw(deps, {
      tenantId: TENANT,
      q: "hop dong",
      kinds: ["record"],
      limit: 2,
      offset: 0,
    });
    const second = await searchRaw(deps, {
      tenantId: TENANT,
      q: "hop dong",
      kinds: ["record"],
      limit: 2,
      offset: 2,
    });
    const ids = [...first.hits, ...second.hits].map((h) =>
      h.kind === "record" ? h.sourceRecordId : "",
    );
    expect(new Set(ids).size).toBe(4);
  });

  it("finds a document the source has deleted, and says that it is a tombstone", async () => {
    // Included rather than filtered: "which contract said this" is asked about terminated
    // contracts more often than live ones. Saying so is what keeps it from reading as current.
    await landDocument(TENANT, "gone", "Hợp đồng đã chấm dứt", { deleted: true });
    const found = await searchRaw(deps, {
      tenantId: TENANT,
      q: "cham dut",
      kinds: ["document"],
      limit: 10,
      offset: 0,
    });
    expect(found.hits).toHaveLength(1);
    expect(found.hits[0]?.deletedAt).not.toBeNull();
  });
});

describe("a tenant that was never provisioned", () => {
  it("is refused rather than answered with an empty lake", async () => {
    // "No such tenant" and "nothing matched" are different facts, and only one of them is a
    // configuration error somebody has to go and fix.
    await expect(
      searchRaw(deps, {
        tenantId: "CASE-NOPE",
        q: "hop dong",
        kinds: ["record"],
        limit: 10,
        offset: 0,
      }),
    ).rejects.toThrow(/no roles/u);
  });
});
