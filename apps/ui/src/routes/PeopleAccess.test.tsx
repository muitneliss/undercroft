/**
 * The People division's role editor and grants (ADR 0141), as a reader uses them: defining a role
 * that the roster then offers, editing a customer's own role, and giving and taking away a grant.
 *
 * No mocks: the real route, store, tRPC client and react-query, over `mountRoute`'s in-memory
 * server, whose answers here keep the roles and grants a write adds -- so what the page shows
 * after a write is what it read back, not what it assumed -- and which refuses every procedure it
 * was not given.
 */

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { type Permission, PERMISSIONS } from "@undercroft/contracts/access";

import { translatorFor } from "@/i18n/index.ts";
import type { ListedRole } from "@/lib/roles.ts";
import { People } from "@/routes/People.tsx";
import { useUiStore } from "@/store.ts";
import { builtInRoles, held } from "@/test/access.ts";
import { mountRoute, type Received } from "@/test/mountRoute.tsx";

const TENANT = "CASE-0042";
const t = translatorFor("vi");

afterEach(() => {
  cleanup();
  useUiStore.getState().setRoleDraft(null);
});

interface Grant {
  id: string;
  subject: "role" | "user";
  role: string | null;
  email: string | null;
  permission: Permission | null;
  object: string;
  action: string;
  expiresAt: string | null;
  expired: boolean;
  grantedBy: string | null;
  createdAt: string;
}

/** A field of a request's input, read without a cast. */
function field(input: unknown, name: string): unknown {
  return typeof input === "object" && input !== null ? Reflect.get(input, name) : undefined;
}

/**
 * The division at `url`, read by a reader holding `permissions`, over a server that keeps the
 * roles and the grants it is sent.
 */
/** What the reader reaches, as `grants.reach` answers it; a built-in's is the whole customer. */
interface Reached {
  models: "all" | string[];
  raw: "all";
  reports: "all";
}

function open(
  url: string,
  {
    permissions = held("admin"),
    roles = builtInRoles(),
    grants = [],
    reach = { models: "all", raw: "all", reports: "all" },
  }: { permissions?: Permission[]; roles?: ListedRole[]; grants?: Grant[]; reach?: Reached } = {},
): { received: Received[] } {
  const kept = { roles: [...roles], grants: [...grants] };
  return mountRoute({
    pattern: "/",
    url,
    element: <People tenantId={TENANT} signedInAs="ada@example.test" />,
    answers: {
      "tenants.get": () => ({
        id: TENANT,
        displayName: "Acme",
        role: "admin",
        roleLabel: null,
        permissions,
        deactivatedAt: null,
      }),
      "people.members": () => [
        { userId: "u1", email: "ada@example.test", role: "admin" },
        { userId: "u2", email: "bo@example.test", role: "member" },
      ],
      "people.invitations": () => [],
      "roles.list": () => ({ roles: kept.roles, permissions: PERMISSIONS }),
      "roles.save": (input) => {
        const key = String(field(input, "key"));
        const saved: ListedRole = {
          key,
          builtin: false,
          label: String(field(input, "label")),
          description: String(field(input, "description") ?? ""),
          permissions: PERMISSIONS.filter((p) =>
            (field(input, "permissions") as readonly string[]).includes(p),
          ),
          members: 0,
          invitations: 0,
        };
        kept.roles = [...kept.roles.filter((role) => role.key !== key), saved];
        return { key, unchanged: false };
      },
      "grants.list": () => kept.grants,
      "grants.reach": () => ({ permissions, reach }),
      "models.list": () => [{ name: "fct_sales" }],
      "seeds.list": () => [{ name: "fx_rates" }],
      "lake.summary": () => ({
        records: [{ source: "hubspot", entity: "deals" }],
        documents: [{ source: "gmail" }],
      }),
      "bi.questions.list": () => [{ id: QUESTION, name: "Doanh thu" }],
      "bi.dashboards.list": () => [],
      "grants.save": (input) => {
        const permission = (field(input, "permission") as Permission | undefined) ?? null;
        const email = field(input, "email");
        const grant: Grant = {
          id: `g-${kept.grants.length + 1}`,
          subject: email === undefined ? "role" : "user",
          role: email === undefined ? String(field(input, "role")) : null,
          email: email === undefined ? null : String(email),
          permission,
          object: permission === null ? String(field(input, "object")) : `perm:${permission}`,
          action: permission === null ? "read" : "use",
          expiresAt: (field(input, "expiresAt") as string | null) ?? null,
          expired: false,
          grantedBy: "ada@example.test",
          createdAt: "2026-10-16T02:00:00.000Z",
        };
        kept.grants = [...kept.grants, grant];
        return { id: grant.id, unchanged: false };
      },
      "grants.delete": (input) => {
        kept.grants = kept.grants.filter((grant) => grant.id !== field(input, "id"));
        return { ok: true };
      },
    },
  });
}

/** What the server was sent for `path`, in order. */
function sent(received: readonly Received[], path: string): unknown[] {
  return received.filter((request) => request.path === path).map((request) => request.input);
}

const QUESTION = "00000000-0000-4000-8000-0000000000a1";

const ACCOUNTANT: ListedRole = {
  key: "accountant",
  builtin: false,
  label: "Kế toán",
  description: "",
  permissions: ["lake:read"],
  members: 0,
  invitations: 0,
};

describe("the role editor", () => {
  it("defines a role, which the table then lists and the roster offers by its label", async () => {
    const { received } = open("/?view=roles");
    const form = (await screen.findByText(t("roleEditor.createHead"))).closest("form");
    if (form === null) {
      throw new Error("the create form is not a form");
    }

    fireEvent.change(within(form).getByLabelText(t("roleEditor.keyLabel")), {
      target: { value: "accountant" },
    });
    fireEvent.change(within(form).getByLabelText(t("roleEditor.labelLabel")), {
      target: { value: "Kế toán" },
    });
    const lakeRead = within(form)
      .getAllByRole("checkbox")
      .find((box) => box instanceof HTMLInputElement && box.value === "lake:read");
    if (lakeRead === undefined) {
      throw new Error("no box for lake:read");
    }
    fireEvent.click(lakeRead);
    fireEvent.click(within(form).getByRole("button", { name: t("roleEditor.create") }));

    expect(await screen.findByText("Kế toán (accountant)")).toBeDefined();
    expect(sent(received, "roles.save")).toEqual([
      {
        tenantId: TENANT,
        key: "accountant",
        label: "Kế toán",
        description: "",
        permissions: ["lake:read"],
        create: true,
      },
    ]);

    fireEvent.click(screen.getByRole("link", { name: t("people.viewMembers", { count: 2 }) }));
    const select = await screen.findByLabelText(t("people.roleFor", { email: "bo@example.test" }));
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "viewer",
      "member",
      "builder",
      "admin",
      "Kế toán (accountant)",
    ]);
  });

  it("edits a customer's own role through a draft, and saves the permissions ticked", async () => {
    const { received } = open("/?view=roles", { roles: [...builtInRoles(), ACCOUNTANT] });

    fireEvent.click(await screen.findByRole("button", { name: t("roleEditor.edit") }));
    const fieldset = screen.getByRole("group", {
      name: t("roleEditor.permissionsFor", { role: "Kế toán (accountant)" }),
    });
    const author = within(fieldset)
      .getAllByRole("checkbox")
      .find((box) => box instanceof HTMLInputElement && box.value === "reports:author");
    if (author === undefined) {
      throw new Error("no box for reports:author");
    }
    fireEvent.click(author);
    fireEvent.click(screen.getByRole("button", { name: t("roleEditor.save") }));

    await waitFor(() => {
      expect(sent(received, "roles.save")).toEqual([
        {
          tenantId: TENANT,
          key: "accountant",
          label: "Kế toán",
          description: "",
          permissions: ["lake:read", "reports:author"],
        },
      ]);
    });
    expect(await screen.findByText(t("roleEditor.saved", { role: "accountant" }))).toBeDefined();
    expect(useUiStore.getState().roleDraft).toBeNull();
  });

  it("is a comparison alone for a reader without roles:manage, who is told what it needs", async () => {
    open("/?view=roles", {
      permissions: ["people:manage"],
      roles: [...builtInRoles(), ACCOUNTANT],
    });

    expect(await screen.findByText("Kế toán (accountant)")).toBeDefined();
    expect(screen.getByText(t("roleEditor.readOnly"))).toBeDefined();
    expect(screen.queryByText(t("roleEditor.createHead"))).toBeNull();
    expect(screen.queryByRole("button", { name: t("roleEditor.edit") })).toBeNull();
  });
});

describe("the grants", () => {
  const STANDING: Grant = {
    id: "g-0",
    subject: "role",
    role: "member",
    email: null,
    permission: "lake:read",
    object: "perm:lake:read",
    action: "use",
    expiresAt: null,
    expired: false,
    grantedBy: "ada@example.test",
    createdAt: "2026-10-01T02:00:00.000Z",
  };

  it("gives a member a permission until the end of a day in Singapore time", async () => {
    const { received } = open("/?view=access");
    const form = (await screen.findByText(t("accessGrants.addHead"))).closest("form");
    if (form === null) {
      throw new Error("the grant form is not a form");
    }

    fireEvent.change(within(form).getByLabelText(t("accessGrants.subjectLabel")), {
      target: { value: "email:bo@example.test" },
    });
    fireEvent.change(within(form).getByLabelText(t("accessGrants.permissionLabel")), {
      target: { value: "perm:models:write" },
    });
    fireEvent.change(within(form).getByLabelText(t("accessGrants.untilLabel")), {
      target: { value: "2026-10-31" },
    });
    fireEvent.click(within(form).getByRole("button", { name: t("accessGrants.add") }));

    expect(await screen.findByText("bo@example.test")).toBeDefined();
    expect(sent(received, "grants.save")).toEqual([
      {
        tenantId: TENANT,
        email: "bo@example.test",
        permission: "models:write",
        expiresAt: "2026-10-31T15:59:59.000Z",
      },
    ]);
  });

  it("gives a role reading one model, offered from the models the server lists", async () => {
    const { received } = open("/?view=access");
    const form = (await screen.findByText(t("accessGrants.addHead"))).closest("form");
    if (form === null) {
      throw new Error("the grant form is not a form");
    }
    await within(form).findByRole("option", { name: "fct_sales" });

    fireEvent.change(within(form).getByLabelText(t("accessGrants.subjectLabel")), {
      target: { value: "role:member" },
    });
    fireEvent.change(within(form).getByLabelText(t("accessGrants.permissionLabel")), {
      target: { value: "model:fct_sales" },
    });
    fireEvent.click(within(form).getByRole("button", { name: t("accessGrants.add") }));

    expect(await screen.findByText(t("grantObjects.model", { name: "fct_sales" }))).toBeDefined();
    expect(sent(received, "grants.save")).toEqual([
      { tenantId: TENANT, role: "member", object: "model:fct_sales", expiresAt: null },
    ]);
  });

  it("offers a wildcard only to a reader the server says reaches the whole of it", async () => {
    open("/?view=access", { reach: { models: ["fct_sales"], raw: "all", reports: "all" } });
    const form = (await screen.findByText(t("accessGrants.addHead"))).closest("form");
    if (form === null) {
      throw new Error("the grant form is not a form");
    }
    await within(form).findByRole("option", { name: t("grantObjects.wholeLake") });

    expect(within(form).queryByRole("option", { name: t("grantObjects.everyModel") })).toBeNull();
    expect(
      within(form).getByRole("option", {
        name: t("grantObjects.stream", { source: "hubspot", entity: "deals" }),
      }),
    ).toBeDefined();
    expect(
      within(form).getByRole("option", {
        name: t("grantObjects.questionOption", { name: "Doanh thu" }),
      }),
    ).toBeDefined();
  });

  it("takes a grant away on the second press only, which names whose it is", async () => {
    const { received } = open("/?view=access", { grants: [STANDING] });

    fireEvent.click(await screen.findByText(t("accessGrants.revoke")));
    const confirm = screen.getByRole("button", {
      name: t("accessGrants.revokeConfirm", { subject: "member" }),
    });
    const afterFirstPress = sent(received, "grants.delete").length;
    fireEvent.click(confirm);

    expect(afterFirstPress).toBe(0);
    expect(await screen.findByText(t("accessGrants.none"))).toBeDefined();
    expect(sent(received, "grants.delete")).toEqual([{ tenantId: TENANT, id: "g-0" }]);
  });

  it("offers a reader without roles:manage the list and no way to change it", async () => {
    open("/?view=access", { permissions: ["people:manage"], grants: [STANDING] });

    expect(await screen.findByText(t("accessGrants.toRole", { role: "member" }))).toBeDefined();
    expect(screen.getByText(t("accessGrants.readOnly"))).toBeDefined();
    expect(screen.queryByText(t("accessGrants.revoke"))).toBeNull();
    expect(screen.queryByText(t("accessGrants.addHead"))).toBeNull();
  });
});
