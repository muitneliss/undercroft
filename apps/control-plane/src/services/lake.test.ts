/**
 * What the Lake division promises: the summary counts what landed per stream, the rows page
 * newest first, one tenant's rows never appear in another's, and a payload is shown as
 * Postgres rendered it -- every digit of a number the source sent.
 *
 * Runs as `undercroft_app`, so a missing grant on `raw.documents` fails here rather than at
 * first use in production.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { documents, records, summary } from "./lake.ts";

const TENANT = "CASE-0042";
const OTHER = "CASE-0043";
/** A number no float can hold. jsonb keeps it; JSON.parse would not. */
const EXACT = "12345678901234567890.123456789";

let db: TestDatabase;

interface SeedRecord {
  tenantId: string;
  entity: string;
  id: string;
  observedAt: string;
  payload: string;
  deletedAt?: string;
}

async function seedRecord(r: SeedRecord): Promise<void> {
  await db.query(
    `INSERT INTO raw.records (source, tenant_id, entity, source_record_id, payload,
       content_sha256, observed_at, lake_key, lake_stamp, run_id, deleted_at)
     VALUES ('hubspot', $1, $2, $3, $4::jsonb, repeat('0', 64), $5, 'k', 's', 'r-1', $6)`,
    [r.tenantId, r.entity, r.id, r.payload, r.observedAt, r.deletedAt ?? null],
  );
}

async function seedDocument(
  tenantId: string,
  id: string,
  bytes: number,
  observedAt: string,
): Promise<void> {
  await db.query(
    `INSERT INTO raw.documents (source, tenant_id, document_id, lake_key, sha256, byte_length,
       content_type, observed_at, run_id)
     VALUES ('gmail', $1, $2, 'k', repeat('0', 64), $3, 'application/pdf', $4, 'r-2')`,
    [tenantId, id, bytes, observedAt],
  );
}

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1), ($2)", [TENANT, OTHER]);

  const deals = { tenantId: TENANT, entity: "deals" };
  await seedRecord({
    ...deals,
    id: "d-1",
    observedAt: "2026-09-18T08:00:00Z",
    payload: '{"amount":"10.00"}',
  });
  await seedRecord({
    ...deals,
    id: "d-2",
    observedAt: "2026-09-18T09:00:00Z",
    payload: `{"amount":${EXACT}}`,
  });
  await seedRecord({
    ...deals,
    id: "d-3",
    observedAt: "2026-09-18T10:00:00Z",
    payload: '{"n":3}',
    deletedAt: "2026-09-19T00:00:00Z",
  });
  await seedRecord({
    tenantId: TENANT,
    entity: "companies",
    id: "c-1",
    observedAt: "2026-09-17T08:00:00Z",
    payload: '{"name":"Acme"}',
  });
  await seedRecord({
    tenantId: OTHER,
    entity: "deals",
    id: "d-1",
    observedAt: "2026-09-18T11:00:00Z",
    payload: '{"n":"theirs"}',
  });

  await seedDocument(TENANT, "m-1", 1000, "2026-09-18T08:00:00Z");
  await seedDocument(TENANT, "m-2", 2500, "2026-09-18T09:30:00Z");
  await seedDocument(OTHER, "m-1", 9999, "2026-09-18T12:00:00Z");

  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

describe("summary", () => {
  it("counts each stream, names its tombstones, and dates its newest observation", async () => {
    const got = await summary(db, TENANT);

    expect(got.records).toEqual([
      {
        source: "hubspot",
        entity: "companies",
        records: 1,
        tombstoned: 0,
        latestObservedAt: "2026-09-17T08:00:00.000Z",
      },
      {
        source: "hubspot",
        entity: "deals",
        records: 3,
        tombstoned: 1,
        latestObservedAt: "2026-09-18T10:00:00.000Z",
      },
    ]);
    expect(got.documents).toEqual([
      {
        source: "gmail",
        documents: 2,
        bytes: 3500,
        latestObservedAt: "2026-09-18T09:30:00.000Z",
      },
    ]);
  });

  it("a tenant with nothing landed has an empty summary, not a missing one", async () => {
    await db.asSuperuser((tx) => tx.query("INSERT INTO ops.tenant (id) VALUES ('CASE-0044')"));
    expect(await summary(db, "CASE-0044")).toEqual({ records: [], documents: [] });
  });
});

describe("records", () => {
  it("pages one stream newest first, and the cursor picks up exactly where the page ended", async () => {
    const first = await records(db, TENANT, { source: "hubspot", entity: "deals", limit: 2 });
    expect(first.items.map((r) => r.sourceRecordId)).toEqual(["d-3", "d-2"]);
    expect(first.items[0]?.deletedAt).toBe("2026-09-19T00:00:00.000Z");
    expect(first.nextCursor).not.toBeNull();

    const second = await records(db, TENANT, {
      source: "hubspot",
      entity: "deals",
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((r) => r.sourceRecordId)).toEqual(["d-1"]);
    expect(second.nextCursor).toBeNull();
  });

  it("the payload is Postgres's rendering, with every digit the source sent", async () => {
    const page = await records(db, TENANT, { source: "hubspot", entity: "deals", limit: 50 });
    const exact = page.items.find((r) => r.sourceRecordId === "d-2");

    expect(exact?.payload).toContain(EXACT);
    expect(typeof exact?.payload).toBe("string");
  });

  it("another tenant's rows are not in the page, whatever the stream", async () => {
    const page = await records(db, OTHER, { source: "hubspot", entity: "deals", limit: 50 });
    expect(page.items.map((r) => r.payload.replaceAll(/\s/gu, ""))).toEqual(['{"n":"theirs"}']);
  });

  it("a stream that never landed is an empty page", async () => {
    const page = await records(db, TENANT, { source: "xero", entity: "invoices", limit: 50 });
    expect(page).toEqual({ items: [], nextCursor: null });
  });
});

describe("documents", () => {
  it("lists the catalogue row for one source, newest first, with its size in bytes", async () => {
    const page = await documents(db, TENANT, { source: "gmail", limit: 50 });

    expect(page.items.map((d) => [d.documentId, d.bytes, d.contentType])).toEqual([
      ["m-2", 2500, "application/pdf"],
      ["m-1", 1000, "application/pdf"],
    ]);
    expect(page.items.every((d) => d.deletedAt === null)).toBe(true);
    expect(page.nextCursor).toBeNull();
  });

  it("pages, and never crosses into another tenant", async () => {
    const first = await documents(db, TENANT, { source: "gmail", limit: 1 });
    expect(first.items.map((d) => d.documentId)).toEqual(["m-2"]);

    const second = await documents(db, TENANT, {
      source: "gmail",
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.items.map((d) => d.documentId)).toEqual(["m-1"]);
    expect(second.nextCursor).toBeNull();
  });
});
