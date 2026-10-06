/**
 * An export, end to end over HTTP (ADR 0111): asked for through `/mcp` by an agent holding a
 * read token, downloaded from the link it was given -- and the link answering nobody else, not
 * after it expires, and not to a bearer that failed because a live cookie came with it.
 *
 * The real control plane, with the in-memory worker standing in for the stream: what the worker
 * itself promises about a stream -- every row, through a cursor, and a cut rather than a short
 * file -- is proven against Postgres in the worker's `queryRunner.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { TestDatabase } from "@undercroft/db/testing";
import { mint } from "../services/accessTokens.ts";
import { type ControlPlane, startControlPlane } from "../testing.ts";

const OPERATOR = "operator@example.test";
const COLLEAGUE = "colleague@example.test";
const OWN = "CASE-0042";
const MODEL = "fct_revenue";

let plane: ControlPlane;
let cookie = "";
let colleagueId = "";

async function seed(db: TestDatabase): Promise<void> {
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [OWN]);
  await db.query(
    `INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
     VALUES ($1, $2, 'admin', repeat('a', 64), now() + interval '7 days')`,
    [OWN, OPERATOR],
  );
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [COLLEAGUE],
  );
  colleagueId = rows[0]?.id ?? "";
  await db.query(
    "INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, 'member')",
    [OWN, colleagueId],
  );
  await db.query("INSERT INTO app.model (tenant_id, name, sql) VALUES ($1, $2, 'select 1')", [
    OWN,
    MODEL,
  ]);
}

beforeEach(async () => {
  plane = await startControlPlane({ devSignInAs: OPERATOR, seed });
  const signedIn = await Bun.fetch(`${plane.origin}/api/auth/sign-in/dev`, {
    method: "POST",
    headers: { origin: plane.origin },
  });
  cookie = signedIn.headers.getSetCookie().join("; ");
  plane.worker.answering({
    columns: [
      { name: "segment", type: "text" },
      { name: "amount", type: "numeric" },
    ],
    rows: [
      ["=1+1", "-1234.5670"],
      ["Hà Nội", null],
    ],
    truncated: false,
  });
});

afterEach(async () => {
  await plane.stop();
});

/** A token for the operator, minted through the browser's own door as the account page does. */
async function operatorToken(grant: "read" | "write"): Promise<string> {
  const response = await Bun.fetch(`${plane.origin}/trpc/account.tokens.mint`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ label: "agent", grant, expiresInDays: 30 }),
  });
  const body = (await response.json()) as { result: { data: { token: string } } };
  return body.result.data.token;
}

/** Ask for an export of the model through `/mcp`, as an agent does; the link's path. */
async function exportModel(token: string): Promise<string> {
  const client = new Client({ name: "exports.test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", plane.origin), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  const result = await client.callTool({
    name: "bi_exports_create",
    arguments: { tenantId: OWN, source: { kind: "model", model: MODEL } },
  });
  await client.close();
  const answered = result.structuredContent as { path?: unknown } | undefined;
  return typeof answered?.path === "string" ? answered.path : "the tool answered no path";
}

function download(path: string, headers: Record<string, string>): Promise<Response> {
  return Bun.fetch(`${plane.origin}${path}`, {
    headers: { accept: "application/json", ...headers },
  });
}

describe("an export", () => {
  it("is asked for by an agent with a read token and downloaded with it, every figure as sent", async () => {
    const token = await operatorToken("read");
    const response = await download(await exportModel(token), {
      authorization: `Bearer ${token}`,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv;charset=utf-8");
    expect(response.headers.get("content-disposition")).toContain(`filename="${MODEL}.csv"`);
    const bytes = await response.arrayBuffer();
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe(
      "﻿segment,amount\r\n'=1+1,-1234.5670\r\nHà Nội,\r\n",
    );
    // A model is exported whole, under the tenant's own search path.
    expect(plane.worker.exports.map((e) => e.sql)).toEqual([`SELECT * FROM "${MODEL}"`]);
  });

  it("is in the customer's log as asked for and as taken, by the door that took it", async () => {
    const token = await operatorToken("read");
    await download(await exportModel(token), { authorization: `Bearer ${token}` });

    const input = encodeURIComponent(JSON.stringify({ tenantId: OWN }));
    const response = await Bun.fetch(`${plane.origin}/trpc/audit.tenant?input=${input}`, {
      headers: { cookie },
    });
    const body = (await response.json()) as {
      result: { data: { entries: { action: string; channel: string | null }[] } };
    };
    const exports = body.result.data.entries.filter((entry) =>
      entry.action.startsWith("bi.exports."),
    );
    expect(exports.map((entry) => [entry.action, entry.channel])).toEqual([
      ["bi.exports.download", "mcp"],
      ["bi.exports.create", "mcp"],
    ]);
  });

  it("answers no one but the person who asked for it", async () => {
    const path = await exportModel(await operatorToken("read"));
    const colleague = await mint(plane.db, {
      userId: colleagueId,
      actor: { userId: null, email: COLLEAGUE, channel: "web", credential: null },
      label: "agent",
      grant: "read",
      expiresInDays: 30,
    });

    const response = await download(path, { authorization: `Bearer ${colleague.token}` });

    expect(response.status).toBe(404);
    expect(plane.worker.exports).toEqual([]);
  });

  it("answers no one once it has expired", async () => {
    const path = await exportModel(await operatorToken("read"));
    await plane.db.asSuperuser((tx) =>
      tx.query(
        `UPDATE app.bi_export
         SET created_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes'`,
      ),
    );

    const response = await download(path, { cookie });

    expect(response.status).toBe(404);
  });

  it("refuses a bearer that failed even when a live session cookie came with it", async () => {
    const path = await exportModel(await operatorToken("read"));

    const response = await download(path, { cookie, authorization: "Bearer upat_nobody00.x" });

    expect(response.status).toBe(401);
    expect(plane.worker.exports).toEqual([]);
  });

  it("refuses SQL the database refuses before the first byte, in the caller's language", async () => {
    const path = await exportModel(await operatorToken("read"));
    plane.worker.refusingQueries('relation "fct_revenue" does not exist');

    const response = await download(path, { cookie, "accept-language": "en" });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.message).toContain('relation "fct_revenue" does not exist');
  });
});
