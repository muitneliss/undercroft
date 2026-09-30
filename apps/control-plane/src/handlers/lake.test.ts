/**
 * The Lake division over tRPC: the summary is every member's, the rows are an admin's.
 *
 * The guard is pinned from both sides -- a member is refused, an admin is answered -- because
 * a gate with only the refusing case can be satisfied by a procedure that refuses everyone.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { DEFAULT_LOCALE } from "@undercroft/core";
import { closeRun, openRun, recordEntities } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { messages } from "../i18n/index.ts";
import { InMemoryWorkerClient } from "../services/inMemoryWorkerClient.ts";
import type { WorkerClient } from "../services/workerClient.ts";
import { appRouter } from "./router.ts";
import type { Context, Role } from "./trpc.ts";

const TENANT = "CASE-0042";

let db: TestDatabase;

async function seedMember(email: string, role: Role): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [email],
  );
  const userId = rows[0]?.id ?? "";
  await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    TENANT,
    userId,
    role,
  ]);
  return userId;
}

function caller(userId: string, email: string, worker: WorkerClient | null = null) {
  const ctx: Context = {
    exec: db,
    user: { userId, email },
    credentialId: "s1",
    via: "session",
    grant: "write",
    superadmin: false,
    locale: DEFAULT_LOCALE,
    endSession: () => Promise.resolve(),
    apps: null,
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () =>
      Promise.resolve({
        ok: false as const,
        reason: "not-configured" as const,
        provider: "google" as const,
      }),
    worker,
    specReads: new Map(),
    googlePicker: null,
  };
  return appRouter.createCaller(ctx);
}

async function errorCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_ERROR";
  } catch (error) {
    return error instanceof TRPCError ? error.code : "UNKNOWN";
  }
}

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.query(
    `INSERT INTO raw.records (source, tenant_id, entity, source_record_id, payload,
       content_sha256, observed_at, lake_key, lake_stamp, run_id)
     VALUES ('hubspot', $1, 'deals', 'd-1', '{"name":"Acme"}'::jsonb, repeat('0', 64),
             '2026-09-18T08:00:00Z', 'k', 's', 'r-1')`,
    [TENANT],
  );
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

describe("lake.summary", () => {
  it("a viewer reads what landed: counts, never a payload", async () => {
    const viewer = await seedMember("v@example.test", "viewer");
    const got = await caller(viewer, "v@example.test").lake.summary({ tenantId: TENANT });

    expect(got.records.map((s) => [s.entity, s.records])).toEqual([["deals", 1]]);
    expect(JSON.stringify(got)).not.toContain("Acme");
  });
});

describe("lake.records", () => {
  it("a member is refused: the rows are the source's data verbatim", async () => {
    const member = await seedMember("m@example.test", "member");
    const code = await errorCode(() =>
      caller(member, "m@example.test").lake.records({
        tenantId: TENANT,
        source: "hubspot",
        entity: "deals",
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("an admin pages the rows", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const page = await caller(admin, "a@example.test").lake.records({
      tenantId: TENANT,
      source: "hubspot",
      entity: "deals",
    });

    expect(page.items.map((r) => r.sourceRecordId)).toEqual(["d-1"]);
    expect(page.items[0]?.payload).toContain("Acme");
  });

  it("the document catalogue is gated the same way", async () => {
    const member = await seedMember("m@example.test", "member");
    const admin = await seedMember("a@example.test", "admin");

    expect(
      await errorCode(() =>
        caller(member, "m@example.test").lake.documents({ tenantId: TENANT, source: "gmail" }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await caller(admin, "a@example.test").lake.documents({ tenantId: TENANT, source: "gmail" }),
    ).toEqual({ items: [], nextCursor: null, ofRun: null });
  });
});

describe("the rows one run wrote", () => {
  /** A run of HubSpot, closed with what it counted per entity -- or left running. */
  async function run(
    id: string,
    counted: { entity: string; created: number; changed: number }[],
    status: "ok" | "running" = "ok",
  ): Promise<void> {
    await openRun(db, {
      id,
      tenantId: TENANT,
      source: "hubspot",
      verb: "ingest",
      trigger: "manual",
    });
    if (status === "running") {
      return;
    }
    await recordEntities(
      db,
      id,
      counted.map((c) => ({ ...c, landed: c.created + c.changed, unchanged: 0, refused: 0 })),
    );
    await closeRun(db, id, { status: "ok" });
  }

  /** `raw.records` as the loader leaves it: each row names the run that last wrote it. */
  async function rows(lastWrittenBy: Record<string, string>): Promise<void> {
    await db.asSuperuser(async (tx) => {
      for (const [id, runId] of Object.entries(lastWrittenBy)) {
        await tx.query(
          `INSERT INTO raw.records (source, tenant_id, entity, source_record_id, payload,
             content_sha256, observed_at, lake_key, lake_stamp, run_id)
           VALUES ('hubspot', $1, 'contacts', $2, '{}'::jsonb, repeat('0', 64),
                   '2026-09-18T08:00:00Z', 'k', 's', $3)`,
          [TENANT, id, runId],
        );
      }
    });
  }

  it("lists what the run still names, and says how many a later run has written again", async () => {
    // r-a created three contacts; r-b changed c-2 afterwards, so c-2 names r-b now. The page is
    // two rows long and must not pass for everything r-a wrote.
    await run("r-a", [{ entity: "contacts", created: 3, changed: 0 }]);
    await run("r-b", [{ entity: "contacts", created: 0, changed: 1 }]);
    await rows({ "c-1": "r-a", "c-2": "r-b", "c-3": "r-a" });
    const admin = await seedMember("a@example.test", "admin");

    const page = await caller(admin, "a@example.test").lake.records({
      tenantId: TENANT,
      source: "hubspot",
      entity: "contacts",
      runId: "r-a",
    });

    expect(page.items.map((r) => r.sourceRecordId).sort()).toEqual(["c-1", "c-3"]);
    expect(page.ofRun).toEqual({ runId: "r-a", wrote: 3, current: 2, rewritten: 1 });
  });

  it("says nothing it cannot compute: a run still going has no count to subtract from", async () => {
    await run("r-live", [], "running");
    await rows({ "c-1": "r-live" });
    const admin = await seedMember("a@example.test", "admin");

    const page = await caller(admin, "a@example.test").lake.records({
      tenantId: TENANT,
      source: "hubspot",
      entity: "contacts",
      runId: "r-live",
    });

    expect(page.items.map((r) => r.sourceRecordId)).toEqual(["c-1"]);
    expect(page.ofRun).toBeNull();
  });

  it("counts a run's documents against the entity its ledger counts them under", async () => {
    await run("r-docs", [{ entity: "documents", created: 2, changed: 0 }]);
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO raw.documents (source, tenant_id, document_id, lake_key, sha256, byte_length,
           observed_at, run_id)
         VALUES ('hubspot', $1, 'f-1', 'k1', repeat('1', 64), 10, now(), 'r-docs'),
                ('hubspot', $1, 'f-2', 'k2', repeat('2', 64), 10, now(), 'r-later')`,
        [TENANT],
      ),
    );
    const admin = await seedMember("a@example.test", "admin");

    const page = await caller(admin, "a@example.test").lake.documents({
      tenantId: TENANT,
      source: "hubspot",
      runId: "r-docs",
    });

    expect(page.items.map((d) => d.documentId)).toEqual(["f-1"]);
    expect(page.ofRun).toEqual({ runId: "r-docs", wrote: 2, current: 1, rewritten: 1 });
  });
});

describe("lake.search", () => {
  const HIT = {
    kind: "document" as const,
    source: "gmail",
    documentId: "d1",
    method: "pdf_text",
    truncated: false,
    rank: 0.2,
    excerpt: "Hợp đồng thuê nhà",
    observedAt: "2026-09-18T08:00:00.000Z",
    deletedAt: null,
  };

  it("a member is refused: a hit carries what a source actually said", async () => {
    const member = await seedMember("m@example.test", "member");
    const code = await errorCode(() =>
      caller(member, "m@example.test", new InMemoryWorkerClient()).lake.search({
        tenantId: TENANT,
        q: "hop dong",
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("an admin is answered, and the question reaches the worker for this tenant", async () => {
    // The quiet side of the gate, and the wiring in one: a procedure that refused everybody
    // would pass the test above on its own.
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient().answersSearchWith({
      hits: [HIT],
      truncated: false,
    });

    const found = await caller(admin, "a@example.test", worker).lake.search({
      tenantId: TENANT,
      q: "hop dong",
    });

    expect(found.hits).toEqual([HIT]);
    expect(worker.searches).toHaveLength(1);
    expect(worker.searches[0]?.tenantId).toBe(TENANT);
    expect(worker.searches[0]?.q).toBe("hop dong");
  });

  it("passes the reader's text through untouched, so the search syntax is theirs", async () => {
    // No second parser here: `websearch_to_tsquery` is what gives a quoted phrase and a
    // `-negation` their meaning, and trimming or splitting on the way past would be a
    // quietly different answer to what was asked.
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient();

    await caller(admin, "a@example.test", worker).lake.search({
      tenantId: TENANT,
      q: '"hop dong" -phu luc',
    });

    expect(worker.searches[0]?.q).toBe('"hop dong" -phu luc');
  });

  it("with no worker configured the answer is PRECONDITION_FAILED, not an empty lake", async () => {
    // "Nothing matched" and "the search never ran" are different facts, and answering the
    // second with the first tells an admin their data is not there.
    const admin = await seedMember("a@example.test", "admin");
    const code = await errorCode(() =>
      caller(admin, "a@example.test").lake.search({ tenantId: TENANT, q: "hop dong" }),
    );
    expect(code).toBe("PRECONDITION_FAILED");
  });

  it("a worker that refused is PRECONDITION_FAILED too", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient().failing("refused");
    const code = await errorCode(() =>
      caller(admin, "a@example.test", worker).lake.search({ tenantId: TENANT, q: "hop dong" }),
    );
    expect(code).toBe("PRECONDITION_FAILED");
  });

  // ADR 0088: a login with no connection free in time is not an outage and not the reader's
  // fault, and the sentence used to say the processing service was not answering.
  it("a worker whose tenant login is busy is worded as busy, to try again shortly", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient().failing("busy");
    const refusal = await caller(admin, "a@example.test", worker)
      .lake.search({ tenantId: TENANT, q: "hop dong" })
      .then(
        () => null,
        (error: unknown) => (error instanceof TRPCError ? error.message : String(error)),
      );
    expect(refusal).toBe(messages(DEFAULT_LOCALE)("error.workerBusy"));
  });

  it("refuses a blank question before it reaches the worker", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient();
    const code = await errorCode(() =>
      caller(admin, "a@example.test", worker).lake.search({ tenantId: TENANT, q: "   " }),
    );
    expect(code).toBe("BAD_REQUEST");
    expect(worker.searches).toHaveLength(0);
  });
});
