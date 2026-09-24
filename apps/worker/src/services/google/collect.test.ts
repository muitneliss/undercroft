/**
 * The Google collectors, end to end and entirely offline.
 *
 * Real PGlite, a real in-memory lake, and a byte fetcher that REFUSES an unmodelled request
 * -- so a collector that calls an endpoint nobody recorded fails loudly here rather than
 * returning nothing and reading as an empty mailbox.
 */

import { createPacer, createStampSource, InMemoryByteFetcher, TestClock } from "@undercroft/core";
import { writeConnectionDetail } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { CHUNK } from "../landing.ts";
import { createGoogleApi } from "./api.ts";
import { DOCUMENT_UNLANDED, runGoogleCollect, ScopeNotChosen } from "./collect.ts";
import { NOTHING_MATCHED } from "./drive.ts";
import { GrantTooNarrow } from "./grant.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const TENANT = "CASE-0042";
const FOLDER = "application/vnd.google-apps.folder";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n%%EOF\n");
/** base64url of PDF, as Gmail returns it in `body.data`. */
const PDF_B64 = Buffer.from(PDF).toString("base64url");

let db: TestDatabase;
let lake: LakeStore;
let fetcher: InMemoryByteFetcher;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  fetcher = new InMemoryByteFetcher();
  // Seeded as the superuser; from here on every statement runs as the worker does.
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

/** `granted` is what Google said it granted; empty is "nothing recorded", as on an old row. */
async function connect(source: string, selection: unknown, granted = ""): Promise<void> {
  await db.query(
    "INSERT INTO ops.connection (tenant_id, source, status, scope) VALUES ($1, $2, 'connected', $3)",
    [TENANT, source, granted],
  );
  // A chosen scope is an admin's decision recorded by the control plane; the worker may
  // read it and never write it, so the fixture is planted as the superuser.
  await db.asSuperuser((tx) =>
    writeConnectionDetail(tx, {
      tenantId: TENANT,
      source,
      selectionJson: JSON.stringify(selection),
    }),
  );
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

/**
 * The message URL the collector actually fetches: `format=full`, and the ONLY one any fixture
 * here records.
 *
 * An attachment is only discoverable at this format. Gmail's `metadata` returns headers alone
 * -- Google's Format reference: "Returns only email message ID, labels, and email headers" --
 * so a fixture that answered a metadata request with parts described an API that does not
 * exist, and that is exactly how this suite stayed green while production landed no
 * attachments. Nothing records the metadata URL now, so a collector that asked for it is
 * refused by the fetcher and every attachment test below fails loudly.
 */
function messageUrl(id: string): string {
  return `${GMAIL}/messages/${id}?format=full`;
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

/** The ids `raw.records` holds for one source, which is what the next run skips on. */
async function projected(source: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT source_record_id AS id FROM raw.records WHERE source = $1 ORDER BY id",
    [source],
  );
  return rows.map((r) => r.id);
}

/**
 * What each record says its harvest settled. `::text` so the count arrives verbatim.
 *
 * This is what the next run actually skips on, and reading it back is the only way to tell a
 * mark of 0 -- "one attachment, refused for its size, and there will never be one" -- from a
 * mark of 1 the code guessed from what it MATCHED. Nothing downstream compares the two today,
 * so a wrong count is inert and invisible; that is exactly why it is asserted here.
 */
async function marks(source: string): Promise<{ id: string; landed: string | null }[]> {
  const { rows } = await db.query<{ id: string; landed: string | null }>(
    `SELECT source_record_id AS id, documents_landed::text AS landed
       FROM raw.records WHERE source = $1 ORDER BY id`,
    [source],
  );
  return rows;
}

/**
 * Put this source's rows back into the state the code before ADR 0035 left them in.
 *
 * A record landed and projected, no catalogue row, and NOTHING SAID about what its harvest
 * settled -- which is every row written by the old order (records, projection, documents) and
 * so every row on a tenant that had already run when the ingest was oom-killed on 2026-09-21.
 * The operator's report was precisely this: rows in `raw.records`, nothing in `raw.documents`.
 *
 * As the superuser because it is not a thing the current code does: the worker holds no DELETE
 * on `raw.documents` (`040_grants.sql`), which is also why the repair cannot be "delete the
 * bad rows" and has to be something a run can see and act on.
 */
async function asLegacy(source: string): Promise<void> {
  await db.asSuperuser(async (tx) => {
    await tx.query("UPDATE raw.records SET documents_landed = NULL WHERE source = $1", [source]);
    await tx.query("DELETE FROM raw.documents WHERE source = $1", [source]);
  });
}

/** A message carrying whichever attachment parts a file-type test asks for, not just a PDF. */
function messageWithAttachments(
  id: string,
  labelIds: string[],
  attachments: readonly { mimeType: string; filename: string }[],
): unknown {
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
      parts: [
        { mimeType: "text/plain", body: { size: "12" } },
        ...attachments.map((attachment, index) => ({
          mimeType: attachment.mimeType,
          filename: attachment.filename,
          body: { size: String(PDF.byteLength), attachmentId: `att-${id}-${index}` },
        })),
      ],
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
    // "Headers and matching attachments, whole mailbox".
    await connect("gmail", { labels: [] });
    fetcher.on("GET", listUrl(null), { body: { messages: [] } });

    await expect(collect("gmail")).resolves.toMatchObject({ source: "gmail" });
  });
});

describe("a grant that cannot read the source is refused before Google is asked", () => {
  const PICKED = { files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }] };

  it("a Drive grant of drive.file fails the run and names the reconnect", async () => {
    // The firing side, and issue 178. Google does not refuse this grant: under drive.file a
    // picked folder's existing files are simply not there, so the listing answers 200 and
    // empty, and the run closed green on "no matching files in folder" with 0 landed. Every
    // Drive connection made before ADR 0047 holds exactly this scope string.
    await connect(
      "drive",
      PICKED,
      "https://www.googleapis.com/auth/userinfo.email openid https://www.googleapis.com/auth/drive.file",
    );
    // No route is recorded: the fetcher refuses anything unmodelled, and `calls` below proves
    // nothing was even attempted.
    const failed = collect("drive");

    await expect(failed).rejects.toBeInstanceOf(GrantTooNarrow);
    await expect(failed).rejects.toThrow(/drive\.readonly.*reconnect the source/u);
    expect(fetcher.calls).toEqual([]);
  });

  it("a Drive grant of drive.readonly reads the picked folder", async () => {
    // The quiet side: the grant every Drive consent asks for now.
    await connect(
      "drive",
      PICKED,
      "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.readonly",
    );
    const q = "'folder-1' in parents and mimeType='application/pdf' and trashed=false";
    const listing = new URL(DRIVE);
    listing.searchParams.set("q", q);
    listing.searchParams.set(
      "fields",
      "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,parents)",
    );
    listing.searchParams.set("pageSize", "100");
    listing.searchParams.set("supportsAllDrives", "true");
    listing.searchParams.set("includeItemsFromAllDrives", "true");
    fetcher
      .on("GET", listing.toString(), {
        body: {
          files: [
            {
              id: "f1",
              name: "statement.pdf",
              mimeType: "application/pdf",
              size: String(PDF.byteLength),
              modifiedTime: "2026-09-17T12:00:00.000Z",
              md5Checksum: "abc",
              parents: ["folder-1"],
            },
          ],
        },
      })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF });

    const result = await collect("drive");

    expect(result.documents.created).toBe(1);
    expect(result.refusals).toEqual([]);
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

  it("`format=full` widens what is fetched without widening what is stored", async () => {
    // The quiet side of the format change. `full` returns bodies, a snippet and every header
    // a message carries; `metadata` returned none of that, so the narrowing that used to be
    // done by the request is now done by `headerMap` and `messageRecord`. If either stops
    // narrowing, a body or a Received chain lands in raw.records and this fails.
    await connect("gmail", { labels: [] });
    const withBody = message("m1", ["Label_A"]) as {
      snippet?: string;
      payload: { headers: { name: string; value: string }[]; parts: { body: unknown }[] };
    };
    withBody.snippet = "Please find the settlement figure attached";
    withBody.payload.headers.push(
      { name: "Received", value: "from mx.acme.test by smtp.google.test" },
      { name: "DKIM-Signature", value: "v=1; a=rsa-sha256; d=acme.test" },
      { name: "X-Internal-Routing", value: "ledger-team" },
    );
    withBody.payload.parts[0] = {
      body: { size: "12", data: Buffer.from("secret body text").toString("base64url") },
    };

    fetcher
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }] } })
      .on("GET", messageUrl("m1"), { body: withBody })
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-rotates`, { body: { data: PDF_B64 } });

    await collect("gmail");

    const { rows } = await db.query<{ payload: unknown }>(
      "SELECT payload FROM raw.records WHERE source = 'gmail'",
    );
    const landed = JSON.stringify(rows[0]?.payload);
    expect(landed).not.toContain("secret body text");
    expect(landed).not.toContain("settlement figure");
    expect(landed).not.toContain("DKIM");
    expect(landed).not.toContain("X-Internal-Routing");
    expect(landed).not.toContain("mx.acme.test");
    // The six the consent names still land, so this is a narrowing and not a blanking.
    expect(landed).toContain("Invoice m1");
    expect(landed).toContain("billing@acme.test");
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

  it("re-running over an unchanged mailbox does not READ the mailbox again", async () => {
    // The whole point of skip-known, and the incident it was written for: 7,786 messages at
    // one paced request each is 43 minutes, and on an unchanged mailbox every one of those
    // requests buys nothing. This used to assert `{created: 0, unchanged: 1}` -- the second
    // run re-fetched the message, re-landed identical bytes, and the lake reported
    // `unchanged`, which proved idempotence and said nothing about cost. Now the message is
    // never asked for, so nothing CAN be re-landed, and the assertion moves to the two
    // things that say so: no `messages/m1` request at all, and one version in the lake.
    await connect("gmail", { labels: [] });
    fetcher
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }] } })
      .on("GET", messageUrl("m1"), { body: message("m1", ["Label_A"]) })
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-rotates`, { body: { data: PDF_B64 } });

    await collect("gmail");
    const second = await collect("gmail");

    // Across BOTH runs: one read of the message, and one of its attachment.
    const reads = fetcher.calls.filter((c) => c.url === messageUrl("m1"));
    expect(reads).toHaveLength(1);
    expect(fetcher.calls.filter((c) => c.url.includes("/attachments/"))).toHaveLength(1);

    // Landing nothing is now what a healthy second run looks like, and the count that keeps
    // it from reading as an empty mailbox is `skipped`.
    expect(second.records).toMatchObject({ landed: 0, skipped: 1 });
    expect(second.documents).toMatchObject({ created: 0, unchanged: 0 });
    expect(await lake.versions("documents/gmail/CASE-0042/m1:002")).toHaveLength(1);
  });

  it("but a message the mailbox has not seen before is read", async () => {
    // The firing side of the same guard. A skip-known that skipped everything would pass the
    // test above and ingest nothing forever, which is the failure mode worth pairing against.
    await connect("gmail", { labels: [] });
    fetcher
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }] } })
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }, { id: "m2" }] } })
      .on("GET", messageUrl("m1"), { body: message("m1", ["Label_A"]) })
      .on("GET", messageUrl("m2"), { body: message("m2", ["Label_A"]) })
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-rotates`, { body: { data: PDF_B64 } })
      .on("GET", `${GMAIL}/messages/m2/attachments/att-m2-rotates`, { body: { data: PDF_B64 } });

    await collect("gmail");
    const second = await collect("gmail");

    expect(second.records).toMatchObject({ landed: 1, skipped: 1 });
    expect(fetcher.calls.filter((c) => c.url === messageUrl("m1"))).toHaveLength(1);
    expect(fetcher.calls.filter((c) => c.url === messageUrl("m2"))).toHaveLength(1);
    const { rows } = await db.query<{ source_record_id: string }>(
      "SELECT source_record_id FROM raw.records WHERE source = 'gmail' ORDER BY source_record_id",
    );
    expect(rows.map((r) => r.source_record_id)).toEqual(["m1", "m2"]);
  });

  it("an attachment outside the allow-list is excluded, but a matching one still lands", async () => {
    // Default scope: PDF only. The Excel part must not widen what is stored beyond it.
    await connect("gmail", { labels: [] });
    fetcher
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }] } })
      .on("GET", messageUrl("m1"), {
        body: messageWithAttachments(
          "m1",
          ["Label_A"],
          [
            { mimeType: "application/pdf", filename: "invoice-m1.pdf" },
            { mimeType: "application/vnd.ms-excel", filename: "budget-m1.xlsx" },
          ],
        ),
      })
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-0`, { body: { data: PDF_B64 } });

    const result = await collect("gmail");

    expect(result.documents.created).toBe(1);
    const { rows } = await db.query<{ document_id: string }>(
      "SELECT document_id FROM raw.documents",
    );
    expect(rows.map((r) => r.document_id)).toEqual(["m1:002"]);
  });

  it("an allow-listed non-PDF attachment lands with its own content type", async () => {
    await connect("gmail", { labels: [], fileTypes: ["application/vnd.ms-excel"] });
    fetcher
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }] } })
      .on("GET", messageUrl("m1"), {
        body: messageWithAttachments(
          "m1",
          ["Label_A"],
          [{ mimeType: "application/vnd.ms-excel", filename: "budget-m1.xlsx" }],
        ),
      })
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-0`, { body: { data: PDF_B64 } });

    const result = await collect("gmail");

    expect(result.documents.created).toBe(1);
    const { rows } = await db.query<{ content_type: string }>(
      "SELECT content_type FROM raw.documents",
    );
    expect(rows.map((r) => r.content_type)).toEqual(["application/vnd.ms-excel"]);
  });

  it("a message whose attachment did NOT land does not land its record either", async () => {
    // The firing side of the rule that makes skipping safe at all. What the next run skips
    // is what `raw.records` holds, so "present in raw.records" has to mean "fully
    // harvested". Land the record while the attachment fetch was still failing and the
    // message is skipped by every run after it -- the attachment lost for good from the one
    // layer that cannot be recomputed, which is CLAUDE.md rule 2 broken by the resume
    // mechanism itself. The record therefore waits, and the wait is SAID rather than
    // silent.
    await connect("gmail", { labels: [] });
    fetcher
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }] } })
      .on("GET", messageUrl("m1"), { body: message("m1", ["Label_A"]) })
      // Two queued responses for the one attachment: the provider refuses the bytes, and
      // then on the next run serves them.
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-rotates`, {
        status: 404,
        body: { error: { message: "attachment not found" } },
      })
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-rotates`, { body: { data: PDF_B64 } });

    const first = await collect("gmail");

    expect(first.documents.failed).toBe(1);
    expect(first.records.landed).toBe(0);
    expect(first.refusals).toContainEqual({
      entity: "messages",
      sourceRecordId: "m1",
      reason: DOCUMENT_UNLANDED,
    });
    // The half that matters: nothing for the next run to mistake for a finished message.
    expect(await projected("gmail")).toEqual([]);

    const second = await collect("gmail");

    expect(second.records).toMatchObject({ landed: 1, skipped: 0 });
    expect(second.documents.created).toBe(1);
    expect(await projected("gmail")).toEqual(["m1"]);
    expect(fetcher.calls.filter((c) => c.url === messageUrl("m1"))).toHaveLength(2);
  });

  it("but one whose attachment was refused for its SIZE lands, and is skipped after", async () => {
    // The quiet side, and data loss in the other direction. A size refusal is deterministic
    // -- it will refuse identically on every future run -- so a record held back for one
    // would never land at all, and the message would be unharvestable rather than merely
    // incomplete. It lands, its refusal is on the record, and the next run skips it.
    await connect("gmail", { labels: [] });
    const huge = message("m1", ["Label_A"]) as {
      payload: { parts: { body: { size?: string } }[] };
    };
    huge.payload.parts[1]!.body.size = String(80 * 1024 * 1024);
    // No attachment route is recorded: had the collector fetched the oversized part anyway,
    // the refusing fetcher would fail it and `failed`, not `skipped`, would be 1.
    fetcher
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }] } })
      .on("GET", messageUrl("m1"), { body: huge });

    const first = await collect("gmail");

    expect(first.documents.skipped).toBe(1);
    expect(first.records.landed).toBe(1);
    expect(first.refusals.map((r) => r.reason)).not.toContain(DOCUMENT_UNLANDED);
    expect(await projected("gmail")).toEqual(["m1"]);

    const second = await collect("gmail");

    expect(second.records).toMatchObject({ landed: 0, skipped: 1 });
    expect(fetcher.calls.filter((c) => c.url === messageUrl("m1"))).toHaveLength(1);
  });

  /**
   * A mailbox in the state the outage left: m1 read once with no attachment part, so a record
   * landed and no document did, and then stripped of its mark.
   *
   * The first read carries no parts DELIBERATELY. `messageRecord` builds its payload from the
   * id, thread, labels, headers and internalDate -- never from `payload.parts` -- so the
   * record this lands is BYTE-IDENTICAL to the one a later read of the same message with an
   * attachment produces. That is the hard half of the repair and the reason the mark could not
   * ride in the lake manifest: re-landing those identical bytes writes no new lake version, so
   * there is no journal entry, so the projection has nothing to carry a fact on.
   */
  function mailboxAsTheOutageLeftIt(): void {
    fetcher
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }] } })
      .on("GET", messageUrl("m1"), { body: message("m1", ["Label_A"], false) })
      .on("GET", messageUrl("m1"), { body: message("m1", ["Label_A"]) })
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-rotates`, { body: { data: PDF_B64 } });
  }

  it("a record landed under the OLD contract is read again, and its attachment lands", async () => {
    // THE TEST THAT WOULD HAVE CAUGHT THE OUTAGE. ADR 0033 asserted that a row in
    // `raw.records` meant a finished harvest, on the strength of an ordering rule that binds
    // only the rows written after it. 7,786 Gmail records written by the old order were
    // skipped on presence by every run after the fix, their attachments never fetched, and
    // nothing about that self-corrects. A landing that did not say what it settled is now not
    // held, so the message is read exactly once more and the attachment lands.
    await connect("gmail", { labels: [] });
    mailboxAsTheOutageLeftIt();

    await collect("gmail");
    await asLegacy("gmail");

    const healing = await collect("gmail");

    expect(healing.records).toMatchObject({ landed: 1, skipped: 0 });
    expect(healing.documents.created).toBe(1);
    const { rows } = await db.query<{ document_id: string }>(
      "SELECT document_id FROM raw.documents",
    );
    expect(rows.map((r) => r.document_id)).toEqual(["m1:002"]);
    // The mark reached the row although NOTHING was projected: the record's bytes had not
    // moved, so the lake wrote no new version and the loader had no entry to read. A fact
    // carried in the manifest would have died right here, and the mailbox would have been
    // re-read on every run for ever.
    expect(healing.records).toMatchObject({ loadedCreated: 0, loadedChanged: 0 });
    expect(await marks("gmail")).toEqual([{ id: "m1", landed: "1" }]);
  });

  it("and it is read once more, not on every run for ever", async () => {
    // The quiet side, and the one that fails for the tempting wrong fix. Dropping skip-known
    // altogether, or marking on anything weaker than what actually landed, repairs the mailbox
    // above and then re-reads it every hour -- 43 minutes of paced requests buying nothing,
    // which is the cost ADR 0033 exists to have removed. Three runs: the outage, the repair,
    // and the steady state.
    await connect("gmail", { labels: [] });
    mailboxAsTheOutageLeftIt();

    await collect("gmail");
    await asLegacy("gmail");
    await collect("gmail");
    const settled = await collect("gmail");

    expect(settled.records).toMatchObject({ landed: 0, skipped: 1 });
    // Twice across all three runs: the original read, and the one that repaired it.
    expect(fetcher.calls.filter((c) => c.url === messageUrl("m1"))).toHaveLength(2);
  });

  it("the mark counts what LANDED, so an over-large attachment is zero and never one", async () => {
    // The second bug in the shape of a fix, refused. A part refused for its declared size
    // never becomes a `raw.documents` row and never will -- the refusal is deterministic. A
    // mark taken from what the message MATCHED would leave m2 permanently one document short
    // of its own claim, and any reader of the count would re-fetch it for ever; the existing
    // size test cannot see the difference, because both numbers are equally not-null. So the
    // value is asserted: m2 settled nothing, honestly, and that is a complete harvest.
    await connect("gmail", { labels: [] });
    const huge = message("m2", ["Label_A"]) as {
      payload: { parts: { body: { size?: string } }[] };
    };
    huge.payload.parts[1]!.body.size = String(80 * 1024 * 1024);
    fetcher
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }, { id: "m2" }] } })
      .on("GET", messageUrl("m1"), { body: message("m1", ["Label_A"]) })
      .on("GET", messageUrl("m2"), { body: huge })
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-rotates`, { body: { data: PDF_B64 } });

    await collect("gmail");

    expect(await marks("gmail")).toEqual([
      { id: "m1", landed: "1" },
      { id: "m2", landed: "0" },
    ]);
  });

  it("an attachment that failed while a full buffer was landing still holds its record", async () => {
    // A mailbox big enough that the DOCUMENT buffer fills on its own, inside `add`, before the
    // caller ever asks it to flush. The sink used to answer only for the chunk that `flush`
    // itself landed, so a failure settled by that self-triggered landing was reported to
    // nobody -- and on one attachment per message the two boundaries coincide, which is to say
    // it was reported to nobody on every real mailbox. The record went in regardless, was
    // skipped by every later run, and the attachment was lost from the only durable layer.
    // Under one chunk this cannot happen at all, which is why the test is over one.
    const ids = Array.from({ length: CHUNK + 50 }, (_, i) => `m${i}`);
    await connect("gmail", { labels: [] });
    fetcher.on("GET", listUrl(null), { body: { messages: ids.map((id) => ({ id })) } });
    for (const id of ids) {
      fetcher.on("GET", messageUrl(id), { body: message(id, ["Label_A"]) });
      fetcher.on("GET", `${GMAIL}/messages/${id}/attachments/att-${id}-rotates`, {
        // One message in the first chunk is refused its bytes, retryably.
        ...(id === "m7"
          ? { status: 404, body: { error: { message: "attachment not found" } } }
          : { body: { data: PDF_B64 } }),
      });
    }

    const result = await collect("gmail");

    expect(result.documents.failed).toBe(1);
    expect(result.records.landed).toBe(ids.length - 1);
    expect(result.refusals).toContainEqual({
      entity: "messages",
      sourceRecordId: "m7",
      reason: DOCUMENT_UNLANDED,
    });
    // The half that matters: nothing for the next run to mistake for a finished message.
    expect(await projected("gmail")).not.toContain("m7");
  });

  it("a mailbox larger than one chunk lands every message, and holds none of them", async () => {
    // Streaming, asserted the only way a caller can see it: more messages than one chunk
    // holds, all of them landed and all of them projected. The shape this replaced read the
    // whole mailbox into two arrays first, and on 7,786 messages that reached the worker's
    // 1 GiB cgroup limit and lost 76 minutes of paced reads. It also walks the boundary
    // where a chunk's documents are flushed and its records released, which a mailbox that
    // fits in one chunk never reaches.
    const ids = Array.from({ length: CHUNK + 50 }, (_, i) => `m${i}`);
    await connect("gmail", { labels: [] });
    fetcher.on("GET", listUrl(null), { body: { messages: ids.map((id) => ({ id })) } });
    for (const id of ids) {
      fetcher
        .on("GET", messageUrl(id), { body: message(id, ["Label_A"]) })
        .on("GET", `${GMAIL}/messages/${id}/attachments/att-${id}-rotates`, {
          body: { data: PDF_B64 },
        });
    }

    const result = await collect("gmail");

    expect(result.records.landed).toBe(ids.length);
    expect(result.documents.created).toBe(ids.length);
    expect(await projected("gmail")).toHaveLength(ids.length);
    // The counts came back summed over the chunks, not from the last one.
    expect(result.records.loadedCreated).toBe(ids.length);
  });

  it("an empty allow-list lands attachments of every type in one message", async () => {
    await connect("gmail", { labels: [], fileTypes: [] });
    fetcher
      .on("GET", listUrl(null), { body: { messages: [{ id: "m1" }] } })
      .on("GET", messageUrl("m1"), {
        body: messageWithAttachments(
          "m1",
          ["Label_A"],
          [
            { mimeType: "application/pdf", filename: "invoice-m1.pdf" },
            { mimeType: "application/vnd.ms-excel", filename: "budget-m1.xlsx" },
          ],
        ),
      })
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-0`, { body: { data: PDF_B64 } })
      .on("GET", `${GMAIL}/messages/m1/attachments/att-m1-1`, { body: { data: PDF_B64 } });

    const result = await collect("gmail");

    expect(result.documents.created).toBe(2);
  });
});

describe("drive", () => {
  /** Reproduces the collector's own query, so a test proves the allow-list actually threads
   * through rather than merely trusting it did: the default one-type case must stay
   * byte-identical to what shipped before file types were configurable. */
  function listUrlFor(
    folderId: string,
    fileTypes: readonly string[] = ["application/pdf"],
    recurse = false,
  ): string {
    // A recursive walk asks for the folder type too, so one request per page yields both the
    // files to land and the folders to descend into. An EMPTY allow-list stays empty: "every
    // type" already includes folders, and adding one would narrow it to folders alone.
    const asked = recurse && fileTypes.length > 0 ? [...fileTypes, FOLDER] : fileTypes;
    const joined = asked.map((type) => `mimeType='${type}'`).join(" or ");
    const typeClause = asked.length > 1 ? `(${joined})` : joined;
    const q =
      asked.length === 0
        ? `'${folderId}' in parents and trashed=false`
        : `'${folderId}' in parents and ${typeClause} and trashed=false`;

    const url = new URL(DRIVE);
    url.searchParams.set("q", q);
    url.searchParams.set(
      "fields",
      "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,parents)",
    );
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    return url.toString();
  }

  function file(id: string, mimeType = "application/pdf") {
    return {
      id,
      name: `statement-${id}.pdf`,
      mimeType,
      size: String(PDF.byteLength),
      modifiedTime: "2026-09-17T12:00:00.000Z",
      md5Checksum: "abc",
      parents: ["folder-1"],
    };
  }

  /** A sub-folder as Drive hands one back inside a listing. */
  function folder(id: string) {
    return { id, name: `${id}-name`, mimeType: FOLDER };
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

  it("a picked folder that matched nothing says so rather than landing a silent zero", async () => {
    // The firing side, and the symptom an operator actually reports: "Drive syncs nothing
    // even though I have data". A folder whose contents are all filtered out by the chosen
    // allow-list returns an empty listing, and until this was recorded the run was green with
    // 0 records and 0 refusals -- indistinguishable from an empty folder, or from a broken
    // credential. `readOneFile` already refused a directly-picked file with a reason; the
    // folder path was the half that stayed silent. CLAUDE.md rule 2.
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
      fileTypes: ["application/pdf"],
    });
    fetcher.on("GET", listUrlFor("folder-1", ["application/pdf"]), { body: { files: [] } });

    const result = await collect("drive");

    expect(result.records.landed).toBe(0);
    expect(result.refusals).toEqual([
      { entity: "files", sourceRecordId: "folder-1", reason: NOTHING_MATCHED },
    ]);
  });

  it("a picked folder that matched something records no refusal", async () => {
    // The quiet side. A guard that always fires is as useless as one that never does. The
    // empty allow-list is deliberate too: the listing is recorded only at the URL with NO type
    // filter, so a query that kept one would be refused here.
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
      fileTypes: [],
    });
    fetcher
      .on("GET", listUrlFor("folder-1", []), { body: { files: [file("f1")] } })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF });

    const result = await collect("drive");

    expect(result.records.landed).toBe(1);
    expect(result.refusals).toEqual([]);
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

  it("a file skipped because it was unchanged is NOT reported deleted", async () => {
    // The quiet side, and the one that loses a tenant's whole Drive. `tombstoneMissing`
    // negates the kept-id set, so a file left out of it because it had not changed is
    // reported deleted -- and in a steady-state Drive that is EVERY file in it, on the
    // second run, with the run green and landing 0. A file the listing named was seen;
    // whether we re-read it is a different question from whether it still exists.
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
    });
    fetcher
      .on("GET", listUrlFor("folder-1"), { body: { files: [file("f1"), file("f2")] } })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF })
      .on("GET", `${DRIVE}/f2?alt=media`, { body: PDF });

    await collect("drive");
    const second = await collect("drive");

    expect(second.records).toMatchObject({ landed: 0, skipped: 2 });
    expect(second.documents.tombstoned).toBe(0);
    const { rows } = await db.query<{ document_id: string }>(
      "SELECT document_id FROM raw.documents WHERE deleted_at IS NULL ORDER BY document_id",
    );
    expect(rows.map((r) => r.document_id)).toEqual(["f1", "f2"]);
    // And nothing was downloaded twice, which is the saving the skip exists for.
    expect(fetcher.calls.filter((c) => c.url.endsWith("?alt=media"))).toHaveLength(2);
  });

  it("a file whose modifiedTime moved IS read again", async () => {
    // The firing side. The comparison is Postgres's: Drive says
    // `2026-09-17T12:00:00.000Z` and `timestamptz` reads back `2026-09-17 12:00:00+00`, so
    // a compare in JavaScript is false forever -- which re-fetches everything on every run
    // while LOOKING exactly like a working skip. `f1` moved and must be re-read; `f2` did
    // not and must not, or this test would pass on a skip that never skips.
    const edited = { ...file("f1"), modifiedTime: "2026-09-18T08:30:00.000Z", md5Checksum: "def" };
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
    });
    fetcher
      .on("GET", listUrlFor("folder-1"), { body: { files: [file("f1"), file("f2")] } })
      .on("GET", listUrlFor("folder-1"), { body: { files: [edited, file("f2")] } })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF })
      .on("GET", `${DRIVE}/f2?alt=media`, { body: PDF });

    await collect("drive");
    const second = await collect("drive");

    expect(second.records).toMatchObject({ landed: 1, skipped: 1 });
    expect(fetcher.calls.filter((c) => c.url === `${DRIVE}/f1?alt=media`)).toHaveLength(2);
    expect(fetcher.calls.filter((c) => c.url === `${DRIVE}/f2?alt=media`)).toHaveLength(1);
    const { rows } = await db.query<{ id: string; at: Date }>(
      "SELECT source_record_id AS id, source_updated_at AS at FROM raw.records WHERE source = 'drive' ORDER BY id",
    );
    expect(rows[0]?.at.toISOString()).toBe("2026-09-18T08:30:00.000Z");
  });

  it("a file landed under the OLD contract is downloaded again and catalogued", async () => {
    // Drive carried the same exposure as Gmail and by the same route: its old path also landed
    // the record first and the bytes last, so a run that died between them left a row whose
    // `modifiedTime` matched and whose document did not exist. That row satisfied the
    // unchanged test on every later run, so the file was never downloaded again -- a PDF
    // missing from the one layer that cannot be recomputed, on a source that reports green.
    //
    // The fixture differs from Gmail's because every Drive file IS a document: there is no
    // first read that lands a record and no document, so the catalogue row is removed instead.
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
    });
    fetcher
      .on("GET", listUrlFor("folder-1"), { body: { files: [file("f1")] } })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF });

    await collect("drive");
    await asLegacy("drive");

    const healing = await collect("drive");

    expect(healing.records).toMatchObject({ landed: 1, skipped: 0 });
    // Downloaded a second time -- which is the repair, and what a skip on the stale row
    // prevented for ever.
    expect(fetcher.calls.filter((c) => c.url === `${DRIVE}/f1?alt=media`)).toHaveLength(2);
    const { rows } = await db.query<{ document_id: string }>(
      "SELECT document_id FROM raw.documents",
    );
    expect(rows.map((r) => r.document_id)).toEqual(["f1"]);
    expect(await marks("drive")).toEqual([{ id: "f1", landed: "1" }]);
  });

  it("and it is downloaded once more, not on every run for ever", async () => {
    // The quiet side. A Drive tenant's files are the expensive half of a run -- bytes, not
    // headers -- so a repair that never terminates is a bill as well as a regression.
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
    });
    fetcher
      .on("GET", listUrlFor("folder-1"), { body: { files: [file("f1")] } })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF });

    await collect("drive");
    await asLegacy("drive");
    await collect("drive");
    const settled = await collect("drive");

    expect(settled.records).toMatchObject({ landed: 0, skipped: 1 });
    expect(fetcher.calls.filter((c) => c.url === `${DRIVE}/f1?alt=media`)).toHaveLength(2);
  });

  it("an over-large file lands a record marked zero, and is not offered again", async () => {
    // Drive's half of "count what landed, not what was matched", and the sharper half: here
    // the file IS the document, so a mark taken from what the pick matched would say 1 against
    // a catalogue that holds 0 and can never hold more. The refusing fetcher is the second
    // assertion -- no bytes route is recorded, so any attempt to download this file fails the
    // test on either run.
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
    });
    fetcher.on("GET", listUrlFor("folder-1"), {
      body: { files: [{ ...file("f1"), size: String(80 * 1024 * 1024) }] },
    });

    const first = await collect("drive");
    const second = await collect("drive");

    expect(first.documents.skipped).toBe(1);
    expect(first.records.landed).toBe(1);
    expect(await marks("drive")).toEqual([{ id: "f1", landed: "0" }]);
    expect(second.records).toMatchObject({ landed: 0, skipped: 1 });
  });

  it("a selection that did not ask for sub-folders never lists one", async () => {
    // The quiet half of the descent guard, and what EVERY selection saved before `recurse`
    // existed means. The refusing fetcher proves it: no route is recorded for a child folder,
    // so any attempt to list one fails the test. ADR 0031.
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
    });
    fetcher
      .on("GET", listUrlFor("folder-1"), {
        body: { files: [file("f1"), folder("sub")] },
      })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF });

    await expect(collect("drive")).resolves.toMatchObject({ source: "drive" });
    expect(fetcher.calls.map((c) => c.url)).not.toContain(listUrlFor("sub"));
  });

  it("a file five levels down lands when sub-folders were asked for", async () => {
    // The firing half. An admin picks the year and expects the months inside it, which is the
    // whole point of the toggle; landing only the loose files at the top would be the silent
    // subset this feature exists to stop being the only option.
    //
    // Five levels rather than two, because two cannot tell a walk from a walk that descends
    // once: a sub-folder's own sub-folders must be queued too. Issue 178's tree held most of
    // its files four and five levels down, and "recurse only reaches the children" was a
    // hypothesis for its empty runs until the scope was shown to be the cause.
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
      recurse: true,
    });
    fetcher
      .on("GET", listUrlFor("folder-1", ["application/pdf"], true), {
        body: { files: [file("f1"), folder("d2")] },
      })
      .on("GET", listUrlFor("d2", ["application/pdf"], true), { body: { files: [folder("d3")] } })
      .on("GET", listUrlFor("d3", ["application/pdf"], true), { body: { files: [folder("d4")] } })
      .on("GET", listUrlFor("d4", ["application/pdf"], true), { body: { files: [folder("d5")] } })
      .on("GET", listUrlFor("d5", ["application/pdf"], true), { body: { files: [file("f5")] } })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF })
      .on("GET", `${DRIVE}/f5?alt=media`, { body: PDF });

    const result = await collect("drive");

    expect(result.documents.created).toBe(2);
    const { rows } = await db.query<{ document_id: string }>(
      "SELECT document_id FROM raw.documents ORDER BY document_id",
    );
    expect(rows.map((r) => r.document_id)).toEqual(["f1", "f5"]);
  });

  it("a sub-folder is never landed as a document", async () => {
    // With an empty allow-list -- "every file type" -- Drive hands folders back in the
    // listing like anything else, and one landed as a document is a zero-byte file whose
    // whole content is its name. No bytes route is recorded for `sub`, but the refusal alone
    // proves nothing: a document whose fetch fails is COUNTED as failed and its record held
    // back, not raised, so `created` would still read 1. The assertions are therefore on
    // what a folder treated as a file would leave behind -- one failed document, a record
    // held back with DOCUMENT_UNLANDED, and `sub` in neither count.
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
      fileTypes: [],
    });
    fetcher
      .on("GET", listUrlFor("folder-1", []), { body: { files: [file("f1"), folder("sub")] } })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF });

    const result = await collect("drive");

    expect(result.documents).toMatchObject({ created: 1, failed: 0, skipped: 0 });
    expect(result.records.landed).toBe(1);
    expect(result.refusals).toEqual([]);
    expect(await projected("drive")).toEqual(["f1"]);
  });

  it("a folder reachable twice in one tree is listed once", async () => {
    // A shortcut can make a tree a graph, and Drive will happily describe a cycle. Without
    // the visited set this walks forever -- and it HANGS rather than failing fast, because
    // the fetcher replays the last response recorded for a URL, so a second listing of
    // either folder is answered, not refused. The test then fails on bun's per-test timeout;
    // the call counts below are what it asserts when the walk does end.
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
      recurse: true,
    });
    fetcher
      .on("GET", listUrlFor("folder-1", ["application/pdf"], true), {
        body: { files: [folder("sub")] },
      })
      .on("GET", listUrlFor("sub", ["application/pdf"], true), {
        body: { files: [file("f1"), folder("folder-1")] },
      })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF });

    const result = await collect("drive");

    expect(result.documents.created).toBe(1);
    const listings = fetcher.calls.map((c) => c.url).filter((url) => !url.endsWith("?alt=media"));
    expect(listings).toEqual([
      listUrlFor("folder-1", ["application/pdf"], true),
      listUrlFor("sub", ["application/pdf"], true),
    ]);
  });

  it("a picked folder whose whole tree is empty refuses once, not once per branch", async () => {
    // The refusal is recorded against the PICK. An admin picked one folder and is owed one
    // sentence about it; a deep tree of empty sub-folders reporting each branch would bury
    // the fact that the thing they chose yielded nothing.
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
      recurse: true,
    });
    fetcher
      .on("GET", listUrlFor("folder-1", ["application/pdf"], true), {
        body: { files: [folder("sub")] },
      })
      .on("GET", listUrlFor("sub", ["application/pdf"], true), { body: { files: [] } });

    const result = await collect("drive");

    expect(result.refusals).toEqual([
      { entity: "files", sourceRecordId: "folder-1", reason: NOTHING_MATCHED },
    ]);
  });

  function fileUrlFor(id: string): string {
    const url = new URL(`${DRIVE}/${id}`);
    url.searchParams.set("fields", "id,name,mimeType,size,modifiedTime,md5Checksum,parents");
    url.searchParams.set("supportsAllDrives", "true");
    return url.toString();
  }

  it("a picked file outside the allow-list is refused with its reason, not dropped", async () => {
    // It used to be dropped where it was found, so the run landed 0 and said nothing --
    // indistinguishable from "the picker gave us nothing". CLAUDE.md rule 2.
    await connect("drive", { files: [{ id: "x1", name: "budget", kind: "file" }] });
    fetcher.on("GET", fileUrlFor("x1"), {
      body: { id: "x1", name: "budget.xlsx", mimeType: "application/vnd.ms-excel", size: "10" },
    });

    const result = await collect("drive");

    expect(result.refusals).toEqual([
      { entity: "files", sourceRecordId: "x1", reason: "not-an-allowed-type" },
    ]);
  });

  it("a picked file that is a PDF is landed and refused nothing", async () => {
    await connect("drive", { files: [{ id: "f1", name: "statement", kind: "file" }] });
    fetcher
      .on("GET", fileUrlFor("f1"), { body: file("f1") })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF });

    const result = await collect("drive");

    expect(result.refusals).toEqual([]);
    expect(result.documents.created).toBe(1);
  });

  it("a directly-picked file matching a custom allow-list lands with its own content type", async () => {
    await connect("drive", {
      files: [{ id: "x1", name: "budget", kind: "file" }],
      fileTypes: ["application/vnd.ms-excel"],
    });
    fetcher
      .on("GET", fileUrlFor("x1"), { body: file("x1", "application/vnd.ms-excel") })
      .on("GET", `${DRIVE}/x1?alt=media`, { body: PDF });

    const result = await collect("drive");

    expect(result.refusals).toEqual([]);
    const { rows } = await db.query<{ content_type: string }>(
      "SELECT content_type FROM raw.documents",
    );
    expect(rows.map((r) => r.content_type)).toEqual(["application/vnd.ms-excel"]);
  });

  it("an empty allow-list accepts a directly-picked file of any type", async () => {
    await connect("drive", { files: [{ id: "x1", name: "budget", kind: "file" }], fileTypes: [] });
    fetcher
      .on("GET", fileUrlFor("x1"), { body: file("x1", "application/vnd.ms-excel") })
      .on("GET", `${DRIVE}/x1?alt=media`, { body: PDF });

    const result = await collect("drive");

    expect(result.refusals).toEqual([]);
    expect(result.documents.created).toBe(1);
  });

  it("a folder listing's query is built from the chosen allow-list", async () => {
    // If the implementation forgot to thread `fileTypes` into the query, this listing's URL
    // would not match anything registered and the refusing fetcher would fail the test loudly.
    await connect("drive", {
      files: [{ id: "folder-1", name: "2026 statements", kind: "folder" }],
      fileTypes: ["application/vnd.ms-excel"],
    });
    fetcher
      .on("GET", listUrlFor("folder-1", ["application/vnd.ms-excel"]), {
        body: { files: [file("f1", "application/vnd.ms-excel")] },
      })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF });

    const result = await collect("drive");

    expect(result.documents.created).toBe(1);
    const { rows } = await db.query<{ content_type: string }>(
      "SELECT content_type FROM raw.documents",
    );
    expect(rows.map((r) => r.content_type)).toEqual(["application/vnd.ms-excel"]);
  });
});
