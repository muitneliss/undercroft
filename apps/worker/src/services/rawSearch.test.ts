/**
 * What the lake search promises, proven as the login that actually runs it.
 *
 * The statement is exercised through `sessionsBySetRole`, so it runs as `undercroft_dbt_<slug>`
 * exactly as in production: a grant it does not hold, or a row the policy does not show it,
 * fails here rather than at 02:00. The one thing PGlite cannot prove is that a hostile
 * connection cannot escape `SET ROLE`; that is the Docker tier's, as everywhere else.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { MAX_SEARCH_HITS } from "@undercroft/contracts";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import type { QueryDeps } from "./queryRunner.ts";
import { QUERY_TIMEOUT_MS } from "./queryRunner.ts";
import { QueryTimedOut } from "./queryTimeout.ts";
import { RANKED_PER_KIND, searchRaw } from "./rawSearch.ts";
import { sessionsBySetRole, type TenantSessions } from "./tenantSession.ts";

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
    // The quiet side of the cap: five matches are all ranked, and the answer does not say
    // otherwise.
    expect(found.capped).toEqual([]);
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

// #447, ADR 0123. A common word matched tens of thousands of rows and each was ranked and
// excerpted, so the search ran into its time limit. Each kind now ranks its newest matches
// only, and the answer says when that cut any.
describe("a word that matches more than a search ranks", () => {
  const CAP = RANKED_PER_KIND.document;

  beforeEach(async () => {
    // One more document than the cap, a day apart, so "the newest" has one right answer: every
    // one but `d1`.
    await db.asSuperuser(async (tx) => {
      await tx.query(
        `INSERT INTO raw.documents (source, tenant_id, document_id, lake_key, sha256, byte_length,
           observed_at, run_id)
         SELECT 'demo', $1, 'd' || g, 'k', repeat('0', 64), 10,
                timestamptz '2026-01-01' + g * interval '1 day', 'r'
         FROM generate_series(1, $2::int) g`,
        [TENANT, CAP + 1],
      );
      await tx.query(
        `INSERT INTO raw.document_text (source, tenant_id, document_id, source_sha256, method,
           text, chars, truncated, extracted_at, run_id)
         SELECT 'demo', $1, 'd' || g, repeat('0', 64), 'pdf_text', 'Hợp đồng số ' || g, 12, false,
                timestamptz '2026-01-01' + g * interval '1 day', 'r'
         FROM generate_series(1, $2::int) g`,
        [TENANT, CAP + 1],
      );
    });
  });

  it("ranks the newest, says so, and pages over them without skipping or repeating one", async () => {
    const seen: string[] = [];
    for (let offset = 0; offset <= CAP; offset += MAX_SEARCH_HITS) {
      const page = await searchRaw(deps, {
        tenantId: TENANT,
        q: "hop dong",
        kinds: ["document"],
        limit: MAX_SEARCH_HITS,
        offset,
      });
      // Every page says it, the empty one past the end included: that is the page on which
      // "no more hits" would otherwise be read as "nothing else matched".
      expect(page.capped).toEqual([{ kind: "document", ranked: CAP }]);
      seen.push(...page.hits.map((h) => (h.kind === "document" ? h.documentId : "")));
    }
    expect(seen).toHaveLength(CAP);
    expect(new Set(seen).size).toBe(CAP);
    expect(seen).not.toContain("d1");
  });

  it("names only the kind that was cut", async () => {
    await landRecord(TENANT, "r1", '{"note":"Hợp đồng thuê nhà"}');
    const found = await searchRaw(deps, {
      tenantId: TENANT,
      q: "hop dong",
      kinds: ["record", "document"],
      limit: 5,
      offset: 0,
    });
    expect(found.capped).toEqual([{ kind: "document", ranked: CAP }]);
  });
});

describe("a search Postgres stopped at its time limit", () => {
  /** A session seam whose statement fails as the driver reports `error`. */
  function failingWith(error: Error): QueryDeps {
    const sessions: TenantSessions = {
      as: () => Promise.reject(error),
      withPassword: () => Promise.reject(error),
    };
    return { exec: db, sessions };
  }

  /** What `pg` raises for a server error: Postgres's sentence, and its SQLSTATE as `code`. */
  function serverError(message: string, code: string): Error {
    return Object.assign(new Error(message), { code });
  }

  const question = {
    tenantId: TENANT,
    q: "invoice",
    kinds: ["record" as const],
    limit: 2,
    offset: 0,
  };

  it("is named a timeout, carrying the limit it ran into", async () => {
    const refusal = await searchRaw(
      failingWith(serverError("canceling statement due to statement timeout", "57014")),
      question,
    ).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(QueryTimedOut);
    expect((refusal as QueryTimedOut).limitMs).toBe(QUERY_TIMEOUT_MS);
  });

  it("is not confused with a statement cancelled by hand, which shares its code", async () => {
    // The quiet side. 57014 is also `pg_cancel_backend`; telling that reader to narrow a
    // question that never ran into any limit would be a guess dressed as a fact.
    const cancelled = serverError("canceling statement due to user request", "57014");
    const refusal = await searchRaw(failingWith(cancelled), question).catch(
      (error: unknown) => error,
    );
    expect(refusal).toBe(cancelled);
  });
});

describe("searchRaw narrowed to the streams a reader reaches (ADR 0142)", () => {
  beforeEach(async () => {
    await landRecord(TENANT, "1", '{"deal_name":"Hợp đồng thuê nhà"}');
    await landDocument(TENANT, "d1", "Hợp đồng thuê nhà số 42.");
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO raw.records (source, tenant_id, entity, source_record_id, payload,
           content_sha256, observed_at, lake_key, lake_stamp, run_id)
         VALUES ('demo', $1, 'companies', 'c1', '{"name":"Hợp đồng thuê nhà"}'::jsonb,
                 repeat('0', 64), now(), 'k', 's', 'r')`,
        [TENANT],
      ),
    );
  });

  const ask = {
    tenantId: TENANT,
    q: "hop dong",
    kinds: ["record", "document"] as const,
    limit: 10,
    offset: 0,
  };

  function found(hits: Awaited<ReturnType<typeof searchRaw>>["hits"]): string[] {
    return hits
      .map((hit) =>
        hit.kind === "record" ? `${hit.entity}/${hit.sourceRecordId}` : `doc/${hit.documentId}`,
      )
      .sort();
  }

  it("finds in the streams it is given, a whole source in all of that source's, and nowhere else", async () => {
    const deals = await searchRaw(deps, { ...ask, streams: [{ source: "demo", entity: "deals" }] });
    const documents = await searchRaw(deps, {
      ...ask,
      streams: [{ source: "demo", entity: "documents" }],
    });
    const source = await searchRaw(deps, { ...ask, streams: [{ source: "demo", entity: null }] });
    const none = await searchRaw(deps, { ...ask, streams: [] });

    expect(found(deals.hits)).toEqual(["deals/1"]);
    expect(found(documents.hits)).toEqual(["doc/d1"]);
    expect(found(source.hits)).toEqual(["companies/c1", "deals/1", "doc/d1"]);
    expect(none.hits).toEqual([]);
  });

  it("with no narrowing, finds in the whole lake as before", async () => {
    const whole = await searchRaw(deps, ask);

    expect(found(whole.hits)).toEqual(["companies/c1", "deals/1", "doc/d1"]);
  });
});
