/**
 * What an alert promises: the right people are told once, in their own language, with a
 * way in; a repeat within a day is held; and nothing goes out twice.
 *
 * No mocks: real Postgres in WASM, the real catalogues, and the in-memory sender that
 * refuses a message no provider would take.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { DEFAULT_LOCALE, InMemoryEmailSender } from "@undercroft/core";
import { closeRun, openRun, upsertConnection, writeCredential } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { appRouter } from "../handlers/router.ts";
import type { Context } from "../handlers/trpc.ts";
import { type AlertDeps, runAlerts } from "./alerts.ts";

const TENANT = "CASE-0042";
const PUBLIC_URL = "https://undercroft.example.test";
const ENV = { UNDERCROFT_SECRET_KEY: Buffer.alloc(32, 9).toString("base64") };

let db: TestDatabase;
let email: InMemoryEmailSender;

function deps(over: Partial<AlertDeps> = {}): AlertDeps {
  return { exec: db, email, publicUrl: PUBLIC_URL, superadmins: new Set<string>(), ...over };
}

async function seedAdmin(address: string, locale = DEFAULT_LOCALE): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email, locale) VALUES ($1, $2) RETURNING id",
    [address, locale],
  );
  const userId = rows[0]?.id ?? "";
  await db.query(
    "INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, 'admin')",
    [TENANT, userId],
  );
  return userId;
}

async function failedRun(
  id: string,
  source = "hubspot",
  error = "HubSpot answered 401 after 0",
): Promise<void> {
  await openRun(db, { id, tenantId: TENANT, source, verb: "ingest", trigger: "schedule" });
  await closeRun(db, id, { status: "failed", error });
}

function caller(userId: string, address: string) {
  const ctx: Context = {
    exec: db,
    user: { userId, email: address },
    sessionId: "s1",
    superadmin: false,
    locale: DEFAULT_LOCALE,
    endSession: () => Promise.resolve(),
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () => Promise.resolve({ ok: false as const, reason: "not-configured" as const }),
    worker: null,
    googlePicker: null,
  };
  return appRouter.createCaller(ctx);
}

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.exec("INSERT INTO ops.tenant (id) VALUES ('CASE-0042')");
  await db.become("undercroft_app");
  email = new InMemoryEmailSender();
});

afterEach(async () => {
  await db.close();
});

describe("a failed run", () => {
  it("is told to every admin, in each one's language, with the reason and a way in", async () => {
    await seedAdmin("ada@example.test", "vi");
    await seedAdmin("bob@example.test", "en");
    await failedRun("r-1");

    const summary = await runAlerts(deps());

    expect(summary).toMatchObject({ failures: 1, suppressed: 0, undeliverable: 0 });
    expect(email.sent.map((m) => m.to)).toEqual(["ada@example.test", "bob@example.test"]);
    const [vi, en] = email.sent;
    expect(vi?.subject).toBe("Đồng bộ HubSpot cho CASE-0042 không thành công");
    expect(en?.subject).toBe("The HubSpot sync for CASE-0042 failed");
    expect(en?.text).toContain("HubSpot answered 401 after 0");
    expect(en?.text).toContain(`${PUBLIC_URL}/tenants/CASE-0042/journal/r-1`);
    expect(en?.text).toContain("24 hours");
  });

  it("is told once: a second tick finds nothing to send", async () => {
    await seedAdmin("ada@example.test");
    await failedRun("r-1");

    await runAlerts(deps());
    const again = await runAlerts(deps());

    expect(again.failures).toBe(0);
    expect(email.sent).toHaveLength(1);
  });

  it("a repeat within a day is held, and a success in between lets the next one through", async () => {
    await seedAdmin("ada@example.test");
    await failedRun("r-1");
    await runAlerts(deps());

    await failedRun("r-2");
    const held = await runAlerts(deps());
    expect(held).toMatchObject({ failures: 0, suppressed: 1 });
    expect(email.sent).toHaveLength(1);

    await openRun(db, {
      id: "r-ok",
      tenantId: TENANT,
      source: "hubspot",
      verb: "ingest",
      trigger: "schedule",
    });
    await closeRun(db, "r-ok", { status: "ok" });
    await failedRun("r-3");
    const news = await runAlerts(deps());
    expect(news).toMatchObject({ failures: 1, suppressed: 0 });
    expect(email.sent).toHaveLength(2);
  });

  it("a tenant with no admin is told to the platform's superadmins, in the default language", async () => {
    await failedRun("r-1");

    await runAlerts(deps({ superadmins: new Set(["root@example.test"]) }));

    expect(email.sent.map((m) => m.to)).toEqual(["root@example.test"]);
    expect(email.last?.subject).toContain("không thành công");
  });

  it("a model build that failed is named as such, in the reader's language", async () => {
    await seedAdmin("ada@example.test", "vi");
    await seedAdmin("bob@example.test", "en");
    await openRun(db, {
      id: "t-1",
      tenantId: TENANT,
      source: "*",
      verb: "transform",
      trigger: "schedule",
    });
    await closeRun(db, "t-1", { status: "failed", error: "dbt exited 1" });

    await runAlerts(deps());

    // Its own sentence in each language, not the build's name spliced into the sync's.
    const [vi, en] = email.sent;
    expect(vi?.subject).toBe("Dựng mô hình cho CASE-0042 không thành công");
    expect(en?.subject).toBe("The model build for CASE-0042 failed");
  });

  it("the language an admin chose on screen is the one their email arrives in", async () => {
    // The public seam: `session.setLocale`, which the switcher calls.
    const userId = await seedAdmin("ada@example.test", "vi");
    await caller(userId, "ada@example.test").session.setLocale({ locale: "en" });
    await failedRun("r-1");

    await runAlerts(deps());

    expect(email.last?.subject).toBe("The HubSpot sync for CASE-0042 failed");
  });
});

describe("an expiring grant", () => {
  it("is warned about a week ahead, once, and again only after it is renewed", async () => {
    await seedAdmin("bob@example.test", "en");
    await upsertConnection(db, { tenantId: TENANT, source: "xero", status: "connected" });
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await db.asSuperuser((tx) =>
      writeCredential(
        tx,
        TENANT,
        "xero",
        { accessToken: "at", refreshToken: "rt", expiresAt: null },
        { env: ENV, grantExpiresAt: soon },
      ),
    );

    expect((await runAlerts(deps())).grants).toBe(1);
    expect(email.last?.subject).toBe("CASE-0042's Xero access is about to expire");
    expect(email.last?.text).toContain(`${PUBLIC_URL}/tenants/CASE-0042`);
    expect((await runAlerts(deps())).grants).toBe(0);

    // Renewed: a successful refresh moves the grant's end out, and the warning is armed again.
    const later = new Date(Date.now() + 5 * 86_400_000).toISOString();
    await db.asSuperuser((tx) =>
      writeCredential(
        tx,
        TENANT,
        "xero",
        { accessToken: "at2", refreshToken: "rt2", expiresAt: null },
        { env: ENV, grantExpiresAt: later },
      ),
    );
    expect((await runAlerts(deps())).grants).toBe(1);
  });

  it("a grant with no known end, or one further out than a week, is not warned about", async () => {
    await seedAdmin("bob@example.test", "en");
    await upsertConnection(db, { tenantId: TENANT, source: "gmail", status: "connected" });
    await upsertConnection(db, { tenantId: TENANT, source: "xero", status: "connected" });
    const far = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await db.asSuperuser(async (tx) => {
      await writeCredential(
        tx,
        TENANT,
        "gmail",
        { accessToken: "a", refreshToken: "r", expiresAt: null },
        { env: ENV },
      );
      await writeCredential(
        tx,
        TENANT,
        "xero",
        { accessToken: "a", refreshToken: "r", expiresAt: null },
        { env: ENV, grantExpiresAt: far },
      );
    });

    expect((await runAlerts(deps())).grants).toBe(0);
    expect(email.sent).toHaveLength(0);
  });
});

describe("an expiring ingest key", () => {
  it("is warned about by its label, never its token, and only while it is live", async () => {
    await seedAdmin("bob@example.test", "en");
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await db.query(
      `INSERT INTO app.ingest_key (id, token_sha256, tenant_id, label, expires_at, revoked_at)
       VALUES ('uk_live', repeat('a', 64), $1, 'Kestra feed', $2, NULL),
              ('uk_dead', repeat('b', 64), $1, 'Old feed', $2, now())`,
      [TENANT, soon],
    );

    const summary = await runAlerts(deps());

    expect(summary.keys).toBe(1);
    expect(email.sent).toHaveLength(1);
    expect(email.last?.subject).toBe("CASE-0042's ingest key “Kestra feed” is about to expire");
    expect(email.last?.text).not.toContain("aaaa");
    expect((await runAlerts(deps())).keys).toBe(0);
  });
});
