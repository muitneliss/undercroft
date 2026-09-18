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

// biome-ignore-all lint/correctness/noUndeclaredVariables: Globals the runtime supplies that Biome's resolver does not model -- Bun's own `Bun`, and DOM globals in .tsx files. tsc resolves all of them, and tsc is the check that binds here.
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/nursery/useExplicitType: The 50 sites whose type the compiler could print are annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type is supplied contextually and writing it out means naming a library-internal type that will drift on the next upgrade.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and not done here: hoisting these 45 literals is a real change to 22 files and belongs in its own commit where the diff is reviewable, not buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useDestructuring: Style preference with no correctness content, and it fires where the current form names the source of the value (`params.tenantId`), which is the thing worth seeing at the call site.
// biome-ignore-all lint/suspicious/noMisplacedAssertion: Assertions inside a helper that several tests call, which is how the repeated part of a check is named once.
// biome-ignore-all lint/suspicious/noUnnecessaryConditions: Checks the inference engine believes are redundant which guard values arriving from outside the type system: a parsed payload, an environment variable, a row from a query. A check the compiler thinks is unnecessary is the one that catches the payload that lied.

// biome-ignore-all lint/style/noMagicNumbers: In a test the number IS the assertion. `expect(delayMs).toBe(5000)` says what the code must do; `expect(delayMs).toBe(EXPECTED_BACKOFF_MS)` says only that two names agree, and it can pass while both are wrong. Naming a fixture value also puts the expected result somewhere other than the line asserting it, which is the opposite of what .claude/rules/tests.md asks for. Source files get named constants; test files keep their literals.

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

// biome-ignore-all lint/correctness/useQwikValidLexicalScope: Qwik-domain rule about what may cross a `$()` serialization boundary. There is no Qwik in this repo.
// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.
// biome-ignore-all lint/style/noExcessiveLinesPerFile: What this file is long with is one harness -- a loopback `Bun.serve`, Better Auth on its memory adapter, PGlite, and the happy-dom dance that lets a real socket be spoken to at all. Every test here needs a genuine session cookie, and that is the only way to get one. Splitting it would clone the harness rather than divide the subject, and two copies of a fixture this delicate is how the copies stop agreeing.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test as it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { InMemoryEmailSender } from "@undercroft/core";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { memoryAdapter } from "better-auth/adapters/memory";
import { startConsent } from "../services/oauth.ts";
import { InMemoryWorkerClient } from "../services/workerClient.ts";
import { createAuth } from "./auth.ts";
import { createServer } from "./server.ts";

/**
 * Named in `UNDERCROFT_SUPERADMINS`, and a member of nothing.
 *
 * Both halves matter. The list is what lets this address sign in with no invitation, and the
 * absent `tenant_member` row is what ADR 0013 provisions -- so this fixture is the platform
 * administrator of a fresh deployment, exactly as one really exists.
 */
const SUPERADMIN = "root@example.test";
const SUPERADMINS: ReadonlySet<string> = new Set([SUPERADMIN]);

const TOKEN_URL = "https://oauth2.googleapis.test/token";
const ID_TOKEN = `header.${Buffer.from(
  JSON.stringify({ sub: "108134092834092834", email: "ops@acme.test" }),
).toString("base64url")}.signature`;

interface IngestClient {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly publicUrl: string;
  readonly tokenUrl: string;
  readonly fetch: (url: string) => Promise<Response>;
}

/**
 * The ingestion Google client, pointed at a token endpoint inside this process.
 *
 * `fetch` is a real function that answers one known URL and rejects every other, so a request
 * this fixture did not model fails loudly instead of returning something plausible.
 */
function ingestClientFor(publicUrl: string): IngestClient {
  return {
    clientId: "ingest.apps.googleusercontent.test",
    clientSecret: "ingest-secret",
    publicUrl,
    tokenUrl: TOKEN_URL,
    fetch: (url: string): Promise<Response> => {
      if (url !== TOKEN_URL) {
        return Promise.reject(new Error(`unexpected fetch to ${url}`));
      }
      return Promise.resolve(
        Response.json({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3599,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
          id_token: ID_TOKEN,
        }),
      );
    },
  };
}

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
let worker: InMemoryWorkerClient;
/** The ingestion client, pointed at a token endpoint that never leaves this process. */
let googleIngest: IngestClient;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  sender = new InMemoryEmailSender();
  worker = new InMemoryWorkerClient().backedBy(db);

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
    // The same list the server below is given. Three gates read one list in production and
    // must not be able to disagree; handing them two lists here would hide that.
    superadmins: SUPERADMINS,
  });

  googleIngest = ingestClientFor(origin);

  handler = createServer({
    exec: db,
    auth,
    superadmins: SUPERADMINS,
    googleIngest,
    worker,
  }).fetch;
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

describe("a platform administrator can finish what the platform lets them start", () => {
  /** The `app_user` uuid behind a signed-in address. */
  async function appUserId(email: string): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM app.app_user WHERE email = $1",
      [email],
    );
    return rows[0]?.id ?? "";
  }

  /** Start a real consent and return the `state` Google would hand back. */
  async function beginConsent(startedBy: string): Promise<string> {
    const started = await startConsent(
      { exec: db, google: googleIngest },
      { tenantId: "CASE-0042", source: "gmail", startedBy },
    );
    if (!started.ok) {
      throw new Error("expected the consent to start");
    }
    return new URL(started.authorizeUrl).searchParams.get("state") ?? "";
  }

  function callback(state: string, cookie: string): Promise<Response> {
    return Bun.fetch(`${origin}/oauth/google/callback?state=${state}&code=auth-code`, {
      headers: { cookie },
      redirect: "manual",
    });
  }

  it("a superadmin who is a member of nothing completes the Google callback", async () => {
    // Through the REAL server, which is the only place the bug this pins ever lived. The
    // route's admin check was wired to a `tenant_member` lookup while the button that starts
    // the flow asked `authorityIn`, so a platform administrator -- who by design has no such
    // row -- was sent to Google, granted access, and refused on the way back every time. The
    // unit test beside this one injects the policy and so could never have seen it.
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-0042') ON CONFLICT DO NOTHING");
    await requestCode(SUPERADMIN);
    const cookie = await signInWithCode(SUPERADMIN);

    const response = await callback(await beginConsent(await appUserId(SUPERADMIN)), cookie);

    expect(response.headers.get("location")).toBe("/tenants/CASE-0042/connect/gmail/scope");
  });

  it("an ordinary member of the same tenant is still refused", async () => {
    // The quiet half. Platform authority is what admitted the caller above, not the mere
    // fact of holding a session -- without this, code that stopped checking would pass.
    await seedInvitation("CASE-0042", "operator@example.test", "member");
    await requestCode("operator@example.test");
    const cookie = await signInWithCode("operator@example.test");

    const response = await callback(
      await beginConsent(await appUserId("operator@example.test")),
      cookie,
    );

    expect(response.headers.get("location")).toContain("reason=not-admin");
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
