/**
 * The local sign-in method, `POST /api/auth/sign-in/dev`: a developer's stack, and a desktop
 * install signing its owner in (ADR 0094).
 *
 * Over HTTP against the real control plane (`startControlPlane`): real Better Auth, PGlite,
 * nothing mocked. What is asserted is what a browser sees -- a session cookie or none, and
 * who `/trpc/session.me` then says it is.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { InMemoryEmailSender } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { type ControlPlane, inMemoryAuthStore, startControlPlane } from "../testing.ts";
import { type AuthConfig, createAuth } from "./auth.ts";
import { createServer } from "./server.ts";

const DEV = "dev@example.test";
/** The address a desktop installer generates, named both the local address and a superadmin. */
const OWNER = "owner@example.test";

const noDatabase: SqlExecutor = {
  query: () => Promise.reject(new Error("this test must not touch the database")),
  exec: () => Promise.reject(new Error("this test must not touch the database")),
};

function authConfig(baseUrl: string): AuthConfig {
  return {
    database: inMemoryAuthStore(),
    exec: noDatabase,
    transactor: () => Promise.reject(new Error("unused")),
    secret: "a-test-secret-that-is-long-enough-to-sign",
    baseUrl,
    email: new InMemoryEmailSender(),
  };
}

async function signInDev(plane: ControlPlane): Promise<Response> {
  return await Bun.fetch(`${plane.origin}/api/auth/sign-in/dev`, {
    method: "POST",
    headers: { origin: plane.origin },
  });
}

describe("an invited address", () => {
  let plane: ControlPlane;

  beforeEach(async () => {
    // Invited rather than a superadmin, so a first sign-in has an invitation to redeem.
    plane = await startControlPlane({
      devSignInAs: DEV,
      seed: async (db) => {
        await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-0042')");
        await db.query(
          `INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
           VALUES ('CASE-0042', $1, 'viewer', repeat('a', 64), now() + interval '7 days')`,
          [DEV],
        );
      },
    });
  });

  afterEach(async () => {
    await plane.stop();
  });

  it("signs the configured address in with an ordinary session", async () => {
    const cookie = (await signInDev(plane)).headers.getSetCookie().join("; ");
    const me = await Bun.fetch(`${plane.origin}/trpc/session.me`, { headers: { cookie } });

    expect(await me.json()).toMatchObject({ result: { data: { email: DEV, superadmin: false } } });
  });

  it("refuses an address whose invitation is gone, and sets no session", async () => {
    await plane.db.query("DELETE FROM app.invitation");

    const response = await signInDev(plane);

    expect({ status: response.status, cookies: response.headers.getSetCookie() }).toEqual({
      status: 403,
      cookies: [],
    });
  });
});

describe("a desktop install (ADR 0094)", () => {
  let plane: ControlPlane;

  beforeEach(async () => {
    // What the installer writes: one generated address, as the local method AND a superadmin,
    // and nothing seeded -- a fresh install has no customer and no invitation.
    plane = await startControlPlane({ devSignInAs: OWNER, superadmins: new Set([OWNER]) });
  });

  afterEach(async () => {
    await plane.stop();
  });

  it("signs its owner in uninvited, with the authority to create the first customer", async () => {
    const cookie = (await signInDev(plane)).headers.getSetCookie().join("; ");

    // `tenants.create` is the router's one superadmin-only procedure: the first thing a fresh
    // install's owner must do, and the thing an ordinary session is refused.
    const created = await Bun.fetch(`${plane.origin}/trpc/tenants.create`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ tenantId: "CASE-0001", displayName: "" }),
    });

    expect({ status: created.status, body: await created.json() }).toMatchObject({
      status: 200,
      body: { result: { data: { id: "CASE-0001" } } },
    });
  });
});

describe("the ways in the sign-in page is told", () => {
  const origin = "http://127.0.0.1:13000";

  async function methodsOf(config: AuthConfig): Promise<unknown> {
    const app = createServer({ exec: noDatabase, auth: createAuth(config) });
    const response = await app.fetch(new Request(`${origin}/trpc/config.signIn`));
    return await response.json();
  }

  // The page signs in by itself only when `dev` is ALL it is told, so both sides are pinned: a
  // list that dropped `dev` would strand a desktop owner on forms that cannot work, and one that
  // dropped mail would take a click-free sign-in from a stack somebody gave a real method.
  it("names the local method alone when it is the only one built", async () => {
    const { email: _mail, ...desktop } = authConfig(origin);

    expect(await methodsOf({ ...desktop, devSignInAs: OWNER })).toEqual({
      result: { data: { methods: ["dev"] } },
    });
  });

  it("names the local method beside mail when both are built", async () => {
    expect(await methodsOf({ ...authConfig(origin), devSignInAs: DEV })).toEqual({
      result: { data: { methods: ["email-otp", "dev"] } },
    });
  });
});

describe("construction", () => {
  it("does not exist on a control plane started without the setting", async () => {
    const origin = "http://localhost:5173";
    const app = createServer({ exec: noDatabase, auth: createAuth(authConfig(origin)) });

    const response = await app.fetch(
      new Request(`${origin}/api/auth/sign-in/dev`, { method: "POST", headers: { origin } }),
    );

    expect(response.status).toBe(404);
  });

  it("refuses a request addressed to another host, as a rebound DNS name would be, with no session", async () => {
    // The quiet side is every sign-in above, addressed to the plane's own origin. This is the
    // page on `attacker.example` whose name now resolves to 127.0.0.1: same socket, other Host.
    const origin = "http://localhost:5173";
    const app = createServer({
      exec: noDatabase,
      auth: createAuth({ ...authConfig(origin), devSignInAs: DEV }),
    });

    const response = await app.fetch(
      new Request("http://attacker.example.test:5173/api/auth/sign-in/dev", { method: "POST" }),
    );

    expect({ status: response.status, cookies: response.headers.getSetCookie() }).toEqual({
      status: 403,
      cookies: [],
    });
  });

  it("is refused at construction behind an origin that is not loopback", () => {
    expect(() =>
      createAuth({ ...authConfig("https://app.example.test"), devSignInAs: DEV }),
    ).toThrow();
  });
});
