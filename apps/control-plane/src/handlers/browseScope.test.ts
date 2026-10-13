/**
 * What the scope picker is TOLD when it cannot show a list.
 *
 * Separate from `authz.test.ts`, which builds its context with no worker at all and asserts
 * codes rather than wording -- deliberately, and it says so. This file asks the other
 * question: given a worker that answered, does the sentence on screen name something the
 * administrator reading it can act on?
 *
 * It exists because that sentence was once "the processing service is not responding" for a
 * Gmail grant Google had refused. The service was up; the permission had been unticked at
 * the consent screen; and the only person who could fix it was being told to wait.
 */

import { TRPCError } from "@trpc/server";
import { DEFAULT_LOCALE } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { messages } from "../i18n/index.ts";
import type { WorkerFailure } from "../services/workerRefusals.ts";
import { InMemoryWorkerClient } from "../services/inMemoryWorkerClient.ts";
import { appRouter } from "./router.ts";
import type { Context } from "./trpc.ts";

const TENANT = "CASE-0042";
const ADMIN = { userId: "", email: "ada@example.test" };

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [ADMIN.email],
  );
  ADMIN.userId = rows[0]!.id;
  await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    TENANT,
    ADMIN.userId,
    "admin",
  ]);
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

function callerWith(failure: WorkerFailure) {
  return callerOf(new InMemoryWorkerClient().failing(failure));
}

function callerOf(worker: InMemoryWorkerClient) {
  const ctx: Context = {
    exec: db,
    user: { userId: ADMIN.userId, email: ADMIN.email },
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
    signInMethods: [],
    channel: "web",
    publicUrl: null,
  };
  return appRouter.createCaller(ctx);
}

async function refusalOf(
  failure: WorkerFailure,
): Promise<{ code: string; message: string; facts: unknown }> {
  try {
    await callerWith(failure).connections.browseScope({ tenantId: TENANT, source: "gmail" });
  } catch (error) {
    if (error instanceof TRPCError) {
      // The verdict rides as the cause's `facts`, which the formatter publishes as `details`.
      const facts = (error.cause as { facts?: unknown } | undefined)?.facts;
      return { code: error.code, message: error.message, facts };
    }
    throw error;
  }
  throw new Error("expected the browse to be refused");
}

describe("a scope picker that cannot list anything", () => {
  it("a withheld permission names the remedy the reader owns", async () => {
    const refusal = await refusalOf("scope-insufficient");

    expect(refusal.message).toBe(
      messages(DEFAULT_LOCALE)("error.scopeInsufficient", { source: "gmail" }),
    );
    expect(refusal.code).toBe("PRECONDITION_FAILED");
  });

  it("a credential that can no longer be refreshed asks for a reconnect, and says so as a verdict", async () => {
    // Issue 213: a mailbox whose refresh token Google refused was worded as the catch-all
    // below, with remedy "none" -- and nothing on the screen said the fix was a reconnect.
    // Not `scope-insufficient` either: no permission was withheld, so none is to be ticked.
    const refusal = await refusalOf("credential-expired");

    expect(refusal.message).toBe(
      messages(DEFAULT_LOCALE)("error.credentialExpired", { source: "gmail" }),
    );
    expect(refusal.code).toBe("PRECONDITION_FAILED");
    expect(refusal.facts).toEqual({
      source: "gmail",
      listing: "labels",
      reason: "credential-expired",
      remedy: "reconnect",
    });
  });

  it("a worker that is actually down still says so", async () => {
    // The quiet side, and the reason the branch above has to be a branch: these two must not
    // collapse back into one sentence, which is the state this file was written to end.
    const refusal = await refusalOf("unreachable");

    expect(refusal.message).toBe(messages(DEFAULT_LOCALE)("error.workerUnavailable"));
  });

  it("a refusal that is neither is worded as neither", async () => {
    const refusal = await refusalOf("refused");

    expect(refusal.message).toBe(
      messages(DEFAULT_LOCALE)("error.browseRefused", { source: "gmail" }),
    );
  });
});

describe("which list a source is browsed for", () => {
  it("Drive asks the worker for its folders, and a second account does too", async () => {
    // Issue 177: this was decided as "Xero, else labels", so Drive asked the worker for Gmail
    // labels, the worker refused a pair it does not serve, and the CLI reported the refusal as
    // VALIDATION_FAILED on input that matched the schema.
    const folder = {
      id: "fo-1",
      name: "Statements",
      kind: "folder" as const,
      path: ["Statements"],
    };
    const worker = new InMemoryWorkerClient().withChoices({ items: [folder], partial: [] });

    const answer = await callerOf(worker).connections.browseScope({
      tenantId: TENANT,
      source: "drive",
    });
    await callerOf(worker).connections.browseScope({
      tenantId: TENANT,
      source: "drive.3fa9c1d2e0ab",
    });

    expect(answer).toEqual({ items: [folder], partial: [], nextCursor: null });
    expect(worker.browsed.map((asked) => asked.kind)).toEqual(["folders", "folders"]);
  });

  it("HubSpot asks the worker for its properties, and a refused token is worded for a private app", async () => {
    // Issue 202: HubSpot used to be the source with nothing to choose, refused before the
    // worker was asked. Its remedy is not Google's either -- there is no consent screen to
    // leave ticked, there is a private app to grant read access to.
    const worker = new InMemoryWorkerClient();
    await callerOf(worker).connections.browseScope({ tenantId: TENANT, source: "hubspot" });

    await expect(
      callerWith("scope-insufficient").connections.browseScope({
        tenantId: TENANT,
        source: "hubspot",
      }),
    ).rejects.toThrow(messages(DEFAULT_LOCALE)("error.propertiesInsufficient"));
    expect(worker.browsed.map((asked) => asked.kind)).toEqual(["properties"]);
  });

  it("a source with nothing to choose is refused as such, and the worker is not asked", async () => {
    const worker = new InMemoryWorkerClient();

    await expect(
      callerOf(worker).connections.browseScope({ tenantId: TENANT, source: "shopify" }),
    ).rejects.toThrow(messages(DEFAULT_LOCALE)("error.browseUnsupported", { source: "shopify" }));
    expect(worker.browsed).toEqual([]);
  });
});

describe("a browse cut to a level, a search or a page (issue 443)", () => {
  function folder(id: string, path: string[], parentId: string | null) {
    return { id, name: path.at(-1) ?? "", kind: "folder" as const, path, parentId };
  }
  const DRIVE = {
    items: [
      folder("f-a", ["Accounts"], null),
      folder("f-a1", ["Accounts", "2025"], "f-a"),
      folder("f-a2", ["Accounts", "2026"], "f-a"),
      folder("f-b", ["Board"], null),
      folder("f-b1", ["Board", "Minutes 2026"], "f-b"),
      { id: "application/pdf", name: "application/pdf", kind: "file-type" as const },
    ],
    // The folder listing stopped at its bound: no cut may make that look whole.
    partial: ["folder" as const],
  };

  function drive() {
    const worker = new InMemoryWorkerClient().withChoices(DRIVE);
    return { worker, api: callerOf(worker).connections };
  }

  async function refused(call: () => Promise<unknown>): Promise<{ code: string; facts: unknown }> {
    try {
      await call();
    } catch (error) {
      if (error instanceof TRPCError) {
        return { code: error.code, facts: (error.cause as { facts?: unknown } | undefined)?.facts };
      }
      throw error;
    }
    throw new Error("expected the browse to be refused");
  }

  function ids(answer: { items: readonly { id: string }[] }): string[] {
    return answer.items.map((item) => item.id);
  }

  it("answers one level under a parent, or the top with null, and still says the listing is partial", async () => {
    const { api } = drive();

    const under = await api.browseScope({ tenantId: TENANT, source: "drive", parentId: "f-a" });
    const top = await api.browseScope({ tenantId: TENANT, source: "drive", parentId: null });

    expect(ids(under)).toEqual(["f-a1", "f-a2"]);
    expect(ids(top)).toEqual(["f-a", "f-b"]);
    expect([under.partial, top.partial]).toEqual([["folder"], ["folder"]]);
  });

  it("searches names and folder paths, case-insensitively", async () => {
    const { api } = drive();

    const byName = await api.browseScope({ tenantId: TENANT, source: "drive", query: "2026" });
    const byPath = await api.browseScope({
      tenantId: TENANT,
      source: "drive",
      query: "accounts/20",
    });

    expect(ids(byName)).toEqual(["f-a2", "f-b1"]);
    expect(ids(byPath)).toEqual(["f-a1", "f-a2"]);
  });

  it("pages through the whole listing, every item once, partial on every page", async () => {
    const { api } = drive();
    const pages: { items: readonly { id: string }[]; partial: readonly string[] }[] = [];
    let cursor: string | undefined;
    do {
      const page = await api.browseScope({
        tenantId: TENANT,
        source: "drive",
        limit: 2,
        ...(cursor === undefined ? {} : { cursor }),
      });
      pages.push(page);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect(pages.flatMap(ids)).toEqual(ids(DRIVE));
    expect(pages.map((page) => page.items.length)).toEqual([2, 2, 2]);
    expect(pages.every((page) => page.partial.join() === "folder")).toBe(true);
  });

  it("a cursor whose item has left the listing is refused, not restarted from the top", async () => {
    const { worker, api } = drive();
    const first = await api.browseScope({ tenantId: TENANT, source: "drive", limit: 2 });
    worker.withChoices({ ...DRIVE, items: DRIVE.items.filter((item) => item.id !== "f-a1") });

    const got = await refused(() =>
      api.browseScope({ tenantId: TENANT, source: "drive", cursor: first.nextCursor ?? "" }),
    );

    expect(got.code).toBe("BAD_REQUEST");
    expect(got.facts).toEqual({
      source: "drive",
      listing: "folders",
      reason: "unknown-cursor",
      remedy: "restart",
    });
  });

  it("a parent the listing does not hold is NOT_FOUND, never an empty level", async () => {
    const { api } = drive();

    const got = await refused(() =>
      api.browseScope({ tenantId: TENANT, source: "drive", parentId: "f-gone" }),
    );

    expect(got.code).toBe("NOT_FOUND");
    expect(got.facts).toEqual({
      source: "drive",
      listing: "folders",
      reason: "unknown-parent",
      parentId: "f-gone",
      remedy: "none",
    });
  });

  it("a listing with no tree refuses a parent, but still answers a search", async () => {
    // Xero's organisations carry no `parentId`; neither does a worker built before the field,
    // whose folders would otherwise answer every level as empty.
    const worker = new InMemoryWorkerClient().withChoices({
      items: [{ id: "org-1", name: "Acme Ltd", kind: null }],
      partial: [],
    });
    const api = callerOf(worker).connections;

    const got = await refused(() =>
      api.browseScope({ tenantId: TENANT, source: "xero", parentId: null }),
    );
    const searched = await api.browseScope({ tenantId: TENANT, source: "xero", query: "acme" });

    expect(got.code).toBe("BAD_REQUEST");
    expect(ids(searched)).toEqual(["org-1"]);
  });
});
