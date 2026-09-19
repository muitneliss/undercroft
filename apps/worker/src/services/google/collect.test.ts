/**
 * The Google collectors, end to end and entirely offline.
 *
 * Real PGlite, a real in-memory lake, and a byte fetcher that REFUSES an unmodelled request
 * -- so a collector that calls an endpoint nobody recorded fails loudly here rather than
 * returning nothing and reading as an empty mailbox.
 */

// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/security/noSecrets: False positives. The rule flags high-entropy string literals, and these are test fixtures with invented values (per .claude/rules/pii.md, fixtures are invented rather than anonymised), plus base64url sample tokens and SQL role names. No real credential is in any tracked file; CI enforces that separately.
// biome-ignore-all lint/style/noNonNullAssertion: Almost all of these are tests asserting on a fixture they created three lines earlier, which the ESLint config this replaced also exempted for the same reason. Biome's unsafe autofix for the rule deletes the `!` and leaves `string | undefined` flowing into a `string`, so it does not compile.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import { createPacer, createStampSource, InMemoryByteFetcher, TestClock } from "@undercroft/core";
import { migrate } from "@undercroft/db";
import { writeConnectionDetail } from "@undercroft/db/repos";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { createGoogleApi } from "./api.ts";
import { runGoogleCollect, ScopeNotChosen } from "./collect.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const TENANT = "CASE-0042";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n%%EOF\n");
/** base64url of PDF, as Gmail returns it in `body.data`. */
const PDF_B64 = Buffer.from(PDF).toString("base64url");

let db: TestDatabase;
let lake: LakeStore;
let fetcher: InMemoryByteFetcher;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  fetcher = new InMemoryByteFetcher();
});

afterEach(async () => {
  await db.close();
});

async function connect(source: string, selection: unknown): Promise<void> {
  await db.query(
    "INSERT INTO ops.connection (tenant_id, source, status) VALUES ($1, $2, 'connected')",
    [TENANT, source],
  );
  await writeConnectionDetail(db, {
    tenantId: TENANT,
    source,
    selectionJson: JSON.stringify(selection),
  });
}

function collect(source: "gmail" | "drive") {
  const clock = new TestClock();
  const api = createGoogleApi(source, {
    fetcher,
    token: () => Promise.resolve("tok"),
    clock,
    // No minimum interval. On a TestClock that nothing advances, a pacer that sleeps
    // between requests never wakes -- and pacing is not what these tests are about. It is
    // exercised against the clock it needs in `api.test.ts`.
    pacer: createPacer({}, clock),
  });
  return runGoogleCollect({ lake, exec: db, api }, { source, tenantId: TENANT });
}

function messageUrl(id: string): string {
  const url = new URL(`${GMAIL}/messages/${id}`);
  url.searchParams.set("format", "metadata");
  for (const header of ["From", "To", "Cc", "Subject", "Date", "Message-ID"]) {
    url.searchParams.append("metadataHeaders", header);
  }
  return url.toString();
}

function listUrl(labelId: string | null): string {
  const url = new URL(`${GMAIL}/messages`);
  url.searchParams.set("maxResults", "100");
  if (labelId !== null) {
    url.searchParams.set("labelIds", labelId);
  }
  return url.toString();
}

function message(id: string, labelIds: string[], withPdf = true): unknown {
  return {
    id,
    threadId: `t-${id}`,
    labelIds,
    internalDate: "1789400000000",
    payload: {
      headers: [
        { name: "Subject", value: `Invoice ${id}` },
        { name: "From", value: "billing@acme.test" },
      ],
      parts: withPdf
        ? [
            { mimeType: "text/plain", body: { size: "12" } },
            {
              mimeType: "application/pdf",
              filename: `invoice-${id}.pdf`,
              body: { size: String(PDF.byteLength), attachmentId: `att-${id}-rotates` },
            },
          ]
        : [{ mimeType: "text/plain", body: { size: "12" } }],
    },
  };
}

describe("a scope is required, never assumed", () => {
  it("a connection with no recorded scope is refused rather than defaulted", async () => {
    // The firing side. "Nobody has chosen yet" and "somebody chose everything" are
    // different facts, and guessing the second reads a whole mailbox on a missing row.
    await db.query(
      "INSERT INTO ops.connection (tenant_id, source, status) VALUES ($1, 'gmail', 'connected')",
      [TENANT],
    );

    await expect(collect("gmail")).rejects.toBeInstanceOf(ScopeNotChosen);
  });

  it("an empty label list is a recorded decision and does run", async () => {
    // The quiet side: empty labels means the whole mailbox, which the card renders as
    // "Headers and PDF attachments, whole mailbox".
    await connect("gmail", { labels: [] });
    fetcher.on("GET", listUrl(null), { body: { messages: [] } });

    await expect(collect("gmail")).resolves.toMatchObject({ source: "gmail" });
  });
});

describe("gmail", () => {
  it("one query PER selected label, because labelIds is AND and not OR", async () => {
    // The defect this test exists for: a single query carrying both ids returns only the
    // messages holding BOTH, which for most selections is none -- and a test written from
    // the same misunderstanding would pass. m1 has only Label_A, m2 only Label_B; a single
    // combined query would have found neither.
    await connect("gmail", {
      labels: [
        { id: "Label_A", name: "Invoices" },
        { id: "Label_B", name: "Receipts" },
      ],
    });
    fetcher
      .on("GET", listUrl("Label_A"), { body: { messages: [{ id: "m1" }] } })
      .on("GET", listUrl("Label_B"), { body: { messages: [{ id: "m2" }] } })
      .on("GET", messageUrl("m1"), { body: message("m1", ["Label_A"]) })
      .on("GET", messageUrl("m2"), { body: message("m2", ["Label_B"]) })
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-rotates`, { body: { data: PDF_B64 } })
      .on("GET", `${GMAIL}/messages/m2/attachments/att-m2-rotates`, { body: { data: PDF_B64 } });

    const result = await collect("gmail");

    expect(result.records.landed).toBe(2);
    expect(result.documents.created).toBe(2);
  });

  it("a message the listing returned but the selection does not cover is not landed", async () => {
    // Defence in depth. A label removed between listing and fetch must not widen what is
    // stored beyond what the admin agreed to.
    await connect("gmail", { labels: [{ id: "Label_A", name: "Invoices" }] });
    fetcher
      .on("GET", listUrl("Label_A"), { body: { messages: [{ id: "m1" }, { id: "m9" }] } })
      .on("GET", messageUrl("m1"), { body: message("m1", ["Label_A"]) })
      .on("GET", messageUrl("m9"), { body: message("m9", ["Label_ELSEWHERE"]) })
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-rotates`, { body: { data: PDF_B64 } });

    const result = await collect("gmail");

    expect(result.records.landed).toBe(1);
    const { rows } = await db.query<{ source_record_id: string }>(
      "SELECT source_record_id FROM raw.records WHERE source = 'gmail'",
    );
    expect(rows.map((r) => r.source_record_id)).toEqual(["m1"]);
  });

  it("a PDF is keyed on messageId and part index, never the rotating attachmentId", async () => {
    await connect("gmail", { labels: [] });
    fetcher
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }] } })
      .on("GET", messageUrl("m1"), { body: message("m1", ["Label_A"]) })
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-rotates`, { body: { data: PDF_B64 } });

    await collect("gmail");

    const { rows } = await db.query<{ document_id: string; lake_key: string }>(
      "SELECT document_id, lake_key FROM raw.documents",
    );
    expect(rows[0]?.document_id).toBe("m1:002");
    expect(rows[0]?.lake_key).toBe("documents/gmail/CASE-0042/m1:002");
    expect(rows[0]?.lake_key).not.toContain("rotates");
  });

  it("the catalogue carries no filename, subject or address", async () => {
    // raw.documents is granted to dbt, so anything here is one model from a dashboard.
    await connect("gmail", { labels: [] });
    fetcher
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }] } })
      .on("GET", messageUrl("m1"), { body: message("m1", ["Label_A"]) })
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-rotates`, { body: { data: PDF_B64 } });

    await collect("gmail");

    const { rows } = await db.query<{ metadata: unknown }>("SELECT metadata FROM raw.documents");
    const asText = JSON.stringify(rows[0]?.metadata);
    expect(asText).not.toContain("invoice-m1.pdf");
    expect(asText).not.toContain("billing@acme.test");
    expect(asText).not.toContain("Invoice m1");
  });

  it("a message with no PDF lands its headers and no document", async () => {
    await connect("gmail", { labels: [] });
    fetcher
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }] } })
      .on("GET", messageUrl("m1"), { body: message("m1", ["Label_A"], false) });

    const result = await collect("gmail");

    expect(result.records.landed).toBe(1);
    expect(result.documents.created).toBe(0);
  });

  it("re-running over an unchanged mailbox writes nothing new", async () => {
    await connect("gmail", { labels: [] });
    fetcher
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }] } })
      .on("GET", messageUrl("m1"), { body: message("m1", ["Label_A"]) })
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-rotates`, { body: { data: PDF_B64 } });

    await collect("gmail");
    const second = await collect("gmail");

    expect(second.documents).toMatchObject({ created: 0, unchanged: 1 });
    expect(await lake.versions("documents/gmail/CASE-0042/m1:002")).toHaveLength(1);
  });

  it("an oversized attachment is skipped with a reason rather than dropped", async () => {
    await connect("gmail", { labels: [] });
    const huge = message("m1", ["Label_A"]) as {
      payload: { parts: { body: { size?: string } }[] };
    };
    huge.payload.parts[1]!.body.size = String(80 * 1024 * 1024);
    fetcher
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }] } })
      .on("GET", messageUrl("m1"), { body: huge });
    // No attachment route recorded: if the collector fetched it anyway, the refusing
    // fetcher would fail this test, which is exactly the assertion.

    const result = await collect("gmail");

    expect(result.documents.skipped).toBe(1);
  });
});

describe("drive", () => {
  function listUrlFor(folderId: string): string {
    const url = new URL(DRIVE);
    url.searchParams.set(
      "q",
      `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`,
    );
    url.searchParams.set(
      "fields",
      "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,parents)",
    );
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    return url.toString();
  }

  function file(id: string) {
    return {
      id,
      name: `statement-${id}.pdf`,
      mimeType: "application/pdf",
      size: String(PDF.byteLength),
      modifiedTime: "2026-09-17T12:00:00.000Z",
      md5Checksum: "abc",
      parents: ["folder-1"],
    };
  }

  it("PDFs in a picked folder are landed and catalogued", async () => {
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
    });
    fetcher
      .on("GET", listUrlFor("folder-1"), { body: { files: [file("f1")] } })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF });

    const result = await collect("drive");

    expect(result.documents.created).toBe(1);
    const { rows } = await db.query<{ document_id: string }>(
      "SELECT document_id FROM raw.documents",
    );
    expect(rows.map((r) => r.document_id)).toEqual(["f1"]);
  });

  it("a file that vanished from a picked folder is tombstoned", async () => {
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
    });
    fetcher
      .on("GET", listUrlFor("folder-1"), { body: { files: [file("f1"), file("f2")] } })
      .on("GET", listUrlFor("folder-1"), { body: { files: [file("f1")] } })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF })
      .on("GET", `${DRIVE}/f2?alt=media`, { body: PDF });

    await collect("drive");
    const second = await collect("drive");

    expect(second.documents.tombstoned).toBe(1);
    const { rows } = await db.query<{ document_id: string }>(
      "SELECT document_id FROM raw.documents WHERE deleted_at IS NOT NULL",
    );
    expect(rows.map((r) => r.document_id)).toEqual(["f2"]);
  });

  it("descent stops at one level, so an unpicked subfolder is never listed", async () => {
    // Recursive descent could reach folders the admin never saw in the Picker, which would
    // make "No other folder is read" false. The refusing fetcher proves it: no route is
    // recorded for a child folder, so any attempt to list one fails the test.
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
    });
    fetcher
      .on("GET", listUrlFor("folder-1"), {
        body: {
          files: [
            file("f1"),
            { id: "sub", name: "older", mimeType: "application/vnd.google-apps.folder" },
          ],
        },
      })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF })
      // A non-PDF listed by the query is still fetched by id, so record it; what must NOT
      // happen is a listing of `sub` as a parent.
      .on("GET", `${DRIVE}/sub?alt=media`, { body: PDF });

    await expect(collect("drive")).resolves.toMatchObject({ source: "drive" });
    expect(fetcher.calls.map((c) => c.url)).not.toContain(listUrlFor("sub"));
  });
});
