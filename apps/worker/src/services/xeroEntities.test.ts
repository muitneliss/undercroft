/**
 * The shipped Xero spec reads every record list its granular read scopes reach. Issue 271.
 *
 * Driven through `runIngest` over the SHIPPED `specs/connectors/xero.yaml`, less its pacing, and a
 * recorded fetcher that refuses any request nobody recorded, so "this is how each list is read" is
 * proved by the only URLs that were answered. The lists do not all read alike, and Xero's own
 * OpenAPI document is where each difference comes from:
 * - `Items`, `BatchPayments`, `RepeatingInvoices` and `ContactGroups` take no `page` at all. Paged
 *   as the default pages, each would answer page two with page one again, never an empty page.
 * - `Quotes` and `LinkedTransactions` page, but take no `pageSize`.
 * - `BankTransfers` takes no `page` either, and is asked for its deleted transfers too (#308).
 * - A list an organisation genuinely has none of is answered `[]`, and that is not a failure.
 * - `Invoices`, `CreditNotes`, `Overpayments`, `Prepayments`, `Items` and `BankTransactions` take
 *   `unitdp`, and are asked for 4-decimal unit prices; without it Xero rounds each line's price to
 *   2 (#280). The fetcher answers only the URL carrying it, so a list that stopped asking would
 *   fail here.
 *
 * Also here: a grant recorded before a scope the consent now asks for -- every Xero connection
 * made before `accounting.settings.read`, and every one made before the bank and journal scopes
 * (#308) -- reads every list it can and never requests the rest, which the run names with the
 * scope a reconnect would add (ADR 0073). The 401 it used to meet on items part-way through a run
 * was issue 276.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryFetcher } from "@undercroft/connector-runtime/testing";
import { createStampSource, TestClock } from "@undercroft/core";
import { seal } from "@undercroft/crypto";
import { writeConnectionDetail } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { writeSyncCursor } from "../repos/syncCursor.ts";
import { GrantTooNarrow } from "./grant.ts";
import { runIngest } from "./ingest.ts";

const TENANT = "CASE-1";
const KEY = Buffer.alloc(32, 7).toString("base64");
const ENV = { UNDERCROFT_SECRET_KEY: KEY };
const SHIPPED = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "..", "specs", "connectors", "xero.yaml"),
  "utf8",
);
/**
 * The shipped spec with its pacing taken out, and nothing else changed. 1100ms between requests
 * is what Xero asks of production; on the real clock it would make this suite wait twenty seconds
 * a test, and nothing it asserts depends on the spacing.
 */
const UNPACED = SHIPPED.replace("minIntervalMs: 1100", "minIntervalMs: 0");
if (UNPACED === SHIPPED) {
  throw new Error("xero.yaml no longer paces at 1100ms; update what this suite takes out");
}
const SPECS_DIR = mkdtempSync(join(tmpdir(), "undercroft-xero-"));
writeFileSync(join(SPECS_DIR, "xero.yaml"), UNPACED);
const BASE = "https://api.xero.com/api.xro/2.0";
/** What every connection recorded before the consent asked for `accounting.settings.read` (#277). */
const OLD_GRANT =
  "offline_access accounting.invoices.read accounting.payments.read accounting.contacts.read";
const SETTINGS = "accounting.settings.read";
const BANK = "accounting.banktransactions.read";
const JOURNALS = "accounting.manualjournals.read";
const FULL_GRANT = `${OLD_GRANT} ${SETTINGS} ${BANK} ${JOURNALS}`;
const UPDATED = "/Date(1573755038314+0000)/";

/** How each list is read, as Xero's OpenAPI document says it may be. */
interface XeroList {
  readonly entity: string;
  readonly path: string;
  readonly idPath: string;
  readonly paging: "page-size" | "page" | "none";
  /** Read under a scope the consent gained after `OLD_GRANT`, which that grant lacks. */
  readonly added?: string;
  /** Asked of the list besides paging. */
  readonly query?: Readonly<Record<string, string>>;
  /** Whether Xero's endpoint takes `unitdp`, so the list is asked for 4-decimal unit prices. */
  readonly unitdp?: true;
}

const LISTS: readonly XeroList[] = [
  { entity: "contacts", path: "/Contacts", idPath: "ContactID", paging: "page-size" },
  {
    entity: "invoices",
    path: "/Invoices",
    idPath: "InvoiceID",
    paging: "page-size",
    unitdp: true,
  },
  { entity: "payments", path: "/Payments", idPath: "PaymentID", paging: "page-size" },
  {
    entity: "credit_notes",
    path: "/CreditNotes",
    idPath: "CreditNoteID",
    paging: "page-size",
    unitdp: true,
  },
  { entity: "quotes", path: "/Quotes", idPath: "QuoteID", paging: "page" },
  {
    entity: "purchase_orders",
    path: "/PurchaseOrders",
    idPath: "PurchaseOrderID",
    paging: "page-size",
  },
  {
    entity: "repeating_invoices",
    path: "/RepeatingInvoices",
    idPath: "RepeatingInvoiceID",
    paging: "none",
  },
  {
    entity: "linked_transactions",
    path: "/LinkedTransactions",
    idPath: "LinkedTransactionID",
    paging: "page",
  },
  {
    entity: "items",
    path: "/Items",
    idPath: "ItemID",
    paging: "none",
    unitdp: true,
    added: SETTINGS,
  },
  {
    entity: "overpayments",
    path: "/Overpayments",
    idPath: "OverpaymentID",
    paging: "page-size",
    unitdp: true,
  },
  {
    entity: "prepayments",
    path: "/Prepayments",
    idPath: "PrepaymentID",
    paging: "page-size",
    unitdp: true,
  },
  { entity: "batch_payments", path: "/BatchPayments", idPath: "BatchPaymentID", paging: "none" },
  { entity: "contact_groups", path: "/ContactGroups", idPath: "ContactGroupID", paging: "none" },
  { entity: "accounts", path: "/Accounts", idPath: "AccountID", paging: "none", added: SETTINGS },
  {
    entity: "tracking_categories",
    path: "/TrackingCategories",
    idPath: "TrackingCategoryID",
    paging: "none",
    added: SETTINGS,
    // Xero leaves archived categories out unless asked, and old lines still name them (#277).
    query: { includeArchived: "true" },
  },
  { entity: "tax_rates", path: "/TaxRates", idPath: "TaxType", paging: "none", added: SETTINGS },
  { entity: "currencies", path: "/Currencies", idPath: "Code", paging: "none", added: SETTINGS },
  {
    entity: "bank_transactions",
    path: "/BankTransactions",
    idPath: "BankTransactionID",
    paging: "page-size",
    unitdp: true,
    added: BANK,
  },
  {
    entity: "bank_transfers",
    path: "/BankTransfers",
    idPath: "BankTransferID",
    paging: "none",
    added: BANK,
    // A DELETED transfer is left out unless asked, and one deleted after it landed would otherwise
    // stay in the lake as money that moved (#308).
    query: { includeDeleted: "true" },
  },
  {
    entity: "manual_journals",
    path: "/ManualJournals",
    idPath: "ManualJournalID",
    paging: "page-size",
    added: JOURNALS,
  },
];
/** The lists `OLD_GRANT` cannot read, in the spec's order. */
const ADDED = LISTS.filter((list) => list.added !== undefined);

/** The four lists read before issue 271, which still refuse an empty first read. */
const ALWAYS_READ = new Set(["contacts", "invoices", "payments", "credit_notes"]);

/** One page's URL, built the way the runtime builds it. */
function pageUrl(list: XeroList, page: number | null): string {
  const url = new URL(`${BASE}${list.path}`);
  for (const [name, value] of Object.entries(list.query ?? {})) {
    url.searchParams.set(name, value);
  }
  if (list.paging === "page-size") {
    url.searchParams.set("pageSize", "100");
  }
  if (list.unitdp === true) {
    url.searchParams.set("unitdp", "4");
  }
  if (page !== null) {
    url.searchParams.set("page", String(page));
  }
  return url.toString();
}

/** The envelope Xero answers a list in: its own name, holding the records. */
function envelope(list: XeroList, records: readonly unknown[]): unknown {
  return { [list.path.slice(1)]: records };
}

/** One record of a list, keyed on its own id field. */
function recordOf(list: XeroList): unknown {
  return { [list.idPath]: `${list.entity}-1`, UpdatedDateUTC: UPDATED };
}

/**
 * Xero as recorded: each list answering `records(list)`. A paged list is asked page one and then
 * page two, which is empty; an unpaged one is asked once, with no `page`. `firstPage` answers an
 * entity's first page with Xero's own text instead, for a record whose numbers must arrive
 * exactly as Xero writes them.
 */
function xero(
  records: (list: XeroList) => readonly unknown[],
  firstPage: Readonly<Record<string, string>> = {},
): InMemoryFetcher {
  const fetcher = new InMemoryFetcher();
  for (const list of LISTS) {
    const answer = firstPage[list.entity] ?? envelope(list, records(list));
    if (list.paging === "none") {
      fetcher.on("GET", pageUrl(list, null), { body: answer });
    } else {
      fetcher.on("GET", pageUrl(list, 1), { body: answer });
      fetcher.on("GET", pageUrl(list, 2), { body: envelope(list, []) });
    }
  }
  return fetcher;
}

let db: TestDatabase;
let lake: LakeStore;

beforeEach(async () => {
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
});

afterEach(async () => {
  await db.close();
});

afterAll(() => {
  rmSync(SPECS_DIR, { recursive: true, force: true });
});

/**
 * A connected Xero organisation, holding the grant its consent recorded, and reading `entities`
 * -- none ticked by default, which reads every entity the spec declares.
 */
async function connect(scope: string, entities: readonly string[] = []): Promise<void> {
  await db.query(
    `INSERT INTO ops.connection (tenant_id, source, status, external_account_id, scope)
     VALUES ($1, 'xero', 'connected', 'org-1', $2)`,
    [TENANT, scope],
  );
  // No expiry, so the run uses the access token as stored and never reaches Xero's token URL.
  const sealed = seal(JSON.stringify({ accessToken: "at", refreshToken: "rt", expiresAt: null }), {
    env: ENV,
  });
  await db.query(
    "INSERT INTO app.connection_secret (tenant_id, source, ciphertext, key_version) VALUES ($1, 'xero', $2, 1)",
    [TENANT, Buffer.from(sealed.blob)],
  );
  await writeConnectionDetail(db, {
    tenantId: TENANT,
    source: "xero",
    selectionJson: JSON.stringify({
      kind: "xero",
      organisation: { id: "org-1", name: "Acme Ltd" },
      entities,
    }),
  });
  await db.become("undercroft_worker");
}

function ingest(fetcher: InMemoryFetcher): ReturnType<typeof runIngest> {
  return runIngest(
    { lake, exec: db, specsDir: SPECS_DIR, env: ENV, fetcher },
    { source: "xero", tenantId: TENANT },
  );
}

async function landedIds(): Promise<Record<string, string[]>> {
  const { rows } = await db.query<{ entity: string; id: string }>(
    "SELECT entity, source_record_id AS id FROM raw.records WHERE source = 'xero' ORDER BY entity, id",
  );
  const byEntity: Record<string, string[]> = {};
  for (const row of rows) {
    byEntity[row.entity] = [...(byEntity[row.entity] ?? []), row.id];
  }
  return byEntity;
}

describe("the shipped Xero spec", () => {
  it("reads every list its granular read scopes reach, each keyed on its own id", async () => {
    await connect(FULL_GRANT);
    const fetcher = xero((list) => [recordOf(list)]);

    const result = await ingest(fetcher);

    expect(result.entities.map((entity) => entity.entity)).toEqual(LISTS.map((l) => l.entity));
    expect(await landedIds()).toEqual(
      Object.fromEntries(LISTS.map((list) => [list.entity, [`${list.entity}-1`]])),
    );
  });

  it("asks a list Xero does not page exactly once, and never for a page", async () => {
    await connect(FULL_GRANT);
    const fetcher = xero((list) => [recordOf(list)]);

    await ingest(fetcher);

    const asked = fetcher.calls.map((call) => call.url);
    for (const list of LISTS.filter((l) => l.paging === "none")) {
      expect(asked.filter((url) => url.startsWith(`${BASE}${list.path}`))).toEqual([
        pageUrl(list, null),
      ]);
    }
  });

  it("closes the first run of an organisation that has none of the optional lists", async () => {
    await connect(FULL_GRANT);
    const fetcher = xero((list) => (ALWAYS_READ.has(list.entity) ? [recordOf(list)] : []));

    const result = await ingest(fetcher);

    expect(result.entities.filter((e) => !ALWAYS_READ.has(e.entity)).map((e) => e.landed)).toEqual(
      LISTS.filter((l) => !ALWAYS_READ.has(l.entity)).map(() => 0),
    );
  });

  it("still refuses an empty first read of a list it has always read", async () => {
    // The quiet side above must not have been bought by relaxing the guard everywhere.
    await connect(FULL_GRANT);
    const fetcher = xero((list) => (list.entity === "contacts" ? [] : [recordOf(list)]));

    await expect(ingest(fetcher)).rejects.toThrow("failOnEmpty");
  });
});

/** The lists the run named as not granted, with the scope each lacks, in the order it said so. */
async function notGranted(): Promise<{ entity: string; scope: unknown }[]> {
  const { rows } = await db.query<{ entity: string; scope: unknown }>(
    `SELECT entity, detail->'scope' AS scope FROM ops.run_event
     WHERE event = 'entity_not_granted' ORDER BY id`,
  );
  return rows;
}

describe("a Xero list read before it asked for 4-decimal unit prices", () => {
  it("is read whole on the next run, without reconnecting, and its unit prices land unrounded", async () => {
    // A cursor as production held it before #280: written before every request had a key, so
    // `request_key` is ''. Handed to the new request, it would ask Xero only for invoices changed
    // since, and a bill nobody has edited would keep the 0.22 it was first read with.
    await connect(FULL_GRANT);
    await writeSyncCursor(
      db,
      { source: "xero", tenantId: TENANT, entity: "invoices" },
      { format: "ms-json-date", requestKey: "", watermark: UPDATED },
      null,
    );
    const bill = `{"Invoices":[{"InvoiceID":"invoices-1","UpdatedDateUTC":"/Date(1500000000000+0000)/",
      "LineItems":[{"Quantity":100,"UnitAmount":0.2248,"LineAmount":22.48}]}]}`;
    const fetcher = xero((list) => [recordOf(list)], { invoices: bill });

    await ingest(fetcher);

    const asked = fetcher.calls.filter((call) => call.url.startsWith(`${BASE}/Invoices`));
    expect(asked.map((call) => call.headers?.["If-Modified-Since"])).toEqual([
      undefined,
      undefined,
    ]);
    const { rows } = await db.query<{ price: string; amount: string }>(
      `SELECT payload #>> '{LineItems,0,UnitAmount}' AS price,
              payload #>> '{LineItems,0,LineAmount}' AS amount
         FROM raw.records WHERE source = 'xero' AND entity = 'invoices'`,
    );
    expect(rows).toEqual([{ price: "0.2248", amount: "22.48" }]);
  });
});

describe("a Xero grant recorded before the consent asked for the scopes it has since added", () => {
  it("reads every other list, requests none of the lists it lacks, and names each", async () => {
    await connect(OLD_GRANT);
    const fetcher = xero((list) => [recordOf(list)]);

    const result = await ingest(fetcher);

    expect(result.entities.map((entity) => entity.entity)).toEqual(
      LISTS.filter((list) => list.added === undefined).map((list) => list.entity),
    );
    const addedPaths = ADDED.map((list) => `${BASE}${list.path}`);
    expect(
      fetcher.calls.filter((call) => addedPaths.some((path) => call.url.startsWith(path))),
    ).toEqual([]);
    const { rows } = await db.query<{ status: string }>("SELECT status FROM ops.run");
    expect(rows).toEqual([{ status: "ok" }]);
    expect(await notGranted()).toEqual(
      ADDED.map((list) => ({ entity: list.entity, scope: list.added })),
    );
  });

  it("fails a run that could read none of the lists chosen, naming the scope", async () => {
    // Closing green on no list read would call "nothing was readable" a success.
    await connect(OLD_GRANT, ["items", "accounts"]);
    const fetcher = xero((list) => [recordOf(list)]);

    const failed = ingest(fetcher);

    await expect(failed).rejects.toBeInstanceOf(GrantTooNarrow);
    await expect(failed).rejects.toThrow(SETTINGS);
    expect(fetcher.calls).toEqual([]);
    expect((await notGranted()).map((row) => row.entity)).toEqual(["items", "accounts"]);
  });

  it("is not judged when no grant was recorded, which is no evidence either way", async () => {
    await connect("");
    const fetcher = xero((list) => [recordOf(list)]);

    const result = await ingest(fetcher);

    expect(result.entities).toHaveLength(LISTS.length);
    expect(await notGranted()).toEqual([]);
  });
});
