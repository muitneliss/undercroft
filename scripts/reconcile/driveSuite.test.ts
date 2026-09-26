/**
 * The Drive suite end to end, offline, over an invented world: two client folders read from
 * Drive through `InMemoryFetcher`, OSTWIN's inventory in SQLite behind `AskPy`, and two lake
 * sources behind `LakeCli` -- one whose last `files` run completed, one whose runs keep failing.
 *
 * Every value here is invented (`.claude/rules/pii.md`).
 */
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { InMemoryFetcher } from "../../packages/connector-runtime/src/testing.ts";
import { AskPy } from "./askPyStandIn.ts";
import type { LiveConfig } from "./config.ts";
import { runDriveSuite } from "./driveSuite.ts";
import { createGoogleClient } from "./google.ts";
import { LakeCli, routeCommands } from "./lakeStandIn.ts";
import { MemorySink } from "./memorySink.ts";
import type { TestResult } from "./model.ts";
import { createOstwinReader } from "./ostwin.ts";
import { createUndercroftReader } from "./undercroft.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const LAKE_RUN = "2026-09-20T00:00:00.000Z";
const SCAN = "2026-09-15T00:00:00+00:00";
const PDF = "application/pdf";
const GDOC = "application/vnd.google-apps.document";
const LIST_FIELDS =
  "nextPageToken,files(id,name,mimeType,md5Checksum,size,modifiedTime,parents,driveId)";

interface FileSpec {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly modifiedTime: string;
  readonly md5?: string;
  readonly size?: string;
}

const BOOKKEEPING: readonly FileSpec[] = [
  // In the lake with equal fields, and inventoried by OSTWIN by path.
  {
    id: "f1aaaaaaaaaaaaaaaaaaaa",
    name: "a.pdf",
    mimeType: PDF,
    modifiedTime: "2026-09-01T00:00:00.000Z",
    md5: "m1",
    size: "10",
  },
  // Older than the lake's completed run, absent from the lake: MISSING. OSTWIN keeps its id.
  {
    id: "f2aaaaaaaaaaaaaaaaaaaa",
    name: "b.pdf",
    mimeType: PDF,
    modifiedTime: "2026-09-02T00:00:00.000Z",
    md5: "m2",
    size: "20",
  },
  // Newer than both warehouses' reads: NOT_YET_SYNCED.
  {
    id: "f3aaaaaaaaaaaaaaaaaaaa",
    name: "c.pdf",
    mimeType: PDF,
    modifiedTime: "2026-09-24T00:00:00.000Z",
    md5: "m3",
    size: "30",
  },
  // Google-native: no md5, no size, compared by id and type only.
  {
    id: "g1aaaaaaaaaaaaaaaaaaaa",
    name: "notes",
    mimeType: GDOC,
    modifiedTime: "2026-09-03T00:00:00.000Z",
  },
];

const SHARED: readonly FileSpec[] = [
  {
    id: "s1aaaaaaaaaaaaaaaaaaaa",
    name: "x.pdf",
    mimeType: PDF,
    modifiedTime: "2026-09-01T00:00:00.000Z",
    md5: "m9",
    size: "90",
  },
  // Absent from a lake whose files runs keep failing: never MISSING, the leg is PENDING.
  {
    id: "s2aaaaaaaaaaaaaaaaaaaa",
    name: "y.pdf",
    mimeType: PDF,
    modifiedTime: "2026-09-01T00:00:00.000Z",
    md5: "m8",
    size: "80",
  },
];

function listUrl(parent: string): string {
  const params = new URLSearchParams({
    q: `'${parent}' in parents and trashed = false`,
    pageSize: "1000",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    fields: LIST_FIELDS,
  });
  return `https://www.googleapis.com/drive/v3/files?${params}`;
}

function driveFile(file: FileSpec, parent: string): Record<string, unknown> {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    parents: [parent],
    ...(file.md5 === undefined ? {} : { md5Checksum: file.md5 }),
    ...(file.size === undefined ? {} : { size: file.size }),
  };
}

function driveFetcher(): InMemoryFetcher {
  return new InMemoryFetcher()
    .on("POST", TOKEN_URL, { body: { access_token: "invented" } })
    .on("GET", listUrl("bk1"), {
      body: { files: BOOKKEEPING.map((file) => driveFile(file, "bk1")) },
    })
    .on("GET", listUrl("sh1"), { body: { files: SHARED.map((file) => driveFile(file, "sh1")) } });
}

function lakeWorld(): LakeCli {
  const lake = new LakeCli();
  lake.connections = [
    {
      kind: "drive",
      source: "drive.b",
      status: "connected",
      externalAccountLabel: "",
      config: { fileTypes: [PDF, GDOC] },
    },
    {
      kind: "drive",
      source: "drive",
      status: "connected",
      externalAccountLabel: "",
      config: { fileTypes: [PDF] },
    },
  ];
  lake.runs = [
    {
      id: "r1",
      kind: "ingest",
      source: "drive.b",
      entities: ["documents", "files"],
      status: "ok",
      startedAt: LAKE_RUN,
      endedAt: LAKE_RUN,
      counts: { landed: 2, unchanged: 0 },
      error: null,
    },
    {
      id: "r2",
      kind: "ingest",
      source: "drive",
      entities: [],
      status: "failed",
      startedAt: LAKE_RUN,
      endedAt: LAKE_RUN,
      counts: null,
      error: 'invalid byte sequence for encoding "UTF8": 0x00',
    },
  ];
  for (const file of [BOOKKEEPING[0], BOOKKEEPING[3]]) {
    if (file !== undefined) {
      lake.records.push({
        source: "drive.b",
        entity: "files",
        sourceRecordId: file.id,
        payload: driveFile(file, "bk1"),
      });
      lake.documents.push({
        source: "drive.b",
        documentId: file.id,
        contentType: file.mimeType,
        bytes: Number.parseInt(file.size ?? "5", 10),
      });
    }
  }
  const [shared] = SHARED;
  if (shared !== undefined) {
    lake.records.push({
      source: "drive",
      entity: "files",
      sourceRecordId: shared.id,
      payload: driveFile(shared, "sh1"),
    });
  }
  return lake;
}

function ostwinWorld(): AskPy {
  const db = new Database(":memory:");
  db.run(
    "CREATE TABLE document_index (client_id TEXT, entry_kind TEXT, inventory_source_list TEXT, source_root TEXT, parent_path TEXT, entry_name TEXT, entry_url TEXT, inventoried_at TEXT)",
  );
  const rows = [
    ["", "a.pdf", "/drive/client-folder/a.pdf"],
    ["", "b.pdf", "https://drive.google.com/file/d/f2aaaaaaaaaaaaaaaaaaaa/view"],
    ["", "notes", "/drive/client-folder/notes.gdoc"],
  ];
  for (const [parent, name, url] of rows) {
    db.run("INSERT INTO document_index VALUES (?,?,?,?,?,?,?,?)", [
      "c-99",
      "file",
      "file_inventory",
      "bookkeeping",
      parent ?? "",
      name ?? "",
      url ?? "",
      SCAN,
    ]);
  }
  return new AskPy(db);
}

const CONFIG: LiveConfig = {
  tenantId: "tenant",
  ostwinRoot: "/legacy",
  outDir: "/tmp/out",
  hubspotEnvFile: "/dev/null",
  mailboxes: {
    primary: { address: "a@example.test", tokenFile: "", undercroftSource: "gmail" },
    secondary: { address: "b@example.test", tokenFile: "", undercroftSource: "gmail.b" },
  },
  driveRoots: [
    { role: "incorp-shared", readAs: "primary", undercroftSource: "drive", ostwinScans: false },
    { role: "incorp-mydrive", readAs: "primary", undercroftSource: null, ostwinScans: true },
    { role: "bookkeeping", readAs: "secondary", undercroftSource: "drive.b", ostwinScans: true },
  ],
  clients: [
    {
      label: "CASE-99",
      caseId: "CASE-99",
      clientId: "c-99",
      hubspotCompanyIds: [],
      driveFolders: [
        { role: "incorp-shared", folderId: "sh1" },
        { role: "bookkeeping", folderId: "bk1" },
      ],
    },
  ],
};

async function run(): Promise<ReadonlyMap<string, TestResult>> {
  const runner = routeCommands(ostwinWorld(), lakeWorld());
  const credentials = { refresh_token: "r", client_id: "c", client_secret: "s" };
  const results = await runDriveSuite({
    config: CONFIG,
    ostwin: createOstwinReader(runner, "/legacy"),
    undercroft: createUndercroftReader(runner, "tenant"),
    google: {
      primary: createGoogleClient(driveFetcher(), credentials),
      secondary: createGoogleClient(driveFetcher(), credentials),
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

describe("IT-DR the Drive suite over an invented world", () => {
  it("IT-DR-001 a file older than the lake's completed run and absent from it fails S->U as MISSING", async () => {
    const s2u = get(await run(), "DR-CASE-99-S2U-bookkeeping");
    expect(s2u.status).toBe("FAIL");
    expect(s2u.counts).toMatchObject({ MATCH: 2, MISSING: 1, NOT_YET_SYNCED: 1 });
  });

  it("IT-DR-002 while the lake's files runs keep failing, an absent file is pending, never missing", async () => {
    const s2u = get(await run(), "DR-CASE-99-S2U-incorp-shared");
    expect(s2u.status).toBe("PENDING");
    expect(s2u.counts).toMatchObject({ MATCH: 1, MISSING: 0, NOT_YET_SYNCED: 1 });
  });

  it("IT-DR-003 OSTWIN's inventory joins by Drive id when it kept one and by path otherwise", async () => {
    const s2o = get(await run(), "DR-CASE-99-S2O-bookkeeping");
    expect(s2o.counts).toMatchObject({ MATCH: 3, MISSING: 0, NOT_YET_SYNCED: 1 });
    expect(s2o.status).toBe("PENDING");
  });

  it("IT-DR-004 a root without the client's folder is out of scope, with one folder it passes", async () => {
    const results = await run();
    expect(get(results, "DR-CASE-99-FOLDER-001-incorp-mydrive").status).toBe("OUT_OF_SCOPE");
    expect(get(results, "DR-CASE-99-FOLDER-001-bookkeeping").status).toBe("PASS");
  });

  it("IT-DR-005 the run ledger's NUL failure is reported as the #218 regression", async () => {
    expect(get(await run(), "DR-U-REG-218").status).toBe("FAIL");
  });

  it("IT-DR-006 a file stored with its byte size, or Google-native, passes the documents leg", async () => {
    const documents = get(await run(), "DR-CASE-99-DOC-bookkeeping");
    expect(documents.counts).toMatchObject({ MATCH: 2, MISSING: 1 });
  });
});
