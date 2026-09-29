/**
 * The schedule of grants, as the card reads it.
 *
 * `presentStatus` is pure, so the rule deciding whether a customer is asked to reconnect is
 * asked from both sides with no database. The rest runs against real Postgres, because the
 * interesting part -- what a join reaching into `app.connection_secret` is allowed to bring
 * back, and what it must leave behind -- is a property of the query.
 */

import {
  openRun,
  upsertConnection,
  writeConnectionDetail,
  writeCredential,
} from "@undercroft/db/repos";
import type { SqlExecutor } from "@undercroft/db";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import {
  disconnect,
  KNOWN_SOURCES,
  list,
  presentStatus,
  setCadence,
  setResync,
  setScope,
  setToken,
} from "./connections.ts";
import { loadSpecReads } from "../specs.ts";
import { InMemoryWorkerClient } from "./inMemoryWorkerClient.ts";

const TENANT = "CASE-0042";
const ENV = { UNDERCROFT_SECRET_KEY: Buffer.alloc(32, 5).toString("base64") };
const GMAIL_SCOPE = JSON.stringify({ labels: [{ id: "Label_8", name: "Invoices" }] });
/** What Google returns for a Gmail consent nobody unticked. */
const GMAIL_GRANT =
  "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.readonly";
/**
 * What Xero recorded for a consent made before ADR 0073 asked for `accounting.settings.read`.
 * Xero answers the scopes granted in its token response, which is what the column holds.
 */
const XERO_OLD_GRANT =
  "offline_access accounting.invoices.read accounting.payments.read accounting.contacts.read";
const ORGANISATION = { id: "org-9f2a", name: "CASE-0042 Pte Ltd" };
/** A Xero choice of the named lists; none named is every list the spec declares. */
function xeroChoosing(entities: string[]): string {
  return JSON.stringify({ organisation: ORGANISATION, entities });
}
const XERO_EVERY_LIST = xeroChoosing([]);

/** The shipped specs, read by the loader the process boots with: the card's rule reads these. */
const SPECS = loadSpecReads();

let db: TestDatabase;

/**
 * A database per test, called inside each describe that reads one rather than at the top of
 * the file: `presentStatus` and the refusals decided before any statement runs pay nothing
 * for a fixture they never touch.
 */
function useDatabase(): void {
  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
    await db.become("undercroft_app");
  });

  afterEach(async () => {
    await db.close();
  });
}

/** For a refusal decided before any statement runs: a query here fails loudly. */
const noDatabase: SqlExecutor = {
  query: () => Promise.reject(new Error("this refusal must not touch the database")),
  exec: () => Promise.reject(new Error("this refusal must not touch the database")),
};

describe("presentStatus", () => {
  it("a connected, scoped source is connected", () => {
    expect(
      presentStatus(
        {
          status: "connected",
          source: "gmail",
          selectionJson: GMAIL_SCOPE,
          scope: GMAIL_GRANT,
        },
        SPECS,
      ).status,
    ).toBe("connected");
  });

  it("connected with no recorded scope needs one", () => {
    // Running in this state would read a whole mailbox on the strength of a missing row.
    expect(
      presentStatus(
        {
          status: "connected",
          source: "gmail",
          selectionJson: "{}",
          scope: GMAIL_GRANT,
        },
        SPECS,
      ).status,
    ).toBe("needs_scope");
  });

  it("an empty label list is a recorded decision, not a missing one", () => {
    // The quiet side: "deliberately the whole mailbox" must not read as "nobody has chosen".
    expect(
      presentStatus(
        {
          status: "connected",
          source: "gmail",
          selectionJson: JSON.stringify({ labels: [] }),
          scope: GMAIL_GRANT,
        },
        SPECS,
      ).status,
    ).toBe("connected");
  });

  it("a source that takes no scope is connected without one", () => {
    // HubSpot and Xero have no picker, so `needs_scope` would be a state nobody can leave.
    expect(
      presentStatus(
        { status: "connected", source: "hubspot", selectionJson: "{}", scope: "" },
        SPECS,
      ).status,
    ).toBe("connected");
  });

  it("a grant missing the permission it asked for needs a reconnect", () => {
    // What `case-001` actually held: Allow pressed with the Gmail tick removed. It read
    // `connected` on the card while every Gmail call came back 403, and the only repair is
    // to consent again. Gmail reads under that one scope, so there is no list left to run on,
    // with the Xero spec's per-list scopes loaded beside it or not.
    expect(
      presentStatus(
        {
          status: "connected",
          source: "gmail",
          selectionJson: GMAIL_SCOPE,
          scope: "openid https://www.googleapis.com/auth/userinfo.email",
        },
        SPECS,
      ).status,
    ).toBe("needs_reconnect");
  });

  it("a Xero grant from before settings were asked for still runs, and names what it cannot read", () => {
    // Every Xero connection made before ADR 0073 holds exactly this grant. It still reads twelve
    // lists, and a run reads them and skips the ones under the scopes asked for since -- so the
    // card may not call it lapsed, and it names each with the scope a reconnect would add.
    const card = presentStatus(
      {
        status: "connected",
        source: "xero",
        selectionJson: XERO_EVERY_LIST,
        scope: XERO_OLD_GRANT,
      },
      SPECS,
    );

    expect(card.status).toBe("connected");
    expect(card.ungranted).toEqual([
      ...["items", "accounts", "tracking_categories", "tax_rates", "currencies"].map((entity) => ({
        entity,
        scope: "accounting.settings.read",
      })),
      { entity: "bank_transactions", scope: "accounting.banktransactions.read" },
      { entity: "bank_transfers", scope: "accounting.banktransactions.read" },
      { entity: "manual_journals", scope: "accounting.manualjournals.read" },
    ]);
  });

  it("a Xero grant that reads every list it was told to read names none as missing", () => {
    // The quiet side: a list nobody chose is not one the connection lacks.
    const card = presentStatus(
      {
        status: "connected",
        source: "xero",
        selectionJson: xeroChoosing(["invoices", "contacts"]),
        scope: XERO_OLD_GRANT,
      },
      SPECS,
    );

    expect(card).toEqual({ status: "connected", ungranted: [] });
  });

  it("a Xero grant that reads none of the lists it was told to read needs a reconnect", () => {
    // A run would read nothing and fail, so the card may not offer one.
    const card = presentStatus(
      {
        status: "connected",
        source: "xero",
        selectionJson: xeroChoosing(["items", "accounts"]),
        scope: XERO_OLD_GRANT,
      },
      SPECS,
    );

    expect(card.status).toBe("needs_reconnect");
  });

  it("a Xero grant without a refresh token needs a reconnect, whatever lists it reads", () => {
    // `offline_access` gates no list, so no run reads around its absence.
    const card = presentStatus(
      {
        status: "connected",
        source: "xero",
        selectionJson: XERO_EVERY_LIST,
        scope: XERO_OLD_GRANT.replace("offline_access ", ""),
      },
      SPECS,
    );

    expect(card.status).toBe("needs_reconnect");
  });

  it("an unrecorded grant is not judged either way", () => {
    // The quiet side. An empty scope column is no evidence -- rows predating it, and every
    // source that never went through Google -- and no evidence is not a verdict.
    expect(
      presentStatus(
        {
          status: "connected",
          source: "gmail",
          selectionJson: GMAIL_SCOPE,
          scope: "",
        },
        SPECS,
      ).status,
    ).toBe("connected");
  });

  it("expired and error both read as needing a reconnect", () => {
    // One state on screen: telling a token expiry from a provider fault is not the
    // customer's question to answer.
    expect(
      presentStatus(
        {
          status: "expired",
          source: "gmail",
          selectionJson: GMAIL_SCOPE,
          scope: GMAIL_GRANT,
        },
        SPECS,
      ).status,
    ).toBe("needs_reconnect");
    expect(
      presentStatus(
        {
          status: "error",
          source: "gmail",
          selectionJson: GMAIL_SCOPE,
          scope: GMAIL_GRANT,
        },
        SPECS,
      ).status,
    ).toBe("needs_reconnect");
  });

  it("disconnected stays disconnected", () => {
    expect(
      presentStatus(
        {
          status: "disconnected",
          source: "gmail",
          selectionJson: GMAIL_SCOPE,
          scope: GMAIL_GRANT,
        },
        SPECS,
      ).status,
    ).toBe("disconnected");
  });
});

describe("the schedule", () => {
  useDatabase();

  it("a tenant with nothing connected still sees every source", async () => {
    // The schedule IS the product: the screen a new customer lands on is the one an
    // established one uses, and an empty list gave it nothing to show.
    const rows = await list(db, TENANT, SPECS);

    expect(rows.map((r) => r.source)).toEqual([...KNOWN_SOURCES]);
    expect(rows.every((r) => r.status === "disconnected")).toBe(true);
  });

  it("the credential's own expiry stays off the card, along with the credential", async () => {
    // The licence for joining `app.connection_secret` at all is that the control plane may
    // know WHEN a credential expires and may never know what it is. Knowing is not showing:
    // `expiresAt: row.expiresAt` wired the access token's HOURLY rotation to the field the
    // card reads as "when must the customer consent again", so every freshly connected Google
    // source announced "expires today" and then turned itself into "reconnect" an hour later,
    // for a token the worker refreshes unattended. No provider tells us when a GRANT ends, so
    // the card gets null and says "no expiry recorded" -- true, where the number to hand was not.
    await upsertConnection(db, { tenantId: TENANT, source: "gmail", status: "connected" });
    await writeCredential(
      db,
      TENANT,
      "gmail",
      { accessToken: "at", refreshToken: "rt", expiresAt: "2099-01-01T00:00:00.000Z" },
      { env: ENV },
    );
    await writeConnectionDetail(db, {
      tenantId: TENANT,
      source: "gmail",
      selectionJson: GMAIL_SCOPE,
    });

    const gmail = (await list(db, TENANT, SPECS)).find((r) => r.source === "gmail");

    expect(gmail?.expiresAt).toBeNull();
    expect(JSON.stringify(gmail)).not.toContain("2099-01-01T00:00:00.000Z");
    expect(JSON.stringify(gmail)).not.toContain("ciphertext");
    expect(JSON.stringify(gmail)).not.toContain("rt");
  });

  it("each mailbox is a card of its own, with its own status", async () => {
    // One aggregate status over two mailboxes cannot say WHICH of them stopped. ADR 0043.
    await upsertConnection(db, {
      tenantId: TENANT,
      source: "gmail",
      status: "connected",
      externalAccountId: "108134092834092834",
    });
    await writeConnectionDetail(db, {
      tenantId: TENANT,
      source: "gmail",
      accountLabel: "ops@acme.test",
      selectionJson: GMAIL_SCOPE,
    });
    await upsertConnection(db, {
      tenantId: TENANT,
      source: "gmail.3fa9c1d2e0ab",
      status: "expired",
      externalAccountId: "208134092834092834",
    });
    await writeConnectionDetail(db, {
      tenantId: TENANT,
      source: "gmail.3fa9c1d2e0ab",
      accountLabel: "billing@acme.test",
    });

    const gmail = (await list(db, TENANT, SPECS)).filter((r) => r.kind === "gmail");

    expect(
      gmail.map((r) => ({ source: r.source, account: r.externalAccountLabel, status: r.status })),
    ).toEqual([
      { source: "gmail", account: "ops@acme.test", status: "connected" },
      { source: "gmail.3fa9c1d2e0ab", account: "billing@acme.test", status: "needs_reconnect" },
    ]);
  });

  it("the granted scope string comes back split", async () => {
    await upsertConnection(db, {
      tenantId: TENANT,
      source: "gmail",
      status: "connected",
      scope: "openid https://www.googleapis.com/auth/gmail.readonly",
    });
    await writeConnectionDetail(db, {
      tenantId: TENANT,
      source: "gmail",
      selectionJson: GMAIL_SCOPE,
    });

    const gmail = (await list(db, TENANT, SPECS)).find((r) => r.source === "gmail");

    expect(gmail?.scopes).toEqual(["openid", "https://www.googleapis.com/auth/gmail.readonly"]);
  });

  it("the card says how often the source is read and when it is next due", async () => {
    // The same rule the scheduler's due list applies, so the card and the ledger agree.
    await upsertConnection(db, { tenantId: TENANT, source: "hubspot", status: "connected" });
    await setCadence(db, {
      tenantId: TENANT,
      source: "hubspot",
      cadence: "hourly",
      actor: "ada@example.test",
    });
    await openRun(db, {
      id: "r-1",
      tenantId: TENANT,
      source: "hubspot",
      verb: "ingest",
      trigger: "schedule",
    });
    const startedAt = (await list(db, TENANT, SPECS)).find((r) => r.source === "hubspot")?.lastRun
      ?.startedAt;

    const hubspot = (await list(db, TENANT, SPECS, new Date("2026-03-01T10:00:00.000Z"))).find(
      (r) => r.source === "hubspot",
    );
    expect(hubspot?.cadence).toBe("hourly");
    expect(hubspot?.nextRunAt).toBe(
      new Date(new Date(startedAt ?? "").getTime() + 3_600_000).toISOString(),
    );
  });

  it("a paused source, and one still waiting for its scope, have no next run", async () => {
    await upsertConnection(db, { tenantId: TENANT, source: "hubspot", status: "connected" });
    await setCadence(db, {
      tenantId: TENANT,
      source: "hubspot",
      cadence: "paused",
      actor: "ada@example.test",
    });
    await upsertConnection(db, { tenantId: TENANT, source: "gmail", status: "connected" });

    const cards = await list(db, TENANT, SPECS);
    expect(cards.find((r) => r.source === "hubspot")?.nextRunAt).toBeNull();
    expect(cards.find((r) => r.source === "gmail")?.nextRunAt).toBeNull();
    // A source nobody has connected reads the default and will not run.
    expect(cards.find((r) => r.source === "xero")).toMatchObject({
      cadence: "daily",
      nextRunAt: null,
    });
  });

  it("a Xero connection whose grant predates a scope keeps its schedule and names the gap", async () => {
    // Issue 277: a connection made before the consent asked for settings keeps reading every
    // list it can until it reconnects. The card says so -- runnable, due, and short what it lacks.
    await upsertConnection(db, {
      tenantId: TENANT,
      source: "xero",
      status: "connected",
      externalAccountId: ORGANISATION.id,
      scope: XERO_OLD_GRANT,
    });
    await writeConnectionDetail(db, {
      tenantId: TENANT,
      source: "xero",
      selectionJson: XERO_EVERY_LIST,
    });
    const now = new Date("2026-09-28T02:00:00.000Z");

    const xero = (await list(db, TENANT, SPECS, now)).find((r) => r.source === "xero");

    expect(xero?.status).toBe("connected");
    expect(xero?.nextRunAt).toBe(now.toISOString());
    expect(xero?.ungranted.map((read) => read.entity)).toEqual([
      "items",
      "accounts",
      "tracking_categories",
      "tax_rates",
      "currencies",
      "bank_transactions",
      "bank_transfers",
      "manual_journals",
    ]);
  });
});

describe("re-syncing a connection's lists whole", () => {
  // ADR 0081: a schedule of its own beside the cadence, off until an admin opts in, for the edits
  // a source's change filter never returns.
  useDatabase();

  async function connectXero(entities: string[]): Promise<void> {
    await upsertConnection(db, {
      tenantId: TENANT,
      source: "xero",
      status: "connected",
      externalAccountId: ORGANISATION.id,
    });
    await writeConnectionDetail(db, {
      tenantId: TENANT,
      source: "xero",
      accountLabel: ORGANISATION.name,
      selectionJson: xeroChoosing(entities),
      chosenBy: "ada@example.test",
    });
  }

  it("is off until an admin turns it on, then shows on the card and in the trail", async () => {
    await connectXero(["invoices"]);
    const before = await list(db, TENANT, SPECS);
    expect(before.find((card) => card.source === "xero")?.resync?.cadence).toBe("paused");

    const result = await setResync(db, SPECS, {
      tenantId: TENANT,
      source: "xero",
      cadence: "custom",
      cron: "0 2 * * 0",
      actor: "ada@example.test",
    });

    expect(result).toEqual({ ok: true });
    const after = await list(db, TENANT, SPECS);
    expect(after.find((card) => card.source === "xero")?.resync).toMatchObject({
      cadence: "custom",
      cron: "0 2 * * 0",
    });
    const { rows } = await db.query<{ action: string }>("SELECT action FROM ops.audit_log");
    expect(rows.map((row) => row.action)).toEqual(["connection.resync_set"]);
  });

  it("refuses a source whose lists no change filter reads, before writing anything", async () => {
    // HubSpot filters on the client, paging the whole source every run: nothing to catch up on.
    const result = await setResync(noDatabase, SPECS, {
      tenantId: TENANT,
      source: "hubspot",
      cadence: "daily",
      actor: "ada@example.test",
    });

    expect(result).toEqual({ ok: false, reason: "not-resyncable" });
  });

  it("says how many days a re-sync takes, from what each list's last whole read cost", async () => {
    await connectXero(["invoices", "contacts"]);
    // 3,000 and 2,000 requests against Xero's whole-read share of 4,000 a day: two days.
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO raw.sync_cursor
           (source, tenant_id, entity, watermark, format, request_key, whole_read_at, whole_read_requests)
         VALUES ('xero', $1, 'invoices', 'w', 'ms-json-date', 'k', '2026-09-20T02:00:00Z', 3000),
                ('xero', $1, 'contacts', 'w', 'ms-json-date', 'k', '2026-09-21T02:00:00Z', 2000)`,
        [TENANT],
      ),
    );

    const cards = await list(db, TENANT, SPECS);

    expect(cards.find((card) => card.source === "xero")?.resync).toMatchObject({
      days: 2,
      lastWholeReadAt: "2026-09-20T02:00:00.000Z",
    });
  });
});

describe("choosing a cadence", () => {
  useDatabase();

  it("is recorded on the connection and in the trail", async () => {
    await upsertConnection(db, { tenantId: TENANT, source: "hubspot", status: "connected" });
    const result = await setCadence(db, {
      tenantId: TENANT,
      source: "hubspot",
      cadence: "every_6h",
      actor: "ada@example.test",
    });
    expect(result).toEqual({ ok: true });
    const { rows } = await db.query<{ action: string; detail: unknown }>(
      "SELECT action, detail FROM ops.audit_log",
    );
    expect(rows[0]?.action).toBe("connection.cadence_set");
    expect(JSON.stringify(rows[0]?.detail)).toContain('"cadence":"every_6h"');
  });

  it("a source nobody has connected has nothing to set it on", async () => {
    const result = await setCadence(db, {
      tenantId: TENANT,
      source: "hubspot",
      cadence: "hourly",
      actor: "ada@example.test",
    });
    expect(result).toEqual({ ok: false, reason: "no-connection" });
  });

  it("a custom expression is kept, printed on the card and in the trail, with its next fire", async () => {
    await upsertConnection(db, { tenantId: TENANT, source: "hubspot", status: "connected" });
    await openRun(db, {
      id: "r-1",
      tenantId: TENANT,
      source: "hubspot",
      verb: "ingest",
      trigger: "schedule",
    });
    const result = await setCadence(db, {
      tenantId: TENANT,
      source: "hubspot",
      cadence: "custom",
      cron: "30 7 * * 1-5",
      actor: "ada@example.test",
    });
    expect(result).toEqual({ ok: true });

    const { rows } = await db.query<{ detail: unknown }>("SELECT detail FROM ops.audit_log");
    expect(JSON.stringify(rows[0]?.detail)).toContain('"cron":"30 7 * * 1-5"');
    // The run just opened started "now", so the next fire is the first weekday 07:30 SGT
    // after it -- whatever day the suite runs on, it is in the future and on a weekday.
    const hubspot = (await list(db, TENANT, SPECS)).find((r) => r.source === "hubspot");
    expect(hubspot).toMatchObject({ cadence: "custom", cron: "30 7 * * 1-5" });
    const next = new Date(hubspot?.nextRunAt ?? "");
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect(next.getUTCHours()).toBe(23);
    expect(next.getUTCMinutes()).toBe(30);
    // 23:30Z is 07:30 the next day in Singapore, so a Monday-to-Friday fire is Sunday to
    // Thursday in UTC.
    expect([0, 1, 2, 3, 4]).toContain(next.getUTCDay());
  });

  it("a preset chosen after a custom expression clears it", async () => {
    await upsertConnection(db, { tenantId: TENANT, source: "hubspot", status: "connected" });
    const actor = "ada@example.test";
    await setCadence(db, {
      tenantId: TENANT,
      source: "hubspot",
      cadence: "custom",
      cron: "0 9 * * *",
      actor,
    });
    await setCadence(db, { tenantId: TENANT, source: "hubspot", cadence: "daily", actor });

    const hubspot = (await list(db, TENANT, SPECS)).find((r) => r.source === "hubspot");
    expect(hubspot).toMatchObject({ cadence: "daily", cron: null });
  });

  it("an expression the scheduler cannot keep is refused, and nothing is written", async () => {
    await upsertConnection(db, { tenantId: TENANT, source: "hubspot", status: "connected" });
    const actor = "ada@example.test";

    expect(
      await setCadence(db, {
        tenantId: TENANT,
        source: "hubspot",
        cadence: "custom",
        cron: "* * * * *",
        actor,
      }),
    ).toEqual({ ok: false, reason: "cron-refused", refusal: "too-frequent" });
    expect(
      await setCadence(db, {
        tenantId: TENANT,
        source: "hubspot",
        cadence: "hourly",
        cron: "0 9 * * *",
        actor,
      }),
    ).toEqual({ ok: false, reason: "cron-without-custom" });

    const hubspot = (await list(db, TENANT, SPECS)).find((r) => r.source === "hubspot");
    expect(hubspot).toMatchObject({ cadence: "daily", cron: null });
    const { rows } = await db.query("SELECT 1 FROM ops.audit_log");
    expect(rows).toEqual([]);
  });
});

describe("choosing a scope", () => {
  useDatabase();

  beforeEach(async () => {
    await upsertConnection(db, { tenantId: TENANT, source: "gmail", status: "connected" });
  });

  it("a valid selection is stored and moves the card to connected", async () => {
    const result = await setScope(db, {
      tenantId: TENANT,
      source: "gmail",
      selectionJson: GMAIL_SCOPE,
      actor: "ada@example.test",
      actorId: "u1",
    });

    expect(result.ok).toBe(true);
    const gmail = (await list(db, TENANT, SPECS)).find((r) => r.source === "gmail");
    expect(gmail?.status).toBe("connected");
    expect(gmail?.config.labels).toEqual(["Invoices"]);
  });

  it("a scope saved with no file types defaults to PDF only", async () => {
    // GMAIL_SCOPE carries no `fileTypes` key at all -- exactly what every selection saved
    // before this field existed looks like -- and the card must still say PDF only.
    await setScope(db, {
      tenantId: TENANT,
      source: "gmail",
      selectionJson: GMAIL_SCOPE,
      actor: "ada@example.test",
      actorId: "u1",
    });

    const gmail = (await list(db, TENANT, SPECS)).find((r) => r.source === "gmail");
    expect(gmail?.config.fileTypes).toEqual(["application/pdf"]);
  });

  it("a scope's file types are surfaced on the card", async () => {
    await setScope(db, {
      tenantId: TENANT,
      source: "gmail",
      selectionJson: JSON.stringify({
        labels: [{ id: "Label_8", name: "Invoices" }],
        fileTypes: ["application/vnd.ms-excel", "text/csv"],
      }),
      actor: "ada@example.test",
      actorId: "u1",
    });

    const gmail = (await list(db, TENANT, SPECS)).find((r) => r.source === "gmail");
    expect(gmail?.config.fileTypes).toEqual(["application/vnd.ms-excel", "text/csv"]);
  });

  it("a selection that does not match the source is refused", async () => {
    // The firing side. A picker that saved a Drive shape under gmail would otherwise store
    // something the collector cannot read, and the run would fail far from the cause.
    const result = await setScope(db, {
      tenantId: TENANT,
      source: "gmail",
      selectionJson: JSON.stringify({ files: [{ id: "x", name: "y", kind: "folder" }] }),
      actor: "ada@example.test",
      actorId: "u1",
    });

    expect(result).toEqual({ ok: false, reason: "unsupported-source" });
  });

  it("a Xero choice records the organisation's id for runs and its name for the card", async () => {
    await upsertConnection(db, { tenantId: TENANT, source: "xero", status: "connected" });

    const result = await setScope(db, {
      tenantId: TENANT,
      source: "xero",
      selectionJson: JSON.stringify({
        organisation: { id: "org-9f2a", name: "Acme Pte Ltd" },
        entities: ["invoices", "contacts"],
      }),
      actor: "ada@example.test",
      actorId: "u1",
    });

    expect(result.ok).toBe(true);
    const xero = (await list(db, TENANT, SPECS)).find((r) => r.source === "xero");
    expect(xero?.status).toBe("connected");
    // The id is what a run sends as `xero-tenant-id`; the name is what a person reads.
    expect(xero?.externalAccountId).toBe("org-9f2a");
    expect(xero?.externalAccountLabel).toBe("Acme Pte Ltd");
    expect(xero?.config.entities).toEqual(["invoices", "contacts"]);
  });

  it("a HubSpot choice is stored and read back by internal name, and the card stays connected", async () => {
    await upsertConnection(db, { tenantId: TENANT, source: "hubspot", status: "connected" });

    const result = await setScope(db, {
      tenantId: TENANT,
      source: "hubspot",
      selectionJson: JSON.stringify({
        properties: { companies: ["annualrevenue", "x_onboarding_stage"] },
      }),
      actor: "ada@example.test",
      actorId: "u1",
    });

    expect(result.ok).toBe(true);
    const hubspot = (await list(db, TENANT, SPECS)).find((r) => r.source === "hubspot");
    expect(hubspot?.status).toBe("connected");
    expect(hubspot?.config.properties).toEqual({
      companies: ["annualrevenue", "x_onboarding_stage"],
    });
  });

  it("a HubSpot choice of every contact property is saved, beside the other objects' choices", async () => {
    // Issue 210. 525 names of 30 characters is over 16,000 once joined -- a portal's full contact
    // list, longer than any URL HubSpot accepts. It used to be refused whole, and the companies
    // choice saved with it went down too. A widened object is read by a batch read whose body
    // carries the names (ADR 0054), so there is no length left to refuse.
    await upsertConnection(db, { tenantId: TENANT, source: "hubspot", status: "connected" });
    const names = Array.from(
      { length: 525 },
      (_, i) => `x_property_${String(i).padStart(19, "0")}`,
    );

    const result = await setScope(db, {
      tenantId: TENANT,
      source: "hubspot",
      selectionJson: JSON.stringify({ properties: { companies: ["city"], contacts: names } }),
      actor: "ada@example.test",
      actorId: "u1",
    });

    expect(result.ok).toBe(true);
    const hubspot = (await list(db, TENANT, SPECS)).find((r) => r.source === "hubspot");
    expect(hubspot?.config.properties).toEqual({ companies: ["city"], contacts: names });
  });

  it("the audit entry counts what was chosen and never names it", async () => {
    // `ops.audit_log` has a wider readership than `app.connection_detail`. What was decided
    // and by whom belongs in a trail; which folders a customer picked is their data.
    await setScope(db, {
      tenantId: TENANT,
      source: "gmail",
      selectionJson: GMAIL_SCOPE,
      actor: "ada@example.test",
      actorId: "u1",
    });

    const { rows } = await db.query<{ action: string; detail: unknown }>(
      "SELECT action, detail FROM ops.audit_log",
    );
    expect(rows[0]?.action).toBe("connection.scope_set");
    expect(JSON.stringify(rows[0]?.detail)).toContain('"count":1');
    expect(JSON.stringify(rows[0]?.detail)).not.toContain("Invoices");
  });
});

describe("connecting with a pasted token", () => {
  useDatabase();

  it("hands the token to the worker to be proven and sealed, and audits the source alone", async () => {
    const worker = new InMemoryWorkerClient().backedBy(db);

    const result = await setToken(db, worker, {
      tenantId: TENANT,
      source: "hubspot",
      token: "pat-na1-secret",
      actor: "ada@example.test",
    });

    expect(result).toEqual({ ok: true });
    expect(worker.stored[0]).toMatchObject({
      source: "hubspot",
      validate: true,
      externalAccountId: "",
    });
    const hubspot = (await list(db, TENANT, SPECS)).find((r) => r.source === "hubspot");
    expect(hubspot?.status).toBe("connected");
    const { rows } = await db.query<{ action: string; detail: unknown }>(
      "SELECT action, detail FROM ops.audit_log",
    );
    expect(rows[0]?.action).toBe("connection.connected");
    expect(JSON.stringify(rows[0]?.detail)).not.toContain("pat-na1-secret");
  });

  it("a token the provider refused is reported as such, and nothing is audited", async () => {
    const worker = new InMemoryWorkerClient().failing("credential-rejected");

    const result = await setToken(db, worker, {
      tenantId: TENANT,
      source: "hubspot",
      token: "typo",
      actor: "ada@example.test",
    });

    expect(result).toEqual({ ok: false, reason: "rejected" });
    const { rows } = await db.query("SELECT 1 FROM ops.audit_log");
    expect(rows).toHaveLength(0);
  });
});

describe("disconnecting", () => {
  useDatabase();

  beforeEach(async () => {
    await upsertConnection(db, { tenantId: TENANT, source: "gmail", status: "connected" });
    await writeConnectionDetail(db, {
      tenantId: TENANT,
      source: "gmail",
      accountLabel: "ops@acme.test",
      selectionJson: GMAIL_SCOPE,
    });
  });

  it("the grant ends, the scope is cleared, and the account history stays", async () => {
    const worker = new InMemoryWorkerClient();

    const result = await disconnect(db, worker, {
      tenantId: TENANT,
      source: "gmail",
      actor: "ada@example.test",
    });

    expect(result.revokedUpstream).toBe(true);
    expect(worker.revoked).toEqual([{ tenantId: TENANT, source: "gmail" }]);

    const gmail = (await list(db, TENANT, SPECS)).find((r) => r.source === "gmail");
    expect(gmail?.status).toBe("disconnected");
    // A stored scope for a connection nobody may use is a record of what a customer once
    // shared, kept past the moment they asked us to stop.
    expect(gmail?.config).toEqual({});
    // The row itself stays: reconnecting the same account should look like the same account.
    expect(gmail?.externalAccountLabel).toBe("ops@acme.test");
  });

  it("a customer can disconnect with no worker configured", async () => {
    // Our side must not depend on the provider being reachable, or a Google outage would
    // trap a customer in a connection they asked to end.
    const result = await disconnect(db, null, {
      tenantId: TENANT,
      source: "gmail",
      actor: "ada@example.test",
    });

    expect(result.revokedUpstream).toBe(false);
    const gmail = (await list(db, TENANT, SPECS)).find((r) => r.source === "gmail");
    expect(gmail?.status).toBe("disconnected");
  });
});

describe("connecting with a pasted token, refused before anything is asked", () => {
  // The quiet half is "hands the token to the worker..." above, which does reach the worker.
  it("a source that consents rather than pastes is refused before the worker is asked", async () => {
    const worker = new InMemoryWorkerClient();

    const result = await setToken(noDatabase, worker, {
      tenantId: TENANT,
      source: "gmail",
      token: "t",
      actor: "ada@example.test",
    });

    expect(result).toEqual({ ok: false, reason: "unsupported-source" });
    expect(worker.stored).toHaveLength(0);
  });
});
