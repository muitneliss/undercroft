/**
 * The invitations band of the People division: the invitations still open, the form that sends
 * one, and what each role grants beside it.
 *
 * Out of `routes/People.tsx` for the reason `Roster` is: the page had grown past what one file
 * may be. The page still owns the mutations (`usePeopleMutations`) and passes them in, so what
 * each write invalidates is decided in one place.
 */

import type { Locale } from "@undercroft/core/locale";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";
import { byAddress, isRole, ROLES, type Role } from "@/lib/roles.ts";
import { formatDate } from "@/lib/when.ts";
import type { trpc } from "@/trpc.ts";

/**
 * Withdrawing one open invitation: two presses, the second naming the address.
 *
 * The fold `RemoveCell` uses in the roster, for the same reason: the first plate opens it and
 * sends nothing, the second says whose invitation goes. `<details>` holds whether it is open,
 * so there is no `useState`. Every plate waits while one withdrawal is in flight, but only the
 * row being withdrawn says so -- `variables` is which one was asked for.
 */
function WithdrawCell({
  invitation,
  revoke,
  tenantId,
}: {
  invitation: { id: string; email: string };
  revoke: ReturnType<typeof trpc.people.revokeInvitation.useMutation>;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <td>
      <details className="tokenform">
        <summary className="plate plate--small">{t("people.withdraw")}</summary>
        <div className="hinge">
          <button
            className="plate plate--small plate--primary"
            type="button"
            disabled={revoke.isPending}
            onClick={(): void => {
              revoke.mutate({ tenantId, id: invitation.id });
            }}
          >
            {revoke.isPending && revoke.variables.id === invitation.id
              ? t("people.withdrawing")
              : t("people.withdrawConfirm", { email: invitation.email })}
          </button>
        </div>
      </details>
    </td>
  );
}

/** Invitations still open, and the refusal shown when one cannot be withdrawn. */
export function OpenInvitations({
  open,
  search,
  isAdmin,
  revoke,
  tenantId,
  locale,
}: {
  open: readonly { id: string; email: string; role: string; expiresAt: string }[];
  search: string;
  isAdmin: boolean;
  revoke: ReturnType<typeof trpc.people.revokeInvitation.useMutation>;
  tenantId: string;
  locale: Locale;
}): React.JSX.Element {
  const { t } = useTranslation();
  const rows = byAddress(open, search);
  return (
    <>
      {open.length === 0 ? <p className="note">{t("people.noneWaiting")}</p> : null}
      {open.length > 0 && rows.length === 0 ? <p className="prose">{t("people.noMatch")}</p> : null}
      {rows.length === 0 ? null : (
        <table className="table">
          <caption>
            {search.trim() === ""
              ? t("people.waitingCaption", { count: open.length })
              : t("people.waitingCaptionFiltered", { shown: rows.length, count: open.length })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("people.colAddress")}</th>
              <th scope="col">{t("people.colInvitedAs")}</th>
              <th scope="col">{t("people.colExpires")}</th>
              {isAdmin ? <th scope="col">{t("people.colWithdraw")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((invitation) => (
              <tr key={invitation.id}>
                <td className="datum datum--quiet">{invitation.email}</td>
                <td>{invitation.role}</td>
                {/* Through `formatDate`, not `toISOString().slice(0, 10)`: that rendered
                  the date in UTC while every other date on the schedule is in Singapore
                  time, so an invitation expiring at 07:00 SGT showed the previous day. */}
                <td className="datum datum--quiet">{formatDate(invitation.expiresAt, locale)}</td>
                {isAdmin ? (
                  <WithdrawCell invitation={invitation} revoke={revoke} tenantId={tenantId} />
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {revoke.isError ? (
        <Errata heading={t("people.notWithdrawn")} live={true} error={revoke.error} />
      ) : null}
    </>
  );
}

/**
 * What happened to the invitation.
 *
 * Success is TWO states, not one: an invitation is valid whether or not the mail went out,
 * and an admin who is not told the send failed will wait for a reply that is not coming.
 */
function InviteOutcome({
  invite,
}: {
  invite: ReturnType<typeof trpc.people.invite.useMutation>;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      {/* The server's own words. It composes them in the language this browser
      asked for -- `main.tsx` sends `accept-language` on every tRPC call --
      so this renders a Vietnamese sentence for a Vietnamese reader without
      the UI having to know what went wrong. */}
      {invite.isError ? (
        <Errata heading={t("people.notInvited")} live={true} error={invite.error} />
      ) : null}

      {/*
       * Read from the mutation's result, not assumed. With no mail configured the
       * invitation is still valid and still works — but somebody has to tell the
       * person, and an admin who was not told that will wait for nothing.
       */}
      {invite.isSuccess ? (
        invite.data.notified ? (
          <p className="note" role="status">
            {t("people.invitedAndEmailed", { email: invite.data.email })}
          </p>
        ) : (
          <Errata heading={t("people.invitedNotEmailedHeading")}>
            {t("people.invitedNotEmailed", { email: invite.data.email })}
          </Errata>
        )
      ) : null}
    </>
  );
}

/** Each role's sentence, keyed by the role so a fourth role is a type error until worded. */
const RIGHTS = {
  viewer: "people.rightsViewer",
  member: "people.rightsMember",
  admin: "people.rightsAdmin",
} as const satisfies Record<Role, string>;

/**
 * What each role may do in this customer, beside the form that grants one.
 *
 * One catalogue entry per role, never assembled from role names (`i18n.md`), and each states
 * what the router's gates allow and refuse and nothing more: `requireRole("member")` on asking
 * and saving questions and dashboards, `requireRole("admin")` on every write to connections,
 * models, macros, document kinds, keys, people and the customer's name, on starting a run and on
 * reading the raw lake's contents. A gate that moves makes these sentences false, so a change
 * to one is a change to both catalogues in the same commit. No test pins the two together:
 * the sentences are prose, and a check that they match the router would have to parse them.
 *
 * Shown to every reader, not only an admin: a viewer who reads why a plate is absent has been
 * told something true before the server had to refuse them.
 */
export function RoleRights({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <dl className="access" aria-label={t("people.rightsLabel", { tenantId })}>
      {/* A flat list of pairs rather than a keyed `Fragment`, which Biome cannot resolve
        out of React's types: `.access` lays `dt` and `dd` out as direct grid children. */}
      {ROLES.flatMap((role) => [
        <dt key={`${role}-role`}>{role}</dt>,
        <dd key={`${role}-rights`}>{t(RIGHTS[role])}</dd>,
      ])}
    </dl>
  );
}

/** Inviting somebody, which only an admin of this tenant may do. */
export function InvitePanel({
  isAdmin,
  invite,
  tenantId,
  displayName,
  emailFieldRef,
}: {
  isAdmin: boolean;
  invite: ReturnType<typeof trpc.people.invite.useMutation>;
  tenantId: string;
  displayName: string;
  /** The page's, because the invitation's success clears it (`usePeopleMutations`). */
  emailFieldRef: React.RefObject<HTMLInputElement | null>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const emailId = useId();
  const roleId = useId();
  const roleFieldRef = useRef<HTMLSelectElement>(null);
  return (
    <>
      {isAdmin ? (
        <form
          className="stack stack--tight"
          onSubmit={(event): void => {
            event.preventDefault();
            const email = emailFieldRef.current?.value.trim() ?? "";
            const role = roleFieldRef.current?.value ?? "viewer";
            if (email === "") {
              return;
            }
            invite.mutate({ tenantId, email, role: isRole(role) ? role : "viewer" });
          }}
        >
          <div className="field">
            <label className="label" htmlFor={emailId}>
              {t("people.inviteLabel")}
            </label>
            <input
              className="input"
              id={emailId}
              name="email"
              type="email"
              autoComplete="off"
              required={true}
              placeholder={t("people.invitePlaceholder")}
              ref={emailFieldRef}
              disabled={invite.isPending}
            />
            <p className="field__hint">{t("people.inviteHint")}</p>
          </div>

          <div className="field">
            <label className="label" htmlFor={roleId}>
              {t("people.roleLabel")}
            </label>
            <select
              className="input"
              id={roleId}
              name="role"
              ref={roleFieldRef}
              disabled={invite.isPending}
              defaultValue="viewer"
            >
              {/* The values as they are, as in the roster's select: what each one grants is
                the statement beside this form, and a second description here would be one
                more place for the two to disagree. */}
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          {/* Which book the role opens, by name and by ID: an admin holding several customers'
            books is one wrong tab from inviting somebody into the wrong one. */}
          <p className="note">{t("people.grantedWithin", { name: displayName, tenantId })}</p>

          <InviteOutcome invite={invite} />

          <div className="row">
            <button className="plate plate--primary" type="submit" disabled={invite.isPending}>
              {invite.isPending ? t("people.inviting") : t("people.sendInvitation")}
            </button>
          </div>
        </form>
      ) : (
        <p className="note">{t("people.adminOnly", { tenantId })}</p>
      )}
      <RoleRights tenantId={tenantId} />
    </>
  );
}
