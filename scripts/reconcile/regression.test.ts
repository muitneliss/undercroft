/**
 * One case per historical finding, each pinned from both sides: the defect makes the case fail,
 * and its absence lets it pass. The finding each test reproduces is named in its title, so the
 * traceability matrix (scripts/reconcile/docs/cases.md) can point at a test, not a memory.
 *
 * Findings reproduced elsewhere, and where:
 * - ask.py's 60-character clip read as content -> adapters.test.ts CT-OST-001/002
 * - Gmail header case (`Message-Id`) read as absent -> adapters.test.ts CT-GG-002b
 * - a dot in a name read as an extension (`Mr. Daniel`) -> core.test.ts UT-KEY-008
 */
import { describe, expect, it } from "bun:test";

import { distinctFiles } from "./driveCommon.ts";
import { lastRead } from "./driveLake.ts";
import { runLedgerCases } from "./driveLedger.ts";
import { keyOstwin } from "./driveS2O.ts";
import type { MailboxState } from "./gmailCommon.ts";
import { crossMailboxCase } from "./gmailMailbox.ts";
import { ostwinPagingCase } from "./gmailOstwin.ts";
import type { HubSpotRecord } from "./hubspot.ts";
import { duplicateDealsCase } from "./hubspotClient.ts";
import { createdBy, objectTypesCase } from "./hubspotObjects.ts";
import type { Universe } from "./hubspotUniverse.ts";
import { MemorySink } from "./memorySink.ts";
import type { Run } from "./undercroft.ts";

function mailbox(
  name: "primary" | "secondary",
  records: { id: string; messageId: string }[],
): MailboxState {
  const items = records.map((record) => ({
    source: name === "primary" ? "gmail" : "gmail.b",
    entity: "messages",
    sourceRecordId: record.id,
    payload: { id: record.id, headers: { "Message-ID": record.messageId } },
    contentSha256: "",
    observedAt: "",
    runId: "r",
    deletedAt: null,
  }));
  return {
    name,
    source: items[0]?.source ?? name,
    identityOk: true,
    identityReason: "",
    labels: ["INBOX"],
    watermark: null,
    lake: {
      items,
      pages: 1,
      exhausted: true,
      truncatedByCap: false,
      loopDetected: false,
      repeats: new Map(),
      shortBy: 0,
    },
    lakeError: null,
    byKey: new Map(),
  };
}

const sink = { sink: new MemorySink() };
const NONE_UNPUBLISHED = { sourceRun: "", state: "", ids: new Set<string>(), truncated: false };

describe("RG regressions of historical findings", () => {
  it("RG-143 an id in both mailboxes naming different letters fails (undercroft issue #143)", () => {
    const deps = sink;
    const clash = crossMailboxCase(deps, [
      mailbox("primary", [{ id: "aa01", messageId: "<one@example.test>" }]),
      mailbox("secondary", [{ id: "aa01", messageId: "<two@example.test>" }]),
    ]);
    expect(clash.status).toBe("FAIL");
    const same = crossMailboxCase(deps, [
      mailbox("primary", [{ id: "aa01", messageId: "<one@example.test>" }]),
      mailbox("secondary", [{ id: "aa01", messageId: "<one@example.test>" }]),
    ]);
    expect(same.status).toBe("PASS");
  });

  it("RG-OST-PAGES OSTWIN stopping exactly at its 20-page cap fails; below the cap passes", () => {
    const deps = sink;
    const client = {
      label: "CASE-99",
      caseId: "CASE-99",
      clientId: "c",
      hubspotCompanyIds: [],
      driveFolders: [],
    };
    function harvest(pages: string): Record<string, string> {
      return { mailbox: "primary", pages_used: pages, max_pages: "20", pagination_exhausted: "1" };
    }
    const capped = ostwinPagingCase(deps, client, {
      candidate: [],
      harvests: [harvest("20")],
      messages: [],
      unpublished: NONE_UNPUBLISHED,
    });
    expect(capped.status).toBe("FAIL");
    const fine = ostwinPagingCase(deps, client, {
      candidate: [],
      harvests: [harvest("3")],
      messages: [],
      unpublished: NONE_UNPUBLISHED,
    });
    expect(fine.status).toBe("PASS");
  });

  it("RG-OST-ROUTE a route OSTWIN did not read to its end fails", () => {
    const deps = sink;
    const client = {
      label: "CASE-99",
      caseId: "CASE-99",
      clientId: "c",
      hubspotCompanyIds: [],
      driveFolders: [],
    };
    const harvests = [
      { mailbox: "primary", pages_used: "1", max_pages: "20", pagination_exhausted: "1" },
    ];
    const candidate = [
      { mailbox: "primary", routes: [{ route: "scope", pagination_exhausted: false }] },
    ];
    expect(
      ostwinPagingCase(deps, client, {
        candidate,
        harvests,
        messages: [],
        unpublished: NONE_UNPUBLISHED,
      }).status,
    ).toBe("FAIL");
  });

  function run(error: string | null, status = "failed"): Run {
    return {
      id: "r",
      kind: "ingest",
      source: "drive",
      entities: [],
      status,
      startedAt: "2026-09-25T00:00:00Z",
      endedAt: null,
      counts: null,
      error,
    };
  }

  it("RG-218 a run failing on a NUL byte fails the ledger case (undercroft issue #218)", () => {
    const [nul] = runLedgerCases(sink, [run('invalid byte sequence for encoding "UTF8": 0x00')]);
    expect(nul?.status).toBe("FAIL");
    const [clean] = runLedgerCases(sink, [run(null, "ok")]);
    expect(clean?.status).toBe("PASS");
  });

  it("RG-219 a run lost to a stopped worker fails the ledger case (undercroft issue #219)", () => {
    const [, stopped] = runLedgerCases(sink, [
      run("the worker stopped abruptly while this run was in progress"),
    ]);
    expect(stopped?.status).toBe("FAIL");
    const [, other] = runLedgerCases(sink, [run("HubSpot answered 401")]);
    expect(other?.status).toBe("PASS");
  });

  function universe(entities: string[]): Universe {
    return {
      source: new Map(),
      ostwin: new Map(),
      ostwinAssociations: [],
      ostwinWatermark: new Map(),
      lake: new Map(),
      lakeComplete: new Map(),
      lakeWatermark: new Map(),
      lakeEntities: entities,
      lakeProperties: new Map(),
    };
  }

  it("RG-HS-OBJ the lake collecting 3 of the 7 object types fails as a requirement gap", () => {
    const deps = sink;
    const three = objectTypesCase(
      deps,
      universe(["companies", "contacts", "deals", "associations"]),
    );
    expect(three.status).toBe("FAIL");
    expect(three.reason).toContain("requirement gap");
    const all = objectTypesCase(
      deps,
      universe(["companies", "contacts", "deals", "quotes", "line_items", "products", "owners"]),
    );
    expect(all.status).toBe("PASS");
  });

  it("RG-HS-DUP two live deals with one name, amount and close date fail as a source defect", () => {
    function deal(id: string, amount: string): HubSpotRecord {
      return {
        id,
        archived: false,
        updatedAt: "",
        properties: { dealname: "Annual fee", amount, closedate: "2026-01-31T00:00:00Z" },
      };
    }
    const twice = duplicateDealsCase(sink, { label: "CASE-99" }, [
      deal("1", "1500"),
      deal("2", "1500.00"),
    ]);
    expect(twice.status).toBe("FAIL");
    const distinct = duplicateDealsCase(sink, { label: "CASE-99" }, [
      deal("1", "1500"),
      deal("2", "900"),
    ]);
    expect(distinct.status).toBe("PASS");
  });

  it("RG-HS-LAG a lake record created after OSTWIN's snapshot is OSTWIN's lag, not a lake extra", () => {
    const snapshot = Date.parse("2026-09-25T02:46:49Z");
    const before = { archived: false, properties: { createdate: "2026-09-24T10:00:00Z" } };
    const after = { archived: false, properties: { createdate: "2026-09-25T10:09:55Z" } };
    expect(createdBy(before, snapshot)).toBe(true);
    expect(createdBy(after, snapshot)).toBe(false);
    expect(createdBy(before, null)).toBe(false);
  });

  it("RG-DR-EMPTYRUN a completed run that read nothing does not vouch that an absent file is missing", () => {
    const empty = { ...run(null, "ok"), entities: ["files"], counts: { landed: 0, unchanged: 0 } };
    expect(lastRead([empty], "drive", "files")).toBeNull();
    const read = { ...empty, counts: { landed: 12, unchanged: 0 } };
    expect(lastRead([read], "drive", "files")).toBe(Date.parse(read.startedAt));
  });

  it("RG-DR-INVENTORIES one file in two OSTWIN inventories is one row, not a duplicate", () => {
    const row = {
      sourceRoot: "incorp_active",
      path: "bizfile/a.pdf",
      driveId: "d1",
      inventoriedAt: null,
    };
    expect(
      distinctFiles([row, { ...row, path: "Bizfile/a.pdf" }, { ...row, driveId: "d2" }]),
    ).toHaveLength(2);
  });

  it("RG-DR-VIEWS one file named by id in one inventory and by path in another resolves once", () => {
    const file = {
      id: "d1",
      name: "a.pdf",
      mimeType: "application/pdf",
      md5Checksum: null,
      size: null,
      modifiedTime: "",
      parents: [],
      driveId: null,
      path: "Corp Sec/a.pdf",
      depth: 2,
    };
    const byId = {
      sourceRoot: "incorp_active",
      path: "corpsec/a.pdf",
      driveId: "d1",
      inventoriedAt: null,
    };
    const byPath = {
      sourceRoot: "incorp_active",
      path: "Corp Sec/a.pdf",
      driveId: null,
      inventoriedAt: null,
    };
    expect(keyOstwin([file], [byId, byPath]).map((entry) => entry.key)).toEqual(["d1"]);
  });
});
