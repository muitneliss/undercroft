/**
 * `gmail_letters()`, run for real: one row per letter however many mailboxes hold it.
 *
 * This is the SQL the macro ships -- `dbtProject.test.ts` pins that the macro is this text
 * with dbt's `source()` in place of `raw.records` -- run on PGlite, as the tenant's own dbt
 * login, so the row-level policy and the grants a model build meets are the ones here.
 *
 * The two rules it holds are the issue's: a letter is its Message-ID, and a letter without
 * one stands alone rather than fusing with every other letter that lacks one; and evidence
 * one copy found belongs to the letter.
 */

import { afterEach, beforeEach, expect, test as it } from "bun:test";

import { gmailLettersSql } from "./services/dbtProject.ts";
import { createMigratedTestDatabase, type TestDatabase } from "./testing.ts";

const TENANT = "CASE-0042";
const SECOND_MAILBOX = "gmail.3fa9c1d2e0ab";
const THIRD_MAILBOX = "gmail.7be04c91d5f2";

interface Letter {
  readonly tenant_id: string;
  readonly letter_key: string;
  readonly rfc822_message_id: string | null;
  readonly copies: number;
  readonly sources: string[];
  readonly message_ids: string[];
  readonly thread_ids: string[];
  readonly message_time: Date | null;
  readonly documents_landed: number | null;
  readonly headers_conflict: boolean;
}

/** One mailbox's copy of a message, as the Gmail collector lands it. */
interface Copy {
  readonly source: string;
  readonly id: string;
  readonly headers?: Record<string, string>;
  readonly entity?: string;
  readonly documentsLanded?: number | null;
  readonly deletedAt?: string;
}

const INVOICE = {
  From: "Billing <billing@acme.example.test>",
  Subject: "Invoice 7",
  Date: "Tue, 01 Sep 2026 09:00:00 +0700",
  "Message-ID": "<invoice-7@acme.example.test>",
} as const;

let db: TestDatabase;
let dbtRole: string;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.exec(`INSERT INTO ops.tenant (id) VALUES ('${TENANT}')`);
  await db.query("SELECT ops.provision_tenant($1)", [TENANT]);
  const { rows } = await db.query<{ role: string }>(
    "SELECT role_name AS role FROM ops.tenant_role WHERE tenant_id = $1 AND kind = 'dbt'",
    [TENANT],
  );
  dbtRole = rows[0]?.role ?? "";
});

afterEach(async () => {
  await db.close();
});

/** Land each copy in `raw.records` as the superuser, the way the worker's loader would. */
async function land(...copies: readonly Copy[]): Promise<void> {
  for (const copy of copies) {
    const payload = {
      id: copy.id,
      threadId: `thread-${copy.id}`,
      labelIds: ["INBOX"],
      headers: copy.headers ?? {},
      internalDate: "1788228000000",
    };
    await db.query(
      `INSERT INTO raw.records (source, tenant_id, entity, source_record_id, payload,
         content_sha256, source_updated_at, observed_at, lake_key, lake_stamp, run_id,
         deleted_at, documents_landed)
       VALUES ($1, $2, $3, $4, $5::jsonb, repeat('0', 64), '2026-09-01T02:00:00Z', now(),
               'k', 's', 'r', $6, $7)`,
      [
        copy.source,
        TENANT,
        copy.entity ?? "messages",
        copy.id,
        JSON.stringify(payload),
        copy.deletedAt ?? null,
        copy.documentsLanded ?? null,
      ],
    );
  }
}

/** The macro's rows, read by the tenant's own dbt login. */
async function letters(): Promise<Letter[]> {
  return db.asRole(dbtRole, async (tx) => {
    const { rows } = await tx.query<Letter>(
      `SELECT * FROM ${gmailLettersSql("raw.records")} l ORDER BY l.letter_key`,
    );
    return rows;
  });
}

it("the same letter in two mailboxes is one letter carrying both copies' ids", async () => {
  await land(
    { source: "gmail", id: "18c1a", headers: INVOICE },
    { source: SECOND_MAILBOX, id: "19f0b", headers: INVOICE },
  );

  expect(await letters()).toEqual([
    {
      tenant_id: TENANT,
      letter_key: "<invoice-7@acme.example.test>",
      rfc822_message_id: "<invoice-7@acme.example.test>",
      copies: 2,
      sources: ["gmail", SECOND_MAILBOX],
      message_ids: ["18c1a", "19f0b"],
      thread_ids: ["thread-18c1a", "thread-19f0b"],
      message_time: new Date("2026-09-01T02:00:00Z"),
      documents_landed: null,
      headers_conflict: false,
    },
  ]);
});

it("two letters without a Message-ID stay two letters, each keyed on its own id", async () => {
  // A blank header and an absent one are the same absence. Grouping on it would fuse every
  // such letter the tenant holds into one message that never existed.
  const { "Message-ID": _anchor, ...unanchored } = INVOICE;
  await land(
    { source: "gmail", id: "20aa1", headers: { ...unanchored, "Message-ID": "   " } },
    { source: "gmail", id: "20aa2", headers: unanchored },
  );

  const rows = await letters();
  expect(rows.map((l) => [l.letter_key, l.rfc822_message_id, l.copies])).toEqual([
    ["gmail:20aa1", null, 1],
    ["gmail:20aa2", null, 1],
  ]);
});

it("a copy stored under the legacy Message-Id spelling folds with a Message-ID copy", async () => {
  const { "Message-ID": anchor, ...rest } = INVOICE;
  await land(
    { source: "gmail", id: "18c1a", headers: { ...rest, "Message-Id": anchor } },
    { source: SECOND_MAILBOX, id: "19f0b", headers: INVOICE },
  );

  const rows = await letters();
  expect(rows.map((l) => [l.rfc822_message_id, l.copies])).toEqual([[anchor, 2]]);
});

it("copies that disagree on the Subject are flagged as a conflict", async () => {
  await land(
    { source: "gmail", id: "18c1a", headers: INVOICE },
    { source: SECOND_MAILBOX, id: "19f0b", headers: { ...INVOICE, Subject: "Invoice 8" } },
  );

  const rows = await letters();
  expect(rows.map((l) => [l.copies, l.headers_conflict])).toEqual([[2, true]]);
});

it("a header one copy carries and another lacks is a conflict, not agreement", async () => {
  // count(DISTINCT) alone skips the NULL and would call these two the same letter's copies
  // in full agreement. See `disagree` in dbtProject.ts.
  const { Subject: _subject, ...withoutSubject } = INVOICE;
  await land(
    { source: "gmail", id: "18c1a", headers: INVOICE },
    { source: SECOND_MAILBOX, id: "19f0b", headers: withoutSubject },
  );

  const rows = await letters();
  expect(rows.map((l) => [l.copies, l.headers_conflict])).toEqual([[2, true]]);
});

it("documents_landed is the strongest copy's count, a copy that did not say ignored", async () => {
  await land(
    { source: "gmail", id: "18c1a", headers: INVOICE, documentsLanded: null },
    { source: SECOND_MAILBOX, id: "19f0b", headers: INVOICE, documentsLanded: 0 },
    { source: THIRD_MAILBOX, id: "1a2c3", headers: INVOICE, documentsLanded: 3 },
  );

  const rows = await letters();
  expect(rows.map((l) => [l.copies, l.documents_landed])).toEqual([[3, 3]]);
});

it("rows that are not live Gmail messages are not letters", async () => {
  await land(
    { source: "gmail", id: "18c1a", headers: INVOICE },
    { source: "drive", id: "d-1", headers: INVOICE },
    { source: "gmailx", id: "x-1", headers: INVOICE },
    { source: "gmail", id: "t-1", headers: INVOICE, entity: "threads" },
    {
      source: SECOND_MAILBOX,
      id: "19f0b",
      headers: INVOICE,
      deletedAt: "2026-09-02T00:00:00Z",
    },
  );

  const rows = await letters();
  expect(rows.map((l) => [l.sources, l.message_ids])).toEqual([[["gmail"], ["18c1a"]]]);
});
