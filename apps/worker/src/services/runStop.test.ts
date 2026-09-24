/**
 * A run the process tells to stop keeps what it landed, counts it, and decides nothing that
 * only a finished read may decide. ADR 0051, and issue #196.
 *
 * Driven through `runIngest`, the door a deploy actually interrupts, over the real recorded
 * fetchers -- which refuse an unmodelled request, so "it stopped here" is proved by a route
 * nobody recorded never being asked for. The stop itself arrives from a fetcher wrapped round
 * the recorded one, the first time a named URL is asked for: a SIGTERM landing mid-read, at a
 * moment a test can name, with no sleeping and no timing to be lucky with.
 *
 * What is pinned is the three promises a stop makes, each a way a partial read could be
 * mistaken for a whole one: the counts are what reached `raw.records`, not zeroes; Drive's
 * tombstone sweep does not run over a walk that stopped halfway; a spec entity's watermark does
 * not move past a read that did not finish.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryFetcher } from "@undercroft/connector-runtime/testing";
import { createStampSource, InMemoryByteFetcher, TestClock } from "@undercroft/core";
import { seal } from "@undercroft/crypto";
import { eventsFor, writeConnectionDetail } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { readSyncCursor } from "../repos/syncCursor.ts";
import { runIngest } from "./ingest.ts";
import { CHUNK } from "./landing.ts";
import { RUN_STOPPED, type RunDeps, RunStopped } from "./runTypes.ts";

const TENANT = "CASE-1";
const KEY = Buffer.alloc(32, 3).toString("base64");
/** One millisecond between Google requests: pacing is not what this suite is about. */
const ENV = { UNDERCROFT_SECRET_KEY: KEY, UNDERCROFT_GOOGLE_MIN_INTERVAL_MS: "1" };
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const BASE = "https://demo.test";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n%%EOF\n");

/** Two entities, the first incremental, so a stop can be seen to leave both the mark and the second alone. */
const SPEC = `
apiVersion: undercroft.dev/v1
kind: Connector
id: demo
displayName: Demo
baseUrl: ${BASE}
auth: { kind: none }
defaults:
  pagination: { kind: json-link, nextPath: paging.next.link }
entities:
  - name: things
    request: { kind: list, path: /things }
    envelopePath: results
    idPath: id
    updatedAtPath: updatedAt
    incremental:
      strategy: query-param
      param: updatedAfter
      sourcePath: changedAt
      format: epoch-millis
  - name: others
    request: { kind: list, path: /others }
    envelopePath: results
    idPath: id
`;

let db: TestDatabase;
let lake: LakeStore;
let specsDir: string;

beforeEach(async () => {
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.exec("CREATE TABLE raw.records_demo PARTITION OF raw.records FOR VALUES IN ('demo')");
  specsDir = mkdtempSync(join(tmpdir(), "undercroft-specs-"));
  writeFileSync(join(specsDir, "demo.yaml"), SPEC);
  // Seeded as the superuser; from here on every statement runs as the worker does.
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

/** A connected Google source with a sealed credential and a chosen scope. */
async function connect(source: "gmail" | "drive", selection: unknown): Promise<void> {
  const sealed = seal(JSON.stringify({ accessToken: "tok", refreshToken: "", expiresAt: null }), {
    env: { UNDERCROFT_SECRET_KEY: KEY },
  });
  await db.asSuperuser(async (tx) => {
    await tx.query(
      "INSERT INTO ops.connection (tenant_id, source, status) VALUES ($1, $2, 'connected')",
      [TENANT, source],
    );
    await tx.query(
      "INSERT INTO app.connection_secret (tenant_id, source, ciphertext, key_version) VALUES ($1, $2, $3, 1)",
      [TENANT, source, Buffer.from(sealed.blob)],
    );
    await writeConnectionDetail(tx, {
      tenantId: TENANT,
      source,
      selectionJson: JSON.stringify(selection),
    });
  });
}

/**
 * The recorded fetcher, with the process told to stop the first time `url` is asked for.
 *
 * Not a mock: every request, the named one included, still goes to the recording and is
 * answered or refused by it exactly as it would be without the wrapper. The only thing added
 * is the SIGTERM, delivered while that request is in flight.
 */
function stoppingAt<R extends { readonly url: string }, A>(
  inner: { send: (request: R) => Promise<A> },
  url: string,
  stop: AbortController,
): { send: (request: R) => Promise<A> } {
  return {
    send: (request): Promise<A> => {
      if (request.url === url) {
        stop.abort();
      }
      return inner.send(request);
    },
  };
}

/** Run once, and answer with how it ended rather than letting a stop fail the test. */
async function ingest(source: string, deps: Partial<RunDeps>): Promise<unknown> {
  try {
    const input = { source, tenantId: TENANT };
    return await runIngest({ lake, exec: db, specsDir, env: ENV, ...deps }, input);
  } catch (error) {
    return error;
  }
}

async function runsOf(
  source: string,
): Promise<{ id: string; status: string; error: string | null; created: number }[]> {
  const { rows } = await db.query<{
    id: string;
    status: string;
    error: string | null;
    created: number;
  }>("SELECT id, status, error, created FROM ops.run WHERE source = $1 ORDER BY started_at, id", [
    source,
  ]);
  return rows;
}

async function entityCreated(runId: string): Promise<Record<string, number>> {
  const { rows } = await db.query<{ entity: string; created: number }>(
    "SELECT entity, created FROM ops.run_entity WHERE run_id = $1",
    [runId],
  );
  return Object.fromEntries(rows.map((row) => [row.entity, row.created]));
}

async function countOf(table: "raw.records" | "raw.documents", source: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE source = $1`,
    [source],
  );
  return rows[0]?.n ?? -1;
}

describe("a Gmail ingest stopped mid-harvest", () => {
  function messageUrl(id: string): string {
    return `${GMAIL}/messages/${id}?format=full`;
  }

  function attachmentUrl(id: string): string {
    return `${GMAIL}/messages/${id}/attachments/att-${id}`;
  }

  /** A mailbox of more than one chunk, one PDF per message. */
  function mailbox(fetcher: InMemoryByteFetcher, ids: readonly string[]): void {
    fetcher.on("GET", `${GMAIL}/messages?maxResults=100`, {
      body: { messages: ids.map((id) => ({ id })) },
    });
    for (const id of ids) {
      fetcher
        .on("GET", messageUrl(id), {
          body: {
            id,
            threadId: `t-${id}`,
            labelIds: ["INBOX"],
            internalDate: "1789400000000",
            payload: {
              headers: [{ name: "Subject", value: `Invoice ${id}` }],
              parts: [
                {
                  mimeType: "application/pdf",
                  filename: `invoice-${id}.pdf`,
                  body: { size: String(PDF.byteLength), attachmentId: `att-${id}` },
                },
              ],
            },
          },
        })
        .on("GET", attachmentUrl(id), {
          body: { data: Buffer.from(PDF).toString("base64url") },
        });
    }
  }

  it("settles failed with the stop, counting what reached raw.records, and the next run finishes", async () => {
    // The first chunk is landed and projected; the stop arrives ten messages into the second.
    // Before this, the run died on SIGTERM, stayed `running` until the next boot, and was
    // closed there with 0 of everything beside 200 messages it had in fact kept.
    const ids = Array.from({ length: CHUNK + 50 }, (_, i) => `m${i}`);
    const recorded = new InMemoryByteFetcher();
    mailbox(recorded, ids);
    await connect("gmail", { labels: [] });
    const stop = new AbortController();

    const outcome = await ingest("gmail", {
      byteFetcher: stoppingAt(recorded, messageUrl(`m${CHUNK + 10}`), stop),
      stop: stop.signal,
    });

    expect(outcome).toBeInstanceOf(RunStopped);
    const [stopped] = await runsOf("gmail");
    expect(stopped?.status).toBe("failed");
    expect(stopped?.error).toBe(RUN_STOPPED);
    // The counts are the lake's, not a placeholder: every record and document it reports is
    // one the tables hold.
    expect(await countOf("raw.records", "gmail")).toBe(CHUNK);
    expect(await countOf("raw.documents", "gmail")).toBe(CHUNK);
    expect(await entityCreated(stopped?.id ?? "")).toEqual({ messages: CHUNK, documents: CHUNK });
    expect(stopped?.created).toBe(CHUNK * 2);
    // The pending messages' attachments were not fetched on the way out -- that is minutes on a
    // real mailbox, which a container's grace period does not have.
    expect(recorded.calls.some((call) => call.url === attachmentUrl(`m${CHUNK + 5}`))).toBe(false);
    const last = (await eventsFor(db, stopped?.id ?? "")).at(-1);
    expect(last?.event).toBe("run_stopped");
    expect(last?.detail).toMatchObject({ created: CHUNK * 2 });

    const next = await ingest("gmail", { byteFetcher: recorded });

    expect(next).not.toBeInstanceOf(Error);
    expect((await runsOf("gmail")).map((run) => run.status)).toEqual(["failed", "ok"]);
    expect(await countOf("raw.records", "gmail")).toBe(ids.length);
    // It carried on from what was kept rather than starting over.
    expect(recorded.calls.filter((call) => call.url === messageUrl("m0"))).toHaveLength(1);
  });
});

describe("a Drive ingest stopped mid-walk", () => {
  function listUrl(folderId: string): string {
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

  function file(id: string, parent: string, modifiedTime: string): unknown {
    return {
      id,
      name: `statement-${id}.pdf`,
      mimeType: "application/pdf",
      size: String(PDF.byteLength),
      modifiedTime,
      md5Checksum: "abc",
      parents: [parent],
    };
  }

  it("tombstones nothing, because it never saw the files it had not reached", async () => {
    // The sweep negates the ids a run saw. Run over a walk that stopped in the first of two
    // picks, it would report every file in the second as DELETED -- a false fact about the
    // customer's Drive, written by a deploy.
    await connect("drive", {
      files: [
        { id: "folder-1", name: "2026 statements", kind: "folder" },
        { id: "folder-2", name: "2025 statements", kind: "folder" },
      ],
    });
    const first = new InMemoryByteFetcher()
      .on("GET", listUrl("folder-1"), {
        body: { files: [file("f1", "folder-1", "2026-09-17T12:00:00.000Z")] },
      })
      .on("GET", listUrl("folder-2"), {
        body: { files: [file("f2", "folder-2", "2026-09-17T12:00:00.000Z")] },
      })
      .on("GET", `${DRIVE}/f1?alt=media`, { body: PDF })
      .on("GET", `${DRIVE}/f2?alt=media`, { body: PDF });
    await ingest("drive", { byteFetcher: first });
    expect(await countOf("raw.documents", "drive")).toBe(2);

    // f1 has changed, so the second run reads it; the stop arrives while its pick is listed.
    // folder-2's listing is deliberately NOT recorded: a run that walked on would be refused.
    const second = new InMemoryByteFetcher().on("GET", listUrl("folder-1"), {
      body: { files: [file("f1", "folder-1", "2026-09-18T12:00:00.000Z")] },
    });
    const stop = new AbortController();

    const outcome = await ingest("drive", {
      byteFetcher: stoppingAt(second, listUrl("folder-1"), stop),
      stop: stop.signal,
    });

    expect(outcome).toBeInstanceOf(RunStopped);
    expect((await runsOf("drive")).map((run) => run.error)).toEqual([null, RUN_STOPPED]);
    const { rows } = await db.query<{ document_id: string }>(
      "SELECT document_id FROM raw.documents WHERE source = 'drive' AND deleted_at IS NOT NULL",
    );
    expect(rows).toEqual([]);
  });
});

describe("a spec ingest stopped mid-entity", () => {
  it("lands and counts what it read, and neither moves the watermark nor starts the next entity", async () => {
    // The stop arrives while page two is fetched. Page three and every `others` request are
    // unrecorded, so a run that read on would fail on them instead of stopping.
    const recorded = new InMemoryFetcher()
      .on("GET", `${BASE}/things`, {
        body: {
          results: [
            { id: "1", changedAt: "400" },
            { id: "2", changedAt: "900" },
          ],
          paging: { next: { link: `${BASE}/things?page=2` } },
        },
      })
      .on("GET", `${BASE}/things?page=2`, {
        body: {
          results: [{ id: "3", changedAt: "700" }],
          paging: { next: { link: `${BASE}/things?page=3` } },
        },
      });
    const stop = new AbortController();

    const outcome = await ingest("demo", {
      fetcher: stoppingAt(recorded, `${BASE}/things?page=2`, stop),
      stop: stop.signal,
    });

    expect(outcome).toBeInstanceOf(RunStopped);
    const [stopped] = await runsOf("demo");
    expect(stopped?.error).toBe(RUN_STOPPED);
    expect(await countOf("raw.records", "demo")).toBe(3);
    expect(await entityCreated(stopped?.id ?? "")).toEqual({ things: 3 });
    // A partial read, so no mark: the next run asks for everything again rather than for
    // what came after a value whose predecessors it may never have reached.
    expect(
      await readSyncCursor(
        db,
        { source: "demo", tenantId: TENANT, entity: "things" },
        "epoch-millis",
      ),
    ).toBeNull();
    expect(recorded.calls.map((call) => call.url)).toEqual([
      `${BASE}/things`,
      `${BASE}/things?page=2`,
    ]);
  });
});
