/**
 * `350_document_text_tool_remarks.sql`: the one-off that sends every text holding a reader's own
 * stderr remarks back to be read again.
 *
 * Applied again over rows seeded the way production holds them, for the reason
 * `xeroReread.test.ts` gives: the migrated fixture ran it against an empty table.
 */

import { afterEach, beforeEach, expect, test as it } from "bun:test";
import { loadMigrations } from "./migrate.ts";
import { createMigratedTestDatabase, type TestDatabase } from "./testing.ts";

const REPAIR = loadMigrations().find(
  (migration) => migration.name === "350_document_text_tool_remarks.sql",
);

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.exec(`
    INSERT INTO raw.document_text
      (source, tenant_id, document_id, source_sha256, method, reason, text, chars, truncated,
       extracted_at, run_id)
    VALUES
      ('drive', 'CASE-0042', 'blank-image', repeat('a', 64), 'image_ocr', NULL,
       E'\\n\\f\\nEstimating resolution as 190\\n', 30, false, now(), 'run-1'),
      ('drive', 'CASE-0042', 'scan', repeat('b', 64), 'pdf_text', NULL,
       E'\\f\\nSyntax Error (571171): No font in show\\n', 40, false, now(), 'run-1'),
      ('drive', 'CASE-0042', 'invoice', repeat('c', 64), 'pdf_text', NULL,
       E'Invalid activity - Original invoice #: 17\\nPage 1 of 2', 50, false, now(), 'run-1'),
      ('drive', 'CASE-0042', 'manual', repeat('d', 64), 'docx', NULL,
       'Troubleshooting: a Syntax Error means the file is malformed.', 60, false, now(), 'run-1'),
      ('drive', 'CASE-0042', 'locked', repeat('e', 64), NULL, 'pdf-password-protected',
       '', 0, false, now(), 'run-1')`);
});

afterEach(async () => {
  await db.close();
});

async function documents(): Promise<string[]> {
  const { rows } = await db.query<{ document_id: string }>(
    "SELECT document_id FROM raw.document_text ORDER BY document_id",
  );
  return rows.map((row) => row.document_id);
}

it("sends a text holding a reader's stderr remark back to be read again", async () => {
  await db.exec(REPAIR?.sql ?? "SELECT missing_migration()");

  expect(await documents()).not.toContain("blank-image");
  expect(await documents()).not.toContain("scan");
});

it("leaves a clean read, an in-process read that quotes the words, and a refusal alone", async () => {
  // The quiet side. "Invalid activity" is a real invoice line that sits beside poppler's
  // "Syntax Warning: Invalid Font Weight" in production texts; a docx never went through a
  // child process; a refusal has no text to be wrong.
  await db.exec(REPAIR?.sql ?? "SELECT missing_migration()");

  expect(await documents()).toEqual(["invoice", "locked", "manual"]);
});
