/**
 * The Drive reconciliation offline: the type rule, every verdict rule both firing and quiet, the
 * two read paths over recorded stand-ins that refuse anything they were not given, and one whole
 * run over an invented tree and lake. No network, no credential; every id and value is made up.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type Evidence,
  hashSample,
  type Judged,
  judgeFile,
  judgeHash,
  judgeLakeOnly,
  outcomeOf,
  withPreconditions,
} from "./driveJudge.ts";
import { type DriveFile, DriveReader } from "./driveApi.ts";
import type { DriveConfig } from "./driveConfig.ts";
import { exportOf, extensionOf, landedTypeOf, overCeiling, takes } from "./driveRules.ts";
import { runDrive } from "./driveRun.ts";
import type { CommandRunner, Http, HttpReply } from "./reads.ts";
import { type LakeDocument, type LakeFile, UndercroftReader } from "./undercroftCli.ts";

const MARK = Date.parse("2030-01-10T00:00:00Z");
const BEFORE = "2030-01-01T00:00:00.000Z";
const AFTER = "2030-01-11T00:00:00.000Z";
const PDF = "application/pdf";
const DOC = "application/vnd.google-apps.document";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function driveFile(id: string, over: Partial<DriveFile> = {}): DriveFile {
  return {
    id,
    mimeType: PDF,
    extension: "pdf",
    size: "1000",
    md5: `md5-${id}`,
    modifiedTime: BEFORE,
    createdTime: BEFORE,
    parents: ["folder-a"],
    trashed: false,
    trashedTime: null,
    ...over,
  };
}

function lakeFile(file: DriveFile, over: Partial<LakeFile> = {}): LakeFile {
  return {
    id: file.id,
    runId: "run-1",
    mimeType: file.mimeType,
    size: file.size ?? "0",
    md5: file.md5 ?? "",
    modifiedTime: file.modifiedTime,
    parents: file.parents,
    ...over,
  };
}

function lakeDocument(file: DriveFile, over: Partial<LakeDocument> = {}): LakeDocument {
  return {
    id: file.id,
    contentType: landedTypeOf(file.mimeType, file.extension),
    bytes: Number.parseInt(file.size ?? "10", 10),
    sha256: `sha-${file.id}`,
    deletedAt: null,
    ...over,
  };
}

function evidenceOf(
  files: readonly LakeFile[],
  documents: readonly LakeDocument[],
  over: Partial<Evidence> = {},
): Evidence {
  return {
    mark: MARK,
    folders: new Set(["folder-a"]),
    files: new Map(files.map((row) => [row.id, row])),
    documents: new Map(documents.map((row) => [row.id, row])),
    ledger: null,
    ...over,
  };
}

function verdictOf(record: Judged): string {
  return record.fields.length === 0
    ? record.verdict
    : `${record.verdict} ${record.fields.join(",")}`;
}

describe("UT-DR-RULE: the published type rule, restated", () => {
  it("UT-DR-RULE-001 takes a chosen type or spelling, and octet-stream only by a chosen extension", () => {
    expect(takes(["image/jpeg"], "image/jpg", null)).toBe(true);
    expect(takes([PDF], "Application/PDF; charset=binary", "pdf")).toBe(true);
    expect(takes([PDF], "image/png", "pdf")).toBe(false);
    expect(takes([".oa"], "application/octet-stream", "oa")).toBe(true);
    expect(takes([".oa"], "application/octet-stream", "bin")).toBe(false);
    expect(takes([".oa"], "text/plain", "oa")).toBe(false);
    expect(takes([], "anything/at-all", null)).toBe(true);
    expect(extensionOf("Acme Pte. Ltd.")).toBeNull();
    expect(extensionOf("report.PDF")).toBe("pdf");
  });

  it("UT-DR-RULE-002 lands exports and .oa by rule, and the ceiling is strictly over 25 MiB", () => {
    expect(exportOf(DOC)).toBe(DOCX);
    expect(landedTypeOf(DOC, null)).toBe(DOCX);
    expect(landedTypeOf("application/octet-stream", "oa")).toBe("application/json");
    expect(landedTypeOf(PDF, "pdf")).toBe(PDF);
    expect(overCeiling(String(25 * 1024 * 1024))).toBe(false);
    expect(overCeiling(String(25 * 1024 * 1024 + 1))).toBe(true);
    expect(overCeiling(null)).toBe(false);
    expect(overCeiling("12.5")).toBe(false);
  });
});

describe("UT-DR-FILE: one Drive file against the lake", () => {
  const file = driveFile("f1");

  it("UT-DR-FILE-001 a record with Drive's fields and a whole document is a MATCH", () => {
    expect(verdictOf(judgeFile(file, evidenceOf([lakeFile(file)], [lakeDocument(file)])))).toBe(
      "MATCH",
    );
  });

  it("UT-DR-FILE-002 an absent file is BLOCKED when older than the run, NOT_YET_SYNCED when newer", () => {
    expect(judgeFile(file, evidenceOf([], [])).verdict).toBe("BLOCKED");
    expect(
      judgeFile(driveFile("f2", { createdTime: AFTER, modifiedTime: AFTER }), evidenceOf([], []))
        .verdict,
    ).toBe("NOT_YET_SYNCED");
    expect(judgeFile(file, evidenceOf([], [], { mark: null })).verdict).toBe("NOT_YET_SYNCED");
  });

  it("UT-DR-FILE-003 a field that differs fails by name, unless Drive changed it after the run", () => {
    const evidence = evidenceOf(
      [lakeFile(file, { md5: "other", size: "999" })],
      [lakeDocument(file)],
    );
    const judged = judgeFile(file, evidence);
    expect(verdictOf(judged)).toBe("CONTENT_MISMATCH size,md5Checksum");
    expect(JSON.stringify(judged)).not.toContain("other");
    const edited = driveFile("f1", { modifiedTime: AFTER });
    expect(judgeFile(edited, evidence).verdict).toBe("NOT_YET_SYNCED");
    const sameInstant = lakeFile(file, { modifiedTime: "2030-01-01T00:00:00Z" });
    expect(judgeFile(file, evidenceOf([sameInstant], [lakeDocument(file)])).verdict).toBe("MATCH");
  });

  it("UT-DR-FILE-004 a move without an edit is excluded by rule (ADR 0033), not a mismatch", () => {
    const moved = evidenceOf([lakeFile(file, { parents: ["folder-old"] })], [lakeDocument(file)]);
    expect(verdictOf(judgeFile(file, moved))).toBe("EXCLUDED_BY_RULE parents");
  });

  it("UT-DR-FILE-005 the document: absent is MISSING, deleted is BLOCKED, short is a mismatch", () => {
    expect(verdictOf(judgeFile(file, evidenceOf([lakeFile(file)], [])))).toBe("MISSING document");
    const deleted = lakeDocument(file, { deletedAt: BEFORE });
    expect(judgeFile(file, evidenceOf([lakeFile(file)], [deleted])).verdict).toBe("BLOCKED");
    const short = lakeDocument(file, { bytes: 999, contentType: "text/plain" });
    expect(verdictOf(judgeFile(file, evidenceOf([lakeFile(file)], [short])))).toBe(
      "CONTENT_MISMATCH contentType,bytes",
    );
    const native = driveFile("g1", { mimeType: DOC, extension: null, size: null, md5: null });
    const exported = lakeDocument(native, { bytes: 5000 });
    expect(judgeFile(native, evidenceOf([lakeFile(native)], [exported])).verdict).toBe("MATCH");
    const empty = lakeDocument(native, { bytes: 0 });
    expect(verdictOf(judgeFile(native, evidenceOf([lakeFile(native)], [empty])))).toBe(
      "CONTENT_MISMATCH bytes",
    );
  });

  it("UT-DR-FILE-006 a file over the ceiling must be refused with the reason, when the ledger can say", () => {
    const big = driveFile("big", { size: String(30 * 1024 * 1024) });
    const refused = new Map([["big", ["declared 31457280 bytes, over the 26214400 ceiling"]]]);
    const ledger = { reasons: refused, complete: true, accounted: new Set(["run-1"]) };
    expect(judgeFile(big, evidenceOf([lakeFile(big)], [], { ledger })).verdict).toBe("MATCH");
    const silent = { ...ledger, reasons: new Map<string, string[]>() };
    expect(verdictOf(judgeFile(big, evidenceOf([lakeFile(big)], [], { ledger: silent })))).toBe(
      "MISSING refusal",
    );
    const lost = { ...silent, accounted: new Set<string>() };
    expect(judgeFile(big, evidenceOf([lakeFile(big)], [], { ledger: lost })).verdict).toBe(
      "BLOCKED",
    );
    const partial = { ...silent, complete: false };
    expect(judgeFile(big, evidenceOf([lakeFile(big)], [], { ledger: partial })).verdict).toBe(
      "BLOCKED",
    );
  });
});

describe("UT-DR-LAKE: a lake record the picked tree does not hold", () => {
  const gone = driveFile("x1");
  const lake = [lakeFile(gone)];

  it("UT-DR-LAKE-001 retained by policy when its document is marked deleted", () => {
    const evidence = evidenceOf(lake, [lakeDocument(gone, { deletedAt: BEFORE })]);
    expect(judgeLakeOnly("x1", null, evidence).verdict).toBe("OUT_OF_SCOPE");
  });

  it("UT-DR-LAKE-002 trashed in the tree before the run with a live document fails; after, it waits", () => {
    const evidence = evidenceOf(lake, [lakeDocument(gone)]);
    const trashed = driveFile("x1", { trashed: true, trashedTime: "2030-01-05T00:00:00Z" });
    expect(verdictOf(judgeLakeOnly("x1", trashed, evidence))).toBe("CONTENT_MISMATCH deletedAt");
    const late = driveFile("x1", { trashed: true, trashedTime: AFTER });
    expect(judgeLakeOnly("x1", late, evidence).verdict).toBe("NOT_YET_SYNCED");
  });

  it("UT-DR-LAKE-003 outside the tree now, or a 404, is BLOCKED: Drive keeps no history of moves", () => {
    const evidence = evidenceOf(lake, [lakeDocument(gone)]);
    expect(judgeLakeOnly("x1", driveFile("x1", { parents: ["elsewhere"] }), evidence).verdict).toBe(
      "BLOCKED",
    );
    expect(judgeLakeOnly("x1", null, evidence).verdict).toBe("BLOCKED");
    const trashedOutside = driveFile("x1", {
      parents: ["elsewhere"],
      trashed: true,
      trashedTime: BEFORE,
    });
    expect(judgeLakeOnly("x1", trashedOutside, evidence).verdict).toBe("BLOCKED");
  });
});

describe("UT-DR-HASH: the sampled downloads", () => {
  const file = driveFile("h1");
  const document = lakeDocument(file);

  it("UT-DR-HASH-001 md5 must be Drive's and sha256 the lake's", () => {
    expect(judgeHash(file, document, { md5: "md5-h1", sha256: "sha-h1" }).verdict).toBe("MATCH");
    expect(verdictOf(judgeHash(file, document, { md5: "md5-h1", sha256: "zzz" }))).toBe(
      "CONTENT_MISMATCH sha256",
    );
    expect(judgeHash(file, document, { md5: "changed", sha256: "zzz" }).verdict).toBe("BLOCKED");
    expect(judgeHash(file, document, null).verdict).toBe("BLOCKED");
  });

  it("UT-DR-HASH-002 samples only matched stored files, every stratum, the same way each time", () => {
    const small = Array.from({ length: 20 }, (_, i) => driveFile(`s${i}`));
    const large = Array.from({ length: 12 }, (_, i) =>
      driveFile(`l${i}`, { size: String(20 * 1024 * 1024) }),
    );
    const native = driveFile("n1", { mimeType: DOC, extension: null, md5: null, size: null });
    const failed = driveFile("bad");
    const all = [...small, ...large, native, failed];
    const evidence = evidenceOf(
      all.map((f) => lakeFile(f)),
      all.map((f) => lakeDocument(f)),
    );
    const verdicts = new Map(
      all.map((f) => [
        f.id,
        {
          id: f.id,
          verdict: f.id === "bad" ? "CONTENT_MISMATCH" : "MATCH",
          reason: "",
          fields: [],
        } as Judged,
      ]),
    );
    const sample = hashSample(all, verdicts, evidence, 10);
    const ids = sample.map((f) => f.id);
    expect(ids).not.toContain("n1");
    expect(ids).not.toContain("bad");
    expect(ids.filter((id) => id.startsWith("l")).length).toBeLessThanOrEqual(8);
    expect(ids.filter((id) => id.startsWith("s")).length).toBeGreaterThanOrEqual(3);
    expect(hashSample(all, verdicts, evidence, 10).map((f) => f.id)).toEqual(ids);
    expect(hashSample(all, verdicts, evidence, 0).length).toBe(6);
  });
});

describe("UT-DR-PRE: preconditions and the outcome", () => {
  const records: Judged[] = [
    { id: "a", verdict: "MATCH", reason: "", fields: [] },
    { id: "b", verdict: "MISSING", reason: "no document", fields: ["document"] },
  ];

  it("UT-DR-PRE-001 a defect found while a read was not whole is BLOCKED; with every read whole it stands", () => {
    expect(withPreconditions(records, []).map((r) => r.verdict)).toEqual(["MATCH", "MISSING"]);
    const blocked = withPreconditions(records, ["lake not read whole"]);
    expect(blocked.map((r) => r.verdict)).toEqual(["MATCH", "BLOCKED"]);
    expect(blocked[1]?.reason).toContain("lake not read whole");
  });

  it("UT-DR-PRE-002 FAIL outranks, undecided is INCONCLUSIVE, nothing run is NOT_RUN", () => {
    expect(outcomeOf(records)).toBe("FAIL");
    expect(outcomeOf(withPreconditions(records, ["x"]))).toBe("INCONCLUSIVE");
    expect(outcomeOf(records.slice(0, 1))).toBe("PASS");
    expect(outcomeOf([])).toBe("NOT_RUN");
  });
});

// --- Stand-ins: recorded answers, and a refusal for anything not recorded.

const TENANT = "CASE-0042";

function cliArgv(command: string, flags: readonly string[] = []): string[] {
  return ["undercroft", ...command.split(" "), "--tenant-id", TENANT, ...flags, "--agent"];
}

interface RecordedCli extends CommandRunner {
  on: (command: string, flags: readonly string[], ...answers: unknown[]) => RecordedCli;
  fail: (command: string, flags: readonly string[], code: string) => RecordedCli;
}

/** The CLI over recorded answers; a repeated command gets the next answer, then the last. */
function recordedCli(): RecordedCli {
  const routes = new Map<string, string[]>();
  function push(command: string, flags: readonly string[], envelopes: string[]): void {
    const key = JSON.stringify(cliArgv(command, flags));
    routes.set(key, [...(routes.get(key) ?? []), ...envelopes]);
  }
  const cli: RecordedCli = {
    on(command, flags, ...answers) {
      push(
        command,
        flags,
        answers.map((data) => JSON.stringify({ ok: true, data })),
      );
      return cli;
    },
    fail(command, flags, code) {
      push(command, flags, [JSON.stringify({ ok: false, error: { code, message: "down" } })]);
      return cli;
    },
    run(argv) {
      const key = JSON.stringify(argv);
      const [head, ...rest] = routes.get(key) ?? [];
      if (head === undefined) {
        return Promise.reject(new Error(`unrecorded command ${key}`));
      }
      if (rest.length > 0) {
        routes.set(key, rest);
      }
      return Promise.resolve({ code: 0, stdout: head, stderr: "" });
    },
  };
  return cli;
}

function reply(status: number, body: string | Uint8Array): HttpReply {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return {
    status,
    text: () => Promise.resolve(new TextDecoder().decode(bytes)),
    async *chunks() {
      yield bytes.slice(0, 3);
      yield bytes.slice(3);
    },
  };
}

interface Entry {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size?: string;
  readonly md5Checksum?: string;
  readonly modifiedTime: string;
  readonly createdTime: string;
  readonly parents: readonly string[];
  readonly trashed?: boolean;
  readonly trashedTime?: string;
}

interface RecordedDrive extends Http {
  readonly files: Map<string, Entry>;
  readonly failing: Set<string>;
  add: (file: Entry, content?: string) => RecordedDrive;
  expireNext: () => void;
}

/** Drive over an invented tree: folders list two entries a page; anything unknown is refused. */
function recordedDrive(): RecordedDrive {
  const children = new Map<string, Entry[]>();
  const files = new Map<string, Entry>();
  const bytes = new Map<string, Uint8Array>();
  const failing = new Set<string>();
  const token = { issued: 0, expire: false };
  function listing(parsed: URL): HttpReply {
    const folder =
      /^'(?<id>.+)' in parents/u.exec(parsed.searchParams.get("q") ?? "")?.groups?.id ?? "";
    if (failing.has(folder)) {
      return reply(500, "{}");
    }
    const all = children.get(folder) ?? [];
    const start = Number.parseInt(parsed.searchParams.get("pageToken") ?? "0", 10);
    const more = start + 2 < all.length ? { nextPageToken: String(start + 2) } : {};
    return reply(200, JSON.stringify({ files: all.slice(start, start + 2), ...more }));
  }
  function one(parsed: URL, id: string): HttpReply {
    const found = files.get(id);
    if (found === undefined) {
      return reply(404, "{}");
    }
    return parsed.searchParams.get("alt") === "media"
      ? reply(200, bytes.get(id) ?? new Uint8Array())
      : reply(200, JSON.stringify(found));
  }
  const drive: RecordedDrive = {
    files,
    failing,
    add(file, content) {
      for (const parent of file.parents) {
        children.set(parent, [...(children.get(parent) ?? []), file]);
      }
      files.set(file.id, file);
      if (content !== undefined) {
        bytes.set(file.id, new TextEncoder().encode(content));
      }
      return drive;
    },
    expireNext() {
      token.expire = true;
    },
    send(url, init) {
      if (init.method === "POST") {
        token.issued += 1;
        return Promise.resolve(
          reply(200, JSON.stringify({ access_token: `token-${token.issued}` })),
        );
      }
      if (token.expire || init.headers.authorization !== `Bearer token-${token.issued}`) {
        token.expire = false;
        return Promise.resolve(reply(401, "{}"));
      }
      const parsed = new URL(url);
      const tail = parsed.pathname.split("/files")[1] ?? "";
      return Promise.resolve(
        tail === "" ? listing(parsed) : one(parsed, decodeURIComponent(tail.slice(1))),
      );
    },
  };
  return drive;
}

const CREDENTIALS = { refresh_token: "r", client_id: "c", client_secret: "s" };

function driveEntry(id: string, parent: string, over: Partial<Entry> = {}): Entry {
  return {
    id,
    name: `${id}.pdf`,
    mimeType: PDF,
    size: "5",
    md5Checksum: new Bun.CryptoHasher("md5").update(`bytes-${id}`).digest("hex"),
    modifiedTime: BEFORE,
    createdTime: BEFORE,
    parents: [parent],
    ...over,
  };
}

describe("CT-DR-CLI: Undercroft through its read commands", () => {
  it("CT-DR-CLI-001 refuses a command that is not a read, before anything is spawned", async () => {
    const reader = new UndercroftReader(recordedCli(), TENANT);
    await expect(reader.call("connections set-scope")).rejects.toThrow(
      'refused: "connections set-scope"',
    );
    await expect(reader.call("lake summary")).rejects.toThrow("unrecorded command");
  });

  it("CT-DR-CLI-002 walks the lake to its end, parses the payload, and says when a cursor loops", async () => {
    const payload = JSON.stringify({
      mimeType: PDF,
      size: "5",
      md5Checksum: "m",
      modifiedTime: BEFORE,
      parents: ["p"],
    });
    function row(id: string) {
      return { sourceRecordId: id, runId: "run-1", payload };
    }
    const flags = ["--source", "drive", "--entity", "files", "--limit", "50"];
    const cli = recordedCli()
      .on("lake records", flags, { items: [row("a"), row("b")], nextCursor: "c1" })
      .on("lake records", [...flags, "--cursor", "c1"], {
        items: [row("b"), row("c")],
        nextCursor: null,
      });
    const walked = await new UndercroftReader(cli, TENANT).files("drive");
    expect(walked.exhausted).toBe(true);
    expect(walked.repeats).toBe(1);
    expect(walked.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(walked.items[0]?.parents).toEqual(["p"]);
    const looping = recordedCli()
      .on("lake documents", ["--source", "drive", "--limit", "50"], { items: [], nextCursor: "c1" })
      .on("lake documents", ["--source", "drive", "--limit", "50", "--cursor", "c1"], {
        items: [],
        nextCursor: "c1",
      });
    expect((await new UndercroftReader(looping, TENANT).documents("drive")).exhausted).toBe(false);
  });

  it("CT-DR-CLI-003 asks again after a dropped connection, and gives up on any other error", async () => {
    const cli = recordedCli()
      .fail("lake summary", [], "NETWORK_ERROR")
      .on("lake summary", [], { records: [], documents: [] });
    expect((await new UndercroftReader(cli, TENANT, undefined, 0).summary()).files.size).toBe(0);
    const denied = recordedCli().fail("lake summary", [], "FORBIDDEN");
    await expect(new UndercroftReader(denied, TENANT, undefined, 0).summary()).rejects.toThrow(
      "FORBIDDEN",
    );
  });
});

describe("CT-DR-GG: Drive, read-only", () => {
  it("CT-DR-GG-001 walks every page of every folder, counts shortcuts, keeps no name", async () => {
    const drive = recordedDrive()
      .add(driveEntry("f1", "root"))
      .add(driveEntry("f2", "root"))
      .add({ ...driveEntry("sub", "root"), mimeType: "application/vnd.google-apps.folder" })
      .add({ ...driveEntry("cut", "root"), mimeType: "application/vnd.google-apps.shortcut" })
      .add(driveEntry("f3", "sub"));
    const reader = new DriveReader(drive, CREDENTIALS, 0);
    const tree = await reader.tree([{ id: "root", kind: "folder" }], true, 2);
    expect(tree.files.map((file) => file.id).sort()).toEqual(["f1", "f2", "f3"]);
    expect([...tree.folders].sort()).toEqual(["root", "sub"]);
    expect(tree.shortcuts).toBe(1);
    expect(tree.incomplete + tree.repeats + tree.unreadable.length).toBe(0);
    expect(JSON.stringify(tree.files)).not.toContain("f1.pdf");
    const flat = await reader.tree([{ id: "root", kind: "folder" }], false, 2);
    expect(flat.files.map((file) => file.id).sort()).toEqual(["f1", "f2"]);
  });

  it("CT-DR-GG-002 a folder Drive will not list makes the tree unreadable, not smaller", async () => {
    const drive = recordedDrive().add(driveEntry("f1", "root"));
    drive.failing.add("root");
    const tree = await new DriveReader(drive, CREDENTIALS, 0).tree(
      [{ id: "root", kind: "folder" }],
      true,
      1,
    );
    expect(tree.unreadable).toEqual(["root"]);
  });

  it("CT-DR-GG-003 refreshes an expired token once, answers null for a 404, and hashes without keeping", async () => {
    const drive = recordedDrive().add(driveEntry("f1", "root"), "bytes-f1");
    const reader = new DriveReader(drive, CREDENTIALS, 0);
    expect((await reader.file("f1"))?.extension).toBe("pdf");
    drive.expireNext();
    expect((await reader.file("f1"))?.id).toBe("f1");
    expect(await reader.file("nope")).toBeNull();
    const digest = await reader.digest("f1");
    expect(digest?.md5).toBe(drive.files.get("f1")?.md5Checksum);
    expect(digest?.sha256).toBe(new Bun.CryptoHasher("sha256").update("bytes-f1").digest("hex"));
  });
});

describe("IT-DR-RUN: one whole run over an invented tree and lake", () => {
  const run = {
    id: "run-1",
    source: "drive",
    kind: "ingest",
    status: "ok",
    entities: ["files"],
    startedAt: "2030-01-10T00:00:00.000Z",
    counts: { landed: 3 },
  };
  const connection = {
    source: "drive",
    config: { files: [{ id: "root", kind: "folder" }], recurse: true, fileTypes: [PDF] },
  };

  function world(documents: readonly string[], runsAfter: readonly unknown[] = [run]) {
    const drive = recordedDrive();
    for (const id of ["f1", "f2"]) {
      drive.add(driveEntry(id, "root"), `bytes-${id}`);
    }
    drive.add({ ...driveEntry("png", "root"), mimeType: "image/png", name: "png.png" });
    drive.add({ ...driveEntry("new", "root"), createdTime: AFTER, modifiedTime: AFTER });
    function record(id: string) {
      const md5Checksum = drive.files.get(id)?.md5Checksum ?? "";
      const payload = {
        mimeType: PDF,
        size: "5",
        md5Checksum,
        modifiedTime: BEFORE,
        parents: ["root"],
      };
      return { sourceRecordId: id, runId: "run-1", payload };
    }
    function document(id: string) {
      return {
        documentId: id,
        contentType: PDF,
        bytes: 5,
        sha256: new Bun.CryptoHasher("sha256").update(`bytes-${id}`).digest("hex"),
        deletedAt: id === "old" ? BEFORE : null,
      };
    }
    const cli = recordedCli()
      .on("connections list", [], [connection], [connection])
      .on(
        "runs list",
        ["--limit", "50"],
        { items: [run], nextCursor: null },
        { items: runsAfter, nextCursor: null },
      )
      .on("lake summary", [], {
        records: [{ source: "drive", entity: "files", records: 3 }],
        documents: [{ source: "drive", documents: documents.length }],
      })
      .on("lake records", ["--source", "drive", "--entity", "files", "--limit", "50"], {
        items: ["f1", "f2", "old"].map(record),
        nextCursor: null,
      })
      .on("lake documents", ["--source", "drive", "--limit", "50"], {
        items: documents.map(document),
        nextCursor: null,
      });
    const config: DriveConfig = {
      tenantId: TENANT,
      outDir: mkdtempSync(join(tmpdir(), "drive-reconcile-")),
      connections: [{ source: "drive", tokenFile: "unused" }],
      hashSample: 5,
      concurrency: 2,
    };
    const readers = {
      undercroft: new UndercroftReader(cli, TENANT),
      drive: () => new DriveReader(drive, CREDENTIALS, 0),
    };
    return { config, readers };
  }

  function verdicts(result: Awaited<ReturnType<typeof runDrive>>): Record<string, string[]> {
    return Object.fromEntries(
      result.groups.map((group) => [
        group.id,
        group.records.map((r) => `${r.id}:${r.verdict}`).sort(),
      ]),
    );
  }

  it("IT-DR-RUN-001 every file is its own verdict, and a lake that holds the tree is not a failure", async () => {
    const { config, readers } = world(["f1", "f2", "old"]);
    const result = await runDrive(config, readers);
    expect(verdicts(result)).toEqual({
      "DR-PRE-drive": ["lake:MATCH", "run:MATCH", "still:MATCH", "tree:MATCH"],
      "DR-FILE-drive": ["f1:MATCH", "f2:MATCH", "new:NOT_YET_SYNCED"],
      "DR-LAKE-ONLY-drive": ["old:OUT_OF_SCOPE"],
      "DR-HASH-drive": ["f1:MATCH", "f2:MATCH"],
    });
    expect(result.outcome).toBe("INCONCLUSIVE");
    const summary = JSON.parse(readFileSync(join(result.dir, "summary.json"), "utf8"));
    expect(summary.outcome).toBe("INCONCLUSIVE");
  });

  it("IT-DR-RUN-002 a record without its document fails -- unless a files run started under the reads", async () => {
    const failing = world(["f1", "old"]);
    const result = await runDrive(failing.config, failing.readers);
    expect(verdicts(result)["DR-FILE-drive"]).toContain("f2:MISSING");
    expect(result.outcome).toBe("FAIL");
    const started = { ...run, id: "run-2", status: "running", startedAt: AFTER };
    const moving = world(["f1", "old"], [started, run]);
    const moved = await runDrive(moving.config, moving.readers);
    expect(verdicts(moved)["DR-FILE-drive"]).toContain("f2:BLOCKED");
    expect(verdicts(moved)["DR-PRE-drive"]).toContain("still:BLOCKED");
    expect(moved.outcome).toBe("INCONCLUSIVE");
  });
});
