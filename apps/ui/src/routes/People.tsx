/**
 * The people division: who may see this customer, and how they were invited.
 *
 * This is the other half of invite-only sign-in. The gate admits an address that has a live
 * invitation; this page is how one comes to exist. Without it a correct sign-in admits
 * nobody without a SQL client, which is not a product.
 *
 * Inviting is admin-only on the server (`requireRole("admin")`). The form is hidden for
 * anyone else rather than shown and rejected, because the role is already known here — but
 * hiding it is courtesy, not the control: the procedure refuses regardless of what the
 * browser renders.
 *
 * No `useState`, per `state.md`, and nothing here needs it. The two inputs are uncontrolled
 * and read through refs on submit; everything else is server state in the query cache or
 * mutation state on the mutation. The one thing that would otherwise want a local flag —
 * "did the invitation email go out?" — is read from the mutation's own result, which is the
 * only thing that actually knows.
 */

import { useRef } from "react";

import { EmptyState } from "@/components/EmptyState";
import { Errata } from "@/components/Errata";
import { Skeleton } from "@/components/Skeleton";
import { trpc } from "@/trpc";

export function People({ tenantId }: { tenantId: string }) {
  const utils = trpc.useUtils();
  const emailField = useRef<HTMLInputElement>(null);
  const roleField = useRef<HTMLSelectElement>(null);

  const tenant = trpc.tenants.get.useQuery({ tenantId });
  const members = trpc.people.members.useQuery({ tenantId });
  const invitations = trpc.people.invitations.useQuery({ tenantId });

  const invalidate = async () => {
    await utils.people.invitations.invalidate({ tenantId });
    await utils.people.members.invalidate({ tenantId });
  };

  const invite = trpc.people.invite.useMutation({
    onSuccess: async () => {
      if (emailField.current !== null) emailField.current.value = "";
      await invalidate();
    },
  });

  const revoke = trpc.people.revokeInvitation.useMutation({ onSuccess: invalidate });

  if (members.isPending || invitations.isPending) return <Skeleton rows={4} />;

  if (members.isError || invitations.isError) {
    return (
      <Errata heading="Not loaded" live>
        The roster for {tenantId} could not be loaded. Nothing has been changed.
      </Errata>
    );
  }

  const isAdmin = tenant.data?.role === "admin";
  const roster = members.data;
  const open = invitations.data.filter((i) => i.status === "pending");

  return (
    <div className="sheet">
      <div className="head head--division">People</div>
      <div className="body stack">
        <h1>People</h1>
        <p className="prose prose--lead">Who may see {tenantId}, and how they were invited.</p>

        {roster.length === 0 ? (
          <EmptyState
            title="Nobody has access yet"
            body="Invite an address below. Whoever controls it can then sign in with Google or a one-time code — the invitation is what admits them."
          />
        ) : (
          <table className="table">
            <caption>
              {roster.length} {roster.length === 1 ? "person" : "people"} with access
            </caption>
            <thead>
              <tr>
                <th scope="col">Address</th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((member) => (
                <tr key={member.userId}>
                  <td className="datum datum--quiet">{member.email}</td>
                  <td>{member.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="band-rule" />

      <div className="head">Invitations</div>
      <div className="body stack">
        {open.length === 0 ? (
          <p className="note">No invitations are waiting to be accepted.</p>
        ) : (
          <table className="table">
            <caption>{open.length} waiting to be accepted</caption>
            <thead>
              <tr>
                <th scope="col">Address</th>
                <th scope="col">Invited as</th>
                <th scope="col">Expires</th>
                {isAdmin ? <th scope="col">Withdraw</th> : null}
              </tr>
            </thead>
            <tbody>
              {open.map((invitation) => (
                <tr key={invitation.id}>
                  <td className="datum datum--quiet">{invitation.email}</td>
                  <td>{invitation.role}</td>
                  <td className="datum datum--quiet">
                    {new Date(invitation.expiresAt).toISOString().slice(0, 10)}
                  </td>
                  {isAdmin ? (
                    <td>
                      <button
                        className="plate plate--small"
                        type="button"
                        disabled={revoke.isPending}
                        onClick={() => {
                          revoke.mutate({ tenantId, id: invitation.id });
                        }}
                      >
                        Withdraw
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {revoke.isError ? (
          <Errata heading="Not withdrawn" live>
            {revoke.error.message}
          </Errata>
        ) : null}

        {isAdmin ? (
          <form
            className="stack stack--tight"
            onSubmit={(event) => {
              event.preventDefault();
              const email = emailField.current?.value.trim() ?? "";
              const role = roleField.current?.value ?? "viewer";
              if (email === "") return;
              invite.mutate({
                tenantId,
                email,
                role: role === "admin" || role === "member" ? role : "viewer",
              });
            }}
          >
            <div className="field">
              <label className="label" htmlFor="invite-email">
                Invite an address
              </label>
              <input
                className="input"
                id="invite-email"
                name="email"
                type="email"
                autoComplete="off"
                required
                placeholder="colleague@example.com"
                ref={emailField}
                disabled={invite.isPending}
              />
              <p className="field__hint">
                They must sign in with this exact address. An invitation is not a password — it
                grants nothing until they prove they control the mailbox.
              </p>
            </div>

            <div className="field">
              <label className="label" htmlFor="invite-role">
                Role
              </label>
              <select
                className="input"
                id="invite-role"
                name="role"
                ref={roleField}
                disabled={invite.isPending}
                defaultValue="viewer"
              >
                <option value="viewer">viewer — can look</option>
                <option value="member">member — can trigger a sync</option>
                <option value="admin">admin — can connect accounts and invite</option>
              </select>
            </div>

            {invite.isError ? (
              <Errata heading="Not invited" live>
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
                  Invited {invite.data.email}. They have been emailed.
                </p>
              ) : (
                <Errata heading="Invited, but not emailed">
                  {invite.data.email} can sign in now, but no email was sent — mail is not
                  configured. Tell them to sign in with that exact address.
                </Errata>
              )
            ) : null}

            <div className="row">
              <button className="plate plate--primary" type="submit" disabled={invite.isPending}>
                {invite.isPending ? "Inviting…" : "Send invitation"}
              </button>
            </div>
          </form>
        ) : (
          <p className="note">Only an admin of {tenantId} can invite someone.</p>
        )}
      </div>
    </div>
  );
}
