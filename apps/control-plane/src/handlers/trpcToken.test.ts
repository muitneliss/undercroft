/**
 * `/trpc` for a caller holding a personal access token rather than a session (ADR 0134): the
 * CLI signed in unattended. Real HTTP against `startControlPlane()` -- real Better Auth, the real
 * router, PGlite as `undercroft_app`, the in-memory worker. Nothing is mocked.
 *
 * Tokens are minted the way a person mints them, through `/trpc/account.tokens.mint` with the
 * session cookie of a signed-in browser. What is asserted is what a caller gets back: the answer,
 * or the refusal's code and facts -- and, for a write, whether the worker was asked to do it.
 * The grant guard itself, and what each effect admits, are `mcp.test.ts`'s; this proves `/trpc`
 * reaches the same guard and the same revocation, and lends a failed bearer nothing.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import type { TestDatabase } from "@undercroft/db/testing";
import { type ControlPlane, startControlPlane } from "../testing.ts";

const OPERATOR = "operator@example.test";
const OWN = "CASE-0042";

let plane: ControlPlane;
let cookie = "";

async function seed(db: TestDatabase): Promise<void> {
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [OWN]);
  await db.query(
    `INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
     VALUES ($1, $2, 'admin', repeat('a', 64), now() + interval '7 days')`,
    [OWN, OPERATOR],
  );
}

beforeEach(async () => {
  plane = await startControlPlane({ devSignInAs: OPERATOR, seed });
  const signedIn = await Bun.fetch(`${plane.origin}/api/auth/sign-in/dev`, {
    method: "POST",
    headers: { origin: plane.origin },
  });
  cookie = signedIn.headers.getSetCookie().join("; ");
});

afterEach(async () => {
  await plane.stop();
});

interface Answer {
  readonly result?: { readonly data: unknown };
  readonly error?: { readonly data: { readonly code: string; readonly details?: unknown } };
}

/** One tRPC call over HTTP, as the CLI sends it: a query is a GET, a mutation a POST. */
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

/** A token for the operator, minted through the browser's own door as the account page does. */
async function mint(grant: "read" | "write"): Promise<{ token: string; id: string }> {
  const minted = await call(
    "account.tokens.mint",
    { label: "nightly", grant, expiresInDays: 30 },
    { cookie },
    "mutation",
  );
  const token = (minted.result?.data as { token: string } | undefined)?.token ?? "none minted";
  return { token, id: token.slice(0, token.indexOf(".")) };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "x-undercroft-client": "cli" };
}

describe("/trpc with a personal access token", () => {
  it("lets a write token read and write, recorded as the CLI's call with that token", async () => {
    const { token, id } = await mint("write");

    const listed = await call("runs.list", { tenantId: OWN }, bearer(token));
    const started = await call(
      "runs.trigger",
      { tenantId: OWN, source: "hubspot" },
      bearer(token),
      "mutation",
    );

    expect(listed.result?.data).toEqual({ items: [], nextCursor: null });
    expect(started.result?.data).toEqual({ runId: "run-mem-1" });
    expect(plane.worker.triggered.map((run) => run.tenantId)).toEqual([OWN]);
    const mine = await call("audit.mine", {}, { cookie });
    const page = mine.result?.data as
      | { items: { action: string; channel: string | null; credential: string | null }[] }
      | undefined;
    expect(page?.items.find((entry) => entry.action === "runs.trigger")).toMatchObject({
      channel: "cli",
      credential: id,
    });
  });

  it("refuses a read token's write, naming the grant it holds", async () => {
    const { token } = await mint("read");

    const refused = await call(
      "runs.trigger",
      { tenantId: OWN, source: "hubspot" },
      bearer(token),
      "mutation",
    );

    expect(refused.error?.data).toMatchObject({
      code: "FORBIDDEN",
      details: { reason: "WRITES_DISABLED", grant: "read" },
    });
    expect(plane.worker.triggered).toEqual([]);
  });

  it("refuses a revoked token, and a live session cookie sent with it does not rescue it", async () => {
    const { token, id } = await mint("write");
    await call("account.tokens.revoke", { id }, { cookie }, "mutation");

    const refused = await call("session.me", undefined, { ...bearer(token), cookie });

    expect(refused.error?.data.code).toBe("UNAUTHORIZED");
  });

  it("cannot reach the token procedures, so a token never mints a token", async () => {
    const { token } = await mint("write");

    const refused = await call(
      "account.tokens.mint",
      { label: "escalated", grant: "write", expiresInDays: 30 },
      bearer(token),
      "mutation",
    );

    expect(refused.error?.data.code).toBe("FORBIDDEN");
  });
});
