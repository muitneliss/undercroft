// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { type RawDocumentRow, tombstoneMissing, upsertDocuments } from "./rawDocuments.ts";

let db: TestDatabase;

const IDENTITY = { source: "gmail", tenantId: "CASE-0042" } as const;
const EARLIER = "2026-09-17T09:00:00.000Z";
const LATER = "2026-09-17T12:00:00.000Z";

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  // Every statement runs as the worker does, so a missing grant on raw.documents fails here.
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

function doc(over: Partial<RawDocumentRow> = {}): RawDocumentRow {
  return {
    documentId: "19a2f:001",
    lakeKey: "documents/gmail/CASE-0042/19a2f:001",
    sha256: "a".repeat(64),
    byteLength: "2048",
    contentType: "application/pdf",
    metadataJson: '{"partIndex":1}',
    observedAt: LATER,
    runId: "run-1",
    ...over,
  };
}

async function shaOf(documentId: string): Promise<string | undefined> {
  const { rows } = await db.query<{ sha256: string }>(
    "SELECT sha256 FROM raw.documents WHERE document_id = $1",
    [documentId],
  );
  return rows[0]?.sha256;
}

describe("upsertDocuments", () => {
  it("a document never seen before is created", async () => {
    const counts = await upsertDocuments(db, IDENTITY, [doc()]);

    expect(counts).toEqual({ created: 1, changed: 0, unchanged: 0 });
  });

  it("re-landing identical bytes writes no new row version", async () => {
    // The idempotency guard. Without it an hourly schedule rewrites every row every hour,
    // which is WAL and index churn for no information.
    await upsertDocuments(db, IDENTITY, [doc()]);

    const counts = await upsertDocuments(db, IDENTITY, [doc({ runId: "run-2" })]);

    expect(counts).toEqual({ created: 0, changed: 0, unchanged: 1 });
  });

  it("a document whose bytes changed is updated", async () => {
    // The quiet side of the same guard: a rule that never updated would pass the test
    // above and lose every revision.
    await upsertDocuments(db, IDENTITY, [doc()]);

    const counts = await upsertDocuments(db, IDENTITY, [doc({ sha256: "b".repeat(64) })]);

    expect(counts).toEqual({ created: 0, changed: 1, unchanged: 0 });
    expect(await shaOf("19a2f:001")).toBe("b".repeat(64));
  });

  it("an older observation does not overwrite a newer row", async () => {
    // No time travel. A backfill running beside the hourly schedule must not rewind a row
    // to a state the source has already moved past.
    await upsertDocuments(db, IDENTITY, [doc({ observedAt: LATER, sha256: "b".repeat(64) })]);

    const counts = await upsertDocuments(db, IDENTITY, [
      doc({ observedAt: EARLIER, sha256: "c".repeat(64) }),
    ]);

    expect(counts).toEqual({ created: 0, changed: 0, unchanged: 1 });
    expect(await shaOf("19a2f:001")).toBe("b".repeat(64));
  });

  it("a byte length beyond a float's exact range survives the round trip", async () => {
    // bigint, carried as text and cast by Postgres. Through a JS number this arrives as
    // 9007199254740992 -- a silently wrong file size.
    await upsertDocuments(db, IDENTITY, [doc({ byteLength: "9007199254740993" })]);

    const { rows } = await db.query<{ byte_length: string }>(
      "SELECT byte_length FROM raw.documents WHERE document_id = $1",
      ["19a2f:001"],
    );
    expect(String(rows[0]?.byte_length)).toBe("9007199254740993");
  });

  it("an empty batch touches nothing", async () => {
    expect(await upsertDocuments(db, IDENTITY, [])).toEqual({
      created: 0,
      changed: 0,
      unchanged: 0,
    });
  });
});

describe("tombstoneMissing", () => {
  it("a document the run no longer sees is tombstoned", async () => {
    await upsertDocuments(db, IDENTITY, [doc({ documentId: "gone" }), doc({ documentId: "kept" })]);

    const count = await tombstoneMissing(db, IDENTITY, {
      keptIds: ["kept"],
      observedAt: LATER,
    });

    expect(count).toBe(1);
    const { rows } = await db.query<{ document_id: string }>(
      "SELECT document_id FROM raw.documents WHERE deleted_at IS NOT NULL",
    );
    expect(rows.map((r) => r.document_id)).toEqual(["gone"]);
  });

  it("a document the run still sees is left alone", async () => {
    // The quiet side. A tombstoner that marked everything would pass the test above.
    await upsertDocuments(db, IDENTITY, [doc({ documentId: "kept" })]);

    const count = await tombstoneMissing(db, IDENTITY, { keptIds: ["kept"], observedAt: LATER });

    expect(count).toBe(0);
  });

  it("another tenant's documents are never tombstoned", async () => {
    // The identity is part of the WHERE clause, not a convention. A collector running for
    // one tenant must not reach into another's catalogue.
    await upsertDocuments(db, { source: "gmail", tenantId: "CASE-0043" }, [doc()]);

    const count = await tombstoneMissing(db, IDENTITY, { keptIds: [], observedAt: LATER });

    expect(count).toBe(0);
  });
});
