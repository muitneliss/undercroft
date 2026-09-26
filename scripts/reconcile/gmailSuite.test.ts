/**
 * The Gmail suite end to end, offline: a small invented world held by the three stand-ins
 * (Gmail through `InMemoryFetcher`, OSTWIN through `AskPy` over SQLite, the lake through
 * `LakeCli`), run through the same `runGmailSuite` the live CLI calls. Each message in the
 * world is placed to produce one verdict, so a change to scope, watermark or identity logic
 * shows up as a verdict moving, not as a count drifting.
 *
 * Every value here is invented (`.claude/rules/pii.md`).
 */
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { InMemoryFetcher } from "../../packages/connector-runtime/src/testing.ts";
import type { LiveConfig } from "./config.ts";
import { MemorySink } from "./memorySink.ts";
import { runGmailSuite } from "./gmailSuite.ts";
import { createGoogleClient } from "./google.ts";
import type { TestResult } from "./model.ts";
import { createOstwinReader } from "./ostwin.ts";
import { AskPy } from "./askPyStandIn.ts";
import { LakeCli, routeCommands } from "./lakeStandIn.ts";
import { createUndercroftReader } from "./undercroft.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const HARVEST = "20260910T000000Z-fixture";
const HARVEST_MS = Date.parse("2026-09-10T00:00:00Z");
const LAKE_RUN = "2026-09-20T00:00:00.000Z";
const SCOPE_QUERY = '{"example.test"}';
const LABEL_QUERY = 'label:"docs example"';

interface Message {
  readonly id: string;
  readonly at: number;
  readonly labels: readonly string[];
  readonly subject: string;
}

const DAY = 86_400_000;
const WORLD: readonly Message[] = [
  // In every system, fields equal.
  { id: "aa00000000000001", at: HARVEST_MS - 5 * DAY, labels: ["INBOX"], subject: "Invoice" },
  // Found by the scope query, older than OSTWIN's harvest, absent from OSTWIN: MISSING.
  { id: "aa00000000000002", at: HARVEST_MS - 4 * DAY, labels: ["INBOX"], subject: "Contract" },
  // Newer than both warehouses' last reads: NOT_YET_SYNCED everywhere.
  { id: "aa00000000000003", at: Date.parse(LAKE_RUN) + DAY, labels: ["INBOX"], subject: "New" },
  // Found only by the label route and not claimed: EXCLUDED_BY_RULE.
  { id: "aa00000000000004", at: HARVEST_MS - 3 * DAY, labels: ["INBOX"], subject: "Filed" },
  // In the lake with a different subject: CONTENT_MISMATCH on S->U.
  { id: "aa00000000000005", at: HARVEST_MS - 2 * DAY, labels: ["INBOX"], subject: "Receipt" },
  // Archived out of every Undercroft label: OUT_OF_SCOPE for the lake.
  { id: "aa00000000000006", at: HARVEST_MS - DAY, labels: ["SENT"], subject: "Sent" },
];

function metadataUrl(id: string): string {
  const params = new URLSearchParams({ format: "metadata" });
  for (const header of ["Message-ID", "Subject", "From", "Date"]) {
    params.append("metadataHeaders", header);
  }
  return `${GMAIL}/messages/${id}?${params}`;
}

function listUrl(params: { q?: string; label?: string; spam: boolean }): string {
  const search = new URLSearchParams({ maxResults: "500" });
  if (params.q !== undefined) {
    search.set("q", params.q);
  }
  if (params.label !== undefined) {
    search.append("labelIds", params.label);
  }
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
  fetcher.on("GET", listUrl({ q: SCOPE_QUERY, spam: false }), {
    body: ids(messages.filter((message) => message.id !== "aa00000000000004")),
  });
  fetcher.on("GET", listUrl({ q: LABEL_QUERY, spam: false }), {
    body: ids(messages.filter((message) => message.id === "aa00000000000004")),
  });
  for (const message of messages) {
    fetcher.on("GET", metadataUrl(message.id), {
      body: {
        id: message.id,
        threadId: `t${message.id}`,
        labelIds: message.labels,
        internalDate: String(message.at),
        payload: {
          headers: [
            { name: "Message-ID", value: `<${message.id}@mail.example.test>` },
            { name: "Subject", value: message.subject },
            { name: "From", value: "Someone <a@example.test>" },
          ],
        },
      },
    });
  }
  return fetcher;
}

function ostwinWorld(unpublished: readonly string[]): AskPy {
  const db = new Database(":memory:");
  const ask = new AskPy(db);
  db.run(
    "CREATE TABLE gmail_message_evidence (case_id TEXT, mailbox TEXT, message_id TEXT, thread_id TEXT, message_time TEXT, subject TEXT, route TEXT, labels TEXT, rfc822_message_id TEXT, source_run TEXT)",
  );
  db.run(
    "CREATE TABLE gmail_coverage (case_id TEXT, mailbox TEXT, mode TEXT, coverage_status TEXT, pages_used TEXT, max_pages TEXT, pagination_exhausted TEXT, messages_found TEXT, messages_discarded TEXT, query_sha256 TEXT, source_run TEXT)",
  );
  for (const message of WORLD.filter((entry) =>
    ["aa00000000000001", "aa00000000000005", "aa00000000000006"].includes(entry.id),
  )) {
    db.run("INSERT INTO gmail_message_evidence VALUES (?,?,?,?,?,?,?,?,?,?)", [
      "CASE-99",
      "primary",
      message.id,
      `t${message.id}`,
      new Date(message.at).toISOString().replace(".000Z", "+00:00"),
      message.subject,
      "scope",
      message.labels.join(";"),
      `<${message.id}@mail.example.test>`,
      HARVEST,
    ]);
  }
  db.run("INSERT INTO gmail_coverage VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
    "CASE-99",
    "primary",
    "full",
    "complete",
    "1",
    "20",
    "1",
    "4",
    "0",
    "x",
    HARVEST,
  ]);
  ask.named("gmail-source-status", "CASE-99", {
    header: "# Gmail SOURCE_CANDIDATE CASE-99",
    rows: [{ case: "CASE-99", state: "review_needed", source_run: "20260915T000000Z-fixture" }],
  });
  ask.named("gmail-source-messages", "CASE-99", {
    header: "# Gmail SOURCE_CANDIDATE CASE-99",
    rows: unpublished.map((id) => ({ message_id: id, mailbox: "primary" })),
  });
  ask.named("gmail-source-coverage", "CASE-99", {
    header: "# Gmail SOURCE_CANDIDATE CASE-99",
    rows: [
      {
        mailbox: "primary",
        discarded: [],
        routes: [
          { route: "scope", query: SCOPE_QUERY, pagination_exhausted: true },
          { route: "label", query: LABEL_QUERY, pagination_exhausted: true },
          { route: "thread_sibling", query: "", pagination_exhausted: true },
        ],
      },
    ],
  });
  return ask;
}

function lakeWorld(lakeSubject: (message: Message) => string): LakeCli {
  const lake = new LakeCli();
  lake.connections = [
    {
      kind: "gmail",
      source: "gmail",
      status: "connected",
      externalAccountLabel: "primary@example.test",
      config: { labels: ["INBOX", "SPAM"] },
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
      entities: ["messages"],
      status: "ok",
      startedAt: LAKE_RUN,
      endedAt: LAKE_RUN,
      counts: null,
      error: null,
    },
  ];
  for (const message of WORLD.filter(
    (entry) => entry.labels.includes("INBOX") && entry.at < Date.parse(LAKE_RUN),
  )) {
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
  tenantId: "tenant",
  ostwinRoot: "/legacy",
  outDir: "/tmp/out",
  hubspotEnvFile: "/dev/null",
  mailboxes: {
    primary: { address: "primary@example.test", tokenFile: "", undercroftSource: "gmail" },
    secondary: { address: "secondary@example.test", tokenFile: "", undercroftSource: "gmail.b" },
  },
  driveRoots: [],
  clients: [
    {
      label: "CASE-99",
      caseId: "CASE-99",
      clientId: "c-99",
      hubspotCompanyIds: [],
      driveFolders: [],
    },
  ],
};

async function run(
  options: {
    businessReads?: string;
    lakeSubject?: (message: Message) => string;
    unpublished?: readonly string[];
  } = {},
) {
  const ask = ostwinWorld(options.unpublished ?? []);
  const lake = lakeWorld(
    options.lakeSubject ??
      ((message) => (message.id === "aa00000000000005" ? "Receipt (edited)" : message.subject)),
  );
  const runner = routeCommands(ask, lake);
  const credentials = { refresh_token: "r", client_id: "c", client_secret: "s" };
  const results = await runGmailSuite({
    config: CONFIG,
    ostwin: createOstwinReader(runner, "/legacy"),
    undercroft: createUndercroftReader(runner, "tenant"),
    google: {
      primary: createGoogleClient(gmailFetcher("primary@example.test", WORLD), credentials),
      secondary: createGoogleClient(
        gmailFetcher(options.businessReads ?? "secondary@example.test", []),
        credentials,
      ),
    },
    sink: new MemorySink(),
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
  it("IT-GM-001 a message the scope query finds, older than the harvest and absent from OSTWIN, fails S->O as MISSING", async () => {
    const s2o = get(await run(), "GM-CASE-99-S2O-primary");
    expect(s2o.status).toBe("FAIL");
    expect(s2o.counts).toMatchObject({
      MISSING: 1,
      MATCH: 3,
      NOT_YET_SYNCED: 1,
      EXCLUDED_BY_RULE: 1,
    });
  });

  it("IT-GM-002 a label-route hit OSTWIN did not claim is excluded by rule, not missing", async () => {
    const s2o = get(await run(), "GM-CASE-99-S2O-primary");
    expect(s2o.counts?.EXCLUDED_BY_RULE).toBe(1);
  });

  it("IT-GM-003 a header the lake holds differently is a content mismatch on S->U", async () => {
    const s2u = get(await run(), "GM-CASE-99-S2U-primary");
    expect(s2u.status).toBe("FAIL");
    expect(s2u.counts).toMatchObject({ CONTENT_MISMATCH: 1, OUT_OF_SCOPE: 1, NOT_YET_SYNCED: 1 });
  });

  it("IT-GM-004 with equal headers the same leg passes, the archived message out of scope and the new one pending", async () => {
    const s2u = get(
      await run({ lakeSubject: (message) => message.subject }),
      "GM-CASE-99-S2U-primary",
    );
    expect(s2u.status).toBe("PENDING");
    expect(s2u.counts).toMatchObject({
      CONTENT_MISMATCH: 0,
      MISSING: 0,
      OUT_OF_SCOPE: 1,
      NOT_YET_SYNCED: 1,
    });
  });

  it("IT-GM-005 O->U compares only OSTWIN messages under an Undercroft label", async () => {
    const o2u = get(
      await run({ lakeSubject: (message) => message.subject }),
      "GM-CASE-99-O2U-primary",
    );
    expect(o2u.counts).toMatchObject({ MATCH: 2, OUT_OF_SCOPE: 1 });
    expect(o2u.status).toBe("PASS");
  });

  it("IT-GM-006 the whole-mailbox leg finds every in-label message in the lake", async () => {
    const mailbox = get(await run(), "GM-S2U-MBX-001-primary");
    expect(mailbox.counts).toMatchObject({ MISSING: 0, NOT_YET_SYNCED: 1 });
    expect(mailbox.status).toBe("PENDING");
  });

  it("IT-GM-007 a token reading another account blocks every comparison for that mailbox", async () => {
    const results = await run({ businessReads: "someone-else@example.test" });
    expect(get(results, "GM-ID-001-secondary").status).toBe("BLOCKED");
    expect(get(results, "GM-CASE-99-S2O-secondary").status).toBe("BLOCKED");
    expect(get(results, "GM-S2U-MBX-001-secondary").status).toBe("BLOCKED");
  });

  it("IT-GM-008 with the right account the identity case passes", async () => {
    expect(get(await run(), "GM-ID-001-primary").status).toBe("PASS");
  });

  it("IT-GM-009 a message OSTWIN's newer harvest holds but has not published is pending, not missing", async () => {
    const s2o = get(await run({ unpublished: ["aa00000000000002"] }), "GM-CASE-99-S2O-primary");
    expect(s2o.counts).toMatchObject({ MISSING: 0, NOT_YET_SYNCED: 2 });
    expect(s2o.status).toBe("PENDING");
  });
});
