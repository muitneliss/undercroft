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
 * No `useState`, per `state.md`, and nothing here needs it. The two invitation inputs are
 * uncontrolled and read through refs on submit; the open view and the address search are the
 * page's address (`?view=`, `?q=`); everything else is server state in the query cache or
 * mutation state on the mutation. The one thing that would otherwise want a local flag —
 * "did the invitation email go out?" — is read from the mutation's own result, which is the
 * only thing that actually knows.
 */

import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { ActivityLog } from "@/components/ActivityLog.tsx";
import { Errata } from "@/components/Errata.tsx";
import { InvitePanel, OpenInvitations } from "@/components/Invitations.tsx";
import { ViewHead } from "@/components/PeopleViews.tsx";
import { Roster } from "@/components/Roster.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { type PeopleAddress, usePeopleAddress } from "@/components/usePeopleAddress.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

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

/**
 * The open view's list: who has access, or the invitations still waiting, narrowed by the
 * address search, or the customer's activity. Compare roles lists nothing; its statements are
 * printed by `ViewLead`.
 */
function ViewList({
  address,
  roster,
  open,
  isAdmin,
  writes,
  tenantId,
  signedInAs,
}: {
  address: PeopleAddress;
  roster: readonly { userId: string; email: string; role: string }[];
  open: readonly { id: string; email: string; role: string; expiresAt: string }[];
  isAdmin: boolean;
  writes: PeopleMutations;
  tenantId: string;
  signedInAs: string;
}): React.JSX.Element | null {
  const locale = useUiStore((state) => state.locale);
  if (address.view === "members") {
    return (
      <Roster
        roster={roster}
        isAdmin={isAdmin}
        setRole={writes.setRole}
        remove={writes.remove}
        tenantId={tenantId}
        search={address.search}
        signedInAs={signedInAs}
      />
    );
  }
  if (address.view === "activity") {
    return <ActivityLog scope={{ kind: "tenant", tenantId }} />;
  }
  if (address.view === "invites") {
    return (
      <OpenInvitations
        open={open}
        search={address.search}
        isAdmin={isAdmin}
        revoke={writes.revoke}
        tenantId={tenantId}
        locale={locale}
      />
    );
  }
  return null;
}

/** The invitation form and the role statements beside it, on the Invitations view. */
function InviteBand({
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
  emailFieldRef: React.RefObject<HTMLInputElement | null>;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <div className="band-rule" />
      <div className="head">{t("people.invitationsHead")}</div>
      <div className="body stack">
        <InvitePanel
          isAdmin={isAdmin}
          invite={invite}
          tenantId={tenantId}
          displayName={displayName}
          emailFieldRef={emailFieldRef}
        />
      </div>
    </>
  );
}

/**
 * The people division, in four views bound to `?view=`: who has access (the default), the
 * invitations still open with the form that sends one, what each role may do, and -- for an
 * admin -- everything done in the customer (ADR 0112).
 *
 * The form and the role statements stay together on Invitations, as the design contract asks:
 * an admin choosing a role reads what it grants beside the choice. Compare roles repeats the
 * statements alone, for a reader who came to ask only that.
 */
export function People({
  tenantId,
  signedInAs,
}: {
  tenantId: string;
  signedInAs: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const emailFieldRef = useRef<HTMLInputElement>(null);
  const address = usePeopleAddress();

  const tenant = trpc.tenants.get.useQuery({ tenantId });
  const members = trpc.people.members.useQuery({ tenantId });
  const invitations = trpc.people.invitations.useQuery({ tenantId });
  const writes = usePeopleMutations(tenantId, emailFieldRef);

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
  const open = invitations.data.filter((i) => i.status === "pending");
  const shown: PeopleAddress =
    address.view === "activity" && !isAdmin ? { ...address, view: "members" } : address;

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.people")}</div>
      <div className="body stack">
        <h1>{t("people.title")}</h1>
        <p className="prose prose--lead">{t("people.lead", { tenantId })}</p>
        <ViewHead
          address={shown}
          members={members.data.length}
          invitations={open.length}
          tenantId={tenantId}
          isAdmin={isAdmin}
        />
        <ViewList
          address={shown}
          roster={members.data}
          open={open}
          isAdmin={isAdmin}
          writes={writes}
          tenantId={tenantId}
          signedInAs={signedInAs}
        />
      </div>

      {shown.view === "invites" ? (
        <InviteBand
          isAdmin={isAdmin}
          invite={writes.invite}
          tenantId={tenantId}
          displayName={tenant.data?.displayName || tenantId}
          emailFieldRef={emailFieldRef}
        />
      ) : null}
    </div>
  );
}
