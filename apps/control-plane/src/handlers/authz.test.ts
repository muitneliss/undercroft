/**
 * The authorization semantics, exercised through a real caller against PGlite.
 *
 * No HTTP and no mocks: the test builds a context and calls the router directly, so it
 * runs the actual middleware -- the 404-not-403 boundary, the permission gates Casbin decides
 * (ADR 0139) -- against real Postgres grants and rows.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { Permission } from "@undercroft/contracts/access";
import { DEFAULT_LOCALE } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { procedureManifest, resolveProcedure } from "./procedures.ts";
import { appRouter } from "./router.ts";
import { type Context, type Role, refusalFacts, type SessionUser } from "./trpc.ts";

let db: TestDatabase;

async function seedUser(email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [email],
  );
  return rows[0]!.id;
}

async function seedMembership(tenantId: string, userId: string, role: Role): Promise<void> {
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1) ON CONFLICT DO NOTHING", [tenantId]);
  await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    tenantId,
    userId,
    role,
  ]);
}

function caller(user: SessionUser | null, superadmin = false) {
  const ctx: Context = {
    exec: db,
    user,
    credentialId: "s1",
    via: "session",
    grant: "write",
    // Defaulted off, so every test written before platform authority existed still asks the
    // question it was asking: what an ordinary member may do. A superadmin is opted into.
    superadmin,
    // The product default, as a request with no `Accept-Language` would resolve to. These
    // tests assert which code a refusal carries, never its wording.
    locale: DEFAULT_LOCALE,
    endSession: () => Promise.resolve(),
    // No mail in an authorization test: these procedures are being checked for who may
    // call them, and a sender here would be a second thing under test.
    apps: null,
    notifyInvitation: () => Promise.resolve(false),
    // No Google client and no worker, for the same reason. `startOAuth` therefore refuses
    // every caller who gets past the role gate -- which is what makes PRECONDITION_FAILED
    // the proof of authorization here: it is the answer only a caller the gate ADMITTED can
    // receive.
    startConsent: () =>
      Promise.resolve({
        ok: false as const,
        reason: "not-configured" as const,
        provider: "google" as const,
      }),
    worker: null,
    specReads: new Map(),
    googlePicker: null,
    signInMethods: [],
    channel: "web",
    publicUrl: null,
    holdOpen: () => undefined,
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

/** The refusal's code and the permission it names, or `NO_ERROR`. */
async function lacking(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_ERROR";
  } catch (error) {
    if (!(error instanceof TRPCError)) {
      return "UNKNOWN";
    }
    return `${error.code}:${refusalFacts(error)?.permission ?? ""}`;
  }
}

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  // Every statement runs as the control plane does, fixtures included: `undercroft_app`
  // holds DML on every table in `app` and `ops`, which is what the seeding helpers need.
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

describe("a non-member is told the tenant does not exist", () => {
  it("get on a tenant the caller cannot see is NOT_FOUND, not FORBIDDEN", async () => {
    // FORBIDDEN would confirm the tenant exists, turning this into a customer-list oracle.
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-secret')");
    const outsider = await seedUser("outsider@example.test");
    expect(
      await errorCode(() =>
        caller({ userId: outsider, email: "outsider@example.test" }).tenants.get({
          tenantId: "CASE-secret",
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("a member gets the tenant back", async () => {
    const user = await seedUser("member@example.test");
    await seedMembership("CASE-1", user, "member");
    const tenant = await caller({ userId: user, email: "member@example.test" }).tenants.get({
      tenantId: "CASE-1",
    });
    expect(tenant.id).toBe("CASE-1");
    expect(tenant.role).toBe("member");
  });
});

describe("permissions gate privileged actions once membership is established", () => {
  it("a viewer calling startOAuth gets FORBIDDEN, because they know the tenant exists", async () => {
    const user = await seedUser("viewer@example.test");
    await seedMembership("CASE-1", user, "viewer");
    expect(
      await errorCode(() =>
        caller({ userId: user, email: "viewer@example.test" }).connections.startOAuth({
          tenantId: "CASE-1",
          source: "hubspot",
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("an admin gets past the role gate on startOAuth", async () => {
    // PRECONDITION_FAILED, not a URL: this fixture configures no Google client, so the
    // furthest an admitted caller can get is the procedure telling them so. That is the
    // point -- the viewer above never reaches this answer, and the difference between the
    // two codes IS the authorization fact under test.
    //
    // It used to assert a `/oauth/hubspot/` URL, which the procedure fabricated for a
    // refusal it had no way to report. A test can only be as honest as the value it reads.
    const user = await seedUser("admin@example.test");
    await seedMembership("CASE-1", user, "admin");
    expect(
      await errorCode(() =>
        caller({ userId: user, email: "admin@example.test" }).connections.startOAuth({
          tenantId: "CASE-1",
          source: "hubspot",
        }),
      ),
    ).toBe("PRECONDITION_FAILED");
  });

  it("a member cannot change what a connection reads", async () => {
    // Narrowing or widening a live grant is an admin's decision. A member may see the
    // schedule; they may not alter what a customer shares.
    const user = await seedUser("member@example.test");
    await seedMembership("CASE-1", user, "member");
    expect(
      await errorCode(() =>
        caller({ userId: user, email: "member@example.test" }).connections.setScope({
          tenantId: "CASE-1",
          source: "gmail",
          selection: { labels: [] },
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("an admin may change what a connection reads", async () => {
    const user = await seedUser("admin2@example.test");
    await seedMembership("CASE-1", user, "admin");
    await db.query(
      "INSERT INTO ops.connection (tenant_id, source, status) VALUES ('CASE-1','gmail','connected')",
    );

    const result = await caller({
      userId: user,
      email: "admin2@example.test",
    }).connections.setScope({
      tenantId: "CASE-1",
      source: "gmail",
      selection: { labels: [] },
    });

    expect(result).toEqual({ ok: true });
  });

  it("a member cannot end a grant", async () => {
    const user = await seedUser("member2@example.test");
    await seedMembership("CASE-1", user, "member");
    expect(
      await errorCode(() =>
        caller({ userId: user, email: "member2@example.test" }).connections.disconnect({
          tenantId: "CASE-1",
          source: "gmail",
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("browsing a scope with no worker configured says so rather than failing obscurely", async () => {
    // `ctx.worker` is null in these tests. A PRECONDITION_FAILED names the cause; letting it
    // through would surface as a network error that reads like a Google outage.
    const user = await seedUser("admin3@example.test");
    await seedMembership("CASE-1", user, "admin");
    expect(
      await errorCode(() =>
        caller({ userId: user, email: "admin3@example.test" }).connections.browseScope({
          tenantId: "CASE-1",
          source: "gmail",
        }),
      ),
    ).toBe("PRECONDITION_FAILED");
  });
});

/**
 * The built-in roles as what each lets a person do (ADR 0139). A shipped contract: the UI, the
 * CLI and an agent all read `permissions` off `tenants.get` to know what they may do, so the
 * matrix is pinned whole rather than one permission at a time.
 */
describe("what each built-in role holds", () => {
  const EVERY: Permission[] = [
    "audit:read",
    "catalogue:manage",
    "keys:manage",
    "lake:read",
    "models:read",
    "models:write",
    "people:manage",
    "reports:author",
    "roles:manage",
    "runs:read",
    "sources:manage",
    "sources:read",
    "tenant:manage",
  ];

  it("is answered by tenants.get, sorted, and is the same row tenants.list gives", async () => {
    const held: Record<string, unknown> = {};
    const listed: Record<string, unknown> = {};
    for (const role of ["viewer", "member", "builder", "admin"] as const) {
      const user = await seedUser(`${role}@example.test`);
      await seedMembership("CASE-1", user, role);
      const as = caller({ userId: user, email: `${role}@example.test` });
      held[role] = (await as.tenants.get({ tenantId: "CASE-1" })).permissions;
      listed[role] = (await as.tenants.list())[0]?.permissions;
    }

    expect(held).toEqual({
      viewer: [],
      member: ["reports:author"],
      builder: [
        "lake:read",
        "models:read",
        "models:write",
        "reports:author",
        "runs:read",
        "sources:read",
      ],
      admin: EVERY,
    });
    expect(listed).toEqual(held);
  });

  it("a superadmin holds every permission in a tenant they are no member of", async () => {
    const user = await seedUser("root@example.test");
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
    const root = caller({ userId: user, email: "root@example.test" }, true);

    expect((await root.tenants.get({ tenantId: "CASE-1" })).permissions).toEqual(EVERY);
    expect((await root.tenants.list())[0]?.permissions).toEqual(EVERY);
  });
});

/**
 * Issue 481: a builder fixes the dbt project without the authority to change who reaches the
 * customer or what it connects. The opened gates are pinned in each area's own suite
 * (`models.test.ts`, `macros.test.ts`, `seeds.test.ts`, `lake.test.ts`); this is the other half
 * -- everything an admin keeps, refused by name.
 */
describe("a builder", () => {
  async function builder() {
    const user = await seedUser("builder@example.test");
    await seedMembership("CASE-1", user, "builder");
    return caller({ userId: user, email: "builder@example.test" });
  }

  it("is refused people, sources, keys, runs and the customer, each naming what it lacks", async () => {
    const as = await builder();
    const tenantId = "CASE-1";

    expect({
      invite: await lacking(() =>
        as.people.invite({ tenantId, email: "new@example.test", role: "viewer" }),
      ),
      disconnect: await lacking(() => as.connections.disconnect({ tenantId, source: "gmail" })),
      mint: await lacking(() => as.keys.mint({ tenantId, label: "script" })),
      trigger: await lacking(() => as.runs.trigger({ tenantId, source: "hubspot" })),
      rename: await lacking(() => as.tenants.rename({ tenantId, displayName: "Renamed" })),
    }).toEqual({
      invite: "FORBIDDEN:people:manage",
      disconnect: "FORBIDDEN:sources:manage",
      mint: "FORBIDDEN:keys:manage",
      trigger: "FORBIDDEN:sources:manage",
      rename: "FORBIDDEN:tenant:manage",
    });
  });

  it("is told in their own language what they lack and who can grant it", async () => {
    const user = await seedUser("builder@example.test");
    await seedMembership("CASE-1", user, "builder");

    try {
      await caller({ userId: user, email: "builder@example.test" }).people.members({
        tenantId: "CASE-1",
      });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error instanceof TRPCError ? error.message : "").toBe(
        "Thao tác này cần quyền quản lý người dùng (people:manage). Hãy nhờ người có quyền people:manage trong khách hàng này cấp cho bạn một vai trò có quyền đó.",
      );
    }
  });
});

/**
 * Every tenant procedure that changes something declares the permission it needs (ADR 0139).
 * Read off the running router, so the next write somebody adds on bare `tenantProcedure` --
 * open to every viewer -- fails here rather than shipping. A POST that only reads (`models.check`,
 * an export's request) is a read for this purpose, as it is for a credential's grant.
 */
describe("the router's permissions", () => {
  it("leave no tenant write open to every member", async () => {
    const open = (await procedureManifest())
      .filter((spec) => spec.tenantScoped && spec.effect !== "read" && spec.permission === null)
      .map((spec) => spec.path);

    expect(open).toEqual([]);
  });

  it("are described where every caller outside the browser reads a procedure", async () => {
    const specs = await procedureManifest();
    const save = specs.find((spec) => spec.path === "models.save");
    const list = specs.find((spec) => spec.path === "roles.list");

    expect(save?.permission).toBe("models:write");
    // Writing a model changes what the build login runs, which reads every model and the whole
    // raw lake: that it needs both is said too, read off the same chain (ADR 0142).
    expect(
      save?.description.en.endsWith(
        " Needs models:write. Needs reading every model and the whole raw lake (model:*, raw:*).",
      ),
    ).toBe(true);
    expect(save?.description.vi).toContain(" Cần quyền models:write.");
    // The quiet side: a read any member may make names no permission and no reach.
    expect(list?.permission).toBeNull();
    expect(list?.description.en).not.toContain("Needs");
  });
});

/**
 * ADR 0146: a reader of Reports alone opens Customers and Reports, and the server says so at every
 * door. Sources, the Journal, the Lake and Models each open on a permission, and every procedure
 * behind them names one -- read off the running router, so a read somebody adds to one of these
 * namespaces on bare `tenantProcedure` fails here rather than reaching every viewer through the
 * CLI, MCP and the assistant, which never see a tab.
 */
describe("the divisions a reader of Reports does not open", () => {
  /** Each division's namespaces, and the permission its reads need. */
  const DIVISION_READS: readonly (readonly [readonly string[], Permission])[] = [
    [["connections"], "sources:read"],
    [["runs"], "runs:read"],
    [["lake", "documentKinds", "dq"], "lake:read"],
    [["models", "macros", "seeds"], "models:read"],
  ];

  it("leave no procedure behind them open to every member", async () => {
    const behind = new Set(DIVISION_READS.flatMap(([namespaces]) => namespaces));
    const open = (await procedureManifest())
      .filter(
        (spec) =>
          spec.tenantScoped &&
          behind.has(spec.path.split(".")[0] ?? "") &&
          spec.permission === null,
      )
      .map((spec) => spec.path);

    expect(open).toEqual([]);
  });

  it("refuse a viewer each one's reads by name, and answer a builder", async () => {
    const tenantId = "CASE-1";
    async function reads(role: Role): Promise<Record<string, string>> {
      const user = await seedUser(`${role}@example.test`);
      await seedMembership(tenantId, user, role);
      const reader = caller({ userId: user, email: `${role}@example.test` });
      return {
        sources: await lacking(() => reader.connections.list({ tenantId })),
        journal: await lacking(() => reader.runs.list({ tenantId })),
        lake: await lacking(() => reader.lake.summary({ tenantId })),
        models: await lacking(() => reader.models.list({ tenantId })),
      };
    }

    expect(await reads("viewer")).toEqual({
      sources: "FORBIDDEN:sources:read",
      journal: "FORBIDDEN:runs:read",
      lake: "FORBIDDEN:lake:read",
      models: "FORBIDDEN:models:read",
    });
    expect(await reads("builder")).toEqual({
      sources: "NO_ERROR",
      journal: "NO_ERROR",
      lake: "NO_ERROR",
      models: "NO_ERROR",
    });
  });
});

describe("unauthenticated access", () => {
  it("session.me without a user is UNAUTHORIZED", async () => {
    expect(await errorCode(() => caller(null).session.me())).toBe("UNAUTHORIZED");
  });

  it("the list view shows only tenants the caller belongs to", async () => {
    const user = await seedUser("u@example.test");
    await seedMembership("CASE-1", user, "member");
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-other')");
    const tenants = await caller({ userId: user, email: "u@example.test" }).tenants.list();
    expect(tenants.map((t) => t.id)).toEqual(["CASE-1"]);
  });
});

/**
 * Platform authority: what `UNDERCROFT_SUPERADMINS` buys, and what it must not.
 *
 * Each of these is paired with the same call made by a caller who is NOT a superadmin, so
 * a bug that granted authority unconditionally -- the failure mode that matters, because it
 * is silent -- cannot pass. `.claude/rules/tests.md`: a guard needs two tests.
 */
describe("a superadmin holds admin in every tenant", () => {
  it("reaches a tenant they are not a member of", async () => {
    const user = await seedUser("root@example.test");
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");

    const tenant = await caller({ userId: user, email: "root@example.test" }, true).tenants.get({
      tenantId: "CASE-1",
    });

    expect(tenant.role).toBe("admin");
    // Its pair: the same call by a non-member WITHOUT platform authority is NOT_FOUND, which
    // is the first test in this file.
  });

  it("a tenant that does not exist is still NOT_FOUND for a superadmin", async () => {
    // Otherwise every tenant-scoped procedure would run against a customer that is not
    // there, and report an empty connection list rather than a 404 -- plausible and wrong.
    const user = await seedUser("root@example.test");

    expect(
      await errorCode(() =>
        caller({ userId: user, email: "root@example.test" }, true).tenants.get({
          tenantId: "CASE-nonexistent",
        }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("a superadmin can act in a tenant, not only see it", () => {
  it("may invite to a tenant they have no membership in", async () => {
    // `people.invite` needs people:manage. Platform authority has to satisfy it, or a
    // superadmin can see a customer and do nothing about who may reach it.
    const user = await seedUser("root@example.test");
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");

    const result = await caller({ userId: user, email: "root@example.test" }, true).people.invite({
      tenantId: "CASE-1",
      email: "new@example.test",
      role: "viewer",
    });

    expect(result.email).toBe("new@example.test");
  });

  it("may read who has access to a tenant they have no membership in", async () => {
    // `people.members` and `people.invitations` are admin-only (ADR 0119). A superadmin who
    // can invite must be able to see whom they invited, or they act blind.
    const user = await seedUser("root@example.test");
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
    const root = caller({ userId: user, email: "root@example.test" }, true);
    await root.people.invite({ tenantId: "CASE-1", email: "new@example.test", role: "viewer" });

    const members = await root.people.members({ tenantId: "CASE-1" });
    const invitations = await root.people.invitations({ tenantId: "CASE-1" });

    expect(members).toEqual([]);
    expect(invitations.map((invitation) => invitation.email)).toEqual(["new@example.test"]);
  });

  it("the list view shows every tenant, including ones with no membership", async () => {
    const user = await seedUser("root@example.test");
    await seedMembership("CASE-1", user, "member");
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-other')");

    const tenants = await caller({ userId: user, email: "root@example.test" }, true).tenants.list();

    // `admin` for both, matching what `tenants.get` grants above: the list and the page must
    // not disagree about what may be done there.
    expect(tenants.map((tenant) => `${tenant.id}:${tenant.role}`)).toEqual([
      "CASE-1:admin",
      "CASE-other:admin",
    ]);
  });
});

describe("creating a customer is platform authority, not a tenant role", () => {
  it("a superadmin creates one and it appears in the list", async () => {
    const user = await seedUser("root@example.test");

    const created = await caller({ userId: user, email: "root@example.test" }, true).tenants.create(
      { tenantId: "CASE-0001", displayName: "Acme" },
    );

    expect(created.displayName).toBe("Acme");
    const tenants = await caller({ userId: user, email: "root@example.test" }, true).tenants.list();
    expect(tenants.map((tenant) => tenant.id)).toEqual(["CASE-0001"]);
  });

  it("a tenant admin cannot, however senior in their own customer", async () => {
    // The point of the pairing: `admin` holds every permission there is and still not this.
    const user = await seedUser("admin@example.test");
    await seedMembership("CASE-1", user, "admin");

    expect(
      await errorCode(() =>
        caller({ userId: user, email: "admin@example.test" }).tenants.create({
          tenantId: "CASE-0002",
          displayName: "",
        }),
      ),
    ).toBe("FORBIDDEN");
  });
});

describe("a customer reference is refused rather than reinterpreted", () => {
  it("a reference already in use is a CONFLICT, and does not rename the existing customer", async () => {
    const user = await seedUser("root@example.test");
    const root = caller({ userId: user, email: "root@example.test" }, true);
    await root.tenants.create({ tenantId: "CASE-0001", displayName: "First" });

    expect(
      await errorCode(() => root.tenants.create({ tenantId: "CASE-0001", displayName: "Second" })),
    ).toBe("CONFLICT");

    const tenants = await root.tenants.list();
    expect(tenants[0]?.displayName).toBe("First");
  });

  it("an empty display name falls back to the reference rather than a blank row", async () => {
    const user = await seedUser("root@example.test");
    const root = caller({ userId: user, email: "root@example.test" }, true);

    const created = await root.tenants.create({ tenantId: "CASE-0003", displayName: "" });

    expect(created.displayName).toBe("CASE-0003");
  });

  it("a reference with a space in it is refused before it reaches the database", async () => {
    // It becomes an S3 key prefix in the raw lake, which cannot be renamed afterwards.
    const user = await seedUser("root@example.test");

    expect(
      await errorCode(() =>
        caller({ userId: user, email: "root@example.test" }, true).tenants.create({
          tenantId: "CASE 0001",
          displayName: "",
        }),
      ),
    ).toBe("BAD_REQUEST");
  });
});

describe("a customer can be retitled, but never re-identified", () => {
  it("an admin corrects the display name and the id is left alone", async () => {
    // The pairing that matters: the name a person reads is repairable, the id the lake
    // writes under is not. Asserting both in one test is what proves they were separated.
    const user = await seedUser("admin@example.test");
    await seedMembership("CASE-0001", user, "admin");
    const admin = caller({ userId: user, email: "admin@example.test" });

    const renamed = await admin.tenants.rename({
      tenantId: "CASE-0001",
      displayName: "Acme Holdings",
    });

    expect(renamed.displayName).toBe("Acme Holdings");
    expect(renamed.id).toBe("CASE-0001");
  });

  it("a member is refused, so the name is not a thing any signed-in colleague can change", async () => {
    const user = await seedUser("member@example.test");
    await seedMembership("CASE-0001", user, "member");

    expect(
      await errorCode(() =>
        caller({ userId: user, email: "member@example.test" }).tenants.rename({
          tenantId: "CASE-0001",
          displayName: "Renamed By A Member",
        }),
      ),
    ).toBe("FORBIDDEN");

    // Aliased rather than typed as `display_name`: the column is snake_case and the lint
    // rule that governs identifiers here is not worth a file-wide suppression for one row.
    const { rows } = await db.query<{ name: string }>(
      'SELECT display_name AS "name" FROM ops.tenant WHERE id = $1',
      ["CASE-0001"],
    );
    expect(rows[0]!.name).toBe("");
  });

  it("an empty name falls back to the id rather than blanking the row", async () => {
    const user = await seedUser("admin@example.test");
    await seedMembership("CASE-0001", user, "admin");
    const admin = caller({ userId: user, email: "admin@example.test" });
    await admin.tenants.rename({ tenantId: "CASE-0001", displayName: "Acme" });

    const cleared = await admin.tenants.rename({ tenantId: "CASE-0001", displayName: "" });

    expect(cleared.displayName).toBe("CASE-0001");
  });
});

/**
 * A deactivated customer (ADR 0110): every member loses access until an admin reactivates it.
 *
 * Each refusal is paired with its quiet side -- the same call on a customer in use, or the same
 * caller after reactivation -- so code that refused everything could not pass.
 */
describe("a deactivated customer", () => {
  async function seeded(role: Role, address = `${role}@example.test`) {
    const userId = await seedUser(address);
    await seedMembership("CASE-0001", userId, role);
    return caller({ userId, email: address });
  }

  /** The refusal's code and the reason an agent matches on, or `NO_ERROR`. */
  async function refusedWith(fn: () => Promise<unknown>): Promise<string> {
    try {
      await fn();
      return "NO_ERROR";
    } catch (error) {
      if (!(error instanceof TRPCError)) {
        return "UNKNOWN";
      }
      return `${error.code}:${refusalFacts(error)?.reason ?? ""}`;
    }
  }

  it("refuses a member's tenant procedure by name, and answered it before", async () => {
    const member = await seeded("member");
    const admin = await seeded("admin");
    expect(await errorCode(() => member.roles.list({ tenantId: "CASE-0001" }))).toBe("NO_ERROR");

    await admin.tenants.deactivate({ tenantId: "CASE-0001" });

    expect(await refusedWith(() => member.roles.list({ tenantId: "CASE-0001" }))).toBe(
      "PRECONDITION_FAILED:TENANT_DEACTIVATED",
    );
  });

  it("refuses every tenant procedure but those about its state and its history, for an admin too", async () => {
    // The enforcement is one middleware; this is what proves every tenant procedure is behind
    // it, including the next one somebody adds. Only `tenantId` is sent: the refusal comes
    // before a procedure's own input is read, so no procedure needs a valid body to answer it.
    const admin = await seeded("admin");
    await admin.tenants.deactivate({ tenantId: "CASE-0001" });

    const answered: string[] = [];
    for (const spec of await procedureManifest()) {
      // Reactivating last, below: it would end the state this loop is about.
      const procedure =
        spec.tenantScoped && spec.path !== "tenants.reactivate"
          ? resolveProcedure(admin, spec.path)
          : null;
      if (
        procedure !== null &&
        (await refusedWith(() => procedure({ tenantId: "CASE-0001" }))) !==
          "PRECONDITION_FAILED:TENANT_DEACTIVATED"
      ) {
        answered.push(spec.path);
      }
    }

    // `audit.tenant` answers so the admin can read who deactivated it (ADR 0113).
    expect(answered).toEqual(["audit.tenant", "tenants.get"]);
    expect(await refusedWith(() => admin.tenants.reactivate({ tenantId: "CASE-0001" }))).toBe(
      "NO_ERROR",
    );
  });

  it("still tells a non-member the customer is not there", async () => {
    // The 404 boundary comes first: a deactivated customer must not become an oracle for one
    // that exists.
    const admin = await seeded("admin");
    await admin.tenants.deactivate({ tenantId: "CASE-0001" });
    const outsider = await seedUser("outsider@example.test");

    expect(
      await errorCode(() =>
        caller({ userId: outsider, email: "outsider@example.test" }).tenants.get({
          tenantId: "CASE-0001",
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("stays in its members' list and on its page, marked with when", async () => {
    const member = await seeded("member");
    const admin = await seeded("admin");
    await admin.tenants.deactivate({ tenantId: "CASE-0001" });

    const [listed] = await member.tenants.list();
    const opened = await member.tenants.get({ tenantId: "CASE-0001" });

    expect(listed?.deactivatedAt).toBeString();
    expect(opened.deactivatedAt).toBe(listed?.deactivatedAt ?? "");
    expect(opened.role).toBe("member");
  });

  it("is reactivated by an admin, and access returns as it was", async () => {
    const member = await seeded("member");
    const admin = await seeded("admin");
    await admin.tenants.deactivate({ tenantId: "CASE-0001" });

    const reactivated = await admin.tenants.reactivate({ tenantId: "CASE-0001" });

    expect(reactivated.deactivatedAt).toBeNull();
    expect(await errorCode(() => member.roles.list({ tenantId: "CASE-0001" }))).toBe("NO_ERROR");
    const { rows } = await db.query<{ action: string; actor: string }>(
      "SELECT action, actor FROM ops.audit_log WHERE tenant_id = 'CASE-0001' ORDER BY id",
    );
    expect(rows).toEqual([
      { action: "tenants.deactivate", actor: "admin@example.test" },
      { action: "tenants.reactivate", actor: "admin@example.test" },
    ]);
  });

  it("cannot be deactivated or reactivated by a member", async () => {
    const member = await seeded("member");
    const admin = await seeded("admin");

    expect(await errorCode(() => member.tenants.deactivate({ tenantId: "CASE-0001" }))).toBe(
      "FORBIDDEN",
    );
    expect((await member.tenants.get({ tenantId: "CASE-0001" })).deactivatedAt).toBeNull();

    await admin.tenants.deactivate({ tenantId: "CASE-0001" });
    expect(await errorCode(() => member.tenants.reactivate({ tenantId: "CASE-0001" }))).toBe(
      "FORBIDDEN",
    );
  });

  it("is deactivated and reactivated by a superadmin with no membership, as its admin", async () => {
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-0001')");
    const user = await seedUser("root@example.test");
    const root = caller({ userId: user, email: "root@example.test" }, true);

    await root.tenants.deactivate({ tenantId: "CASE-0001" });
    const back = await root.tenants.reactivate({ tenantId: "CASE-0001" });

    expect(back.deactivatedAt).toBeNull();
  });

  it("refuses a transition to the state it is already in, in both directions", async () => {
    // Never a quiet success: a second "deactivate" that answered ok would let a person believe
    // they cut the customer off, when somebody else did, at a moment they are not told.
    const admin = await seeded("admin");

    expect(await refusedWith(() => admin.tenants.reactivate({ tenantId: "CASE-0001" }))).toBe(
      "PRECONDITION_FAILED:TENANT_ACTIVE",
    );
    await admin.tenants.deactivate({ tenantId: "CASE-0001" });
    expect(await refusedWith(() => admin.tenants.deactivate({ tenantId: "CASE-0001" }))).toBe(
      "PRECONDITION_FAILED:TENANT_DEACTIVATED",
    );
  });
});
