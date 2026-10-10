/**
 * What a read or write grant reaches, said beside the choice of one: on `/consent`, where a
 * model-context client asks for it (ADR 0061), and on the account page's token form (ADR 0060).
 *
 * A grant is not a role. The server decides every call twice: the grant is the ceiling
 * (`grantAdmits` in `surface.ts`), and then the role gates run against the person's CURRENT
 * membership (`requireRole` in `trpc.ts`), so a viewer's write token is still refused every
 * customer's write. Without this band the page offered "read and write" to a viewer and never
 * said that, in their customers, it would buy nothing but the one write that is theirs rather
 * than a customer's -- `session.setLocale`.
 *
 * So it reads the person's customers (`tenants.list`) and says, per role they hold, where they
 * hold it and what it lets them do. What a role lets them do is `ROLE_RIGHTS`, the sentences the
 * People division already shows beside the invitation form: one description of a role, never
 * two that a moved gate could leave disagreeing.
 *
 * Decisions:
 *
 * - **Deactivated customers are left out of the list**, because the router refuses them every
 *   call but their own state and an admin's reactivation (`tenantProcedure`). They still count
 *   against the viewer-everywhere note: an admin of a deactivated customer CAN reactivate it
 *   with a write grant, and the note would then be false.
 * - **The write option is never disabled or hidden here.** It stays valid for the person's own
 *   account, and a role can rise later; the reach follows it from the next call.
 * - **It never blocks the form it sits in.** Loading is a set line and a failure a quiet note;
 *   consent must stay answerable when the list cannot be read, and the ceiling sentences, which
 *   need no data, are shown either way.
 */

import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/Skeleton.tsx";
import { ROLE_RIGHTS, ROLES, type Role } from "@/lib/roles.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** How many customers a role's line names before it counts the rest. */
const NAMED = 5;

/** One customer the person holds a role in, as `tenants.list` answers it. */
interface Held {
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
  readonly deactivatedAt: string | null;
}

/** Each role the person holds in an active customer, with those customers' names, in `ROLES` order. */
function byRole(held: readonly Held[]): readonly { role: Role; customers: readonly string[] }[] {
  const active = held.filter((tenant) => tenant.deactivatedAt === null);
  return ROLES.map((role) => ({
    role,
    customers: active
      .filter((tenant) => tenant.role === role)
      .map((tenant) => tenant.displayName || tenant.id),
  })).filter((group) => group.customers.length > 0);
}

/**
 * Whether write would add nothing in any customer: viewer in every one held, the deactivated
 * included (see the docstring). A role the browser does not know is not a viewer.
 */
function viewerEverywhere(held: readonly Held[]): boolean {
  return held.every((tenant) => tenant.role === "viewer");
}

function RoleLines({ held }: { held: readonly Held[] }): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const groups = byRole(held);
  if (groups.length === 0) {
    return <p className="note">{t("grantReach.none")}</p>;
  }
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  return (
    <>
      <dl className="access" aria-label={t("grantReach.rolesLabel")}>
        {/* Flat pairs, as `RoleRights` lays them: `.access` grids `dt` and `dd` directly. */}
        {groups.flatMap(({ role, customers }) => {
          const rest = customers.length - NAMED;
          const named = customers.slice(0, NAMED);
          return [
            <dt key={`${role}-role`}>{role}</dt>,
            <dd key={`${role}-reach`} className="stack stack--tight">
              <span>
                {t("grantReach.heldIn", {
                  customers: list.format(
                    rest > 0 ? [...named, t("grantReach.more", { count: rest })] : named,
                  ),
                })}
              </span>
              <span className="field__hint">{t(ROLE_RIGHTS[role])}</span>
            </dd>,
          ];
        })}
      </dl>
      {viewerEverywhere(held) ? <p className="note">{t("grantReach.viewerEverywhere")}</p> : null}
    </>
  );
}

export function GrantReach(): React.JSX.Element {
  const { t } = useTranslation();
  const tenants = trpc.tenants.list.useQuery();
  // Whole sentences side by side, each its own key; never fragments of one (`i18n.md`).
  const ceiling = `${t("grantReach.ceiling")} ${t("grantReach.followsRole")}`;
  const grants = `${t("grantReach.read")} ${t("grantReach.write")}`;
  return (
    <section className="stack stack--tight" aria-label={t("grantReach.label")}>
      <p className="field__hint">{ceiling}</p>
      <p className="field__hint">{grants}</p>
      {tenants.isPending ? <Skeleton rows={2} /> : null}
      {tenants.isError ? <p className="note">{t("grantReach.notLoaded")}</p> : null}
      {tenants.isSuccess ? <RoleLines held={tenants.data} /> : null}
    </section>
  );
}
