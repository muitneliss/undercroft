/**
 * The refresh path, end to end against real Postgres.
 *
 * Three defects converge here and none had ever fired: `accessToken` had no caller passing
 * a refresher, so its refresh branch was dead; `runIngest` called it on the autocommit
 * executor, so the `FOR UPDATE` that stops two runs spending one refresh token held a lock
 * for a single statement and protected nothing; and the worker role lacked the grants both
 * of those paths need. These tests are what keeps them wired.
 */

// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and deliberately not done here: hoisting these literals touches many files and belongs in its own commit where the diff is reviewable, rather than buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import { seal } from "@undercroft/crypto";
import { migrate, type SqlExecutor } from "@undercroft/db";
import type { Credential } from "@undercroft/db/repos";
import { readCredential } from "@undercroft/db/repos";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { resolveToken } from "./runTypes.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ENV = { UNDERCROFT_SECRET_KEY: KEY };
const INPUT = { source: "gmail", tenantId: "CASE-0042" } as const;
const LONG_EXPIRED = "2020-01-01T00:00:00.000Z";

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [INPUT.tenantId]);
  await db.query(
    "INSERT INTO ops.connection (tenant_id, source, status) VALUES ($1, $2, 'connected')",
    [INPUT.tenantId, INPUT.source],
  );
  // Seeded as the superuser; from here on every statement runs as the worker does.
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

/**
 * PGlite is a single connection, so a transaction is BEGIN/COMMIT on it. Real enough for
 * what is under test: that the refresh and the credential read share one transaction, and
 * that a throw rolls the write back.
 */
async function transactor<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
  await db.exec("BEGIN");
  try {
    const result = await fn(db);
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

async function storeCredential(credential: Credential): Promise<void> {
  const sealed = seal(JSON.stringify(credential), { env: ENV });
  await db.query(
    `INSERT INTO app.connection_secret (tenant_id, source, ciphertext, key_version, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      INPUT.tenantId,
      INPUT.source,
      Buffer.from(sealed.blob),
      sealed.keyVersion,
      credential.expiresAt,
    ],
  );
}

async function statusOf(): Promise<string | undefined> {
  const { rows } = await db.query<{ status: string }>(
    "SELECT status FROM ops.connection WHERE tenant_id = $1 AND source = $2",
    [INPUT.tenantId, INPUT.source],
  );
  return rows[0]?.status;
}

describe("resolveToken", () => {
  it("a credential well short of expiry is returned as it stands", async () => {
    // The quiet side of the refresh guard: a resolver that always refreshed would spend a
    // refresh token on every run for no reason.
    await storeCredential({
      accessToken: "still-good",
      refreshToken: "r",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const token = await resolveToken(
      {
        exec: db,
        env: ENV,
        transactor,
        refresher: () => Promise.reject(new Error("must not refresh")),
      },
      INPUT,
    );

    expect(token).toBe("still-good");
  });

  it("an expired credential with no refresher marks the connection expired and raises", async () => {
    // The firing side, and the regression this file exists to catch: `accessToken` writes
    // the status and THEN throws, so inside a transaction the rollback takes the status
    // with it. Re-applied outside, or the card reads "connected" forever while every run
    // fails.
    await storeCredential({ accessToken: "stale", refreshToken: "r", expiresAt: LONG_EXPIRED });

    await expect(resolveToken({ exec: db, env: ENV, transactor }, INPUT)).rejects.toThrow(
      /needs re-consent/u,
    );
    expect(await statusOf()).toBe("expired");
  });

  it("an expired credential with a refresher is refreshed and written back", async () => {
    await storeCredential({ accessToken: "stale", refreshToken: "r0", expiresAt: LONG_EXPIRED });

    const token = await resolveToken(
      {
        exec: db,
        env: ENV,
        transactor,
        refresher: (refreshToken) =>
          Promise.resolve({
            accessToken: `fresh-after-${refreshToken}`,
            refreshToken: "r1",
            expiresAt: "2099-01-01T00:00:00.000Z",
          }),
      },
      INPUT,
    );

    expect(token).toBe("fresh-after-r0");
    expect(await statusOf()).toBe("connected");

    // The rotated token is durable, not just returned: the next run must find r1, because
    // r0 may already be dead at the provider.
    const stored = await readCredential(db, INPUT.tenantId, INPUT.source, { env: ENV });
    expect(stored.refreshToken).toBe("r1");
    expect(stored.accessToken).toBe("fresh-after-r0");
  });

  it("a failed refresh rolls back and leaves the stored credential untouched", async () => {
    // Google's token endpoint being briefly down must cost nothing. A half-written
    // credential here costs the connection outright, and the customer has to re-consent.
    await storeCredential({ accessToken: "stale", refreshToken: "r0", expiresAt: LONG_EXPIRED });

    await expect(
      resolveToken(
        {
          exec: db,
          env: ENV,
          transactor,
          refresher: () => Promise.reject(new Error("503 from the token endpoint")),
        },
        INPUT,
      ),
    ).rejects.toThrow(/503/u);

    const stored = await readCredential(db, INPUT.tenantId, INPUT.source, { env: ENV });
    expect(stored.refreshToken).toBe("r0");
    expect(stored.accessToken).toBe("stale");
  });

  it("a transient refresh failure does not mark the connection expired", async () => {
    // The other side of the same judgement. Marking expired here would send a customer to
    // re-consent over a provider hiccup that fixes itself in a minute.
    await storeCredential({ accessToken: "stale", refreshToken: "r0", expiresAt: LONG_EXPIRED });

    await expect(
      resolveToken(
        {
          exec: db,
          env: ENV,
          transactor,
          refresher: () => Promise.reject(new Error("503 from the token endpoint")),
        },
        INPUT,
      ),
    ).rejects.toThrow();

    expect(await statusOf()).toBe("connected");
  });

  it("a connection with no stored credential says so", async () => {
    await expect(resolveToken({ exec: db, env: ENV, transactor }, INPUT)).rejects.toThrow(
      /has not completed its OAuth flow/u,
    );
  });
});
