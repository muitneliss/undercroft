/**
 * The people division: who may see this customer, and how they were invited.
 *
 * This is the other half of invite-only sign-in. The gate admits an address that has a live
 * invitation; this page is how one comes to exist. Without it a correct sign-in admits
 * nobody without a SQL client, which is not a product.
 *
 * Inviting, changing a member's role and removing a member are admin-only on the server
 * (`requireRole("admin")`), and the server alone refuses to leave a customer without an
 * admin. The form and the roster's controls are hidden for anyone else rather than shown and
 * rejected, because the role is already known here — but hiding them is courtesy, not the
 * control: the procedures refuse regardless of what the browser renders.
 *
 * No `useState`, per `state.md`, and nothing here needs it. The two inputs are uncontrolled
 * and read through refs on submit; everything else is server state in the query cache or
 * mutation state on the mutation. The one thing that would otherwise want a local flag —
 * "did the invitation email go out?" — is read from the mutation's own result, which is the
 * only thing that actually knows.
 */

import type { Locale } from "@undercroft/core/locale";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";
import { Roster } from "@/components/Roster.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { formatDate } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** Invitations still open, and the refusal shown when one cannot be withdrawn. */
function OpenInvitations({
  open,
  isAdmin,
  revoke,
  tenantId,
  locale,
}: {
  open: readonly { id: string; email: string; role: string; expiresAt: string }[];
  isAdmin: boolean;
  revoke: ReturnType<typeof trpc.people.revokeInvitation.useMutation>;
  tenantId: string;
  locale: Locale;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      {open.length === 0 ? (
        <p className="note">{t("people.noneWaiting")}</p>
      ) : (
        <table className="table">
          <caption>{t("people.waitingCaption", { count: open.length })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("people.colAddress")}</th>
              <th scope="col">{t("people.colInvitedAs")}</th>
              <th scope="col">{t("people.colExpires")}</th>
              {isAdmin ? <th scope="col">{t("people.colWithdraw")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {open.map((invitation) => (
              <tr key={invitation.id}>
                <td className="datum datum--quiet">{invitation.email}</td>
                <td>{invitation.role}</td>
                {/* Through `formatDate`, not `toISOString().slice(0, 10)`: that rendered
                  the date in UTC while every other date on the schedule is in Singapore
                  time, so an invitation expiring at 07:00 SGT showed the previous day. */}
                <td className="datum datum--quiet">{formatDate(invitation.expiresAt, locale)}</td>
                {isAdmin ? (
                  <td>
                    <button
                      className="plate plate--small"
                      type="button"
                      disabled={revoke.isPending}
                      onClick={(): void => {
                        revoke.mutate({ tenantId, id: invitation.id });
                      }}
                    >
                      {t("people.withdraw")}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {revoke.isError ? (
        <Errata heading={t("people.notWithdrawn")} live={true}>
          {revoke.error.message}
        </Errata>
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
      {invite.isError ? (
        <Errata heading={t("people.notInvited")} live={true}>
          {/* The server's own words. It composes them in the language this browser
          asked for -- `main.tsx` sends `accept-language` on every tRPC call --
          so this renders a Vietnamese sentence for a Vietnamese reader without
          the UI having to know what went wrong. */}
          {invite.error.message}
        </Errata>
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

/** Inviting somebody, which only an admin of this tenant may do. */
function InvitePanel({
  isAdmin,
  invite,
  tenantId,
  emailFieldRef,
  roleFieldRef,
  emailId,
  roleId,
}: {
  isAdmin: boolean;
  invite: ReturnType<typeof trpc.people.invite.useMutation>;
  tenantId: string;
  emailFieldRef: React.RefObject<HTMLInputElement | null>;
  roleFieldRef: React.RefObject<HTMLSelectElement | null>;
  emailId: string;
  roleId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
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
            invite.mutate({
              tenantId,
              email,
              role: role === "admin" || role === "member" ? role : "viewer",
            });
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
              {/* The role names themselves stay in English in both catalogues: `viewer`,
                `member` and `admin` are the values the API takes and the words the
                roster column prints, so translating the option but not the row would
                make the two disagree. What is translated is the explanation after the
                dash, which is the part that has to be understood. */}
              <option value="viewer">{t("people.roleViewer")}</option>
              <option value="member">{t("people.roleMember")}</option>
              <option value="admin">{t("people.roleAdmin")}</option>
            </select>
          </div>

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
    </>
  );
}

/**
 * Everything this page reads and writes, wired once.
 *
 * Both mutations invalidate BOTH lists: accepting an invitation moves a row from one table
 * to the other, so refreshing only the one that was acted on leaves the other stale on
 * screen.
 */
interface PeopleMutations {
  readonly invite: ReturnType<typeof trpc.people.invite.useMutation>;
  readonly revoke: ReturnType<typeof trpc.people.revokeInvitation.useMutation>;
  readonly setRole: ReturnType<typeof trpc.people.setRole.useMutation>;
  readonly remove: ReturnType<typeof trpc.people.removeMember.useMutation>;
}

/**
 * The four writes this page makes.
 *
 * Every one invalidates BOTH lists: accepting an invitation moves a row from one table to the
 * other, so refreshing only the one that was acted on leaves the other stale on screen. A
 * role change or a removal also refreshes the tenant itself, because the admin acting may be
 * the person acted on: one who steps down must stop being offered the admin controls, and
 * one who leaves must stop being shown the customer.
 */
function usePeopleMutations(
  tenantId: string,
  emailFieldRef: React.RefObject<HTMLInputElement | null>,
): PeopleMutations {
  const utils = trpc.useUtils();

  async function invalidate(): Promise<void> {
    await utils.people.invitations.invalidate({ tenantId });
    await utils.people.members.invalidate({ tenantId });
  }

  async function invalidateAccess(): Promise<void> {
    await invalidate();
    await utils.tenants.invalidate();
  }

  return {
    invite: trpc.people.invite.useMutation({
      onSuccess: async () => {
        if (emailFieldRef.current !== null) {
          emailFieldRef.current.value = "";
        }
        await invalidate();
      },
    }),
    revoke: trpc.people.revokeInvitation.useMutation({ onSuccess: invalidate }),
    setRole: trpc.people.setRole.useMutation({ onSuccess: invalidateAccess }),
    remove: trpc.people.removeMember.useMutation({ onSuccess: invalidateAccess }),
  };
}

export function People({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const emailId = useId();
  const roleId = useId();
  const locale = useUiStore((state) => state.locale);
  const emailFieldRef = useRef<HTMLInputElement>(null);
  const roleFieldRef = useRef<HTMLSelectElement>(null);

  const tenant = trpc.tenants.get.useQuery({ tenantId });
  const members = trpc.people.members.useQuery({ tenantId });
  const invitations = trpc.people.invitations.useQuery({ tenantId });
  const { invite, revoke, setRole, remove } = usePeopleMutations(tenantId, emailFieldRef);

  if (members.isPending || invitations.isPending) {
    return <Skeleton rows={4} />;
  }

  if (members.isError || invitations.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("people.notLoaded", { tenantId })}
      </Errata>
    );
  }

  const isAdmin = tenant.data?.role === "admin";
  const roster = members.data;
  const open = invitations.data.filter((i) => i.status === "pending");

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.people")}</div>
      <div className="body stack">
        <h1>{t("people.title")}</h1>
        <p className="prose prose--lead">{t("people.lead", { tenantId })}</p>

        <Roster
          roster={roster}
          isAdmin={isAdmin}
          setRole={setRole}
          remove={remove}
          tenantId={tenantId}
        />
      </div>

      <div className="band-rule" />

      <div className="head">{t("people.invitationsHead")}</div>
      <div className="body stack">
        <OpenInvitations
          open={open}
          isAdmin={isAdmin}
          revoke={revoke}
          tenantId={tenantId}
          locale={locale}
        />

        <InvitePanel
          isAdmin={isAdmin}
          invite={invite}
          tenantId={tenantId}
          emailFieldRef={emailFieldRef}
          roleFieldRef={roleFieldRef}
          emailId={emailId}
          roleId={roleId}
        />
      </div>
    </div>
  );
}
