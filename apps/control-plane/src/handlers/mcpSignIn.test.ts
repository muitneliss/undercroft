/**
 * `/mcp` for a client that signs its person in rather than holding a token (ADR 0061): the real
 * `@modelcontextprotocol/client` -- its own OAuth code, discovery, registration, PKCE and all --
 * against `startControlPlane()` over real HTTP. The person's side is what their browser does on
 * `/sign-in` and `/consent`: ask for a code, read it from the in-memory mailbox, sign in with it
 * carrying the signed query the authorize step put in the URL, and answer the consent. Nothing
 * is mocked.
 *
 * What is asserted is what a client and a person see: the discovery documents, the tools a
 * consent to read leaves the client, and that revoking the app on the account page shuts the
 * client out at its next call -- with the `mcp_refused` line that says so to an operator.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import {
  auth,
  Client,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createLogger } from "@undercroft/core";
import { currentTraceId } from "@undercroft/telemetry";
import { type ControlPlane, startControlPlane } from "../testing.ts";

const OPERATOR = "operator@example.test";
const TENANT = "CASE-0042";
/** Where the client asks to be sent back to; nothing listens, the test reads the address. */
const CALLBACK = "http://localhost:9/callback";

let plane: ControlPlane;
/** Every line the server logged, as the process's own logger writes it, trace id included. */
let logged: Record<string, unknown>[] = [];

beforeEach(async () => {
  logged = [];
  plane = await startControlPlane({
    log: createLogger({
      component: "control-plane",
      sink: (line) => logged.push(JSON.parse(line) as Record<string, unknown>),
      context: () => ({ traceId: currentTraceId() }),
    }),
    seed: async (db) => {
      await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
      await db.query(
        `INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
         VALUES ($1, $2, 'admin', repeat('a', 64), now() + interval '7 days')`,
        [TENANT, OPERATOR],
      );
    },
  });
});

afterEach(async () => {
  await plane.stop();
});

/**
 * The client's own storage, in memory: what a connector keeps between the leg that sends the
 * person away and the leg that comes back with a code. It stores; it decides nothing.
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

  accessToken(): string {
    return this.stored?.access_token ?? "";
  }
}

function post(path: string, body: unknown, cookie = ""): Promise<Response> {
  return Bun.fetch(`${plane.origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: plane.origin, cookie },
    body: JSON.stringify(body),
  });
}

/** Where the server said a step of the authorization continues. */
async function continuation(response: Response): Promise<URL> {
  const body = (await response.json()) as { url?: string };
  return new URL(body.url ?? "", plane.origin);
}

/**
 * The person's side of one authorization: sent to `/sign-in` by the authorize step, sign in
 * with the emailed code, land on `/consent`, and agree to `keep` of the scopes asked for.
 * Resolves with the session cookie and the address the client is sent back to.
 */
async function signInAndConsent(
  authorizationUrl: URL,
  keep: (scope: string) => boolean,
): Promise<{ cookie: string; back: URL }> {
  const toSignIn = await Bun.fetch(authorizationUrl, { redirect: "manual" });
  const signInPage = new URL(toSignIn.headers.get("location") ?? "", plane.origin);
  const signedQuery = signInPage.search.slice(1);

  await post("/api/auth/email-otp/send-verification-otp", {
    email: OPERATOR,
    type: "sign-in",
    oauth_query: signedQuery,
  });
  const otp = /\d{6}/u.exec(plane.sender.last?.text ?? "")?.[0];
  const signedIn = await post("/api/auth/sign-in/email-otp", {
    email: OPERATOR,
    otp,
    oauth_query: signedQuery,
  });
  const cookie = signedIn.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  const consentPage = await continuation(signedIn);

  const asked = (consentPage.searchParams.get("scope") ?? "").split(" ");
  const answered = await post(
    "/api/auth/oauth2/consent",
    { accept: true, scope: asked.filter(keep).join(" "), oauth_query: consentPage.search.slice(1) },
    cookie,
  );
  return { cookie, back: await continuation(answered) };
}

/** Register, send the person through sign-in and consent, and exchange the code. */
async function authorize(
  keep: (scope: string) => boolean,
): Promise<{ client: RememberingClient; cookie: string }> {
  const client = new RememberingClient();
  const serverUrl = new URL("/mcp", plane.origin);
  await auth(client, { serverUrl });
  const { cookie, back } = await signInAndConsent(client.authorizationUrl ?? serverUrl, keep);
  await auth(client, {
    serverUrl,
    authorizationCode: back.searchParams.get("code") ?? "",
    iss: back.searchParams.get("iss") ?? "",
  });
  return { client, cookie };
}

/** "Revoke" on the account page, for the one app this person has let in. */
async function revokeTheApp(cookie: string): Promise<{ id: string; grant: string } | undefined> {
  const apps = await Bun.fetch(`${plane.origin}/trpc/account.apps.list`, { headers: { cookie } });
  const [app] = ((await apps.json()) as { result: { data: { id: string; grant: string }[] } })
    .result.data;
  await post("/trpc/account.apps.revoke", { id: app?.id }, cookie);
  return app;
}

/** One JSON-RPC `tools/list` over plain HTTP, for what a client library would hide: the status. */
function rawList(token: string): Promise<Response> {
  return Bun.fetch(`${plane.origin}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

describe("what a client finds before it has a token", () => {
  it("names this resource, this server, its scopes, registration and S256", async () => {
    const resource = await Bun.fetch(`${plane.origin}/.well-known/oauth-protected-resource/mcp`);
    const server = await Bun.fetch(`${plane.origin}/.well-known/oauth-authorization-server`);
    const prm = (await resource.json()) as Record<string, unknown>;
    const as = (await server.json()) as Record<string, unknown>;

    expect({
      resource: prm.resource,
      servers: prm.authorization_servers,
      scopes: prm.scopes_supported,
      registration: as.registration_endpoint,
      pkce: as.code_challenge_methods_supported,
    }).toEqual({
      resource: `${plane.origin}/mcp`,
      servers: [plane.origin],
      scopes: ["undercroft:read", "undercroft:write"],
      registration: `${plane.origin}/api/auth/oauth2/register`,
      pkce: ["S256"],
    });
  });
});

describe("a client signed in through OAuth", () => {
  it("holds what the person consented to, and is shut out once they revoke it", async () => {
    // Asked for read and write; the person keeps read.
    const { client, cookie } = await authorize((scope) => scope !== "undercroft:write");
    const mcp = new Client({ name: "mcpSignIn.test", version: "0" });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", plane.origin), { authProvider: client }),
    );
    const { tools } = await mcp.listTools();
    await mcp.close();

    const app = await revokeTheApp(cookie);

    expect({
      writes: tools.filter((tool) => tool.annotations?.readOnlyHint !== true).length,
      reads: tools.length > 0,
      grant: app?.grant,
      afterRevoke: (await rawList(client.accessToken())).status,
    }).toEqual({ writes: 0, reads: true, grant: "read", afterRevoke: 401 });
  });

  it("is refused, naming the scope, when the person granted it neither of ours", async () => {
    const { client } = await authorize((scope) => scope === "offline_access");
    const response = await rawList(client.accessToken());

    expect({
      status: response.status,
      challenge: response.headers.get("www-authenticate"),
    }).toEqual({
      status: 403,
      challenge: expect.stringContaining('error="insufficient_scope"'),
    });
  });

  it("once revoked, is logged as revoked, naming the app and never its token", async () => {
    const { client, cookie } = await authorize((scope) => scope !== "undercroft:write");
    await revokeTheApp(cookie);
    const response = await rawList(client.accessToken());

    expect(logged.filter((line) => line.event === "mcp_refused")).toEqual([
      {
        at: expect.any(String),
        level: "warn",
        component: "control-plane",
        event: "mcp_refused",
        traceId: response.headers.get("x-trace-id"),
        status: 401,
        refusal: "invalid_token",
        reason: "revoked",
        credential: `oauth:${client.clientInformation()?.client_id}`,
      },
    ]);
  });
});
