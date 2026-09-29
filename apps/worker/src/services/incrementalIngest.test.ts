/**
 * The cursor a spec run reads from and writes back: `raw.sync_cursor`, end to end.
 *
 * Driven through `runIngest`, the same door the scheduler uses, over a real
 * `InMemoryFetcher` -- which refuses an unmodelled request, so "the second run asked for
 * less" is proved by a route recorded only WITH the watermark. PGlite runs every statement
 * as `undercroft_worker`, so the new table's grant is checked here rather than at 02:00.
 *
 * The pair that carries the weight is advance-on-completion against no-advance-on-failure. A
 * watermark that moved past a read which died halfway would ask the next run for records
 * after a mark that records below it never reached -- and on a source that does not order its
 * pages by the incremental field, which is most of them, those are gone from the one layer
 * that cannot be recomputed. Nothing sets a flag to prevent that; the cursor write simply
 * sits after the loop, so a throw skips it.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestKey } from "@undercroft/connector-runtime";
import { InMemoryFetcher } from "@undercroft/connector-runtime/testing";
import { parseSpec } from "@undercroft/contracts";
import { createStampSource, TestClock } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { readSyncCursor, writeSyncCursor } from "../repos/syncCursor.ts";
import { runIngest } from "./ingest.ts";

const BASE = "https://demo.test";
const STREAM = { source: "demo", tenantId: "CASE-1", entity: "things" } as const;

// `auth: none`, so the run needs no connection and no sealed credential: what is under test
// is the cursor, and a token would be a second harness to keep working.
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
`;

/** The request key a spec's only entity is read under, as the runtime names it. */
function keyOf(specText: string): string {
  const spec = parseSpec(specText);
  const [entity] = spec.entities;
  if (entity === undefined) {
    throw new Error("the spec declares no entity");
  }
  return requestKey(spec, entity);
}

/** How the demo entity keeps its mark while its spec's request is unchanged. */
const AS_DECLARED = { format: "epoch-millis", requestKey: keyOf(SPEC) } as const;

let lake: LakeStore;
let db: TestDatabase;
let specsDir: string;

beforeEach(async () => {
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
  await db.exec("CREATE TABLE raw.records_demo PARTITION OF raw.records FOR VALUES IN ('demo')");
  specsDir = mkdtempSync(join(tmpdir(), "undercroft-specs-"));
  writeFileSync(join(specsDir, "demo.yaml"), SPEC);
  // Seeded as the superuser; from here on every statement runs as the worker does.
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

function ingest(fetcher: InMemoryFetcher): ReturnType<typeof runIngest> {
  return runIngest({ lake, exec: db, specsDir, fetcher }, { source: "demo", tenantId: "CASE-1" });
}

describe("a watermark advances only by getting to the end", () => {
  it("advances to the highest value the entity carried when the read completes", async () => {
    // Highest, not last: the page is deliberately out of order, because a source is not
    // obliged to sort by the field it is filtered on and a watermark taken from the final
    // record of an unordered read skips everything below it forever.
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: {
        results: [
          { id: "1", changedAt: "400" },
          { id: "2", changedAt: "900" },
          { id: "3", changedAt: "700" },
        ],
        paging: {},
      },
    });

    await ingest(fetcher);

    expect(await readSyncCursor(db, STREAM, AS_DECLARED)).toBe("900");
  });

  it("does not advance when the entity throws partway", async () => {
    // Page two is not recorded, so the fetcher refuses it -- the same shape as an upstream
    // fault or a token that expired mid-read.
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: {
        results: [{ id: "1", changedAt: "900" }],
        paging: { next: { link: `${BASE}/things?page=2` } },
      },
    });

    await expect(ingest(fetcher)).rejects.toThrow();

    expect(await readSyncCursor(db, STREAM, AS_DECLARED)).toBeNull();
  });

  it("stays where it was when an incremental read finds nothing new", async () => {
    await writeSyncCursor(db, STREAM, { ...AS_DECLARED, watermark: "900" }, null);
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things?updatedAfter=900`, {
      body: { results: [], paging: {} },
    });

    // And the run is green: `failOnEmpty` is relaxed because a watermark was sent.
    const result = await ingest(fetcher);

    expect(result.entities[0]?.landed).toBe(0);
    expect(await readSyncCursor(db, STREAM, AS_DECLARED)).toBe("900");
  });
});

describe("the second run asks the source for less", () => {
  it("sends the stored watermark and lands only what came back", async () => {
    const first = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "1", changedAt: "400" }], paging: {} },
    });
    await ingest(first);

    // Recorded ONLY at the URL carrying the watermark: a second run that forgot it would
    // fail against the fetcher rather than quietly re-reading the whole source.
    const second = new InMemoryFetcher().on("GET", `${BASE}/things?updatedAfter=400`, {
      body: { results: [{ id: "2", changedAt: "800" }], paging: {} },
    });
    const result = await ingest(second);

    expect(second.calls.map((call) => call.url)).toEqual([`${BASE}/things?updatedAfter=400`]);
    expect(result.entities[0]?.landed).toBe(1);
    expect(await readSyncCursor(db, STREAM, AS_DECLARED)).toBe("800");

    const { rows } = await db.query<{ id: string }>(
      "SELECT source_record_id AS id FROM raw.records WHERE source = 'demo' ORDER BY source_record_id",
    );
    expect(rows.map((r) => r.id)).toEqual(["1", "2"]);
  });
});

describe("a source that writes Microsoft JSON dates, as Xero does", () => {
  // Shaped as `specs/connectors/xero.yaml` declares its entities, minus the OAuth a real Xero
  // read needs. Issue #265: the first run died on its first page, and the watermark never moved.
  const XERO_SHAPED = `
apiVersion: undercroft.dev/v1
kind: Connector
id: ledger
displayName: Ledger
baseUrl: ${BASE}
auth: { kind: none }
defaults:
  pagination: { kind: json-link, nextPath: paging.next.link }
entities:
  - name: contacts
    request: { kind: list, path: /Contacts }
    envelopePath: Contacts
    idPath: ContactID
    updatedAtPath: UpdatedDateUTC
    incremental:
      strategy: header
      header: If-Modified-Since
      sourcePath: UpdatedDateUTC
      format: ms-json-date
      send: rfc3339-seconds
`;
  const LEDGER = { source: "ledger", tenantId: "CASE-1", entity: "contacts" } as const;
  const LEDGER_MARK = { format: "ms-json-date", requestKey: keyOf(XERO_SHAPED) } as const;

  beforeEach(async () => {
    writeFileSync(join(specsDir, "ledger.yaml"), XERO_SHAPED);
    await db.asSuperuser((tx) =>
      tx.query("CREATE TABLE raw.records_ledger PARTITION OF raw.records FOR VALUES IN ('ledger')"),
    );
  });

  function ingestLedger(fetcher: InMemoryFetcher): ReturnType<typeof runIngest> {
    return runIngest(
      { lake, exec: db, specsDir, fetcher },
      { source: "ledger", tenantId: "CASE-1" },
    );
  }

  it("lands the first read, stamps each row, and keeps the latest value as written", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/Contacts`, {
      body: {
        Contacts: [
          { ContactID: "a", UpdatedDateUTC: "/Date(1573755038314+0000)/" },
          { ContactID: "b", UpdatedDateUTC: "/Date(999+0000)/" },
        ],
        paging: {},
      },
    });

    const result = await ingestLedger(fetcher);

    expect(result.entities[0]?.landed).toBe(2);
    const { rows } = await db.query<{ id: string; at: string }>(
      "SELECT source_record_id AS id, source_updated_at::text AS at FROM raw.records WHERE source = 'ledger' ORDER BY id",
    );
    expect(rows).toEqual([
      { id: "a", at: "2019-11-14 18:10:38.314+00" },
      { id: "b", at: "1970-01-01 00:00:00.999+00" },
    ]);
    expect(await readSyncCursor(db, LEDGER, LEDGER_MARK)).toBe("/Date(1573755038314+0000)/");
  });

  it("asks the second read for what changed since, in the dialect the header reads", async () => {
    await writeSyncCursor(
      db,
      LEDGER,
      { ...LEDGER_MARK, watermark: "/Date(1573755038314+0000)/" },
      null,
    );
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/Contacts`, {
      body: { Contacts: [], paging: {} },
    });

    await ingestLedger(fetcher);

    expect(fetcher.calls.map((call) => call.headers?.["If-Modified-Since"])).toEqual([
      "2019-11-14T18:10:38Z",
    ]);
  });
});

describe("a watermark is only ever handed back under the format it was written in", () => {
  it("answers nothing when the spec has changed format under it", async () => {
    // One honest full read, rather than comparing two incompatible renderings of an instant
    // and being silently wrong about which is later. The quiet side -- the same format answers
    // the stored value -- is "stays where it was when an incremental read finds nothing new",
    // which writes this cursor and reads it back through a whole run.
    await writeSyncCursor(db, STREAM, { ...AS_DECLARED, watermark: "900" }, null);

    expect(await readSyncCursor(db, STREAM, { ...AS_DECLARED, format: "iso8601" })).toBeNull();
  });
});

describe("a watermark is only ever handed back for the request it was read with", () => {
  it("reads from the start once the spec changes what the entity asks for", async () => {
    // Issue #280 in general form: Xero's lists gained `unitdp=4`, and a mark kept across that
    // edit would ask only for what changed since, leaving every record not edited since as the
    // old request answered it. The quiet side -- an unchanged request sends its mark -- is "the
    // second run asks the source for less" above.
    await ingest(
      new InMemoryFetcher().on("GET", `${BASE}/things`, {
        body: { results: [{ id: "1", changedAt: "400" }], paging: {} },
      }),
    );
    const edited = SPEC.replace("path: /things }", 'path: /things, query: { detail: "full" } }');
    writeFileSync(join(specsDir, "demo.yaml"), edited);

    // Recorded only WITHOUT a watermark: a run that sent `updatedAfter=400` would be refused.
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things?detail=full`, {
      body: { results: [{ id: "1", changedAt: "400" }], paging: {} },
    });
    await ingest(fetcher);

    expect(fetcher.calls.map((call) => call.url)).toEqual([`${BASE}/things?detail=full`]);
    expect(await readSyncCursor(db, STREAM, { ...AS_DECLARED, requestKey: keyOf(edited) })).toBe(
      "400",
    );
  });
});

describe("a list whose change filter cannot see every change is read whole on a bound", () => {
  // Issue #314: Xero documents edits that do not move `UpdatedDateUTC` -- a due date moved on a
  // partially paid invoice, a contact's balances -- so `If-Modified-Since` never returns them.
  // `wholeReadAfterHours` reads the list whole again, sending no watermark, once the run that
  // last did so is that old. ADR 0080.
  const BOUNDED = SPEC.replace(
    "format: epoch-millis\n",
    "format: epoch-millis\n      wholeReadAfterHours: 24\n",
  );

  beforeEach(() => {
    writeFileSync(join(specsDir, "demo.yaml"), BOUNDED);
  });

  /** A whole read of `/things`, the only request the fetcher answers. */
  function whole(results: readonly object[]): InMemoryFetcher {
    return new InMemoryFetcher().on("GET", `${BASE}/things`, { body: { results, paging: {} } });
  }

  it("reads whole once its last whole read is a day old, landing an edit the filter never reported", async () => {
    await ingest(whole([{ id: "1", changedAt: "400", due: "2026-10-01" }]));
    // A day passing, as the one fact that measures it: the run that read the list whole began a
    // day ago. The worker holds no clock of its own to move instead.
    await db.query("UPDATE raw.sync_cursor SET whole_read_at = whole_read_at - interval '1 day'");

    // The due date moved and `changedAt` did not, which is exactly what the filter cannot see.
    const fetcher = whole([{ id: "1", changedAt: "400", due: "2026-10-30" }]);
    const result = await ingest(fetcher);

    expect(fetcher.calls.map((call) => call.url)).toEqual([`${BASE}/things`]);
    expect(result.entities[0]).toMatchObject({ changed: 1 });
  });

  it("asks only for what changed while its last whole read is recent", async () => {
    await ingest(whole([{ id: "1", changedAt: "400" }]));

    // Recorded only WITH the watermark: a run that read whole again would be refused.
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things?updatedAfter=400`, {
      body: { results: [], paging: {} },
    });
    await ingest(fetcher);

    expect(fetcher.calls.map((call) => call.url)).toEqual([`${BASE}/things?updatedAfter=400`]);
  });

  it("reads whole once when its cursor was written before whole reads were recorded", async () => {
    // Every cursor production holds when this ships: a watermark, and no whole read on record.
    await writeSyncCursor(db, STREAM, { ...AS_DECLARED, watermark: "400" }, null);

    const fetcher = whole([{ id: "1", changedAt: "400" }]);
    await ingest(fetcher);

    expect(fetcher.calls.map((call) => call.url)).toEqual([`${BASE}/things`]);
  });
});
