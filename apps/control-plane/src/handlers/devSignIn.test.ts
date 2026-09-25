/**
 * `devSignInAs`: a local stack opens signed in, and nothing else does.
 *
 * Through the real Hono app and `/trpc/session.me`, which is the SPA's one auth read, so what
 * is asserted is what the browser would be told. No Better Auth: the setting is what makes a
 * stack usable without one, and a request here presents no session at all.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { createServer } from "./server.ts";

const LOCAL = "http://localhost:5173";
const DEV = "dev@example.test";

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

async function me(): Promise<Response> {
  const app = createServer({ exec: db, publicUrl: LOCAL, devSignInAs: DEV });
  return await app.fetch(new Request(`${LOCAL}/trpc/session.me`));
}

describe("dev sign-in", () => {
  it("a request with no session is the dev address's app_user", async () => {
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
      [DEV],
    );

    const response = await me();

    expect(await response.json()).toEqual({
      result: { data: { userId: rows[0]?.id, email: DEV, superadmin: false } },
    });
  });

  it("a dev address that was never provisioned is still nobody", async () => {
    const response = await me();

    expect(response.status).toBe(401);
  });

  it("refuses to build a server whose public URL is not loopback", () => {
    expect(() =>
      createServer({ exec: db, publicUrl: "https://app.example.test", devSignInAs: DEV }),
    ).toThrow();
  });
});
