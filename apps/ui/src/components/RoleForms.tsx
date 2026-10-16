/**
 * The parts of the Roles view that name and choose permissions: a permission in words with its
 * key, a role's list of them, the punched boxes that choose them, and the form that defines a
 * role. Out of `RoleEditor.tsx` for length; the reasoning is in that module's docstring.
 */

import { isPermission, PERMISSIONS, type Permission } from "@undercroft/contracts/access";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";
import { StatusLine } from "@/components/StatusLine.tsx";
import { can, PERMISSION_LABELS } from "@/lib/permissions.ts";
import type { trpc } from "@/trpc.ts";

type Save = ReturnType<typeof trpc.roles.save.useMutation>;

/** A permission in words, with its key beside it: what a person reads and what they quote. */
export function PermissionWords({ permission }: { permission: Permission }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <span className="stack stack--tight">
      <span>{t(PERMISSION_LABELS[permission])}</span>
      <span className="datum datum--quiet">{permission}</span>
    </span>
  );
}

/** What a role holds, one permission a line, or that it holds none. */
export function PermissionList({
  permissions,
}: {
  permissions: readonly Permission[];
}): React.JSX.Element {
  const { t } = useTranslation();
  if (permissions.length === 0) {
    return <span className="datum--quiet">{t("roleEditor.noPermissions")}</span>;
  }
  return (
    <span className="stack stack--tight">
      {permissions.map((permission) => (
        <PermissionWords key={permission} permission={permission} />
      ))}
    </span>
  );
}

/**
 * The catalogue as punched boxes, inside a fieldset: the create form's, uncontrolled and named
 * `permission` for its `FormData`, or an edit's, ticked from the draft. A box the reader does not
 * hold is locked either way (the module's docstring says why).
 */
export function PermissionBoxes({
  legend,
  held,
  disabled,
  ticked,
  onToggle,
}: {
  legend: string;
  held: readonly Permission[] | undefined;
  disabled: boolean;
  /** An edit's draft; absent for the create form, whose boxes start empty. */
  ticked?: readonly Permission[];
  onToggle?: (permission: Permission) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const hintId = useId();
  return (
    <fieldset aria-describedby={hintId} className="field">
      <legend className="label">{legend}</legend>
      <div className="stack stack--tight">
        {PERMISSIONS.map((permission) => (
          <label key={permission} className="punch">
            <input
              type="checkbox"
              name="permission"
              value={permission}
              disabled={disabled || !can(held, permission)}
              // Controlled only for an edit's draft; the create form's boxes are read on submit.
              {...(ticked === undefined
                ? {}
                : {
                    checked: ticked.includes(permission),
                    onChange: (): void => {
                      onToggle?.(permission);
                    },
                  })}
            />
            <span className="punch__box" />
            <PermissionWords permission={permission} />
          </label>
        ))}
      </div>
      <p className="field__hint" id={hintId}>
        {t("roleEditor.heldOnly")}
      </p>
    </fieldset>
  );
}

/** A new role's key, label and description, uncontrolled and named for the form's `FormData`. */
function RoleFields({ disabled }: { disabled: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const keyId = useId();
  const keyHintId = useId();
  const labelId = useId();
  const descriptionId = useId();
  return (
    <>
      <div className="field">
        <label className="label" htmlFor={keyId}>
          {t("roleEditor.keyLabel")}
        </label>
        <input
          aria-describedby={keyHintId}
          autoComplete="off"
          className="input"
          disabled={disabled}
          id={keyId}
          maxLength={63}
          name="key"
          pattern="[a-z][a-z0-9_]*"
          required={true}
          type="text"
        />
        <p className="field__hint" id={keyHintId}>
          {t("roleEditor.keyHint")}
        </p>
      </div>
      <div className="field">
        <label className="label" htmlFor={labelId}>
          {t("roleEditor.labelLabel")}
        </label>
        <input
          autoComplete="off"
          className="input"
          disabled={disabled}
          id={labelId}
          maxLength={80}
          name="label"
          required={true}
          type="text"
        />
      </div>
      <div className="field">
        <label className="label" htmlFor={descriptionId}>
          {t("roleEditor.descriptionLabel")}
        </label>
        <input
          autoComplete="off"
          className="input"
          disabled={disabled}
          id={descriptionId}
          maxLength={500}
          name="description"
          type="text"
        />
      </div>
    </>
  );
}

/** The form that defines a role: key, label, description and its permissions. */
export function CreateRoleForm({
  tenantId,
  held,
  create,
  formRef,
}: {
  tenantId: string;
  held: readonly Permission[] | undefined;
  create: Save;
  formRef: React.RefObject<HTMLFormElement | null>;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <form
      className="stack stack--tight"
      ref={formRef}
      onSubmit={(event): void => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const key = String(data.get("key") ?? "").trim();
        const label = String(data.get("label") ?? "").trim();
        if (key === "" || label === "") {
          return;
        }
        create.mutate({
          tenantId,
          key,
          label,
          description: String(data.get("description") ?? "").trim(),
          permissions: data.getAll("permission").map(String).filter(isPermission),
          create: true,
        });
      }}
    >
      <span className="label">{t("roleEditor.createHead")}</span>
      <RoleFields disabled={create.isPending} />
      <PermissionBoxes
        legend={t("roleEditor.permissionsLabel")}
        held={held}
        disabled={create.isPending}
      />
      {create.isError ? (
        <Errata heading={t("roleEditor.notCreated")} live={true} error={create.error} />
      ) : null}
      <StatusLine
        className="note"
        text={create.isSuccess ? t("roleEditor.created", { role: create.data.key }) : null}
      />
      <div className="row">
        <button className="plate plate--primary" type="submit" disabled={create.isPending}>
          {create.isPending ? t("roleEditor.creating") : t("roleEditor.create")}
        </button>
      </div>
    </form>
  );
}
