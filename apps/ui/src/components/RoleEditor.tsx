/**
 * The People division's Roles view (ADR 0141): every role the customer has -- the four built-ins
 * and its own -- with what each holds and how many use it, and, for a holder of `roles:manage`,
 * the form that defines a role, an edit of a custom role's permissions and its delete.
 *
 * Everything a role holds is the server's answer (`roles.list`); nothing here computes a role's
 * rights. The one thing the browser decides is which boxes it offers: a permission the reader
 * does not hold is locked, because the subset rule refuses giving or taking it away. That is a
 * courtesy -- the server refuses regardless -- and it is read off the reader's own `permissions`
 * through `can`, never off a role's name.
 *
 * No `useState`, per `state.md`. The create form is uncontrolled and read as `FormData` on submit,
 * as `IngestKeys` reads its mint form; an edit's ticks are the store's `roleDraft`, seeded from
 * the server when Edit is pressed, because between Edit and Save they are nobody's but the
 * reader's. A delete is two presses inside a `<details>`, as the roster's removal is.
 */

import type { Permission } from "@undercroft/contracts/access";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";
import { CreateRoleForm, PermissionBoxes, PermissionList } from "@/components/RoleForms.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { StatusLine } from "@/components/StatusLine.tsx";
import { can } from "@/lib/permissions.ts";
import { type ListedRole, roleName } from "@/lib/roles.ts";
import { roleDraftFor, useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

type Save = ReturnType<typeof trpc.roles.save.useMutation>;
type Remove = ReturnType<typeof trpc.roles.delete.useMutation>;

/** The three writes of this view, each refreshing what it changed. */
function useRoleWrites(
  tenantId: string,
  createFormRef: React.RefObject<HTMLFormElement | null>,
): { create: Save; save: Save; remove: Remove } {
  const utils = trpc.useUtils();
  const setRoleDraft = useUiStore((state) => state.setRoleDraft);
  // The reader's own permissions change when the role they hold is edited, and a deleted role's
  // grants go with it; the tenant and the grants are refreshed with the list for both reasons.
  async function refresh(): Promise<void> {
    await utils.roles.list.invalidate({ tenantId });
    await utils.grants.list.invalidate({ tenantId });
    await utils.tenants.invalidate();
  }
  return {
    create: trpc.roles.save.useMutation({
      onSuccess: async () => {
        createFormRef.current?.reset();
        await refresh();
      },
    }),
    save: trpc.roles.save.useMutation({
      onSuccess: async () => {
        setRoleDraft(null);
        await refresh();
      },
    }),
    remove: trpc.roles.delete.useMutation({ onSuccess: refresh }),
  };
}

/** A role's name: a built-in's key, or the customer's label with its key and description. */
function RoleNameCell({ role }: { role: ListedRole }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <td>
      <span className="stack stack--tight">
        <span>{roleName(role)}</span>
        {role.builtin ? <span className="label">{t("roleEditor.builtIn")}</span> : null}
        {role.description === "" ? null : <span className="field__hint">{role.description}</span>}
      </span>
    </td>
  );
}

/** Deleting a customer's own role: two presses, the second naming it. */
function DeleteFold({
  role,
  remove,
  tenantId,
}: {
  role: ListedRole;
  remove: Remove;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <details className="tokenform">
      <summary className="plate plate--small">{t("roleEditor.delete")}</summary>
      <div className="hinge stack stack--tight">
        <p className="note">{t("roleEditor.deleteLead")}</p>
        <button
          className="plate plate--small plate--primary"
          type="button"
          disabled={remove.isPending}
          onClick={(): void => {
            remove.mutate({ tenantId, key: role.key });
          }}
        >
          {remove.isPending && remove.variables.key === role.key
            ? t("roleEditor.deleting")
            : t("roleEditor.deleteConfirm", { role: roleName(role) })}
        </button>
      </div>
    </details>
  );
}

/** One row of the table: a role, what it holds, who uses it, and -- for an editor -- its changes. */
function RoleRow({
  role,
  tenantId,
  held,
  canEdit,
  writes,
}: {
  role: ListedRole;
  tenantId: string;
  held: readonly Permission[] | undefined;
  canEdit: boolean;
  writes: { save: Save; remove: Remove };
}): React.JSX.Element {
  const { t } = useTranslation();
  const draft = useUiStore((state) => roleDraftFor(state, tenantId, role.key));
  const setRoleDraft = useUiStore((state) => state.setRoleDraft);
  const toggle = useUiStore((state) => state.toggleRolePermission);
  const editing = draft !== null && !role.builtin;
  return (
    <tr>
      <RoleNameCell role={role} />
      <td>
        {editing ? (
          <PermissionBoxes
            legend={t("roleEditor.permissionsFor", { role: roleName(role) })}
            held={held}
            disabled={writes.save.isPending}
            ticked={draft}
            onToggle={(permission): void => {
              toggle(tenantId, role.key, permission);
            }}
          />
        ) : (
          <PermissionList permissions={role.permissions} />
        )}
      </td>
      <td className="datum datum--quiet">
        {t("roleEditor.holders", { members: role.members, invitations: role.invitations })}
      </td>
      {canEdit ? (
        <td>
          {role.builtin ? null : (
            <span className="stack stack--tight">
              {editing ? (
                <span className="row">
                  <button
                    className="plate plate--small plate--primary"
                    type="button"
                    disabled={writes.save.isPending}
                    onClick={(): void => {
                      writes.save.mutate({
                        tenantId,
                        key: role.key,
                        label: role.label ?? role.key,
                        description: role.description,
                        permissions: [...draft],
                      });
                    }}
                  >
                    {writes.save.isPending ? t("roleEditor.saving") : t("roleEditor.save")}
                  </button>
                  <button
                    className="plate plate--small"
                    type="button"
                    disabled={writes.save.isPending}
                    onClick={(): void => {
                      setRoleDraft(null);
                    }}
                  >
                    {t("roleEditor.cancel")}
                  </button>
                </span>
              ) : (
                <button
                  className="plate plate--small"
                  type="button"
                  onClick={(): void => {
                    setRoleDraft({ tenantId, key: role.key, permissions: role.permissions });
                  }}
                >
                  {t("roleEditor.edit")}
                </button>
              )}
              <DeleteFold role={role} remove={writes.remove} tenantId={tenantId} />
            </span>
          )}
        </td>
      ) : null}
    </tr>
  );
}

/** What the last edit or delete did, in the server's words on a refusal. */
function RoleOutcome({ save, remove }: { save: Save; remove: Remove }): React.JSX.Element {
  const { t } = useTranslation();
  const saved =
    save.isSuccess && save.data.unchanged
      ? t("roleEditor.unchanged", { role: save.data.key })
      : t("roleEditor.saved", { role: save.data?.key ?? "" });
  return (
    <>
      {save.isError ? (
        <Errata heading={t("roleEditor.notSaved")} live={true} error={save.error} />
      ) : null}
      <StatusLine className="note" text={save.isSuccess ? saved : null} />
      {remove.isError ? (
        <Errata heading={t("roleEditor.notDeleted")} live={true} error={remove.error} />
      ) : null}
      <StatusLine
        className="note"
        text={remove.isSuccess ? t("roleEditor.deleted", { role: remove.variables.key }) : null}
      />
    </>
  );
}

/**
 * The Roles view. `held` is the reader's own permissions (`tenants.get`): whether they may change
 * roles at all is `roles:manage`, and which boxes they may tick is what they hold.
 */
export function RolesView({
  tenantId,
  held,
}: {
  tenantId: string;
  held: readonly Permission[] | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const createFormRef = useRef<HTMLFormElement>(null);
  const roles = trpc.roles.list.useQuery({ tenantId });
  const writes = useRoleWrites(tenantId, createFormRef);
  const canEdit = can(held, "roles:manage");

  if (roles.isPending) {
    return <Skeleton rows={4} />;
  }
  if (roles.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("roleEditor.notLoaded", { tenantId })}
      </Errata>
    );
  }
  return (
    <>
      {canEdit ? null : <p className="note">{t("roleEditor.readOnly")}</p>}
      <div className="table-scroll">
        <table className="table">
          <caption>{t("roleEditor.caption", { count: roles.data.roles.length })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("roleEditor.colRole")}</th>
              <th scope="col">{t("roleEditor.colPermissions")}</th>
              <th scope="col">{t("roleEditor.colHolders")}</th>
              {canEdit ? <th scope="col">{t("roleEditor.colChange")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {roles.data.roles.map((role) => (
              <RoleRow
                key={role.key}
                role={role}
                tenantId={tenantId}
                held={held}
                canEdit={canEdit}
                writes={writes}
              />
            ))}
          </tbody>
        </table>
      </div>
      <RoleOutcome save={writes.save} remove={writes.remove} />
      {canEdit ? (
        <CreateRoleForm
          tenantId={tenantId}
          held={held}
          create={writes.create}
          formRef={createFormRef}
        />
      ) : null}
    </>
  );
}
