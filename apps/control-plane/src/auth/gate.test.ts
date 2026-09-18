/**
 * Sign-in, driven end to end through the real handler.
 *
 * `invite.test.ts` proves the gate DECIDES correctly. This proves it is actually CONSULTED:
 * that Better Auth calls `validateUserInfo` and `sendVerificationOTP`, that a code mints a
 * session, and that the session resolves to the `app_user` uuid the rest of the platform
 * keys everything by. A gate that is right and never invoked is an open control plane.
 *
 * Nothing is mocked. Better Auth runs for real against `memoryAdapter` -- the vendor's own
 * in-process adapter, the same category of seam as PGlite and `InMemoryFetcher` -- while
 * `app.app_user`, `app.invitation` and `app.tenant_member` live in real Postgres via PGlite.
 * That combination is what makes this runnable in the offline gate: no Docker, no network,
 * no credentials.
 *
 * What is deliberately NOT asserted here: the `Set-Cookie` on a successful sign-in, and
 * therefore the cookie-to-`session.me` round trip. Invoking `auth.handler` directly in this
 * harness returns the session token in the body but no cookie header -- for a stock
 * password sign-in too, not just ours -- so asserting on it would be pinning Better Auth's
 * own cookie mechanics, which `tests.md` says not to do, on behaviour this harness does not
 * reproduce faithfully. The browser round trip is verified against a real deployment.
 * `resolveCaller`'s email-to-`app_user` half is covered directly in `invite.test.ts`.
 */

import { InMemoryEmailSender } from "@undercroft/core";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { createServer } from "../server.ts";
import { createAuth } from "./auth.ts";

const ORIGIN = "http://localhost";

let db: TestDatabase;
let sender: InMemoryEmailSender;
let app: Hono;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  sender = new InMemoryEmailSender();

  const auth = createAuth({
    // The keys are the physical table names from `060_auth.sql`, because that is what the
    // `modelName` mapping resolves to. The memory adapter refuses a model it was not given
    // a table for -- which is itself a small proof that the mapping is wired.
    database: memoryAdapter({
      auth_user: [],
      auth_session: [],
      auth_account: [],
      auth_verification: [],
    }),
    exec: db,
    // PGlite is a single connection and these tests are sequential, so the transaction
    // adds no isolation here. Real atomicity is `withTransaction` in production; the
    // concurrent case is integration-tier, the same footnote the repo carries for
    // `SELECT ... FOR UPDATE`.
    transactor: (fn) => fn(db),
    secret: "a-test-secret-that-is-long-enough-to-sign",
    baseUrl: ORIGIN,
    email: sender,
  });

  app = createServer({ exec: db, auth });
});

afterEach(async () => {
  await db.close();
});

async function seedInvitation(tenantId: string, email: string, role: string): Promise<void> {
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1) ON CONFLICT DO NOTHING", [tenantId]);
  await db.query(
    `INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
     VALUES ($1, $2, $3, repeat('a', 64), now() + interval '7 days')`,
    [tenantId, email, role],
  );
}

async function post(path: string, body: unknown): Promise<Response> {
  return await app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
    }),
  );
}

async function requestCode(email: string): Promise<Response> {
  return await post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
}

/** The six-digit code out of the one email we sent, or null if we sent none. */
function codeFromEmail(): string | null {
  const text = sender.last?.text;
  return text === undefined ? null : (/\d{6}/.exec(text)?.[0] ?? null);
}

describe("a one-time code is only ever posted to an address that could use it", () => {
  test("an uninvited address is told nothing and mailed nothing", async () => {
    const response = await requestCode("stranger@example.test");

    // Not an error: answering honestly would make this form an oracle for which addresses
    // have access. The refusal is that no code exists and no mail was sent.
    expect(response.status).toBe(200);
    expect(sender.sent).toHaveLength(0);
  });

  test("an invited address is mailed exactly one code", async () => {
    await seedInvitation("CASE-0042", "operator@example.test", "admin");

    await requestCode("operator@example.test");

    expect(sender.sent).toHaveLength(1);
    expect(sender.last?.to).toBe("operator@example.test");
    expect(codeFromEmail()).toMatch(/^\d{6}$/);
  });
});

describe("signing in with a code lands on the platform's own user identity", () => {
  test("a valid code is accepted and provisions the platform's user", async () => {
    await seedInvitation("CASE-0042", "operator@example.test", "admin");
    await requestCode("operator@example.test");
    const otp = codeFromEmail();
    expect(otp).not.toBeNull();

    const signIn = await post("/api/auth/sign-in/email-otp", {
      email: "operator@example.test",
      otp,
    });

    expect(signIn.status).toBe(200);
    // The bridge: a sign-in must leave behind an `app.app_user` row, because that uuid --
    // not Better Auth's own id -- is what `app.tenant_member` is keyed by and what every
    // tenant-scoped procedure resolves a role against.
    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM app.app_user WHERE email = $1",
      ["operator@example.test"],
    );
    expect(rows).toHaveLength(1);
  });

  test("an uninvited address cannot sign in even with a code in hand", async () => {
    // The firing case for the whole feature. The code is obtained for an invited address,
    // then offered for an uninvited one -- the shape of an attacker reusing what they can
    // see. No user may be provisioned.
    await seedInvitation("CASE-0042", "operator@example.test", "admin");
    await requestCode("operator@example.test");
    const otp = codeFromEmail();

    const signIn = await post("/api/auth/sign-in/email-otp", {
      email: "stranger@example.test",
      otp,
    });

    expect(signIn.status).not.toBe(200);
    const { rows } = await db.query("SELECT id FROM app.app_user WHERE email = $1", [
      "stranger@example.test",
    ]);
    expect(rows).toHaveLength(0);
  });

  test("the invitation is redeemed into the membership it promised", async () => {
    await seedInvitation("CASE-0042", "operator@example.test", "admin");
    await requestCode("operator@example.test");

    await post("/api/auth/sign-in/email-otp", {
      email: "operator@example.test",
      otp: codeFromEmail(),
    });

    const { rows } = await db.query<{ tenant_id: string; role: string }>(
      `SELECT m.tenant_id, m.role FROM app.tenant_member m
       JOIN app.app_user u ON u.id = m.user_id WHERE u.email = $1`,
      ["operator@example.test"],
    );
    expect(rows).toEqual([{ tenant_id: "CASE-0042", role: "admin" }]);
  });
});

describe("the session and the SPA do not fight over a route", () => {
  test("an auth path is handled by the auth handler, never by the app shell", async () => {
    // The catch-all answers any GET with index.html, so an auth route registered after it
    // would turn Google's redirect into a 200 serving the shell -- a sign-in that silently
    // never completes. Asserting "not HTML" is the durable form of that.
    const response = await app.fetch(new Request(`${ORIGIN}/api/auth/get-session`));

    expect(response.headers.get("content-type") ?? "").not.toContain("text/html");
  });
});
