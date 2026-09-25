/**
 * The roster: who has access to a customer today, and -- for an admin -- the two ways to
 * change that, a member's role and their removal.
 *
 * Out of `routes/People.tsx` because the page had grown past what one file may be; the page
 * still owns the mutations (`usePeopleMutations`) and passes them in, so what each write
 * invalidates is decided in one place.
 */

import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import type { trpc } from "@/trpc.ts";

/**
 * The values the API takes, in the order the invitation form offers them. Printed as they
 * are, like the roster column beside them: `i18n.md` keeps role names untranslated.
 */
const ROLES = ["viewer", "member", "admin"] as const;
type Role = (typeof ROLES)[number];
const ROLE_SET: ReadonlySet<string> = new Set(ROLES);

function isRole(value: string): value is Role {
  return ROLE_SET.has(value);
}

/**
 * A member's role: a word for everyone, a `<select>` for an admin.
 *
 * Controlled by the roster itself, not by the reader's choice: the value is the role the
 * server holds, so a change the server refuses -- the last admin stepping down -- leaves the
 * select showing the role that is still true rather than the one that was asked for. The
 * change is saved on selection, as the cadence is (`GrantWhen`): one field, one decision.
 */
function RoleCell({
  member,
  isAdmin,
  setRole,
  tenantId,
}: {
  member: { email: string; role: string };
  isAdmin: boolean;
  setRole: ReturnType<typeof trpc.people.setRole.useMutation>;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (!isAdmin) {
    return <td>{member.role}</td>;
  }
  // While this member's change is in flight the select shows the role asked for, not the one
  // it is leaving: snapping back to the old role would read as the choice having been ignored.
  // Once the server answers, the value is its role again, refusal or not.
  const saving = setRole.isPending && setRole.variables.email === member.email;
  return (
    <td>
      <select
        aria-label={t("people.roleFor", { email: member.email })}
        aria-busy={saving}
        className="input input--select"
        value={saving ? setRole.variables.role : member.role}
        disabled={setRole.isPending}
        onChange={(event): void => {
          const chosen = event.target.value;
          if (isRole(chosen) && chosen !== member.role) {
            setRole.mutate({ tenantId, email: member.email, role: chosen });
          }
        }}
      >
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
      {saving ? (
        <span className="field__hint" role="status">
          {t("people.roleSaving")}
        </span>
      ) : null}
    </td>
  );
}

/**
 * Ending a member's access: two steps, because it is undone only by a fresh invitation.
 *
 * The same fold `ModelEditor` uses for a delete: the first plate opens it, the second names
 * whom it removes. No `useState` -- `<details>` holds whether it is open.
 */
function RemoveCell({
  email,
  remove,
  tenantId,
}: {
  email: string;
  remove: ReturnType<typeof trpc.people.removeMember.useMutation>;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <td>
      <details className="tokenform">
        <summary className="plate plate--small">{t("people.remove")}</summary>
        <div className="hinge">
          <button
            className="plate plate--small plate--primary"
            type="button"
            disabled={remove.isPending}
            onClick={(): void => {
              remove.mutate({ tenantId, email });
            }}
          >
            {remove.isPending ? t("people.removing") : t("people.removeConfirm", { email })}
          </button>
        </div>
      </details>
    </td>
  );
}

/**
 * What the last role change or removal did.
 *
 * The server's own words on a refusal, as for an invitation: it composes them in the
 * reader's language, and it is the only party that knows why -- above all that the address
 * is this customer's last admin.
 */
function MembershipOutcome({
  setRole,
  remove,
}: {
  setRole: ReturnType<typeof trpc.people.setRole.useMutation>;
  remove: ReturnType<typeof trpc.people.removeMember.useMutation>;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      {setRole.isError ? (
        <Errata heading={t("people.roleNotChanged")} live={true}>
          {setRole.error.message}
        </Errata>
      ) : null}
      {setRole.isSuccess ? (
        <p className="note" role="status">
          {t("people.roleChanged", { email: setRole.data.email, role: setRole.data.role })}
        </p>
      ) : null}
      {remove.isError ? (
        <Errata heading={t("people.notRemoved")} live={true}>
          {remove.error.message}
        </Errata>
      ) : null}
      {remove.isSuccess ? (
        <p className="note" role="status">
          {t("people.removed", { email: remove.data.email })}
        </p>
      ) : null}
    </>
  );
}

/**
 * Who has access today, and -- for an admin -- the two ways to change that.
 *
 * Hidden rather than disabled for everyone else, like the invitation form; the procedures
 * refuse regardless of what the browser renders.
 */
export function Roster({
  roster,
  isAdmin,
  setRole,
  remove,
  tenantId,
}: {
  roster: readonly { userId: string; email: string; role: string }[];
  isAdmin: boolean;
  setRole: ReturnType<typeof trpc.people.setRole.useMutation>;
  remove: ReturnType<typeof trpc.people.removeMember.useMutation>;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      {roster.length === 0 ? (
        <EmptyState title={t("people.emptyTitle")} body={t("people.emptyBody")} />
      ) : (
        <table className="table">
          <caption>{t("people.caption", { count: roster.length })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("people.colAddress")}</th>
              <th scope="col">{t("people.colRole")}</th>
              {isAdmin ? <th scope="col">{t("people.colRemove")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {roster.map((member) => (
              <tr key={member.userId}>
                <td className="datum datum--quiet">{member.email}</td>
                <RoleCell member={member} isAdmin={isAdmin} setRole={setRole} tenantId={tenantId} />
                {isAdmin ? (
                  <RemoveCell email={member.email} remove={remove} tenantId={tenantId} />
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <MembershipOutcome setRole={setRole} remove={remove} />
    </>
  );
}
