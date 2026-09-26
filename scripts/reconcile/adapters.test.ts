/**
 * Contract cases for the adapters: each one against a real in-memory stand-in for its system
 * (`testing.ts`, `InMemoryFetcher`), offline and credential-free. The stand-ins reproduce the
 * behaviours the adapters exist to defeat -- ask.py's 60-character clip and 200-row named
 * limit, the lake's 50-row cursor pages, Gmail's page tokens -- so a regression in the defence
 * fails here rather than as a quiet short read in a live run.
 */
import { describe, expect, it } from "bun:test";

import { InMemoryFetcher } from "../../packages/connector-runtime/src/testing.ts";
import { InMemoryRunner } from "./exec.ts";
import { createGoogleClient, retryable } from "./google.ts";
import { createHubSpotClient } from "./hubspot.ts";
import { ReconcileError } from "./errors.ts";
import {
  chunkedSelect,
  createOstwinReader,
  decodeChunks,
  parseNamed,
  parseWatermark,
} from "./ostwin.ts";
import { Database } from "bun:sqlite";

import { AskPy } from "./askPyStandIn.ts";
import { LakeCli } from "./lakeStandIn.ts";
import { cachedUndercroft } from "./lakeCache.ts";
import { callUndercroft, createUndercroftReader, retryDelayForTests } from "./undercroft.ts";

const LONG_SUBJECT =
  "Re: [Hồ sơ] Báo cáo tài chính | quý 3 — bản ký\nlần 2, gửi lại kèm chứng từ đầy đủ cho kiểm toán";

function martWithMessages(count: number): AskPy {
  const db = new Database(":memory:");
  const ask = new AskPy(db);
  db.run(
    "CREATE TABLE gmail_message_evidence (case_id TEXT, mailbox TEXT, message_id TEXT, subject TEXT)",
  );
  for (let index = 0; index < count; index += 1) {
    db.run("INSERT INTO gmail_message_evidence VALUES (?, ?, ?, ?)", [
      "CASE-99",
      "primary",
      `18f00000000${String(index).padStart(5, "0")}`,
      `${LONG_SUBJECT} #${index}`,
    ]);
  }
  return ask;
}

describe("CT-OST the OSTWIN read door", () => {
  it("CT-OST-001 a row longer than ask.py's cell clip arrives whole, separators and all", async () => {
    const ask = martWithMessages(3);
    const reader = createOstwinReader(ask, "/legacy");
    const rows = await reader.fullRows(
      "SELECT message_id, subject FROM gmail_message_evidence WHERE case_id = 'CASE-99'",
      ["message_id", "subject"],
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]?.subject).toBe(`${LONG_SUBJECT} #0`);
    expect(ask.calls[0]).toContain("--no-header");
  });

  it("CT-OST-002 the same query through plain ask.py sql is clipped -- the defect the transport defeats", async () => {
    const ask = martWithMessages(1);
    const { stdout } = await ask.run([
      "python3",
      "scripts/ask.py",
      "sql",
      "SELECT subject FROM gmail_message_evidence",
      "--no-header",
    ]);
    expect(stdout).toContain("…");
    expect(stdout).not.toContain("#0");
  });

  it("CT-OST-003 an answer that reached ask.py's row limit is refused, not read as complete", () => {
    const truncated = "r | i | c\n1 | 0 | 7B7D\n(1 dòng — CÒN NỮA, thêm WHERE/LIMIT để thu hẹp)\n";
    expect(() => decodeChunks(truncated, ["x"])).toThrow(ReconcileError);
    expect(decodeChunks("r | i | c\n1 | 0 | 7B7D\n(1 dòng)\n", ["x"])).toEqual([{ x: null }]);
  });

  it("CT-OST-004 an answer with no footer is refused: it may have been cut off", () => {
    expect(() => decodeChunks("r | i | c\n1 | 0 | 7B7D\n", ["x"])).toThrow(ReconcileError);
  });

  it("CT-OST-005 a column that is not a plain identifier is refused before any SQL runs", () => {
    expect(() => chunkedSelect("SELECT 1", ["a; DROP TABLE x"])).toThrow(ReconcileError);
    expect(chunkedSelect("SELECT 1 AS a", ["a"])).toContain("json_object('a', a)");
  });

  it("CT-OST-006 a named query that returns exactly its limit is marked possibly truncated", () => {
    const full = parseNamed('# h\n{"a":1}\n{"a":2}\n(2 source rows; limit=2; x)\n', 2);
    expect(full.possiblyTruncated).toBe(true);
    const short = parseNamed('# h\n{"a":1}\n(1 source rows; limit=2; x)\n', 2);
    expect(short.possiblyTruncated).toBe(false);
  });

  it("CT-OST-007 ask.py refuses a named-query limit above 200, and the reader surfaces it", async () => {
    const ask = new AskPy(new Database(":memory:")).named("gmail-source-messages", "CASE-99", {
      header: "# h",
      rows: [],
    });
    const reader = createOstwinReader(ask, "/legacy");
    await expect(reader.named("gmail-source-messages", "CASE-99", 500)).rejects.toThrow(
      "limit outside 1..200",
    );
    expect((await reader.named("gmail-source-messages", "CASE-99", 200)).rows).toEqual([]);
  });

  it("CT-OST-008 the mart trust header dates every OSTWIN answer; no header, no date", () => {
    const mark = parseWatermark(
      "# mart client-master.db · built 2026-09-25T08:07 · tables=4 rows=9 · contract=FAIL · ⚠STALE(x)\nprobe\n1\n(1 dòng)\n",
    );
    expect(mark).toMatchObject({ builtAt: "2026-09-25T08:07", contract: "FAIL", stale: true });
    expect(() => parseWatermark("probe\n1\n")).toThrow(ReconcileError);
  });
});

function lakeWith(count: number): LakeCli {
  const lake = new LakeCli();
  for (let index = 0; index < count; index += 1) {
    lake.records.push({
      source: "gmail",
      entity: "messages",
      sourceRecordId: `1a${String(index).padStart(14, "0")}`,
      payload: { id: `1a${index}`, threadId: "t", labelIds: ["INBOX"], headers: {} },
    });
  }
  return lake;
}

describe("CT-UC the Undercroft CLI", () => {
  it("CT-UC-001 a write procedure is refused before any process runs", async () => {
    const runner = new InMemoryRunner();
    // `lake query` runs a SELECT, but the CLI itself labels it a write; set-scope changes data.
    for (const command of ["lake query", "connections set-scope", "keys mint"]) {
      await expect(callUndercroft(runner, "tenant", command, [])).rejects.toMatchObject({
        code: "REFUSED",
      });
    }
    expect(runner.calls).toHaveLength(0);
  });

  it("CT-UC-001b a read procedure on the allow-list reaches the CLI", async () => {
    const runner = new InMemoryRunner().on(
      ["undercroft", "lake", "summary", "--tenant-id", "tenant", "--agent"],
      { stdout: JSON.stringify({ ok: true, data: { records: [], documents: [] } }) },
    );
    expect(await callUndercroft(runner, "tenant", "lake summary", [])).toEqual({
      records: [],
      documents: [],
    });
    expect(runner.calls).toHaveLength(1);
  });

  it("CT-UC-001c a dropped connection is asked again; a real refusal is not", async () => {
    retryDelayForTests(0);
    const argv = ["undercroft", "lake", "summary", "--tenant-id", "tenant", "--agent"];
    const flaky = new InMemoryRunner()
      .on(argv, {
        code: 1,
        stdout: JSON.stringify({ ok: false, error: { code: "NETWORK_ERROR", message: "reset" } }),
      })
      .on(argv, { stdout: JSON.stringify({ ok: true, data: { records: [], documents: [] } }) });
    expect(await callUndercroft(flaky, "tenant", "lake summary", [])).toEqual({
      records: [],
      documents: [],
    });
    expect(flaky.calls).toHaveLength(2);
    const denied = new InMemoryRunner().on(argv, {
      code: 1,
      stdout: JSON.stringify({ ok: false, error: { code: "FORBIDDEN", message: "admin only" } }),
    });
    await expect(callUndercroft(denied, "tenant", "lake summary", [])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(denied.calls).toHaveLength(1);
  });

  it("CT-UC-002 a lake listing is walked across its 50-row pages to the end", async () => {
    const lake = lakeWith(120);
    const walk = await createUndercroftReader(lake, "tenant").records("gmail", "messages", 120);
    expect(walk.items).toHaveLength(120);
    expect(walk.pages).toBe(3);
    expect(walk.exhausted).toBe(true);
    expect(walk.shortBy).toBe(0);
    expect(walk.items[0]?.payload).toMatchObject({ threadId: "t" });
  });

  it("CT-UC-003 a lake summary declaring more rows than the walk finds is a short read", async () => {
    const lake = lakeWith(10);
    const walk = await createUndercroftReader(lake, "tenant").records("gmail", "messages", 12);
    expect(walk.shortBy).toBe(2);
  });

  it("CT-UC-004 an error envelope becomes an error carrying the CLI's code", async () => {
    const runner = new InMemoryRunner().on(
      ["undercroft", "lake", "summary", "--tenant-id", "tenant", "--agent"],
      {
        code: 1,
        stdout: JSON.stringify({ ok: false, error: { code: "NETWORK_ERROR", message: "down" } }),
      },
    );
    const failure = createUndercroftReader(runner, "tenant").summary();
    await expect(failure).rejects.toBeInstanceOf(ReconcileError);
    await expect(failure).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("CT-UC-005 a cached walk is reused within its age and re-read after it", async () => {
    const lake = lakeWith(3);
    const saved = new Map<string, { savedAt: number; walk: unknown }>();
    let now = 1_000_000;
    const reader = cachedUndercroft(
      createUndercroftReader(lake, "tenant"),
      {
        read: (name) => saved.get(name) ?? null,
        write: (name, walk) => {
          saved.set(name, { savedAt: now, walk });
        },
      },
      60_000,
      () => now,
    );
    await reader.records("gmail", "messages");
    const callsAfterFirst = lake.calls.length;
    now += 30_000;
    const cached = await reader.records("gmail", "messages");
    expect(lake.calls.length).toBe(callsAfterFirst);
    expect(cached.items).toHaveLength(3);
    now += 60_000;
    await reader.records("gmail", "messages");
    expect(lake.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CREDENTIALS = { refresh_token: "r", client_id: "c", client_secret: "s" };
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

describe("CT-GG the Google source", () => {
  it("CT-GG-001 a message listing follows page tokens to the end and asks for Spam only when told", async () => {
    const fetcher = new InMemoryFetcher()
      .on("POST", TOKEN_URL, { body: { access_token: "a" } })
      .on("GET", `${GMAIL}/messages?maxResults=500&labelIds=SPAM&includeSpamTrash=true`, {
        body: { messages: [{ id: "a1" }], nextPageToken: "p2" },
      })
      .on(
        "GET",
        `${GMAIL}/messages?maxResults=500&labelIds=SPAM&includeSpamTrash=true&pageToken=p2`,
        {
          body: { messages: [{ id: "a2" }] },
        },
      );
    const walk = await createGoogleClient(fetcher, CREDENTIALS).listMessages({
      labelIds: ["SPAM"],
      includeSpamTrash: true,
    });
    expect(walk.items).toEqual(["a1", "a2"]);
    expect(walk.exhausted).toBe(true);
    expect(fetcher.calls[0]?.body).toContain("grant_type=refresh_token");
  });

  it("CT-GG-002 a message Gmail no longer has is null, not an error", async () => {
    const fetcher = new InMemoryFetcher()
      .on("POST", TOKEN_URL, { body: { access_token: "a" } })
      .on(
        "GET",
        `${GMAIL}/messages/gone?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { status: 404, body: { error: { code: 404, status: "NOT_FOUND" } } },
      );
    expect(await createGoogleClient(fetcher, CREDENTIALS).getMessage("gone")).toBeNull();
  });

  it("CT-GG-002b a header is found under the requested name whatever case the sender wrote", async () => {
    const fetcher = new InMemoryFetcher()
      .on("POST", TOKEN_URL, { body: { access_token: "a" } })
      .on(
        "GET",
        `${GMAIL}/messages/m1?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        {
          body: {
            id: "m1",
            threadId: "t1",
            internalDate: "1",
            payload: {
              headers: [
                { name: "Message-Id", value: "<x@example.test>" },
                { name: "SUBJECT", value: "Hi" },
              ],
            },
          },
        },
      );
    const message = await createGoogleClient(fetcher, CREDENTIALS).getMessage("m1");
    expect(message?.headers["Message-ID"]).toBe("<x@example.test>");
    expect(message?.headers.Subject).toBe("Hi");
  });

  it("CT-GG-003 an error names the endpoint but never the search query", async () => {
    const fetcher = new InMemoryFetcher()
      .on("POST", TOKEN_URL, { body: { access_token: "a" } })
      .on("GET", `${GMAIL}/messages?maxResults=500&q=secret-client&includeSpamTrash=false`, {
        status: 400,
        body: { error: { status: "INVALID_ARGUMENT", message: "bad q=secret-client" } },
      });
    const failure = createGoogleClient(fetcher, CREDENTIALS).listMessages({ q: "secret-client" });
    await expect(failure).rejects.toThrow("INVALID_ARGUMENT");
    await expect(failure).rejects.not.toThrow("secret-client");
  });

  it("CT-GG-004 Gmail's rate-limit 403 is retried; a real permission 403 is not", () => {
    const limit = JSON.stringify({ error: { errors: [{ reason: "rateLimitExceeded" }] } });
    const denied = JSON.stringify({ error: { errors: [{ reason: "insufficientPermissions" }] } });
    expect(retryable(403, limit)).toBe(true);
    expect(retryable(403, denied)).toBe(false);
    expect(retryable(429, "")).toBe(true);
    expect(retryable(404, "")).toBe(false);
  });

  it("CT-GG-005 a Drive tree is walked through subfolders across drives, without following shortcuts", async () => {
    function list(parent: string): string {
      return `https://www.googleapis.com/drive/v3/files?q=%27${parent}%27+in+parents+and+trashed+%3D+false&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken%2Cfiles%28id%2Cname%2CmimeType%2Cmd5Checksum%2Csize%2CmodifiedTime%2Cparents%2CdriveId%29`;
    }
    const fetcher = new InMemoryFetcher()
      .on("POST", TOKEN_URL, { body: { access_token: "a" } })
      .on("GET", list("root"), {
        body: {
          files: [
            {
              id: "sub",
              name: "Hồ sơ",
              mimeType: "application/vnd.google-apps.folder",
              parents: ["root"],
            },
            {
              id: "lnk",
              name: "elsewhere",
              mimeType: "application/vnd.google-apps.shortcut",
              parents: ["root"],
            },
          ],
        },
      })
      .on("GET", list("sub"), {
        body: {
          files: [
            {
              id: "f1",
              name: "a.pdf",
              mimeType: "application/pdf",
              md5Checksum: "m",
              size: "3",
              parents: ["sub"],
            },
          ],
        },
      });
    const tree = await createGoogleClient(fetcher, CREDENTIALS).driveTree("root");
    expect(tree.files.map((file) => file.path)).toEqual(["Hồ sơ/a.pdf"]);
    expect(tree.shortcuts).toBe(1);
    expect(tree.incomplete).toEqual([]);
  });
});

describe("CT-HS the HubSpot source", () => {
  it("CT-HS-001 a full listing follows `after` cursors and keeps each object's company links once", async () => {
    const base =
      "https://api.hubapi.com/crm/v3/objects/deals?limit=100&archived=false&properties=dealname&associations=companies";
    const fetcher = new InMemoryFetcher()
      .on("GET", base, {
        body: {
          results: [
            {
              id: "1",
              properties: { dealname: "A" },
              associations: {
                companies: {
                  results: [
                    { id: "9", type: "deal_to_company" },
                    { id: "9", type: "deal_to_company_unlabeled" },
                  ],
                },
              },
            },
          ],
          paging: { next: { after: "1" } },
        },
      })
      .on("GET", `${base}&after=1`, {
        body: { results: [{ id: "2", properties: { dealname: "B" } }] },
      });
    const listing = await createHubSpotClient(fetcher, "t").listAll(
      "deals",
      ["dealname"],
      "companies",
    );
    expect(listing.records.map((record) => record.id)).toEqual(["1", "2"]);
    expect(listing.associations.get("1")).toEqual(["9"]);
    expect(listing.exhausted).toBe(true);
  });

  it("CT-HS-002 ids a batch read does not return are reported, not dropped", async () => {
    const fetcher = new InMemoryFetcher().on(
      "POST",
      "https://api.hubapi.com/crm/v3/objects/companies/batch/read?archived=false",
      { body: { results: [{ id: "1", properties: { name: "X" } }] } },
    );
    const read = await createHubSpotClient(fetcher, "t").batchRead(
      "companies",
      ["1", "2"],
      ["name"],
    );
    expect(read.notFound).toEqual(["2"]);
  });
});
