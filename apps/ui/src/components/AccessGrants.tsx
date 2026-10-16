/**
 * The People division's Grants view (ADR 0141): every permission given straight to a role or a
 * person, standing or until a day, and -- for a holder of `roles:manage` -- the form that gives
 * one and the fold that takes one away.
 *
 * Reading the list needs `people:manage`, which the whole division already needs: a grant to a
 * person says who holds what, as the roster does. What a grant means is the server's: whether it
 * has expired is `expired` in the answer, decided by the database's clock, never by this tab's.
 *
 * The form offers only the permissions the reader holds, because the subset rule refuses the
 * rest; that is read off the reader's own `permissions` through `can`. An expiry is a calendar
 * day, sent as the last second of that day in the schedule zone (`endOfScheduleDay`), so the
 * day picked is the day printed.
 *
 * No `useState`, per `state.md`: the form is uncontrolled and read as `FormData` on submit, and a
 * removal is two presses inside a `<details>`.
 */

import { isPermission, PERMISSIONS, type Permission } from "@undercroft/contracts/access";
import type { Locale } from "@undercroft/core/locale";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Address } from "@/components/Address.tsx";
import { Errata } from "@/components/Errata.tsx";
import { PermissionWords } from "@/components/RoleForms.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { StatusLine } from "@/components/StatusLine.tsx";
import { MISSING } from "@/lib/money.ts";
import { can, PERMISSION_LABELS } from "@/lib/permissions.ts";
import { type RoleOption, roleName, roleNamed, roleOptions } from "@/lib/roles.ts";
import { endOfScheduleDay, formatDate } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

type Save = ReturnType<typeof trpc.grants.save.useMutation>;
type Remove = ReturnType<typeof trpc.grants.delete.useMutation>;

/** One grant as `grants.list` answers it, as far as this view reads one. */
interface Grant {
  readonly id: string;
  readonly subject: "role" | "user";
  readonly role: string | null;
  readonly email: string | null;
  readonly permission: Permission | null;
  readonly object: string;
  readonly expiresAt: string | null;
  readonly expired: boolean;
  readonly grantedBy: string | null;
}

/**
 * How the form's one subject select spells its two kinds of option. A role key never holds a
 * colon (`ROLE_KEY`), and neither prefix is an address, so the first colon always splits it.
 */
const ROLE_OPTION = "role:";
const PERSON_OPTION = "email:";

function subjectOf(value: string): { role: string } | { email: string } | null {
  if (value.startsWith(ROLE_OPTION)) {
    return { role: value.slice(ROLE_OPTION.length) };
  }
  if (value.startsWith(PERSON_OPTION)) {
    return { email: value.slice(PERSON_OPTION.length) };
  }
  return null;
}

/** Who a grant is to, as a reader names them: a role by its name, a person by address. */
function subjectName(grant: Grant, roles: readonly RoleOption[] | undefined): string {
  return grant.role === null ? (grant.email ?? MISSING) : roleNamed(grant.role, roles);
}

/** The two writes of this view, each refreshing the list and the reader's own standing. */
function useGrantWrites(
  tenantId: string,
  formRef: React.RefObject<HTMLFormElement | null>,
): { save: Save; remove: Remove } {
  const utils = trpc.useUtils();
  async function refresh(): Promise<void> {
    await utils.grants.list.invalidate({ tenantId });
    await utils.tenants.invalidate();
  }
  return {
    save: trpc.grants.save.useMutation({
      onSuccess: async () => {
        formRef.current?.reset();
        await refresh();
      },
    }),
    remove: trpc.grants.delete.useMutation({ onSuccess: refresh }),
  };
}

/** Until when a grant holds: standing, until a day, or since when it holds nothing. */
function UntilCell({ grant, locale }: { grant: Grant; locale: Locale }): React.JSX.Element {
  const { t } = useTranslation();
  if (grant.expiresAt === null) {
    return <td>{t("accessGrants.standing")}</td>;
  }
  const date = formatDate(grant.expiresAt, locale);
  return grant.expired ? (
    <td className="datum--quiet">{t("accessGrants.expired", { date })}</td>
  ) : (
    <td>{t("accessGrants.until", { date })}</td>
  );
}

/** Taking one grant away: two presses, the second naming whose. */
function RevokeFold({
  grant,
  subject,
  remove,
  tenantId,
}: {
  grant: Grant;
  subject: string;
  remove: Remove;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <td>
      <details className="tokenform">
        <summary className="plate plate--small">{t("accessGrants.revoke")}</summary>
        <div className="hinge">
          <button
            className="plate plate--small plate--primary"
            type="button"
            disabled={remove.isPending}
            onClick={(): void => {
              remove.mutate({ tenantId, id: grant.id });
            }}
          >
            {remove.isPending && remove.variables.id === grant.id
              ? t("accessGrants.revoking")
              : t("accessGrants.revokeConfirm", { subject })}
          </button>
        </div>
      </details>
    </td>
  );
}

/** The grants as a table. */
function GrantTable({
  grants,
  roles,
  canChange,
  remove,
  tenantId,
}: {
  grants: readonly Grant[];
  roles: readonly RoleOption[] | undefined;
  canChange: boolean;
  remove: Remove;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  return (
    <div className="table-scroll">
      <table className="table">
        <caption>{t("accessGrants.caption", { count: grants.length })}</caption>
        <thead>
          <tr>
            <th scope="col">{t("accessGrants.colSubject")}</th>
            <th scope="col">{t("accessGrants.colPermission")}</th>
            <th scope="col">{t("accessGrants.colUntil")}</th>
            <th scope="col">{t("accessGrants.colGrantedBy")}</th>
            {canChange ? <th scope="col">{t("accessGrants.colRevoke")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {grants.map((grant) => {
            const subject = subjectName(grant, roles);
            return (
              <tr key={grant.id}>
                <td>
                  {grant.role === null ? (
                    <Address email={subject} />
                  ) : (
                    t("accessGrants.toRole", { role: subject })
                  )}
                </td>
                <td>
                  {grant.permission === null ? (
                    t("accessGrants.unknownPermission", { object: grant.object })
                  ) : (
                    <PermissionWords permission={grant.permission} />
                  )}
                </td>
                <UntilCell grant={grant} locale={locale} />
                <td className="datum datum--quiet">
                  {grant.grantedBy === null ? MISSING : <Address email={grant.grantedBy} />}
                </td>
                {canChange ? (
                  <RevokeFold grant={grant} subject={subject} remove={remove} tenantId={tenantId} />
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Whom a grant is to and which permission: the form's two selects. */
function GrantChoices({
  held,
  roles,
  roster,
  disabled,
}: {
  held: readonly Permission[] | undefined;
  roles: readonly RoleOption[];
  roster: readonly { email: string }[];
  disabled: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const subjectId = useId();
  const permissionId = useId();
  const offered = PERMISSIONS.filter((permission) => can(held, permission));
  return (
    <>
      <div className="field">
        <label className="label" htmlFor={subjectId}>
          {t("accessGrants.subjectLabel")}
        </label>
        <select className="input" disabled={disabled} id={subjectId} name="subject" required={true}>
          <optgroup label={t("accessGrants.rolesGroup")}>
            {roles.map((role) => (
              <option key={role.key} value={`${ROLE_OPTION}${role.key}`}>
                {roleName(role)}
              </option>
            ))}
          </optgroup>
          <optgroup label={t("accessGrants.peopleGroup")}>
            {roster.map((member) => (
              <option key={member.email} value={`${PERSON_OPTION}${member.email}`}>
                {member.email}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor={permissionId}>
          {t("accessGrants.permissionLabel")}
        </label>
        <select
          className="input"
          disabled={disabled}
          id={permissionId}
          name="permission"
          required={true}
        >
          {offered.map((permission) => (
            <option key={permission} value={permission}>
              {t("accessGrants.permissionOption", {
                label: t(PERMISSION_LABELS[permission]),
                permission,
              })}
            </option>
          ))}
        </select>
        <p className="field__hint">{t("roleEditor.heldOnly")}</p>
      </div>
    </>
  );
}

/** The form that gives a permission to a role or a member, standing or until a day. */
function GrantForm({
  tenantId,
  held,
  roles,
  roster,
  save,
  formRef,
}: {
  tenantId: string;
  held: readonly Permission[] | undefined;
  roles: readonly RoleOption[];
  roster: readonly { email: string }[];
  save: Save;
  formRef: React.RefObject<HTMLFormElement | null>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const untilId = useId();
  const untilHintId = useId();
  return (
    <form
      className="stack stack--tight"
      ref={formRef}
      onSubmit={(event): void => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const subject = subjectOf(String(data.get("subject") ?? ""));
        const permission = String(data.get("permission") ?? "");
        const day = String(data.get("until") ?? "");
        const expiresAt = day === "" ? null : endOfScheduleDay(day);
        if (subject === null || !isPermission(permission) || (day !== "" && expiresAt === null)) {
          return;
        }
        save.mutate({ tenantId, ...subject, permission, expiresAt });
      }}
    >
      <span className="label">{t("accessGrants.addHead")}</span>
      <GrantChoices held={held} roles={roles} roster={roster} disabled={save.isPending} />
      <div className="field">
        <label className="label" htmlFor={untilId}>
          {t("accessGrants.untilLabel")}
        </label>
        <input
          aria-describedby={untilHintId}
          className="input"
          disabled={save.isPending}
          id={untilId}
          name="until"
          type="date"
        />
        <p className="field__hint" id={untilHintId}>
          {t("accessGrants.untilHint")}
        </p>
      </div>
      {save.isError ? (
        <Errata heading={t("accessGrants.notAdded")} live={true} error={save.error} />
      ) : null}
      <StatusLine className="note" text={save.isSuccess ? t("accessGrants.added") : null} />
      <div className="row">
        <button className="plate plate--primary" type="submit" disabled={save.isPending}>
          {save.isPending ? t("accessGrants.adding") : t("accessGrants.add")}
        </button>
      </div>
    </form>
  );
}

/**
 * The Grants view. `held` is the reader's own permissions: whether they may change grants is
 * `roles:manage`, and which permissions they may give is what they hold. `roster` is who may be
 * named, and `roles` how a role is named -- both read once by the page.
 */
export function GrantsView({
  tenantId,
  held,
  roles,
  roster,
}: {
  tenantId: string;
  held: readonly Permission[] | undefined;
  roles: readonly RoleOption[] | undefined;
  roster: readonly { email: string }[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const grants = trpc.grants.list.useQuery({ tenantId });
  const writes = useGrantWrites(tenantId, formRef);
  const canChange = can(held, "roles:manage");

  if (grants.isPending) {
    return <Skeleton rows={3} />;
  }
  if (grants.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("accessGrants.notLoaded", { tenantId })}
      </Errata>
    );
  }
  return (
    <>
      {canChange ? null : <p className="note">{t("accessGrants.readOnly")}</p>}
      {grants.data.length === 0 ? (
        <p className="note">{t("accessGrants.none")}</p>
      ) : (
        <GrantTable
          grants={grants.data}
          roles={roles}
          canChange={canChange}
          remove={writes.remove}
          tenantId={tenantId}
        />
      )}
      {writes.remove.isError ? (
        <Errata heading={t("accessGrants.notRevoked")} live={true} error={writes.remove.error} />
      ) : null}
      {canChange ? (
        <GrantForm
          tenantId={tenantId}
          held={held}
          roles={roleOptions(roles)}
          roster={roster}
          save={writes.save}
          formRef={formRef}
        />
      ) : null}
    </>
  );
}
