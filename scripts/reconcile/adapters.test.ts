/**
 * Contract cases for the adapters: each one against a real in-memory stand-in for its system
 * (`lakeStandIn.ts`, `InMemoryRunner`, `InMemoryFetcher`), offline and credential-free. The
 * stand-ins reproduce the behaviours the adapters exist to defeat -- the lake's 50-row cursor
 * pages, the CLI's mix of reads and writes, Gmail's page tokens, header case and rate-limit
 * answers -- so a regression in the defence fails here rather than as a quiet short read in a
 * live run.
 */
import { describe, expect, it } from "bun:test";

import { InMemoryFetcher } from "../../packages/connector-runtime/src/testing.ts";
import { ReconcileError } from "./errors.ts";
import { InMemoryRunner } from "./exec.ts";
import { FULL_FIELDS } from "./gmail.ts";
import { createGoogleClient, retryable } from "./google.ts";
import { cachedUndercroft } from "./lakeCache.ts";
import { LakeCli } from "./lakeStandIn.ts";
import { callUndercroft, createUndercroftReader, retryDelayForTests } from "./undercroft.ts";

function lakeWith(count: number): LakeCli {
  const lake = new LakeCli();
  for (let index = 0; index < count; index += 1) {
    lake.records.push({
      source: "gmail",
      entity: "messages",
      sourceRecordId: `aa${String(index).padStart(14, "0")}`,
      payload: {
        id: `aa${String(index).padStart(14, "0")}`,
        threadId: "t",
        labelIds: ["INBOX"],
        headers: {},
      },
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
    // Only lake reads count: reusing a walk also reads the run ledger once (CT-UC-006).
    function walks() {
      return lake.calls.filter((call) => call.includes("records")).length;
    }
    await reader.records("gmail", "messages");
    const callsAfterFirst = walks();
    now += 30_000;
    const cached = await reader.records("gmail", "messages");
    expect(walks()).toBe(callsAfterFirst);
    expect(cached.items).toHaveLength(3);
    now += 60_000;
    await reader.records("gmail", "messages");
    expect(walks()).toBeGreaterThan(callsAfterFirst);
  });

  it("CT-UC-006 a cached walk is re-read once a run of its source ends after it was taken", async () => {
    const lake = lakeWith(3);
    const saved = new Map<string, { savedAt: number; walk: unknown }>();
    const taken = Date.parse("2026-09-27T18:21:00Z");
    const store = {
      read: (name: string) => saved.get(name) ?? null,
      write: (name: string, walk: unknown) => {
        saved.set(name, { savedAt: taken, walk });
      },
    };
    function run(source: string, endedAt: string | null) {
      return {
        id: `run-${source}-${endedAt}`,
        kind: "ingest",
        source,
        entities: ["messages"],
        status: endedAt === null ? "running" : "ok",
        startedAt: "2026-09-27T18:00:00Z",
        endedAt,
      };
    }
    function open() {
      return cachedUndercroft(
        createUndercroftReader(lake, "tenant"),
        store,
        43_200_000,
        () => taken + 60_000,
      );
    }
    await open().records("gmail", "messages");
    const walked = lake.calls.length;
    // Silent: runs that ended before the walk, or of another source, leave it reusable.
    lake.runs = [run("gmail", "2026-09-27T18:10:00Z"), run("gmail.b", "2026-09-27T18:47:00Z")];
    await open().records("gmail", "messages");
    expect(lake.calls.filter((call) => call.includes("records")).length).toBe(
      lake.calls.slice(0, walked).filter((call) => call.includes("records")).length,
    );
    // Blocks: a run of the same source that ended after the walk forces a fresh one.
    lake.runs = [run("gmail", "2026-09-27T18:44:00Z")];
    await open().records("gmail", "messages");
    expect(lake.calls.filter((call) => call.includes("records")).length).toBeGreaterThan(
      lake.calls.slice(0, walked).filter((call) => call.includes("records")).length,
    );
  });

  it("CT-UC-007 a run of the walk's source still running also forces a fresh walk", async () => {
    const lake = lakeWith(1);
    const saved = new Map<string, { savedAt: number; walk: unknown }>();
    const taken = Date.parse("2026-09-27T18:21:00Z");
    const store = {
      read: (name: string) => saved.get(name) ?? null,
      write: (name: string, walk: unknown) => {
        saved.set(name, { savedAt: taken, walk });
      },
    };
    function open() {
      return cachedUndercroft(
        createUndercroftReader(lake, "tenant"),
        store,
        43_200_000,
        () => taken + 60_000,
      );
    }
    await open().documents("gmail");
    const before = lake.calls.filter((call) => call.includes("documents")).length;
    lake.runs = [
      {
        id: "r",
        kind: "ingest",
        source: "gmail",
        entities: [],
        status: "running",
        startedAt: "2026-09-27T18:30:00Z",
        endedAt: null,
      },
    ];
    await open().documents("gmail");
    expect(lake.calls.filter((call) => call.includes("documents")).length).toBeGreaterThan(before);
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

  it("CT-GG-003 a header is found under the requested name whatever case the sender wrote", async () => {
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

  it("CT-GG-004 a full read keeps every value of the connector's six headers and numbers parts depth-first from 1", async () => {
    const fetcher = new InMemoryFetcher()
      .on("POST", TOKEN_URL, { body: { access_token: "a" } })
      .on(
        "GET",
        `${GMAIL}/messages/m1?${new URLSearchParams({ format: "full", fields: FULL_FIELDS })}`,
        {
          body: {
            id: "m1",
            threadId: "t1",
            labelIds: ["INBOX"],
            internalDate: "1",
            payload: {
              headers: [
                { name: "to", value: "a@example.test" },
                { name: "To", value: "b@example.test" },
                { name: "Received", value: "not kept" },
              ],
              parts: [
                {
                  mimeType: "multipart/alternative",
                  parts: [{ mimeType: "text/plain", body: { size: 3 } }],
                },
                {
                  mimeType: "message/rfc822",
                  filename: "fwd.eml",
                  body: { size: 9, attachmentId: "x" },
                  parts: [
                    {
                      mimeType: "application/pdf",
                      filename: "a.pdf",
                      body: { size: 5, attachmentId: "y" },
                    },
                  ],
                },
              ],
            },
          },
        },
      );
    const message = await createGoogleClient(fetcher, CREDENTIALS).getFull("m1");
    expect(message?.headerValues).toEqual({ To: ["a@example.test", "b@example.test"] });
    expect(message?.parts.map((part) => [part.index, part.mimeType, part.hasAttachmentId])).toEqual(
      [
        [1, "multipart/alternative", false],
        [2, "text/plain", false],
        [3, "message/rfc822", true],
        [4, "application/pdf", true],
      ],
    );
  });

  it("CT-GG-005 a label's own count is read apart from any listing; a label that does not exist is null", async () => {
    const fetcher = new InMemoryFetcher()
      .on("POST", TOKEN_URL, { body: { access_token: "a" } })
      .on("GET", `${GMAIL}/labels/INBOX`, {
        body: { id: "INBOX", type: "system", messagesTotal: 7 },
      })
      .on("GET", `${GMAIL}/labels/NOPE`, { status: 404, body: {} });
    const google = createGoogleClient(fetcher, CREDENTIALS);
    expect(await google.label("INBOX")).toEqual({ id: "INBOX", type: "system", messagesTotal: 7 });
    expect(await google.label("NOPE")).toBeNull();
  });

  it("CT-GG-006 an expired access token is refreshed once and the read repeated", async () => {
    const fetcher = new InMemoryFetcher()
      .on("POST", TOKEN_URL, { body: { access_token: "old" } })
      .on("POST", TOKEN_URL, { body: { access_token: "new" } })
      .on("GET", `${GMAIL}/labels/INBOX`, { status: 401, body: {} })
      .on("GET", `${GMAIL}/labels/INBOX`, {
        body: { id: "INBOX", type: "system", messagesTotal: 2 },
      });
    const label = await createGoogleClient(fetcher, CREDENTIALS).label("INBOX");
    expect(label?.messagesTotal).toBe(2);
  });

  it("CT-GG-007 a 401 that a fresh token does not cure is an error, not a loop", async () => {
    const fetcher = new InMemoryFetcher()
      .on("POST", TOKEN_URL, { body: { access_token: "a" } })
      .on("GET", `${GMAIL}/labels/INBOX`, { status: 401, body: {} });
    await expect(createGoogleClient(fetcher, CREDENTIALS).label("INBOX")).rejects.toThrow("401");
  });

  it("CT-GG-008 an error names the endpoint but never the search query", async () => {
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

  it("CT-GG-009 Gmail's rate-limit 403 is retried; a real permission 403 is not", () => {
    const limit = JSON.stringify({ error: { errors: [{ reason: "rateLimitExceeded" }] } });
    const denied = JSON.stringify({ error: { errors: [{ reason: "insufficientPermissions" }] } });
    expect(retryable(403, limit)).toBe(true);
    expect(retryable(403, denied)).toBe(false);
    expect(retryable(429, "")).toBe(true);
    expect(retryable(404, "")).toBe(false);
  });
});
