/**
 * The form that gives a permission, or reading one thing (ADR 0142), to a role or a member,
 * standing or until a day -- the Grants view's one write besides taking a grant away
 * (`AccessGrants.tsx`).
 *
 * One select holds both kinds: the permissions the reader holds, read off their own
 * `permissions` through `can`, and the objects they can read, from the server's lists
 * (`useGrantObjects`). The subset rule refuses the rest; offering only these is a courtesy. An
 * expiry is a calendar day, sent as the last second of that day in the schedule zone
 * (`endOfScheduleDay`), so the day picked is the day printed.
 *
 * No `useState`, per `state.md`: the form is uncontrolled and read as `FormData` on submit.
 */

import {
  isPermission,
  PERMISSIONS,
  type Permission,
  parseReachObject,
} from "@undercroft/contracts/access";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";
import { ObjectOptionGroups } from "@/components/GrantObjects.tsx";
import { StatusLine } from "@/components/StatusLine.tsx";
import type { GrantObjects } from "@/components/useGrantObjects.ts";
import { can, PERMISSION_LABELS } from "@/lib/permissions.ts";
import { type RoleOption, roleName } from "@/lib/roles.ts";
import { endOfScheduleDay } from "@/lib/when.ts";
import type { trpc } from "@/trpc.ts";

type Save = ReturnType<typeof trpc.grants.save.useMutation>;

/**
 * How the form's one subject select spells its two kinds of option. A role key never holds a
 * colon (`ROLE_KEY`), and neither prefix is an address, so the first colon always splits it.
 */
const ROLE_OPTION = "role:";
const PERSON_OPTION = "email:";

/** How the one grant select spells a permission; an object option is the object itself. */
const PERMISSION_OPTION = "perm:";

/** What the grant select chose: a permission, or reading an object -- or nothing it offered. */
function grantOf(value: string): { permission: Permission } | { object: string } | null {
  if (value.startsWith(PERMISSION_OPTION)) {
    const permission = value.slice(PERMISSION_OPTION.length);
    return isPermission(permission) ? { permission } : null;
  }
  return parseReachObject(value) === null ? null : { object: value };
}

function subjectOf(value: string): { role: string } | { email: string } | null {
  if (value.startsWith(ROLE_OPTION)) {
    return { role: value.slice(ROLE_OPTION.length) };
  }
  if (value.startsWith(PERSON_OPTION)) {
    return { email: value.slice(PERSON_OPTION.length) };
  }
  return null;
}

/** Whom a grant is to and which permission: the form's two selects. */
function GrantChoices({
  held,
  objects,
  roles,
  roster,
  disabled,
}: {
  held: readonly Permission[] | undefined;
  objects: GrantObjects;
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
          name="grant"
          required={true}
        >
          <optgroup label={t("accessGrants.permissionsGroup")}>
            {offered.map((permission) => (
              <option key={permission} value={`${PERMISSION_OPTION}${permission}`}>
                {t("accessGrants.permissionOption", {
                  label: t(PERMISSION_LABELS[permission]),
                  permission,
                })}
              </option>
            ))}
          </optgroup>
          <ObjectOptionGroups objects={objects} />
        </select>
        <p className="field__hint">{t("accessGrants.grantHint")}</p>
      </div>
    </>
  );
}

/** The form that gives a permission to a role or a member, standing or until a day. */
export function GrantForm({
  tenantId,
  held,
  objects,
  roles,
  roster,
  save,
  formRef,
}: {
  tenantId: string;
  held: readonly Permission[] | undefined;
  objects: GrantObjects;
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
        const grant = grantOf(String(data.get("grant") ?? ""));
        const day = String(data.get("until") ?? "");
        const expiresAt = day === "" ? null : endOfScheduleDay(day);
        if (subject === null || grant === null || (day !== "" && expiresAt === null)) {
          return;
        }
        save.mutate({ tenantId, ...subject, ...grant, expiresAt });
      }}
    >
      <span className="label">{t("accessGrants.addHead")}</span>
      <GrantChoices
        held={held}
        objects={objects}
        roles={roles}
        roster={roster}
        disabled={save.isPending}
      />
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
