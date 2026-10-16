/**
 * The projection's refusal to read what the catalogue does not know (ADR 0141), asked of the
 * pure function with no database.
 *
 * Casbin's `keyMatch` treats `*` in a policy object as a pattern, so a stored `*` -- a custom
 * role's permission array is free text to the database -- would be every permission if it reached
 * the enforcer. Each guard is pinned from both sides: the pattern projects nothing, and a known
 * permission beside it still holds. Reach (ADR 0142) is pinned the same way below: a wildcard
 * the grammar admits is the whole of its domain, and one it does not admit reaches nothing.
 */

import { describe, expect, test as it } from "bun:test";
import { type Holder, holdingOf, holdingOfRole, type RolePolicy } from "./rbac.ts";

async function permissionsOf(holder: Holder) {
  return (await holdingOf(holder)).permissions;
}

async function permissionsOfRole(role: RolePolicy) {
  return (await holdingOfRole(role)).permissions;
}

const TENANT = "CASE-0042";
const USER = "00000000-0000-4000-8000-000000000001";

describe("what the catalogue does not know projects nothing", () => {
  it("a custom role's stored '*' grants nothing, while its known permission holds", async () => {
    expect(
      await permissionsOf({
        userId: USER,
        tenantId: TENANT,
        role: "wide",
        rolePermissions: ["*", "lake:read"],
        grants: [],
      }),
    ).toEqual(["lake:read"]);
  });

  it("a grant whose object is a pattern grants nothing, to the person or the role", async () => {
    const grants = [
      { toRole: false, object: "perm:*", action: "use" },
      { toRole: true, object: "perm:*", action: "use" },
      { toRole: false, object: "perm:models:write", action: "use" },
    ];

    expect(
      await permissionsOf({
        userId: USER,
        tenantId: TENANT,
        role: "viewer",
        rolePermissions: [],
        grants,
      }),
    ).toEqual(["models:write"]);
    expect(
      await permissionsOfRole({ tenantId: TENANT, role: "viewer", rolePermissions: [], grants }),
    ).toEqual([]);
  });

  it("a grant to a person is not what the role confers", async () => {
    const grants = [
      { toRole: true, object: "perm:lake:read", action: "use" },
      { toRole: false, object: "perm:models:write", action: "use" },
    ];

    expect(
      await permissionsOfRole({ tenantId: TENANT, role: "member", rolePermissions: [], grants }),
    ).toEqual(["lake:read", "reports:author"]);
  });
});

const BUILT_IN = { userId: USER, tenantId: TENANT, rolePermissions: [], grants: [] } as const;

async function reachOf(holder: Holder) {
  return (await holdingOf(holder)).reach;
}

describe("what a holder reaches (ADR 0142)", () => {
  it("a built-in role reaches the whole customer, a customer's own role reaches nothing ungranted", async () => {
    expect(await reachOf({ ...BUILT_IN, role: "viewer" })).toEqual({
      models: "all",
      raw: "all",
      reports: "all",
    });
    expect(await reachOf({ ...BUILT_IN, role: "sales" })).toEqual({
      models: [],
      raw: { sources: [], streams: [] },
      reports: { questions: [], dashboards: [] },
    });
  });

  it("a grant to the role and one to the person both add, and a grant to the person is not the role's", async () => {
    const grants = [
      { toRole: true, object: "model:fct_sales", action: "read" },
      { toRole: false, object: "raw:hubspot/deals", action: "read" },
    ];
    const holder = { ...BUILT_IN, role: "sales", grants };

    expect(await reachOf(holder)).toEqual({
      models: ["fct_sales"],
      raw: { sources: [], streams: [{ source: "hubspot", entity: "deals" }] },
      reports: { questions: [], dashboards: [] },
    });
    const role = (
      await holdingOfRole({ tenantId: TENANT, role: "sales", rolePermissions: [], grants })
    ).reach;
    expect(role.models).toEqual(["fct_sales"]);
    expect(role.raw).toEqual({ sources: [], streams: [] });
  });

  it("a wildcard reaches the whole of its domain, and a source's reaches that source alone", async () => {
    const reach = await reachOf({
      ...BUILT_IN,
      role: "sales",
      grants: [
        { toRole: true, object: "model:*", action: "read" },
        { toRole: true, object: "raw:gmail/*", action: "read" },
      ],
    });

    expect(reach.models).toBe("all");
    // A second mailbox is a source of its own (ADR 0043): `gmail/*` is not `gmail.<key>/*`.
    expect(reach.raw).toEqual({ sources: ["gmail"], streams: [] });
    expect(reach.reports).toEqual({ questions: [], dashboards: [] });
  });

  it("an object outside the grammar, or with the other action, reaches nothing", async () => {
    const reach = await reachOf({
      ...BUILT_IN,
      role: "sales",
      grants: [
        { toRole: true, object: "model:fct_*", action: "read" },
        { toRole: true, object: "*", action: "read" },
        { toRole: true, object: "raw:gmail.*", action: "read" },
        { toRole: true, object: "model:orders", action: "use" },
        { toRole: true, object: "model:fct_sales", action: "read" },
      ],
    });

    expect(reach).toEqual({
      models: ["fct_sales"],
      raw: { sources: [], streams: [] },
      reports: { questions: [], dashboards: [] },
    });
  });

  it("an object grant confers no permission, and a permission grant reaches nothing", async () => {
    const holding = await holdingOf({
      ...BUILT_IN,
      role: "sales",
      grants: [
        { toRole: true, object: "model:*", action: "read" },
        { toRole: true, object: "perm:lake:read", action: "use" },
      ],
    });

    expect(holding.permissions).toEqual(["lake:read"]);
    expect(holding.reach.raw).toEqual({ sources: [], streams: [] });
  });
});
