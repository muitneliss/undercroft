/**
 * The form that gives a permission, or reading one thing (ADR 0142), to a role or a member,
 * standing or until a day -- the Grants view's one write besides taking a grant away
 * (`AccessGrants.tsx`).
 *
 * One select holds both kinds: the permissions the reader holds, read off their own
 * `permissions` through `can`, and the objects they can read, from the server's lists
 * (`useGrantObjects`). The subset rule refuses the rest; offering only these is a courtesy. An
 * expiry is a calendar day, sent as the last second of that day in the reader's own zone
 * (`endOfLocalDay`, ADR 0149), so the day picked is the day printed.
 *
 * Since ADR 0143 a grant of one model or reference table may also say which rows it shows and
 * which columns it hides (`GrantRuleFields`), and the form shows, under it, what the person or
 * role it is for can see now (`ScopePreview`) -- read again once the grant is saved.
 *
 * No `useState`, per `state.md`: whom it is for, what it gives and its rules are the store's
 * `grantDraft`, because the rule fields and the summary read them; the expiry is uncontrolled and
 * read as `FormData` on submit.
 */

import { PERMISSIONS, type Permission } from "@undercroft/contracts/access";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";
import { ObjectOptionGroups } from "@/components/GrantObjects.tsx";
import { GrantRuleFields } from "@/components/GrantRuleFields.tsx";
import { ScopePreview } from "@/components/ScopePreview.tsx";
import { StatusLine } from "@/components/StatusLine.tsx";
import type { GrantObjects } from "@/components/useGrantObjects.ts";
import {
  grantOf,
  oneModelOf,
  PERMISSION_OPTION,
  PERSON_OPTION,
  ROLE_OPTION,
  subjectOf,
} from "@/lib/grantChoices.ts";
import { ruleOfDraft } from "@/lib/grantRules.ts";
import { can, PERMISSION_LABELS } from "@/lib/permissions.ts";
import { type RoleOption, roleName } from "@/lib/roles.ts";
import { endOfLocalDay } from "@/lib/when.ts";
import { type GrantDraft, grantDraftFor, useUiStore } from "@/store.ts";
import type { trpc } from "@/trpc.ts";

type Save = ReturnType<typeof trpc.grants.save.useMutation>;
type GrantRequest = Parameters<Save["mutate"]>[0];

/** Whom a grant is to and which permission: the form's two selects. */
function GrantChoices({
  tenantId,
  draft,
  held,
  objects,
  roles,
  roster,
  disabled,
}: {
  tenantId: string;
  draft: GrantDraft;
  held: readonly Permission[] | undefined;
  objects: GrantObjects;
  roles: readonly RoleOption[];
  roster: readonly { email: string }[];
  disabled: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const subjectId = useId();
  const permissionId = useId();
  const patch = useUiStore((state) => state.patchGrantDraft);
  const offered = PERMISSIONS.filter((permission) => can(held, permission));
  return (
    <>
      <div className="field">
        <label className="label" htmlFor={subjectId}>
          {t("accessGrants.subjectLabel")}
        </label>
        <select
          className="input"
          disabled={disabled}
          id={subjectId}
          name="subject"
          required={true}
          value={draft.subject}
          onChange={(event): void => {
            patch(tenantId, { subject: event.currentTarget.value });
          }}
        >
          <option value="">{t("accessGrants.choose")}</option>
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
          value={draft.grant}
          onChange={(event): void => {
            patch(tenantId, { grant: event.currentTarget.value });
          }}
        >
          <option value="">{t("accessGrants.choose")}</option>
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

/** The day a grant holds until, uncontrolled. */
function UntilField({ disabled }: { disabled: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const untilId = useId();
  const untilHintId = useId();
  return (
    <div className="field">
      <label className="label" htmlFor={untilId}>
        {t("accessGrants.untilLabel")}
      </label>
      <input
        aria-describedby={untilHintId}
        className="input"
        disabled={disabled}
        id={untilId}
        name="until"
        type="date"
      />
      <p className="field__hint" id={untilHintId}>
        {t("accessGrants.untilHint")}
      </p>
    </div>
  );
}

/** What the form sends, from its draft and the day typed; `null` while it says nothing whole. */
function requestOf(draft: GrantDraft, day: string): Omit<GrantRequest, "tenantId"> | null {
  const subject = subjectOf(draft.subject);
  const grant = grantOf(draft.grant);
  const model = oneModelOf(draft.grant);
  const rowRule = model === null ? null : ruleOfDraft(draft.conditions);
  const expiresAt = day === "" ? null : endOfLocalDay(day);
  if (subject === null || grant === null || rowRule === "incomplete") {
    return null;
  }
  if (day !== "" && expiresAt === null) {
    return null;
  }
  return {
    ...subject,
    ...grant,
    expiresAt,
    ...(rowRule === null
      ? {}
      : { rowRule: rowRule.map((condition) => ({ ...condition, values: [...condition.values] })) }),
    ...(model === null || draft.hidden.length === 0 ? {} : { hiddenColumns: [...draft.hidden] }),
  };
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
  // The draft itself, not `grantDraftFor`'s answer, is what the store is asked: an empty draft is
  // a new object every time, and a selector that answers a new object re-renders forever.
  const stored = useUiStore((state) => state.grantDraft);
  const draft = grantDraftFor({ grantDraft: stored }, tenantId);
  const model = oneModelOf(draft.grant);
  const incomplete = model !== null && ruleOfDraft(draft.conditions) === "incomplete";
  return (
    <form
      className="stack stack--tight"
      ref={formRef}
      onSubmit={(event): void => {
        event.preventDefault();
        const request = requestOf(
          draft,
          String(new FormData(event.currentTarget).get("until") ?? ""),
        );
        if (request !== null) {
          save.mutate({ tenantId, ...request });
        }
      }}
    >
      <span className="label">{t("accessGrants.addHead")}</span>
      <GrantChoices
        tenantId={tenantId}
        draft={draft}
        held={held}
        objects={objects}
        roles={roles}
        roster={roster}
        disabled={save.isPending}
      />
      {model === null ? null : (
        <GrantRuleFields
          tenantId={tenantId}
          name={model}
          seed={objects.seeds.has(model)}
          disabled={save.isPending}
        />
      )}
      <UntilField disabled={save.isPending} />
      {incomplete ? <p className="note">{t("grantRules.incomplete")}</p> : null}
      {save.isError ? (
        <Errata heading={t("accessGrants.notAdded")} live={true} error={save.error} />
      ) : null}
      <StatusLine className="note" text={save.isSuccess ? t("accessGrants.added") : null} />
      <div className="row">
        <button
          className="plate plate--primary"
          type="submit"
          disabled={save.isPending || incomplete}
        >
          {save.isPending ? t("accessGrants.adding") : t("accessGrants.add")}
        </button>
      </div>
      <ScopePreview tenantId={tenantId} subject={draft.subject} />
    </form>
  );
}
