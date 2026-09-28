/**
 * The Gmail suite end to end, offline: a small invented world held by two stand-ins (Gmail
 * through `InMemoryFetcher`, the lake through `LakeCli`), run through the same `runGmailSuite`
 * the live run calls. Each message in the world is placed to produce one verdict, so a change
 * to scope, watermark or identity logic shows up as a verdict moving, not as a count drifting.
 *
 * Every value here is invented (`.claude/rules/pii.md`).
 */
import { describe, expect, it } from "bun:test";

import { InMemoryFetcher } from "../../packages/connector-runtime/src/testing.ts";
import type { LiveConfig } from "./config.ts";
import { FULL_FIELDS, type FullMessage } from "./gmail.ts";
import type { SourceCache } from "./gmailCommon.ts";
import { runGmailSuite } from "./gmailSuite.ts";
import { createGoogleClient } from "./google.ts";
import { LakeCli } from "./lakeStandIn.ts";
import { MemorySink } from "./memorySink.ts";
import type { TestResult } from "./model.ts";
import { createUndercroftReader } from "./undercroft.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const LAKE_RUN = "2026-09-20T00:00:00.000Z";
const LAKE_RUN_MS = Date.parse(LAKE_RUN);

interface Message {
  readonly id: string;
  readonly at: number;
  readonly labels: readonly string[];
  readonly subject: string;
}

const DAY = 86_400_000;
const WORLD: readonly Message[] = [
  // In the Inbox and in the lake, fields equal.
  { id: "aa00000000000001", at: LAKE_RUN_MS - 15 * DAY, labels: ["INBOX"], subject: "Invoice" },
  { id: "aa00000000000002", at: LAKE_RUN_MS - 14 * DAY, labels: ["INBOX"], subject: "Contract" },
  // Newer than the lake's last completed run: NOT_YET_SYNCED.
  { id: "aa00000000000003", at: LAKE_RUN_MS + DAY, labels: ["INBOX"], subject: "New" },
  { id: "aa00000000000004", at: LAKE_RUN_MS - 13 * DAY, labels: ["INBOX"], subject: "Filed" },
  // In the lake with a different subject unless a test says otherwise: CONTENT_MISMATCH.
  { id: "aa00000000000005", at: LAKE_RUN_MS - 12 * DAY, labels: ["INBOX"], subject: "Receipt" },
  // Under no label the connection reads: never listed, never landed.
  { id: "aa00000000000006", at: LAKE_RUN_MS - 11 * DAY, labels: ["SENT"], subject: "Sent" },
];

function fullUrl(id: string): string {
  return `${GMAIL}/messages/${id}?${new URLSearchParams({ format: "full", fields: FULL_FIELDS })}`;
}

function listUrl(params: { label: string; spam: boolean }): string {
  const search = new URLSearchParams({ maxResults: "500" });
  search.append("labelIds", params.label);
  search.set("includeSpamTrash", String(params.spam));
  return `${GMAIL}/messages?${search}`;
}

function gmailFetcher(address: string, messages: readonly Message[]): InMemoryFetcher {
  const fetcher = new InMemoryFetcher()
    .on("POST", TOKEN_URL, { body: { access_token: "invented" } })
    .on("GET", `${GMAIL}/profile`, {
      body: { emailAddress: address, messagesTotal: 6, historyId: "1" },
    });
  function ids(list: readonly Message[]): { messages: { id: string }[] } {
    return { messages: list.map((message) => ({ id: message.id })) };
  }
  fetcher.on("GET", listUrl({ label: "INBOX", spam: false }), {
    body: ids(messages.filter((message) => message.labels.includes("INBOX"))),
  });
  fetcher.on("GET", listUrl({ label: "SPAM", spam: true }), { body: {} });
  const inbox = messages.filter((message) => message.labels.includes("INBOX")).length;
  fetcher.on("GET", `${GMAIL}/labels/INBOX`, {
    body: { id: "INBOX", type: "system", messagesTotal: inbox },
  });
  fetcher.on("GET", `${GMAIL}/labels/SPAM`, {
    body: { id: "SPAM", type: "system", messagesTotal: 0 },
  });
  // A user label: its id is not its name, and the connection card shows only the name.
  fetcher.on("GET", `${GMAIL}/labels`, {
    body: {
      labels: [
        { id: "INBOX", name: "INBOX", type: "system" },
        { id: "SPAM", name: "SPAM", type: "system" },
        { id: "Label_7", name: "Docs example", type: "user" },
      ],
    },
  });
  fetcher.on("GET", listUrl({ label: "Label_7", spam: false }), { body: {} });
  fetcher.on("GET", `${GMAIL}/labels/Label_7`, {
    body: { id: "Label_7", type: "user", messagesTotal: 0 },
  });
  for (const message of messages) {
    fetcher.on("GET", fullUrl(message.id), {
      body: {
        id: message.id,
        threadId: `t${message.id}`,
        labelIds: message.labels,
        internalDate: String(message.at),
        payload: {
          headers: [
            { name: "Message-Id", value: `<${message.id}@mail.example.test>` },
            { name: "Subject", value: message.subject },
            { name: "From", value: "Someone <a@example.test>" },
          ],
          // Part 1 is the body; part 2 the one attachment, a PDF of 1234 bytes.
          parts: [
            { partId: "0", mimeType: "text/plain", filename: "", body: { size: 10 } },
            {
              partId: "1",
              mimeType: "application/pdf",
              filename: "invoice.pdf",
              body: { size: 1234, attachmentId: `att-${message.id}` },
            },
          ],
        },
      },
    });
  }
  return fetcher;
}

interface LakeOptions {
  readonly lakeSubject: (message: Message) => string;
  /** Messages left out of the lake. */
  readonly drop?: readonly string[];
  /** Extra lake rows the mailbox listings do not return: id and the labels the lake holds. */
  readonly extra?: readonly { id: string; labels: readonly string[] }[];
  /** Lake documents; default the PDF attachment of every held message. */
  readonly documents?: readonly { id: string; contentType: string; bytes: number }[];
  /** The primary connection's chosen labels as its card names them; default INBOX and SPAM. */
  readonly primaryLabels?: readonly string[];
}

function lakeWorld(options: LakeOptions): LakeCli {
  const { lakeSubject } = options;
  const lake = new LakeCli();
  lake.connections = [
    {
      kind: "gmail",
      source: "gmail",
      status: "connected",
      externalAccountLabel: "primary@example.test",
      config: {
        labels: options.primaryLabels ?? ["INBOX", "SPAM"],
        fileTypes: ["application/pdf"],
      },
    },
    {
      kind: "gmail",
      source: "gmail.b",
      status: "connected",
      externalAccountLabel: "secondary@example.test",
      config: { labels: ["INBOX"] },
    },
  ];
  lake.runs = [
    {
      id: "r1",
      kind: "ingest",
      source: "gmail",
      entities: ["messages", "documents"],
      status: "ok",
      startedAt: LAKE_RUN,
      endedAt: LAKE_RUN,
      counts: null,
      error: null,
    },
  ];
  const held = WORLD.filter(
    (entry) =>
      entry.labels.includes("INBOX") &&
      entry.at < Date.parse(LAKE_RUN) &&
      !(options.drop ?? []).includes(entry.id),
  );
  for (const row of options.extra ?? []) {
    lake.records.push({
      source: "gmail",
      entity: "messages",
      sourceRecordId: row.id,
      payload: {
        id: row.id,
        threadId: `t${row.id}`,
        internalDate: "1",
        labelIds: row.labels,
        headers: {},
      },
    });
  }
  for (const document of options.documents ??
    held.map((message) => ({
      id: `${message.id}:002`,
      contentType: "application/pdf",
      bytes: 1234,
    }))) {
    lake.documents.push({
      source: "gmail",
      documentId: document.id,
      contentType: document.contentType,
      bytes: document.bytes,
    });
  }
  for (const message of held) {
    lake.records.push({
      source: "gmail",
      entity: "messages",
      sourceRecordId: message.id,
      payload: {
        id: message.id,
        threadId: `t${message.id}`,
        internalDate: String(message.at),
        labelIds: message.labels,
        headers: {
          "Message-ID": `<${message.id}@mail.example.test>`,
          Subject: lakeSubject(message),
          From: "Someone <a@example.test>",
        },
      },
    });
  }
  return lake;
}

const CONFIG: LiveConfig = {
  tenantId: "CASE-0042",
  outDir: "/tmp/out",
  mailboxes: {
    primary: { address: "primary@example.test", tokenFile: "", undercroftSource: "gmail" },
    secondary: { address: "secondary@example.test", tokenFile: "", undercroftSource: "gmail.b" },
  },
};

async function run(
  options: {
    secondaryReads?: string;
    lakeSubject?: (message: Message) => string;
    sourceCache?: SourceCache;
  } & Partial<Omit<LakeOptions, "lakeSubject">> = {},
) {
  const lake = lakeWorld({
    ...options,
    lakeSubject:
      options.lakeSubject ??
      ((message) => (message.id === "aa00000000000005" ? "Receipt (edited)" : message.subject)),
  });
  const credentials = { refresh_token: "r", client_id: "c", client_secret: "s" };
  const results = await runGmailSuite({
    config: CONFIG,
    undercroft: createUndercroftReader(lake, CONFIG.tenantId),
    google: {
      primary: createGoogleClient(gmailFetcher("primary@example.test", WORLD), credentials),
      secondary: createGoogleClient(
        gmailFetcher(options.secondaryReads ?? "secondary@example.test", []),
        credentials,
      ),
    },
    sink: new MemorySink(),
    readSpacingMs: 0,
    ...(options.sourceCache === undefined ? {} : { sourceCache: options.sourceCache }),
  });
  return new Map(results.map((result) => [result.id, result] as const));
}

function get(results: ReadonlyMap<string, TestResult>, id: string): TestResult {
  const result = results.get(id);
  if (result === undefined) {
    throw new Error(`no result ${id}; have ${[...results.keys()].join(", ")}`);
  }
  return result;
}

describe("IT-GM the Gmail suite over an invented world", () => {
  it("IT-GM-LBL-001 a user label the card names is listed by its Gmail id, not its name", async () => {
    // Fires: the name is not an id, so listing by it is a request Gmail refuses.
    const mailbox = get(
      await run({
        lakeSubject: (message) => message.subject,
        primaryLabels: ["INBOX", "SPAM", "Docs example"],
      }),
      "GM-S2U-MBX-001-primary",
    );
    expect(mailbox.status).not.toBe("BLOCKED");
    expect(mailbox.reason).not.toContain("could not be read");
  });

  it("IT-GM-LBL-002 a chosen label no Gmail label matches blocks the mailbox, counted and not named", async () => {
    const mailbox = get(
      await run({
        lakeSubject: (message) => message.subject,
        primaryLabels: ["INBOX", "SPAM", "Renamed since"],
      }),
      "GM-S2U-MBX-001-primary",
    );
    expect(mailbox.status).toBe("BLOCKED");
    expect(mailbox.reason).toContain("1 chosen label(s) match no Gmail label");
    expect(mailbox.reason).not.toContain("Renamed since");
  });

  it("IT-GM-001 with the right account the identity case passes", async () => {
    expect(get(await run(), "GM-ID-001-primary").status).toBe("PASS");
  });

  it("IT-GM-002 a token reading another account blocks every comparison for that mailbox", async () => {
    const results = await run({ secondaryReads: "someone-else@example.test" });
    expect(get(results, "GM-ID-001-secondary").status).toBe("BLOCKED");
    expect(get(results, "GM-S2U-MBX-001-secondary").status).toBe("BLOCKED");
    expect(get(results, "GM-S2U-DOC-001-secondary").status).toBe("BLOCKED");
  });

  it("IT-GM-003 the whole-mailbox leg finds every in-label message in the lake", async () => {
    const mailbox = get(
      await run({ lakeSubject: (message) => message.subject }),
      "GM-S2U-MBX-001-primary",
    );
    expect(mailbox.counts).toMatchObject({ MATCH: 4, MISSING: 0, NOT_YET_SYNCED: 1 });
    expect(mailbox.status).toBe("PENDING");
  });

  it("IT-GM-004 the whole-mailbox leg compares the connector's fields: a header held differently is a mismatch", async () => {
    const mailbox = get(await run(), "GM-S2U-MBX-001-primary");
    expect(mailbox.counts).toMatchObject({ CONTENT_MISMATCH: 1, MATCH: 3 });
    expect(mailbox.status).toBe("FAIL");
  });

  it("IT-GM-005 an in-label message older than the last run but absent is BLOCKED, never MISSING: the run's label selection is not recorded", async () => {
    const mailbox = get(
      await run({ lakeSubject: (message) => message.subject, drop: ["aa00000000000002"] }),
      "GM-S2U-MBX-001-primary",
    );
    expect(mailbox.counts).toMatchObject({ MISSING: 0, BLOCKED: 1 });
    expect(mailbox.status).toBe("BLOCKED");
  });

  it("IT-GM-006 a lake row no listing returns is retained history when it held a selected label, undecided when it never did", async () => {
    const mailbox = get(
      await run({
        lakeSubject: (message) => message.subject,
        extra: [
          { id: "aa00000000000006", labels: ["INBOX"] },
          { id: "aa00000000000007", labels: ["CATEGORY_PROMOTIONS"] },
        ],
      }),
      "GM-S2U-MBX-001-primary",
    );
    expect(mailbox.counts).toMatchObject({ EXTRA: 0, OUT_OF_SCOPE: 1, BLOCKED: 1 });
  });

  it("IT-GM-007 a cached read the live listing contradicts is read again before it is judged; a listed one is not", async () => {
    const credentials = { refresh_token: "r", client_id: "c", client_secret: "s" };
    const reader = createGoogleClient(gmailFetcher("primary@example.test", WORLD), credentials);
    const listed = await reader.getFull("aa00000000000001");
    const moved = await reader.getFull("aa00000000000006");
    if (listed === null || moved === null) {
      throw new Error("the invented world lost a message");
    }
    // Cached while it was still in the Inbox; Gmail has since moved it out (the world says SENT).
    const stale: FullMessage = { ...moved, labelIds: ["INBOX"] };
    const cache = new Map<string, FullMessage | null>([
      ["primary:aa00000000000001", listed],
      ["primary:aa00000000000006", stale],
    ]);
    const written = new Set<string>();
    const sourceCache: SourceCache = {
      get: (key) => cache.get(key),
      put: (key, message) => {
        written.add(key);
        cache.set(key, message);
      },
    };
    const mailbox = get(
      await run({
        lakeSubject: (message) => message.subject,
        extra: [{ id: "aa00000000000006", labels: ["INBOX"] }],
        sourceCache,
      }),
      "GM-S2U-MBX-001-primary",
    );
    // Blocks: on its cached labels the message would be undecidable; read live, it left the selection.
    expect(mailbox.counts).toMatchObject({ OUT_OF_SCOPE: 1 });
    expect(mailbox.counts?.BLOCKED ?? 0).toBe(0);
    expect(written.has("primary:aa00000000000006")).toBe(true);
    expect(cache.get("primary:aa00000000000006")?.labelIds).toEqual(["SENT"]);
    // Silent: a message the listing still returns is not read again.
    expect(written.has("primary:aa00000000000001")).toBe(false);
  });

  it("IT-GM-008 every allowed attachment is in the lake with its type and size; a document on a part that is no attachment is EXTRA", async () => {
    const clean = get(await run(), "GM-S2U-DOC-001-primary");
    expect(clean.counts).toMatchObject({ MATCH: 4, NOT_YET_SYNCED: 1 });
    const extra = get(
      await run({
        documents: [
          { id: "aa00000000000001:002", contentType: "application/pdf", bytes: 1234 },
          { id: "aa00000000000001:001", contentType: "text/plain", bytes: 10 },
        ],
      }),
      "GM-S2U-DOC-001-primary",
    );
    expect(extra.counts).toMatchObject({ MATCH: 1, EXTRA: 1, BLOCKED: 3 });
    expect(extra.status).toBe("FAIL");
  });

  it("IT-GM-009 an attachment of a held message, absent from the lake, is BLOCKED: the fileTypes each run read are not recorded", async () => {
    const docs = get(
      await run({
        documents: [{ id: "aa00000000000001:002", contentType: "application/pdf", bytes: 999 }],
      }),
      "GM-S2U-DOC-001-primary",
    );
    expect(docs.counts).toMatchObject({ CONTENT_MISMATCH: 1, BLOCKED: 3, MISSING: 0 });
  });
});
