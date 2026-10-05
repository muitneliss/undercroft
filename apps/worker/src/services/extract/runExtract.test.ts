/**
 * The extract pass, end to end and entirely offline.
 *
 * Real PGlite, a real in-memory lake, and a spawn that answers the way poppler would -- so
 * this suite runs with no poppler installed, which is what the offline gate demands. It runs
 * as `undercroft_worker`, so a missing grant on the new table fails here rather than at 02:00.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { createStampSource, TestClock } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { listExtractDue } from "../schedule.ts";
import type { Spawn } from "../transform.ts";
import { cfbOf } from "./cfbTesting.ts";
import { runExtract } from "./runExtract.ts";
import { zipOf } from "./testing.ts";

const TENANT = "CASE-0042";
const ACRA_LOCATION = "acratrustbar.gov.sg";
const SOURCE = "drive";
const A_PAGE =
  "Acme Holdings agrees to supply the services described in schedule one, " +
  "invoiced monthly in arrears, for a term of twelve months from the commencement date.";

let db: TestDatabase;
let lake: LakeStore;
let spawned: string[][];

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  spawned = [];
  // From here every statement runs as the worker does in production.
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

/** A spawn that answers as `pdftotext` would, and records that it was reached. */
function spawnAnswering(stdout: string): Spawn {
  return (cmd) => {
    spawned.push([...cmd]);
    return Promise.resolve({ exitCode: 0, stdout, stderr: "" });
  };
}

/**
 * PGlite is a single connection, so a transaction is BEGIN/COMMIT on it -- real enough for what
 * the pass needs one for: a workbook's rows replaced as one unit.
 */
async function transactor<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
  await db.exec("BEGIN");
  try {
    const result = await fn(db);
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

/** Land bytes in the lake and catalogue them, the way an ingest run leaves them. */
async function landDocument(input: {
  documentId: string;
  bytes: Uint8Array;
  contentType: string;
  source?: string;
}): Promise<string> {
  const source = input.source ?? SOURCE;
  const lakeKey = `documents/${source}/${TENANT}/${input.documentId}`;
  const put = await lake.put(lakeKey, input.bytes, { runId: "run-seed" });
  await db.query(
    `INSERT INTO raw.documents
       (source, tenant_id, document_id, lake_key, sha256, byte_length, content_type,
        observed_at, run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), 'run-seed')`,
    [
      source,
      TENANT,
      input.documentId,
      lakeKey,
      put.sha256,
      String(input.bytes.byteLength),
      input.contentType,
    ],
  );
  return put.sha256;
}

function extract(spawn: Spawn, runId = "run-extract-1", source = SOURCE) {
  return runExtract({ exec: db, lake, spawn, transactor }, { tenantId: TENANT, source, runId });
}

async function textRows(): Promise<
  {
    document_id: string;
    method: string | null;
    reason: string | null;
    text: string;
    chars: number;
  }[]
> {
  const { rows } = await db.query<{
    document_id: string;
    method: string | null;
    reason: string | null;
    text: string;
    chars: number;
  }>("SELECT document_id, method, reason, text, chars FROM raw.document_text ORDER BY document_id");
  return rows;
}

describe("a pass over landed documents", () => {
  it("reads what it can and records HOW, against the bytes it read", async () => {
    await landDocument({
      documentId: "f1",
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
      contentType: "application/pdf",
    });

    const result = await extract(spawnAnswering(A_PAGE));

    expect(result).toMatchObject({ read: 1, refused: 0, unreadable: 0 });
    const rows = await textRows();
    expect(rows[0]?.method).toBe("pdf_text");
    expect(rows[0]?.reason).toBeNull();
    expect(rows[0]?.text).toBe(A_PAGE);
    expect(rows[0]?.chars).toBeGreaterThan(80);
  });

  it("gives a document it cannot read a REASON, never an absent row", async () => {
    // An absent row means "not read yet" and puts the document back in the next run's queue
    // forever, at full cost. The reason is what stops that.
    await landDocument({
      documentId: "f2",
      bytes: legacyWorkbook("f2"),
      contentType: "application/vnd.ms-excel",
    });

    const result = await extract(spawnAnswering(A_PAGE));

    expect(result).toMatchObject({ read: 0, refused: 1 });
    const rows = await textRows();
    expect(rows[0]?.method).toBeNull();
    expect(rows[0]?.reason).toBe("xls-biff5-unsupported");
    // And the run hands the same refusal, with its reason, to the ledger -- not only a count.
    // Before that, `ops.run.refused` carried a number with nothing behind it. ADR 0039.
    expect(result.refusals).toEqual([
      { entity: "documents", sourceRecordId: "f2", reason: "xls-biff5-unsupported" },
    ]);
  });
});

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** An invented one-sheet ledger, as a whole OPC package (`pii.md`: Acme, not a client). */
const LEDGER_BYTES = zipOf([
  {
    name: "_rels/.rels",
    body: `<Relationships><Relationship Id="r1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  },
  {
    name: "xl/workbook.xml",
    body: `<workbook xmlns:r="${REL}"><sheets><sheet name="Ledger" sheetId="1" r:id="s1"/></sheets></workbook>`,
  },
  {
    name: "xl/_rels/workbook.xml.rels",
    body: `<Relationships><Relationship Id="s1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  },
  {
    name: "xl/worksheets/sheet1.xml",
    body:
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Acme Holdings</t></is></c>' +
      '<c r="C1"><v>1234.10</v></c></row></sheetData></worksheet>',
  },
]);

async function workbookRows(): Promise<unknown[]> {
  const { rows } = await db.query(
    `SELECT s.sheet_name, s.complete, r.row_number, r.cells
       FROM raw.document_sheets s JOIN raw.document_rows r USING (tenant_id, sha256, sheet_index)
      ORDER BY r.row_number`,
  );
  return rows;
}

describe("a workbook's rows", () => {
  it("are written against the bytes they were read from, cells under their letters", async () => {
    await landDocument({ documentId: "w1", bytes: LEDGER_BYTES, contentType: XLSX_TYPE });

    await extract(spawnAnswering(""));

    expect(await workbookRows()).toEqual([
      {
        sheet_name: "Ledger",
        complete: true,
        row_number: 1,
        cells: { A: "Acme Holdings", C: "1234.10" },
      },
    ]);
  });

  it("are one set when the same workbook lands under two sources, each pass replacing it", async () => {
    // An attachment also filed in Drive is one digest. Each source's pass reads it and replaces
    // that digest's rows; neither doubles them, and the second does not fail on the first's key.
    await landDocument({ documentId: "w1", bytes: LEDGER_BYTES, contentType: XLSX_TYPE });
    await landDocument({
      documentId: "m1:2",
      bytes: LEDGER_BYTES,
      contentType: XLSX_TYPE,
      source: "gmail",
    });

    await extract(spawnAnswering(""), "run-drive", SOURCE);
    await extract(spawnAnswering(""), "run-gmail", "gmail");

    const { rows } = await db.query<{ run_id: string }>("SELECT run_id FROM raw.document_sheets");
    expect([rows, (await workbookRows()).length]).toEqual([[{ run_id: "run-gmail" }], 1]);
  });
});

/** An Excel 5/95 workbook (BIFF5), which no reader opens; `marker` varies its bytes. */
function legacyWorkbook(marker: string): Uint8Array {
  return cfbOf([
    { name: "Root Entry", type: 5, child: 1 },
    { name: "Book", type: 2, bytes: new TextEncoder().encode(`BIFF5 records ${marker}`) },
  ]);
}

/** A workbook's text as a reader before rows existed left it: read, from these bytes. */
async function seedReadText(
  documentId: string,
  sha256: string,
  text: string,
  method = "xlsx",
): Promise<void> {
  await db.query(
    `INSERT INTO raw.document_text (source, tenant_id, document_id, source_sha256, method, text,
       chars, extracted_at, run_id, reader_version)
     VALUES ($1, $2, $3, $4, $6, $5, char_length($5), now(), 'run-old', 6)`,
    [SOURCE, TENANT, documentId, sha256, text, method],
  );
}

/** Rows written under a rows generation older than any the pass writes. */
async function seedStaleRows(sha256: string): Promise<void> {
  await db.query(
    `INSERT INTO raw.document_sheets (tenant_id, sha256, sheet_index, sheet_name, sheet_state,
       container, date1904, row_count, complete, rows_version, extracted_at, run_id)
     VALUES ($1, $2, 1, 'Ledger', 'visible', 'ooxml', false, 1, true, 0, now(), 'run-old')`,
    [TENANT, sha256],
  );
  await db.query(
    `INSERT INTO raw.document_rows (tenant_id, sha256, sheet_index, row_number, cells)
     VALUES ($1, $2, 1, 1, '{"A": "held"}')`,
    [TENANT, sha256],
  );
}

describe("a workbook whose text passes the ceiling", () => {
  it("is read to its last row by the tenant's own model, while its text says it was cut (#385)", async () => {
    // Two thousand rows of 600 characters is 1.2M: past `MAX_TEXT_CHARS`. The text a search
    // index holds is capped and says so; the rows a model selects are whole, and the sheet
    // says that too. The query is the one a model compiles: the source tables, as the tenant.
    const filler = "x".repeat(600);
    const sheet = Array.from(
      { length: 2000 },
      (_, at) =>
        `<row r="${String(at + 1)}"><c r="A${String(at + 1)}" t="inlineStr"><is><t>${filler}</t></is></c>` +
        `<c r="B${String(at + 1)}"><v>${String(at + 1)}.10</v></c></row>`,
    ).join("");
    const bytes = zipOf([
      {
        name: "xl/worksheets/sheet1.xml",
        body: `<worksheet><sheetData>${sheet}</sheetData></worksheet>`,
      },
    ]);
    await landDocument({ documentId: "big", bytes, contentType: XLSX_TYPE });
    await extract(spawnAnswering(""));
    await db.asSuperuser((tx) => tx.query("SELECT ops.provision_tenant($1)", [TENANT]));

    const seen = await db.asRole("undercroft_dbt_case_0042", (tx) =>
      tx.query<{ row_number: number; amount: string; complete: boolean; truncated: boolean }>(
        `SELECT r.row_number, r.cells ->> 'B' AS amount, s.complete, t.truncated
           FROM raw.documents d
           JOIN raw.document_text t USING (source, tenant_id, document_id)
           JOIN raw.document_sheets s ON s.tenant_id = d.tenant_id AND s.sha256 = d.sha256
           JOIN raw.document_rows r
             ON r.tenant_id = s.tenant_id AND r.sha256 = s.sha256 AND r.sheet_index = s.sheet_index
          ORDER BY r.row_number DESC LIMIT 1`,
      ),
    );

    expect(seen.rows).toEqual([
      { row_number: 2000, amount: "2000.10", complete: true, truncated: true },
    ]);
  });
});

describe("a workbook read before its rows existed", () => {
  it("makes its scope due when it is the only work there is", async () => {
    const sha = await landDocument({
      documentId: "w1",
      bytes: LEDGER_BYTES,
      contentType: XLSX_TYPE,
    });
    await seedReadText("w1", sha, "Acme Holdings\t1234.10");

    expect((await listExtractDue(db)).due).toEqual([{ tenantId: TENANT, source: SOURCE }]);
  });

  it("is read again for its rows, and its text brought to the same reading", async () => {
    // The text an older reader left slid C's amount into B; the rows and the text are now one
    // reading of the same bytes.
    const sha = await landDocument({
      documentId: "w1",
      bytes: LEDGER_BYTES,
      contentType: XLSX_TYPE,
    });
    await seedReadText("w1", sha, "Acme Holdings\t1234.10");

    await extract(spawnAnswering(""));

    const [text] = await textRows();
    expect([(await workbookRows()).length, text?.text]).toEqual([1, "Acme Holdings\t\t1234.10"]);
  });

  it("keeps the rows and the text it holds when the reader now refuses it, and says why", async () => {
    // The 2,602-document rule: a re-read that cannot read never replaces a reading with nothing.
    const sha = await landDocument({
      documentId: "w1",
      bytes: new TextEncoder().encode("not a workbook any more"),
      contentType: XLSX_TYPE,
    });
    await seedReadText("w1", sha, "held text");
    await seedStaleRows(sha);

    await extract(spawnAnswering(""));

    const { rows: refused } = await db.query<{ reason: string }>(
      "SELECT reason FROM raw.document_rows_refusal",
    );
    const [text] = await textRows();
    expect([text?.text, (await workbookRows()).length, refused]).toEqual([
      "held text",
      1,
      [{ reason: "workbook-not-a-workbook" }],
    ]);
  });
});

describe("a CSV read as text before its rows existed", () => {
  it("is read again for its rows, its text left as the file it is", async () => {
    // ADR 0107: a delimited file's method is `txt`, so it is owed rows by its type.
    const file = "Customer,Amount\nAcme Holdings,1234.10\n";
    const sha = await landDocument({
      documentId: "c1",
      bytes: new TextEncoder().encode(file),
      contentType: "text/csv",
    });
    await seedReadText("c1", sha, file, "txt");

    await extract(spawnAnswering(""));

    const { rows } = await db.query<{ cells: unknown }>(
      "SELECT cells FROM raw.document_rows ORDER BY row_number",
    );
    const [text] = await textRows();
    expect([rows.map((row) => row.cells), text?.text]).toEqual([
      [
        { A: "Customer", B: "Amount" },
        { A: "Acme Holdings", B: "1234.10" },
      ],
      file,
    ]);
  });
});

describe("a workbook the reader refused under this rows generation", () => {
  it("is not owed again, so it cannot head every batch for ever", async () => {
    const sha = await landDocument({
      documentId: "w1",
      bytes: new TextEncoder().encode("not a workbook any more"),
      contentType: XLSX_TYPE,
    });
    await seedReadText("w1", sha, "held text");

    await extract(spawnAnswering(""));

    expect((await listExtractDue(db)).due).toEqual([]);
  });
});

describe("rows no live document holds", () => {
  it("are removed by the next pass over the tenant", async () => {
    await seedStaleRows("f".repeat(64));

    await extract(spawnAnswering(""));

    expect(await workbookRows()).toEqual([]);
  });
});

describe("a second pass", () => {
  it("does nothing when the bytes have not moved", async () => {
    // The mechanism that makes this verb schedulable. Without it every run re-reads the whole
    // catalogue, which for a real tenant is 252 MB of PDFs.
    await landDocument({
      documentId: "f1",
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
      contentType: "application/pdf",
    });
    await extract(spawnAnswering(A_PAGE));
    const afterFirst = spawned.length;

    const second = await extract(spawnAnswering(A_PAGE), "run-extract-2");

    expect(second).toMatchObject({ read: 0, refused: 0, unreadable: 0 });
    expect(spawned).toHaveLength(afterFirst);
    expect(await textRows()).toHaveLength(1);
  });

  it("re-reads a document whose bytes changed", async () => {
    // The firing side of the same guard: a sha that no longer matches is the only signal
    // that the customer replaced the file.
    const documentId = "f1";
    await landDocument({
      documentId,
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
      contentType: "application/pdf",
    });
    await extract(spawnAnswering("first version of the agreement, at some length, to pass"));

    // The same document, new bytes: what a re-ingest of an edited file leaves behind.
    await db.asSuperuser((tx) =>
      tx.query("UPDATE raw.documents SET sha256 = $1 WHERE document_id = $2", [
        "f".repeat(64),
        documentId,
      ]),
    );
    const second = await extract(spawnAnswering(A_PAGE), "run-extract-2");

    expect(second.read).toBe(1);
    const { rows } = await db.query<{ source_sha256: string; run_id: string }>(
      "SELECT source_sha256, run_id FROM raw.document_text",
    );
    expect(rows[0]?.source_sha256).toBe("f".repeat(64));
    expect(rows[0]?.run_id).toBe("run-extract-2");
  });
});

describe("a pass after the readers changed", () => {
  /**
   * Land a document, read it once, then age its row to the generation before this one --
   * which is what a release that bumps `CURRENT_READER_VERSION` does to every existing row.
   */
  async function aged(input: { documentId: string; contentType: string }): Promise<void> {
    await landDocument({
      documentId: input.documentId,
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
      contentType: input.contentType,
    });
    await extract(spawnAnswering(A_PAGE));
    await db.asSuperuser((tx) =>
      tx.query("UPDATE raw.document_text SET reader_version = reader_version - 1"),
    );
  }

  it("re-reads a refusal, and stamps it so the pass after that does not", async () => {
    // The whole point of the slice, end to end: 1,190 documents on production are recorded
    // `unsupported-content-type` for types this platform can now read, and a refusal with
    // unchanged bytes is otherwise permanent. `runExtract` must ask and stamp with ONE
    // generation -- asking with an older number than it writes would loop this document for
    // ever, and the reverse would retire it before any reader looked at it.
    await aged({ documentId: "f2", contentType: "application/vnd.ms-excel" });

    const second = await extract(spawnAnswering(A_PAGE), "run-extract-2");
    const third = await extract(spawnAnswering(A_PAGE), "run-extract-3");

    expect(second).toMatchObject({ read: 0, refused: 1 });
    expect(third).toMatchObject({ read: 0, refused: 0, unreadable: 0 });
    // PDF bytes under an Excel label: the label says spreadsheet, the bytes say otherwise.
    expect((await textRows())[0]?.reason).toBe("workbook-not-a-workbook");
  });
});

describe("a pass after the layouts changed", () => {
  /**
   * What a verified 2024 ACRA profile's text was before its template was known: the
   * verification this worker wrote, then the unwrapped `data`. Invented, like every fixture.
   */
  function readingBeforeItsTemplate(location: string): string {
    const verification = {
      verified: true,
      documentIntegrity: "VALID",
      documentStatus: "VALID",
      issuerIdentity: "VALID",
      issuers: [
        { name: "REGISTRY", identityProofType: "DNS-DID", identityProofLocation: location },
      ],
    };
    const data = {
      $template: { name: "BP-COMPANY-2024-1", type: "EMBEDDED_RENDERER" },
      uen: "209900001A",
      entityName: "ACME HOLDINGS PTE. LTD.",
      statusDate: "01 Jul 2026",
      representatives: [{ name: "ALEX EXAMPLE", position: "Director", isNominee: "true" }],
    };
    const openAttestation = { version: "https://schema.openattestation.com/2.0/schema.json" };
    return JSON.stringify({ openAttestation: { ...openAttestation, verification }, data }, null, 2);
  }

  /** Land a document and its text as a release before this one wrote it: layout generation 0. */
  async function heldAsRead(documentId: string, method: string, text: string): Promise<void> {
    const sha256 = await landDocument({
      documentId,
      bytes: new TextEncoder().encode(text),
      contentType: method === "openattestation" ? "application/json" : "application/pdf",
    });
    await db.query(
      `INSERT INTO raw.document_text
         (source, tenant_id, document_id, source_sha256, method, text, chars, truncated,
          extracted_at, run_id, reader_version)
       VALUES ($1, $2, $3, $4, $5, $6, char_length($6), false,
               '2026-09-01T00:00:00Z', 'run-before', 5)`,
      [SOURCE, TENANT, documentId, sha256, method, text],
    );
  }

  async function held(documentId: string): Promise<{ text: string; run_id: string }> {
    const { rows } = await db.query<{ text: string; run_id: string }>(
      "SELECT text, run_id FROM raw.document_text WHERE document_id = $1",
      [documentId],
    );
    return rows[0] ?? { text: "", run_id: "" };
  }

  it("lays a profile read before its template was known out again, reading nothing", async () => {
    // #313: 418 verified 2024 profiles on production were stored as their unwrapped data. A
    // read cannot reach them -- they WERE read -- and re-reading would re-verify over DNS.
    await heldAsRead("profile", "openattestation", readingBeforeItsTemplate(ACRA_LOCATION));
    await heldAsRead("contract", "pdf_text", A_PAGE);

    const result = await extract(spawnAnswering(A_PAGE));

    expect(result).toMatchObject({ read: 0, refused: 0, relaid: 1 });
    expect(spawned).toEqual([]);
    const profile = await held("profile");
    expect(profile.run_id).toBe("run-extract-1");
    expect(JSON.parse(profile.text).acraBusinessProfile).toMatchObject({
      uen: "209900001A",
      statusDate: "2026-07-01",
      officers: [{ name: "ALEX EXAMPLE", isNominee: true }],
    });
    // Another reader's text is not looked at, let alone moved.
    expect(await held("contract")).toEqual({ text: A_PAGE, run_id: "run-before" });
  });

  it("looks once at a text that will never be a profile, and is then not due", async () => {
    // Stamping the text that stays is what stops the scheduler starting a run for this scope
    // on every tick for ever, over a document from another issuer.
    const elsewhere = readingBeforeItsTemplate("registry.example.test");
    await heldAsRead("other-issuer", "openattestation", elsewhere);
    const scope = [{ tenantId: TENANT, source: SOURCE }];
    expect((await listExtractDue(db)).due).toEqual(scope);

    const result = await extract(spawnAnswering(A_PAGE));

    expect(result.relaid).toBe(0);
    expect(await held("other-issuer")).toEqual({ text: elsewhere, run_id: "run-before" });
    expect((await listExtractDue(db)).due).toEqual([]);
  });
});

describe("the same bytes catalogued several times", () => {
  it("spawns ONE reader and answers both documents", async () => {
    // The whole slice, end to end. Production holds 4,476 documents over 2,030 digests, and
    // since the OCR readers landed a thirty-page duplicate scan is thirty-one child processes
    // spent reproducing text we hold verbatim. `read` stays a count of DOCUMENTS -- it is what
    // `job.ts` records as the run's `created` -- so the saving shows as the spawn count, not as
    // a number that halved. That the sibling is then off the backlog, and that another
    // customer's copy is never answered, are the repo's to prove (`documentText.test.ts`).
    //
    // The same attachment quoted down a reply chain: one row per message, one set of bytes.
    const bytes = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
    for (const documentId of ["msg-1:2", "msg-2:2"]) {
      await landDocument({ documentId, bytes, contentType: "application/pdf" });
    }

    const result = await extract(spawnAnswering(A_PAGE));

    expect(spawned).toHaveLength(1);
    expect(result).toMatchObject({ read: 2, refused: 0, unreadable: 0 });
    const rows = await textRows();
    expect(rows.map((r) => r.document_id)).toEqual(["msg-1:2", "msg-2:2"]);
    expect(rows.every((r) => r.method === "pdf_text")).toBe(true);
  });
});

describe("a document whose text holds a NUL byte", () => {
  it("is answered, and does not cost the rest of its batch their text (#218)", async () => {
    // Regression. A NUL is valid UTF-8, so the text reader decoded it into the text, and a
    // Postgres `text` column cannot hold U+0000. The batch is ONE statement, so the one file
    // failed the whole write, nothing of the batch was stored, and the next run drew the same
    // batch and failed the same way -- on production the backlog grew by 1,200 while the
    // readable count stood still.
    await landDocument({
      documentId: "contract",
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
      contentType: "application/pdf",
    });
    await landDocument({
      documentId: "export",
      bytes: new TextEncoder().encode("Acme Holdings\u0000,1234.10\n"),
      contentType: "text/plain",
    });

    const result = await extract(spawnAnswering(A_PAGE));

    expect(result).toMatchObject({ read: 2, refused: 0, unreadable: 0 });
    const rows = await textRows();
    expect(rows.find((r) => r.document_id === "contract")?.text).toBe(A_PAGE);
    // The byte Postgres cannot hold is replaced where it stood, visibly, and not dropped: the
    // row says something here was not text. `extractText.ts`'s `read` records why.
    expect(rows.find((r) => r.document_id === "export")).toMatchObject({
      method: "txt",
      text: "Acme Holdings�,1234.10\n",
    });
    // And the backlog drained, rather than handing the next run the same batch.
    const second = await extract(spawnAnswering(A_PAGE), "run-extract-2");
    expect(second).toMatchObject({ read: 0, pendingBefore: 0 });
  });
});

describe("a document the lake cannot hand back", () => {
  it("is recorded against the document rather than ending the pass", async () => {
    // One unreadable object must not cost the other 499 their run.
    await db.query(
      `INSERT INTO raw.documents
         (source, tenant_id, document_id, lake_key, sha256, byte_length, content_type,
          observed_at, run_id)
       VALUES ($1, $2, 'ghost', 'documents/drive/CASE-0042/ghost', $3, '10',
               'application/pdf', now(), 'run-seed')`,
      [SOURCE, TENANT, "a".repeat(64)],
    );

    const result = await extract(spawnAnswering(A_PAGE));

    expect(result.unreadable).toBe(1);
    expect((await textRows())[0]?.reason).toBe("lake-object-unreadable");
  });
});

describe("who may read the text", () => {
  // Land a row, then provision both tenants so their own dbt logins exist. Every test below
  // only reads what this leaves; they differ in who is asking.
  beforeEach(async () => {
    await landDocument({
      documentId: "f1",
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
      contentType: "application/pdf",
    });
    await extract(spawnAnswering(A_PAGE));
    await db.asSuperuser(async (tx) => {
      await tx.query("INSERT INTO ops.tenant (id) VALUES ('CASE-0043')");
      await tx.query("SELECT ops.provision_tenant($1)", [TENANT]);
      await tx.query("SELECT ops.provision_tenant('CASE-0043')");
    });
  });

  it("a tenant's own dbt role reads its own text -- the point of the table", async () => {
    // ADR 0024, and proven rather than assumed: `040_grants.sql` expanded ON ALL TABLES when
    // it ran and never runs again, and `ops.provision_tenant` grants raw BY TABLE NAME -- so
    // a table added later is invisible to every tenant unless both are dealt with.
    const seen = await db.asRole("undercroft_dbt_case_0042", (tx) =>
      tx.query<{ n: string }>("SELECT count(*)::text AS n FROM raw.document_text"),
    );

    expect(seen.rows[0]?.n).toBe("1");
  });

  it("another tenant's dbt role reads NONE of it", async () => {
    // The row-level policy, and the reason this table cannot ship without one: the grant says
    // which ROLES may read the table, only the policy says which ROWS, and the rows here are
    // the full text of somebody's contracts.
    const seen = await db.asRole("undercroft_dbt_case_0043", (tx) =>
      tx.query<{ n: string }>("SELECT count(*)::text AS n FROM raw.document_text"),
    );

    expect(seen.rows[0]?.n).toBe("0");
  });

  it("the legacy shared dbt role reads none of it either", async () => {
    // It matches no tenant, so `raw.tenant_of(current_user)` answers nothing and the policy
    // shows it zero rows -- the same answer 080 documents for `raw.records`.
    const seen = await db.asRole("undercroft_dbt", (tx) =>
      tx.query<{ n: string }>("SELECT count(*)::text AS n FROM raw.document_text"),
    );

    expect(seen.rows[0]?.n).toBe("0");
  });
});

/**
 * The half that made a 245-refusal run unexplainable.
 *
 * Before this, a refused document's reason reached `raw.document_text` and nothing else, so
 * `ops.run.refused` carried a number with nothing behind it and the journal's refusals table
 * was not drawn at all. ADR 0039.
 */
describe("what a pass hands the ledger", () => {
  it("counts the refusals by reason, biggest first", async () => {
    // The rollup is what survives the 7-day prune, so it is the thing that must be right
    // even when every per-record row beneath it is gone.
    // Distinct bytes, so these are two reads rather than one read answering two documents.
    // The weighting is covered on its own below.
    for (const id of ["a1", "a2"]) {
      await landDocument({
        documentId: id,
        bytes: legacyWorkbook(id),
        contentType: "application/vnd.ms-excel",
      });
    }
    await landDocument({
      documentId: "b1",
      bytes: new TextEncoder().encode("plain"),
      contentType: "application/x-nobody-reads-this",
    });

    const result = await extract(spawnAnswering(A_PAGE));

    expect(result.reasonCounts).toEqual([
      { entity: "documents", reason: "xls-biff5-unsupported", count: 2 },
      { entity: "documents", reason: "unsupported-content-type", count: 1 },
    ]);
  });

  it("reports the whole queue behind it, not the batch it took", async () => {
    // `pending.length` is capped at the batch, so on a tenant with a backlog it reads 500
    // every time and says nothing about whether the backlog is draining. That difference is
    // what tells a healthy drain from a fault.
    // Distinct bytes per document, so each is its own read: this test is about the QUEUE, and
    // identical bytes would collapse to one read and measure the fan-out instead.
    for (const id of ["q1", "q2", "q3"]) {
      await landDocument({
        documentId: id,
        bytes: new TextEncoder().encode(`%PDF-1.7\n% ${id}\n%%EOF\n`),
        contentType: "application/pdf",
      });
    }

    const result = await runExtract(
      { exec: db, lake, spawn: spawnAnswering(A_PAGE), transactor, batch: 1 },
      { tenantId: TENANT, source: SOURCE, runId: "run-extract-batch" },
    );

    expect(result.read).toBe(1);
    expect(result.pendingBefore).toBe(3);
  });

  it("counts a reason in DOCUMENTS, so the rollup adds up to what the run refused", async () => {
    // One read answers every document holding those bytes (`upsertDocumentText` fans out), and
    // the rollup is what a reader presses into after reading "3 refused". Counting reads would
    // print 1 under a heading that says 3, with nothing to explain the difference.
    for (const id of ["dup1", "dup2", "dup3"]) {
      await landDocument({
        documentId: id,
        bytes: legacyWorkbook("the same legacy bytes"),
        contentType: "application/vnd.ms-excel",
      });
    }

    const result = await extract(spawnAnswering(A_PAGE));

    expect(result.refused).toBe(3);
    expect(result.reasonCounts).toEqual([
      { entity: "documents", reason: "xls-biff5-unsupported", count: 3 },
    ]);
    // And the ledger's own list is the distinct FILES, which is why the interface captions it
    // that way rather than claiming a row per document.
    expect(result.refusals).toHaveLength(1);
  });

  it("reports an empty queue as 0 rather than as no answer", async () => {
    // The quiet half of the guard above: 0 here is a real measurement of an empty queue, and
    // it must not be confused with "this verb has no queue", which is the NULL column.
    const result = await extract(spawnAnswering(A_PAGE));

    expect(result.pendingBefore).toBe(0);
    expect(result.reasonCounts).toEqual([]);
  });
});

/** An invented archive: a workbook, a note, and what is not landed beside them (`pii.md`). */
const ARCHIVE_BYTES = zipOf([
  { name: "ledger.xlsx", body: LEDGER_BYTES },
  { name: "notes/readme.txt", body: "Acme Holdings, statement for September" },
  { name: "logo.gif", body: "GIF89a" },
  { name: "__MACOSX/._ledger.xlsx", body: "resource fork" },
  { name: "inner.zip", body: zipOf([{ name: "a.txt", body: "nested" }]) },
  { name: "locked.pdf", body: "%PDF-1.7", encrypted: true },
  { name: "folder/", body: "" },
]);

async function members(): Promise<unknown[]> {
  const { rows } = await db.query(
    `SELECT document_id, content_type, metadata->>'archiveDocumentId' AS archive,
            metadata->>'archiveMember' AS position
       FROM raw.documents WHERE metadata ? 'archiveDocumentId' ORDER BY document_id`,
  );
  return rows.map((row) => Object.values(row));
}

describe("an archive", () => {
  it("lands each file it holds in a catalogued format as a document, read by the next pass", async () => {
    await landDocument({ documentId: "z1", bytes: ARCHIVE_BYTES, contentType: "application/zip" });

    const first = await extract(spawnAnswering(""));

    // The GIF names no catalogued format, the fork and the folder are not documents: none of
    // them lands, and none is a refusal. The nested archive and the encrypted file are.
    expect(await members()).toEqual([
      ["z1/1", XLSX_TYPE, "z1", "1"],
      ["z1/2", "text/plain", "z1", "2"],
    ]);
    expect(first.refusals).toEqual([
      { entity: "documents", sourceRecordId: "z1/5", reason: "archive-nested" },
      { entity: "documents", sourceRecordId: "z1/6", reason: "archive-member-encrypted" },
    ]);
    expect((await textRows()).map((row) => [row.document_id, row.method, row.text])).toEqual([
      ["z1", "zip", ""],
    ]);

    await extract(spawnAnswering(""), "run-extract-2");

    expect(await workbookRows()).toEqual([
      {
        sheet_name: "Ledger",
        complete: true,
        row_number: 1,
        cells: { A: "Acme Holdings", C: "1234.10" },
      },
    ]);
    expect((await textRows()).find((row) => row.document_id === "z1/2")?.text).toBe(
      "Acme Holdings, statement for September",
    );
  });

  it("lands its files under every document holding it, so each message keeps its own", async () => {
    const note = zipOf([{ name: "note.txt", body: "Acme Holdings" }]);
    await landDocument({ documentId: "m1:001", bytes: note, contentType: "application/zip" });
    await landDocument({ documentId: "m2:001", bytes: note, contentType: "application/zip" });

    await extract(spawnAnswering(""));

    expect(await members()).toEqual([
      ["m1:001/1", "text/plain", "m1:001", "1"],
      ["m2:001/1", "text/plain", "m2:001", "1"],
    ]);
  });

  it("is never unpacked when it is a package in a format of its own, such as a Word document", async () => {
    // Its parts are XML, a format the catalogue lands: unpacked, they would be documents.
    const docx = zipOf([
      { name: "[Content_Types].xml", body: "<Types/>" },
      { name: "word/document.xml", body: "<w:document/>" },
    ]);
    await landDocument({ documentId: "z3", bytes: docx, contentType: "application/zip" });

    await extract(spawnAnswering(""));

    expect([(await textRows())[0]?.reason, await members()]).toEqual([
      "unsupported-content-type",
      [],
    ]);
  });

  it("is refused whole when its list of files breaks off, never read as holding fewer", async () => {
    const bytes = zipOf([{ name: "note.txt", body: "Acme Holdings" }]);
    // The end record claims two files where the directory holds one.
    new DataView(bytes.buffer).setUint16(bytes.byteLength - 12, 2, true);
    await landDocument({ documentId: "z2", bytes, contentType: "application/x-zip-compressed" });

    await extract(spawnAnswering(""));

    expect([(await textRows())[0]?.reason, await members()]).toEqual(["archive-unreadable", []]);
  });
});
