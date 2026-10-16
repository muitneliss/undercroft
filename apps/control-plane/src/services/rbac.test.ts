/**
 * The projection's refusal to read what the catalogue does not know (ADR 0141), asked of the
 * pure function with no database.
 *
 * Casbin's `keyMatch` treats `*` in a policy object as a pattern, so a stored `*` -- a custom
 * role's permission array is free text to the database, and a grant's object will widen in a
 * later change -- would be every permission if it reached the enforcer. Each guard is pinned
 * from both sides: the pattern projects nothing, and a known permission beside it still holds.
 */

import { describe, expect, test as it } from "bun:test";
import { permissionsOf, permissionsOfRole } from "./rbac.ts";

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
