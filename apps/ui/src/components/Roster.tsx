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
import { isRole, ROLES, soleAdmin } from "@/lib/roles.ts";
import type { trpc } from "@/trpc.ts";

/**
 * A member's role: a word for everyone, a `<select>` for an admin.
 *
 * The customer's last admin is the exception: the row says so, to every reader, and offers no
 * select, because every other value in it is a change the server refuses. Saying it in advance
 * is courtesy; the refusal in `repos/membership.ts` is still the control.
 *
 * Controlled by the roster itself, not by the reader's choice: the value is the role the
 * server holds, so a change the server refuses -- the last admin stepping down -- leaves the
 * select showing the role that is still true rather than the one that was asked for. The
 * change is saved on selection, as the cadence is (`GrantWhen`): one field, one decision.
 */
function RoleCell({
  member,
  last,
  isAdmin,
  setRole,
  tenantId,
}: {
  member: { email: string; role: string };
  last: boolean;
  isAdmin: boolean;
  setRole: ReturnType<typeof trpc.people.setRole.useMutation>;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (last) {
    return (
      <td>
        {member.role}
        <p className="field__hint">{t("people.lastAdmin")}</p>
      </td>
    );
  }
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
        <Errata heading={t("people.roleNotChanged")} live={true} error={setRole.error} />
      ) : null}
      {setRole.isSuccess ? (
        <p className="note" role="status">
          {t("people.roleChanged", { email: setRole.data.email, role: setRole.data.role })}
        </p>
      ) : null}
      {remove.isError ? (
        <Errata heading={t("people.notRemoved")} live={true} error={remove.error} />
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
 * refuse regardless of what the browser renders. The last admin's row keeps its Remove cell
 * empty rather than dropping it, so the column still lines up with the rows that have one.
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
  const last = soleAdmin(roster);
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
                <RoleCell
                  member={member}
                  last={member === last}
                  isAdmin={isAdmin}
                  setRole={setRole}
                  tenantId={tenantId}
                />
                {isAdmin && member === last ? <td /> : null}
                {isAdmin && member !== last ? (
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
