/**
 * The local stack's sign-in method, `POST /api/auth/sign-in/dev`.
 *
 * Over HTTP against the real control plane (`startControlPlane`): real Better Auth, PGlite,
 * nothing mocked. What is asserted is what a browser sees -- a session cookie or none, and
 * who `/trpc/session.me` then says it is.
 */

import { afterEach, beforeEach, expect, test as it } from "bun:test";
import { InMemoryEmailSender } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { type ControlPlane, inMemoryAuthStore, startControlPlane } from "../testing.ts";
import { type AuthConfig, createAuth } from "./auth.ts";
import { createServer } from "./server.ts";

const DEV = "dev@example.test";

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

async function signInDev(): Promise<Response> {
  return await Bun.fetch(`${plane.origin}/api/auth/sign-in/dev`, {
    method: "POST",
    headers: { origin: plane.origin },
  });
}

it("signs the configured address in with an ordinary session", async () => {
  const cookie = (await signInDev()).headers.getSetCookie().join("; ");
  const me = await Bun.fetch(`${plane.origin}/trpc/session.me`, { headers: { cookie } });

  expect(await me.json()).toMatchObject({ result: { data: { email: DEV, superadmin: false } } });
});

it("refuses an address whose invitation is gone, and sets no session", async () => {
  await plane.db.query("DELETE FROM app.invitation");

  const response = await signInDev();

  expect({ status: response.status, cookies: response.headers.getSetCookie() }).toEqual({
    status: 403,
    cookies: [],
  });
});

it("does not exist on a control plane started without the setting", async () => {
  const origin = "http://localhost:5173";
  const app = createServer({ exec: noDatabase, auth: createAuth(authConfig(origin)) });

  const response = await app.fetch(
    new Request(`${origin}/api/auth/sign-in/dev`, { method: "POST", headers: { origin } }),
  );

  expect(response.status).toBe(404);
});

it("is refused at construction behind an origin that is not loopback", () => {
  expect(() =>
    createAuth({ ...authConfig("https://app.example.test"), devSignInAs: DEV }),
  ).toThrow();
});
