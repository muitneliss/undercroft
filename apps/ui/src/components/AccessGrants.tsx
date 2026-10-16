/**
 * The People division's Grants view (ADR 0141): every permission given straight to a role or a
 * person, standing or until a day, and -- for a holder of `roles:manage` -- the form that gives
 * one and the fold that takes one away.
 *
 * Since ADR 0142 a grant may also give READING one thing -- a model, a raw stream or a whole
 * source, a question, a dashboard, or the whole of one -- which a customer's own role needs, since
 * it reads only what it is granted. The form (`GrantForm.tsx`) offers those beside the
 * permissions, from the server's own lists (`useGrantObjects.ts`).
 *
 * Reading the list needs `people:manage`, which the whole division already needs: a grant to a
 * person says who holds what, as the roster does. What a grant means is the server's: whether it
 * has expired is `expired` in the answer, decided by the database's clock, never by this tab's.
 *
 * No `useState`, per `state.md`: a removal is two presses inside a `<details>`.
 */

import type { Permission } from "@undercroft/contracts/access";
import type { RowRule } from "@undercroft/contracts/rowRules";
import type { Locale } from "@undercroft/core/locale";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { Address } from "@/components/Address.tsx";
import { Errata } from "@/components/Errata.tsx";
import { GrantForm } from "@/components/GrantForm.tsx";
import { GrantGives } from "@/components/GrantObjects.tsx";
import { useGrantObjects } from "@/components/useGrantObjects.ts";
import { Skeleton } from "@/components/Skeleton.tsx";
import { PERSON_OPTION, ROLE_OPTION } from "@/lib/grantChoices.ts";
import { ruleWords } from "@/lib/grantRules.ts";
import { MISSING } from "@/lib/money.ts";
import { can } from "@/lib/permissions.ts";
import { type RoleOption, roleNamed, roleOptions } from "@/lib/roles.ts";
import { formatDate } from "@/lib/when.ts";
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
  readonly rowRule: RowRule | null;
  readonly hiddenColumns: readonly string[] | null;
  readonly expiresAt: string | null;
  readonly expired: boolean;
  readonly grantedBy: string | null;
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
  const dropDraft = useUiStore((state) => state.dropGrantDraft);
  const patchDraft = useUiStore((state) => state.patchGrantDraft);
  async function refresh(): Promise<void> {
    await utils.grants.list.invalidate({ tenantId });
    await utils.scopes.preview.invalidate({ tenantId });
    await utils.tenants.invalidate();
  }
  return {
    save: trpc.grants.save.useMutation({
      onSuccess: async (_saved, sent) => {
        formRef.current?.reset();
        // The draft goes, but whom it was for stays chosen: the summary under the form then
        // shows what they see now, which is what the reader wants to check next.
        dropDraft();
        patchDraft(tenantId, {
          subject:
            sent.role === undefined
              ? `${PERSON_OPTION}${sent.email ?? ""}`
              : `${ROLE_OPTION}${sent.role}`,
        });
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

/** A model grant's rules, in words, under what it gives (ADR 0143); nothing for a grant of all of it. */
function GrantRuleWords({ grant }: { grant: Grant }): React.JSX.Element | null {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  if (grant.rowRule === null && grant.hiddenColumns === null) {
    return null;
  }
  return (
    <span className="stack stack--tight">
      {grant.rowRule === null ? null : (
        <span className="datum--quiet">
          {t("grantRules.onlyRows", { rule: ruleWords(t, locale, grant.rowRule) })}
        </span>
      )}
      {grant.hiddenColumns === null ? null : (
        <span className="datum--quiet">
          {t("grantRules.hides", { columns: grant.hiddenColumns.join(", ") })}
        </span>
      )}
    </span>
  );
}

/** The grants as a table. */
function GrantTable({
  grants,
  roles,
  names,
  canChange,
  remove,
  tenantId,
}: {
  grants: readonly Grant[];
  roles: readonly RoleOption[] | undefined;
  /** A report's name by its object, for a grant on one. */
  names: ReadonlyMap<string, string>;
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
                  <GrantGives grant={grant} names={names} />
                  <GrantRuleWords grant={grant} />
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
  const objects = useGrantObjects(tenantId);
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
          names={objects.names}
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
          objects={objects}
          roles={roleOptions(roles)}
          roster={roster}
          save={writes.save}
          formRef={formRef}
        />
      ) : null}
    </>
  );
}
