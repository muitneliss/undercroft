/**
 * Deactivating a person platform-wide (ADR 0152), driven over real HTTP against
 * `startControlPlane()`: real Better Auth on its in-memory store, the real router, PGlite as
 * `undercroft_app`, the real `@modelcontextprotocol/client` for the OAuth app. Nothing is mocked.
 *
 * Everyone signs in the way a person does, with an emailed code read from the in-memory mailbox,
 * and a token is minted through the account page's own procedure. What is asserted is what each
 * door answers the person afterwards, what the superadmin is told, and what the trail records --
 * never a row the revocation wrote, which is the implementation of those promises.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import type { TestDatabase } from "@undercroft/db/testing";
import { type ControlPlane, startControlPlane } from "../testing.ts";

/** Named in `UNDERCROFT_SUPERADMINS`, and the one acting throughout. */
const ROOT = "root@example.test";
/** Named there too: the address a deactivation cannot reach. */
const OTHER_ROOT = "second-root@example.test";
/** The person who leaves: a member of one customer, holding a token. */
const LEAVER = "leaver@example.test";
/** An admin of the leaver's customer, and no superadmin. */
const ADMIN = "admin@example.test";
const OWN = "CASE-0042";
const LATER = "CASE-0067";
/** Where the OAuth client asks to be sent back to; nothing listens, the test reads the address. */
const CALLBACK = "http://localhost:9/callback";

let plane: ControlPlane;

async function seed(db: TestDatabase): Promise<void> {
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1), ($2)", [OWN, LATER]);
  await db.query(
    `INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
     VALUES ($1, $2, 'member', repeat('a', 64), now() + interval '7 days'),
            ($1, $3, 'admin', repeat('b', 64), now() + interval '7 days')`,
    [OWN, LEAVER, ADMIN],
  );
}

beforeEach(async () => {
  plane = await startControlPlane({ superadmins: new Set([ROOT, OTHER_ROOT]), seed });
});

afterEach(async () => {
  await plane.stop();
});

function post(path: string, body: unknown, cookie = ""): Promise<Response> {
  return Bun.fetch(`${plane.origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: plane.origin, cookie },
    body: JSON.stringify(body),
  });
}

/** Ask for a code; resolves with how many messages the mailbox holds afterwards. */
async function requestCode(email: string, extra: Record<string, string> = {}): Promise<number> {
  await post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in", ...extra });
  return plane.sender.sent.length;
}

/** The last code mailed to `email`, if one was. */
function codeFor(email: string): string | undefined {
  const mail = plane.sender.sent.findLast((message) => message.to === email);
  return /\d{6}/u.exec(mail?.text ?? "")?.[0];
}

function cookieOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
}

/** Sign in with an emailed code, as the sign-in page does; the session cookie, or `""`. */
async function signIn(email: string): Promise<string> {
  await requestCode(email);
  const signedIn = await post("/api/auth/sign-in/email-otp", { email, otp: codeFor(email) });
  return cookieOf(signedIn);
}

interface Answer {
  readonly result?: { readonly data: unknown };
  readonly error?: { readonly data: { readonly code: string; readonly details?: unknown } };
}

/** One tRPC call over HTTP: a query is a GET, a mutation a POST. */
async function call(
  path: string,
  input: unknown,
  headers: Record<string, string>,
  type: "query" | "mutation" = "query",
): Promise<Answer> {
  const url = `${plane.origin}/trpc/${path}`;
  const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response =
    type === "query"
      ? await Bun.fetch(`${url}${query}`, { headers })
      : await Bun.fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(input),
        });
  return (await response.json()) as Answer;
}

/** A personal access token, minted on the account page with the person's own session. */
async function mint(cookie: string): Promise<string> {
  const minted = await call(
    "account.tokens.mint",
    { label: "laptop", grant: "write", expiresInDays: 30 },
    { cookie },
    "mutation",
  );
  return (minted.result?.data as { token: string } | undefined)?.token ?? "none minted";
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** One JSON-RPC `tools/list` over plain HTTP, for the status a client library would hide. */
function mcpList(token: string): Promise<Response> {
  return Bun.fetch(`${plane.origin}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...bearer(token),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

function deactivate(cookie: string, email: string): Promise<Answer> {
  return call("users.deactivate", { email }, { cookie }, "mutation");
}

function reactivate(cookie: string, email: string): Promise<Answer> {
  return call("users.reactivate", { email }, { cookie }, "mutation");
}

async function refusedReasons(action: string): Promise<(string | null)[]> {
  const { rows } = await plane.db.query<{ reason: string | null }>(
    "SELECT reason FROM ops.audit_log WHERE action = $1 ORDER BY id",
    [action],
  );
  return rows.map((row) => row.reason);
}

describe("a deactivated person, at every door", () => {
  it("is nobody from their next call: cookie, /trpc token and /mcp token alike", async () => {
    const leaver = await signIn(LEAVER);
    const token = await mint(leaver);
    const root = await signIn(ROOT);
    const before = {
      cookie: (await call("session.me", undefined, { cookie: leaver })).result !== undefined,
      trpc: (await call("session.me", undefined, bearer(token))).result !== undefined,
      mcp: (await mcpList(token)).status,
    };

    const deactivated = await deactivate(root, LEAVER);

    expect({
      before,
      revoked: (deactivated.result?.data as { revoked?: unknown } | undefined)?.revoked,
      cookie: (await call("session.me", undefined, { cookie: leaver })).error?.data.code,
      trpc: (await call("session.me", undefined, bearer(token))).error?.data.code,
      mcp: (await mcpList(token)).status,
      // The cause, not its consequence: the token was revoked BECAUSE its person was deactivated.
      logged: (await refusedReasons("auth.tokenRefused")).at(-1),
    }).toEqual({
      before: { cookie: true, trpc: true, mcp: 200 },
      revoked: { tokens: 1, sessions: 1, refreshTokens: 0, consents: 0 },
      cookie: "UNAUTHORIZED",
      trpc: "UNAUTHORIZED",
      mcp: 401,
      logged: "deactivated",
    });
  });

  it("keeps their memberships, which the superadmin reads with their state", async () => {
    await signIn(LEAVER);
    const root = await signIn(ROOT);

    await deactivate(root, LEAVER);
    const listed = await call("users.list", undefined, { cookie: root });

    expect(
      (
        (listed.result?.data ?? []) as {
          email: string;
          memberships: number;
          deactivatedAt: unknown;
        }[]
      )
        .filter((person) => person.email === LEAVER)
        .map((person) => ({ ...person, deactivatedAt: typeof person.deactivatedAt })),
    ).toEqual([expect.objectContaining({ memberships: 1, deactivatedAt: "string" })]);
  });
});

/**
 * The OAuth app's storage, in memory: what a connector keeps between the leg that sends the
 * person away and the leg that comes back with a code. As in `mcpSignIn.test.ts`.
 */
class RememberingClient implements OAuthClientProvider {
  authorizationUrl: URL | null = null;
  private client: StoredOAuthClientInformation | undefined;
  private stored: StoredOAuthTokens | undefined;
  private verifier = "";
  private discovery: OAuthDiscoveryState | undefined;

  readonly redirectUrl = CALLBACK;
  readonly clientMetadata: OAuthClientProvider["clientMetadata"] = {
    client_name: "Example Agent",
    redirect_uris: [CALLBACK],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };

  clientInformation(): StoredOAuthClientInformation | undefined {
    return this.client;
  }

  saveClientInformation(client: StoredOAuthClientInformation): void {
    this.client = client;
  }

  tokens(): StoredOAuthTokens | undefined {
    return this.stored;
  }

  saveTokens(tokens: StoredOAuthTokens): void {
    this.stored = tokens;
  }

  redirectToAuthorization(url: URL): void {
    this.authorizationUrl = url;
  }

  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }

  codeVerifier(): string {
    return this.verifier;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.discovery = state;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.discovery;
  }
}

/** Where the server said a step of the authorization continues. */
async function continuation(response: Response): Promise<URL> {
  const body = (await response.json()) as { url?: string };
  return new URL(body.url ?? "", plane.origin);
}

/** The leaver lets an app in: register, sign in by code, consent to everything, exchange. */
async function connectApp(): Promise<RememberingClient> {
  const client = new RememberingClient();
  const serverUrl = new URL("/mcp", plane.origin);
  await auth(client, { serverUrl });
  const toSignIn = await Bun.fetch(client.authorizationUrl ?? serverUrl, { redirect: "manual" });
  const signedQuery = new URL(toSignIn.headers.get("location") ?? "", plane.origin).search.slice(1);
  await requestCode(LEAVER, { oauth_query: signedQuery });
  const signedIn = await post("/api/auth/sign-in/email-otp", {
    email: LEAVER,
    otp: codeFor(LEAVER),
    oauth_query: signedQuery,
  });
  const consentPage = await continuation(signedIn);
  const answered = await post(
    "/api/auth/oauth2/consent",
    {
      accept: true,
      scope: consentPage.searchParams.get("scope") ?? "",
      oauth_query: consentPage.search.slice(1),
    },
    cookieOf(signedIn),
  );
  const back = await continuation(answered);
  await auth(client, {
    serverUrl,
    authorizationCode: back.searchParams.get("code") ?? "",
    iss: back.searchParams.get("iss") ?? "",
  });
  return client;
}

/**
 * The refresh grant a connector makes once its access token lapses: the status it gets. A token
 * it is given is kept, as a connector keeps it -- the grant rotates the refresh token, and the
 * one it replaced is answered from Better Auth's replay window, which would test nothing.
 */
async function refresh(client: RememberingClient): Promise<number> {
  const metadata = await Bun.fetch(`${plane.origin}/.well-known/oauth-authorization-server`);
  const { token_endpoint: endpoint } = (await metadata.json()) as { token_endpoint: string };
  const response = await Bun.fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: client.tokens()?.refresh_token ?? "",
      client_id: client.clientInformation()?.client_id ?? "",
      resource: `${plane.origin}/mcp`,
    }),
  });
  if (response.ok) {
    client.saveTokens((await response.json()) as StoredOAuthTokens);
  }
  return response.status;
}

describe("an app the person let in over OAuth", () => {
  it("can mint nothing more and is refused at /mcp once its person is deactivated", async () => {
    const app = await connectApp();
    const root = await signIn(ROOT);
    // The quiet side, in the same run: the grant works while the person stands.
    const refreshedBefore = await refresh(app);

    const deactivated = await deactivate(root, LEAVER);

    expect({
      refreshedBefore,
      revoked: (deactivated.result?.data as { revoked?: unknown } | undefined)?.revoked,
      refusedAfter: (await refresh(app)) >= 400,
      mcp: (await mcpList(app.tokens()?.access_token ?? "")).status,
    }).toEqual({
      refreshedBefore: 200,
      revoked: expect.objectContaining({ refreshTokens: expect.any(Number), consents: 1 }),
      refusedAfter: true,
      mcp: 401,
    });
  });
});

describe("signing in again", () => {
  it("is refused to a deactivated address even holding a live invitation, and says why", async () => {
    await signIn(LEAVER);
    const root = await signIn(ROOT);
    await deactivate(root, LEAVER);
    await plane.db.query(
      `INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
       VALUES ($1, $2, 'viewer', repeat('c', 64), now() + interval '7 days')`,
      [LATER, LEAVER],
    );
    const mailed = plane.sender.sent.length;

    expect({
      mailed: (await requestCode(LEAVER)) - mailed,
      recorded: await refusedReasons("auth.refused"),
    }).toEqual({ mailed: 0, recorded: ["DEACTIVATED"] });
  });

  it("works once reactivated, with the membership back and the old token still dead", async () => {
    const leaver = await signIn(LEAVER);
    const token = await mint(leaver);
    const root = await signIn(ROOT);
    await deactivate(root, LEAVER);

    const reactivated = await reactivate(root, LEAVER);
    const again = await signIn(LEAVER);
    const customers = await call("tenants.list", undefined, { cookie: again });

    expect({
      reactivated: reactivated.result !== undefined,
      customers: (customers.result?.data as { id: string }[] | undefined)?.map((c) => c.id),
      oldToken: (await call("session.me", undefined, bearer(token))).error?.data.code,
    }).toEqual({ reactivated: true, customers: [OWN], oldToken: "UNAUTHORIZED" });
  });
});

describe("who may deactivate whom", () => {
  it("is not a customer's admin, whatever they hold in the customer", async () => {
    const leaver = await signIn(LEAVER);
    const admin = await signIn(ADMIN);

    const refused = await deactivate(admin, LEAVER);

    expect({
      code: refused.error?.data.code,
      leaverStillIn: (await call("session.me", undefined, { cookie: leaver })).result !== undefined,
    }).toEqual({ code: "FORBIDDEN", leaverStillIn: true });
  });

  it("refuses the superadmin's own address, and an address the deployment names", async () => {
    const root = await signIn(ROOT);

    const self = await deactivate(root, ROOT);
    const named = await deactivate(root, OTHER_ROOT);

    expect([self.error?.data, named.error?.data]).toEqual([
      expect.objectContaining({
        code: "PRECONDITION_FAILED",
        details: { reason: "CANNOT_DEACTIVATE_SELF", email: ROOT },
      }),
      expect.objectContaining({
        code: "PRECONDITION_FAILED",
        details: { reason: "SUPERADMIN_BY_ENVIRONMENT", email: OTHER_ROOT },
      }),
    ]);
  });

  it("refuses a transition to the state the person is already in, in both directions", async () => {
    await signIn(LEAVER);
    const root = await signIn(ROOT);
    const notDeactivated = await reactivate(root, LEAVER);
    await deactivate(root, LEAVER);

    const twice = await deactivate(root, LEAVER);

    expect([notDeactivated.error?.data, twice.error?.data]).toEqual([
      expect.objectContaining({
        code: "PRECONDITION_FAILED",
        details: { reason: "USER_ACTIVE", email: LEAVER },
      }),
      expect.objectContaining({
        code: "PRECONDITION_FAILED",
        details: { reason: "USER_DEACTIVATED", email: LEAVER },
      }),
    ]);
  });
});
