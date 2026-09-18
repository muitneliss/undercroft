/**
 * Sign-in, driven end to end over a real socket.
 *
 * `invite.test.ts` proves the gate DECIDES correctly. This proves the whole ring: that
 * Better Auth actually consults the gate, that a code becomes a signed cookie, that the
 * cookie resolves to the `app_user` uuid the platform keys everything by, and that signing
 * out stops it working. A gate that is right and never invoked is an open control plane.
 *
 * **Why a real `Bun.serve` rather than `app.fetch`.** Calling the Hono app in-process does
 * not surface `Set-Cookie` on the returned `Response` -- for a stock Better Auth password
 * sign-in too, not just ours -- so an in-process test cannot see the cookie at all and would
 * quietly assert nothing about it. Over a loopback socket the header is there. This still
 * costs the offline gate nothing: no Docker, no egress, no credentials.
 *
 * Nothing is mocked. Better Auth runs against `memoryAdapter`, the vendor's own in-process
 * adapter -- the same category of seam as PGlite and `InMemoryFetcher` -- while
 * `app.app_user`, `app.invitation` and `app.tenant_member` live in real Postgres via PGlite.
 */

// biome-ignore-all lint/style/noMagicNumbers: In a test the number IS the assertion. `expect(delayMs).toBe(5000)` says what the code must do; `expect(delayMs).toBe(EXPECTED_BACKOFF_MS)` says only that two names agree, and it can pass while both are wrong. Naming a fixture value also puts the expected result somewhere other than the line asserting it, which is the opposite of what .claude/rules/tests.md asks for. Source files get named constants; test files keep their literals.

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

// biome-ignore-all lint/correctness/useQwikValidLexicalScope: Qwik-domain rule about what may cross a `$()` serialization boundary. There is no Qwik in this repo.
// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test as it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { InMemoryEmailSender } from "@undercroft/core";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuth } from "./auth.ts";
import { createServer } from "./server.ts";

/**
 * Give this file back the real `Response` and `fetch`.
 *
 * `bunfig.toml` preloads happy-dom for every test so the UI has a document, and its
 * registrator replaces the global `Response` class and `fetch`. `Bun.serve` refuses a
 * happy-dom `Response` ("Expected a Response object"), and happy-dom's `fetch` cannot parse
 * a real HTTP response ("Duplicate Content-Length") -- so a real server cannot be spoken to
 * while it is installed. Unregistered here and put back afterwards, so no other file is
 * affected.
 */
beforeAll(async () => {
  await GlobalRegistrator.unregister();
});

afterAll(() => {
  GlobalRegistrator.register();
});

let db: TestDatabase;
let sender: InMemoryEmailSender;
let server: ReturnType<typeof Bun.serve>;
let origin: string;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  sender = new InMemoryEmailSender();

  // Port 0 for an ephemeral port, so tests never collide with a running dev server. The
  // handler is reached through a mutable reference because Better Auth needs its `baseUrl`
  // -- which is also its only trusted origin -- and that is not known until the socket is
  // bound.
  let handler: (request: Request) => Response | Promise<Response> = () => new Response(null);
  server = Bun.serve({
    port: 0,
    fetch: (request): Response | Promise<Response> => handler(request),
  });
  origin = server.url.origin;

  const auth = createAuth({
    // The keys are the physical table names from `060_auth.sql`, because that is what the
    // `modelName` mapping resolves to. The adapter refuses a model it has no table for,
    // which is itself a small proof that the mapping is wired.
    database: memoryAdapter({
      auth_user: [],
      auth_session: [],
      auth_account: [],
      auth_verification: [],
    }),
    exec: db,
    // PGlite is one connection and these tests are sequential, so a transaction adds no
    // isolation here. Real atomicity is `withTransaction` in production; the concurrent
    // case is integration-tier, the same footnote the repo carries for `FOR UPDATE`.
    transactor: (fn) => fn(db),
    secret: "a-test-secret-that-is-long-enough-to-sign",
    baseUrl: origin,
    email: sender,
  });

  handler = createServer({ exec: db, auth }).fetch;
});

afterEach(async () => {
  // Awaited, and closing existing connections: an unawaited stop leaves the socket bound
  // into the next test, which then talks to the previous test's database.
  await server.stop(true);
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

/** `Bun.fetch` rather than the global, so this cannot regress if the preload changes. */
function post(path: string, body: unknown, cookie = ""): Promise<Response> {
  return Bun.fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(cookie === "" ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

async function requestCode(email: string): Promise<Response> {
  return await post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
}

/** The six-digit code out of the one email we sent, or null if we sent none. */
function codeFromEmail(): string | null {
  const text = sender.last?.text;
  return text === undefined ? null : (/\d{6}/u.exec(text)?.[0] ?? null);
}

/** Sign in and return the cookie header a browser would send back. */
async function signInWithCode(email: string): Promise<string> {
  const response = await post("/api/auth/sign-in/email-otp", { email, otp: codeFromEmail() });
  expect(response.status).toBe(200);
  return response.headers.getSetCookie().join("; ");
}

async function sessionMe(cookie: string): Promise<Response> {
  return await Bun.fetch(`${origin}/trpc/session.me`, { headers: { cookie } });
}

describe("a one-time code is only ever posted to an address that could use it", () => {
  it("an uninvited address is told nothing and mailed nothing", async () => {
    const response = await requestCode("stranger@example.test");

    // Not an error: answering honestly would make this form an oracle for which addresses
    // have access. The refusal is that no code exists and no mail was sent.
    expect(response.status).toBe(200);
    expect(sender.sent).toHaveLength(0);
  });

  it("a refused address is recorded, so an operator can see who was turned away", async () => {
    // The person on the other side sees only "No access". Without this row nobody can tell a
    // typo from a broken gate -- which is what happened on the first production sign-in, and
    // cost a round of guessing that one query against this table answers.
    await requestCode("stranger@example.test");

    const { rows } = await db.query<{ actor: string; action: string }>(
      "SELECT actor, action FROM ops.audit_log WHERE action = 'auth.refused'",
    );
    expect(rows).toEqual([{ actor: "stranger@example.test", action: "auth.refused" }]);
  });

  it("an admitted address leaves no refusal behind", async () => {
    // The quiet side. A trail that recorded every attempt would bury the refusals it exists
    // to surface.
    await seedInvitation("CASE-0042", "operator@example.test", "admin");

    await requestCode("operator@example.test");

    const { rows } = await db.query("SELECT 1 FROM ops.audit_log WHERE action = 'auth.refused'");
    expect(rows).toHaveLength(0);
  });

  it("an invited address is mailed exactly one code", async () => {
    await seedInvitation("CASE-0042", "operator@example.test", "admin");

    await requestCode("operator@example.test");

    expect(sender.sent).toHaveLength(1);
    expect(sender.last?.to).toBe("operator@example.test");
    expect(codeFromEmail()).toMatch(/^\d{6}$/u);
  });
});

describe("signing in with a code lands on the platform's own user identity", () => {
  it("the code becomes a session cookie that resolves to the app_user uuid", async () => {
    await seedInvitation("CASE-0042", "operator@example.test", "admin");
    await requestCode("operator@example.test");

    const cookie = await signInWithCode("operator@example.test");
    expect(cookie).toContain("session_token");

    // The whole bridge in one assertion: cookie -> Better Auth -> verified email ->
    // app.app_user. `session.me` must return OUR uuid, because that is what
    // app.tenant_member is keyed by; returning Better Auth's own id would break every
    // tenant-scoped procedure in a way no type would catch.
    const me = await sessionMe(cookie);
    expect(me.status).toBe(200);
    const body = (await me.json()) as { result: { data: { userId: string; email: string } } };

    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM app.app_user WHERE email = $1",
      ["operator@example.test"],
    );
    expect(body.result.data.userId).toBe(rows[0]?.id ?? "no-app-user-row");
    expect(body.result.data.email).toBe("operator@example.test");
  });

  it("an uninvited address cannot sign in even with a code in hand", async () => {
    // The firing case for the whole feature: a code obtained for an invited address, then
    // offered for an uninvited one. No user may be provisioned.
    await seedInvitation("CASE-0042", "operator@example.test", "admin");
    await requestCode("operator@example.test");

    const signIn = await post("/api/auth/sign-in/email-otp", {
      email: "stranger@example.test",
      otp: codeFromEmail(),
    });

    expect(signIn.status).not.toBe(200);
    const { rows } = await db.query("SELECT id FROM app.app_user WHERE email = $1", [
      "stranger@example.test",
    ]);
    expect(rows).toHaveLength(0);
  });

  it("the invitation is redeemed into the membership it promised", async () => {
    await seedInvitation("CASE-0042", "operator@example.test", "admin");
    await requestCode("operator@example.test");

    await signInWithCode("operator@example.test");

    const { rows } = await db.query<{ tenant_id: string; role: string }>(
      `SELECT m.tenant_id, m.role FROM app.tenant_member m
       JOIN app.app_user u ON u.id = m.user_id WHERE u.email = $1`,
      ["operator@example.test"],
    );
    expect(rows).toEqual([{ tenant_id: "CASE-0042", role: "admin" }]);
  });
});

describe("a session can be withdrawn before it expires", () => {
  it("signing out stops the very same cookie from working", async () => {
    // The guarantee `trpc.ts` is built around, actually exercised rather than asserted in a
    // docstring. The session row is deleted, so the next request cannot be authenticated by
    // a row that no longer exists -- no cache, no grace window.
    await seedInvitation("CASE-0042", "operator@example.test", "admin");
    await requestCode("operator@example.test");
    const cookie = await signInWithCode("operator@example.test");
    expect((await sessionMe(cookie)).status).toBe(200);

    const signOut = await post("/trpc/session.signOut", {}, cookie);
    expect(signOut.status).toBe(200);

    const after = await sessionMe(cookie);
    const body = (await after.json()) as { error?: { data?: { code?: string } } };
    expect(body.error?.data?.code).toBe("UNAUTHORIZED");
  });
});

describe("the session and the SPA do not fight over a route", () => {
  it("an auth path is handled by the auth handler, never by the app shell", async () => {
    // The catch-all answers any GET with index.html, so an auth route registered after it
    // would turn Google's redirect into a 200 serving the shell -- a sign-in that silently
    // never completes. Asserting "not HTML" is the durable form of that.
    const response = await Bun.fetch(`${origin}/api/auth/get-session`);

    expect(response.headers.get("content-type") ?? "").not.toContain("text/html");
  });
});
