/**
 * The people division: who can see this customer.
 *
 * THE INVITATION TOKEN IS THE WHOLE DESIGN PROBLEM HERE. The API returns it
 * exactly once and stores only its digest, so the moment it appears on screen is
 * the only moment it will ever exist in readable form. An interface that shows
 * it in a toast, or in a row that disappears on the next render, loses it -- and
 * the operator finds out only when the person they invited cannot sign in.
 *
 * So it arrives as a tear-off slip: its own leaf, hinged down, saying plainly
 * that this is the only time it is shown, with the token selectable as text as
 * well as copyable, and no way to dismiss it by accident. It stays until the
 * operator puts it away.
 *
 * REMOVING SOMEONE IS CONFIRMED IN PLACE. It revokes a person's access to a
 * customer's data, which deserves a second look, but not a modal -- the row
 * turns into its own confirmation and turns back, so the list never leaves the
 * screen. `.claude/rules/ui.md`: exhaust inline and progressive alternatives
 * before a modal.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, ApiError } from "@/api/client";
import type { Member } from "@/api/types";
import { EmptyState } from "@/components/EmptyState";
import { Errata } from "@/components/Errata";
import { Plus } from "@/components/Icon";
import { Skeleton } from "@/components/Skeleton";
import { formatCount, orMissing } from "@/lib/money";

const ROLES = [
  { value: "viewer", label: "Viewer", detail: "Reads this customer’s data." },
  { value: "member", label: "Member", detail: "Reads, and can run a sync." },
  { value: "admin", label: "Admin", detail: "Everything, including inviting and removing people." },
] as const;

/**
 * The role as a person reads it.
 *
 * The API stores `admin` / `member` / `viewer` and the interface should not
 * leak that casing into a column sitting beside "Staff". An unrecognised role is
 * shown verbatim rather than mapped to a default -- inventing "Viewer" for a
 * value we do not understand would understate someone's access.
 */
function roleLabel(role: string | null): string {
  if (role === null || role === "") return orMissing(role);
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

function Slip({
  token,
  email,
  days,
  onDone,
}: {
  token: string;
  email: string;
  days: number;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  return (
    <section className="hinge stack" aria-label="Invitation">
      <span className="hinge__punch hinge__punch--a" aria-hidden="true" />
      <span className="hinge__punch hinge__punch--b" aria-hidden="true" />
      <div className="stack stack--tight">
        <span className="label">Invitation for {email}</span>
        <h3>Copy this now — it is not shown again</h3>
        <p className="note">
          Only a digest of this token is stored, so nobody, including us, can retrieve it later. If
          it is lost, invite {email} again and a new one is issued. It expires in{" "}
          {formatCount(days)} days.
        </p>
      </div>

      {/* Selectable as text, not only copyable: a clipboard API that silently
          fails would otherwise destroy the one copy of this value. */}
      <p className="token" tabIndex={0}>
        {token}
      </p>

      <div className="row">
        <button
          className="plate plate--primary"
          onClick={() => {
            navigator.clipboard.writeText(token).then(
              () => setCopied("done"),
              () => setCopied("failed"),
            );
          }}
        >
          {copied === "done" ? "Copied" : "Copy token"}
        </button>
        <button className="plate" onClick={onDone}>
          Put it away
        </button>
      </div>

      {copied === "failed" ? (
        <p className="note" role="status">
          Copying was refused by the browser. Select the token above and copy it manually.
        </p>
      ) : null}
    </section>
  );
}

export function People({ tenantId, isStaff }: { tenantId: string; isStaff: boolean }) {
  const queryClient = useQueryClient();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [slip, setSlip] = useState<{ token: string; email: string; days: number } | null>(null);

  const members = useQuery({
    queryKey: ["members", tenantId],
    queryFn: () => api.members(tenantId),
  });

  const invite = useMutation({
    mutationFn: () => api.invite(tenantId, email.trim().toLowerCase(), role),
    onSuccess: async (result) => {
      setSlip({
        token: result.token,
        email: email.trim().toLowerCase(),
        days: result.expires_in_days,
      });
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["members", tenantId] });
    },
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(tenantId, userId),
    onSuccess: async () => {
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: ["members", tenantId] });
    },
  });

  return (
    <div className="sheet">
      <div className="head head--division">People</div>
      <div className="body stack">
        <h1>Who can see this customer</h1>
        <p className="prose prose--lead">
          Everyone listed here can read this customer’s synced data. Staff reach every customer by
          domain; everyone else is here because they were invited.
        </p>
      </div>

      <div className="band-rule" />

      <div className="head">Members</div>
      <div className="body">
        {members.isPending ? <Skeleton rows={4} /> : null}

        {members.isError ? (
          <Errata heading="Not loaded" live>
            This customer’s members could not be loaded, or you do not have access to them.
          </Errata>
        ) : null}

        {members.isSuccess && members.data.length === 0 ? (
          <EmptyState
            title="Nobody invited yet"
            body="Staff can already reach this customer. Invite the customer’s own people here when they should be able to sign in and connect their accounts themselves."
          />
        ) : null}

        {members.isSuccess && members.data.length > 0 ? (
          <table className="table">
            <caption>
              {formatCount(members.data.length)} {members.data.length === 1 ? "person" : "people"}
            </caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.data.map((member: Member) => (
                <tr key={member.id}>
                  <td>
                    <div className="stack stack--tight">
                      <span>{orMissing(member.display_name)}</span>
                      <span className="datum datum--quiet">{member.email}</span>
                    </div>
                  </td>
                  <td>{member.is_staff ? "Staff" : roleLabel(member.role)}</td>
                  <td>
                    {confirming === member.id ? (
                      <div className="row">
                        <span className="note">Remove {member.email}?</span>
                        <button
                          className="plate plate--small"
                          onClick={() => remove.mutate(member.id)}
                          disabled={remove.isPending}
                        >
                          {remove.isPending ? "Removing…" : "Confirm"}
                        </button>
                        <button className="plate plate--small" onClick={() => setConfirming(null)}>
                          Keep
                        </button>
                      </div>
                    ) : (
                      <button
                        className="plate plate--small"
                        onClick={() => setConfirming(member.id)}
                        disabled={member.is_staff}
                        title={
                          member.is_staff
                            ? "Staff reach every customer by domain and are not removed here"
                            : undefined
                        }
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {remove.isError ? (
          <Errata heading="Not removed" live>
            That person could not be removed. Their access is unchanged.
          </Errata>
        ) : null}
      </div>

      {isStaff ? (
        <>
          <div className="band-rule" />

          <div className="head">Invite</div>
          <div className="body stack">
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) invite.mutate();
              }}
            >
              <div className="field" style={{ maxWidth: "26rem" }}>
                <label className="label" htmlFor="invite-email">
                  Email address
                </label>
                <input
                  id="invite-email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.example"
                  aria-describedby="invite-email-hint"
                />
                <span id="invite-email-hint" className="field__hint">
                  They must sign in with this exact address. An invitation sent to an alias they do
                  not use is the most common reason a client cannot get in.
                </span>
              </div>

              <div className="field" style={{ maxWidth: "26rem" }}>
                <label className="label" htmlFor="invite-role">
                  Role
                </label>
                <select
                  id="invite-role"
                  className="input"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  aria-describedby="invite-role-hint"
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <span id="invite-role-hint" className="field__hint">
                  {ROLES.find((r) => r.value === role)?.detail}
                </span>
              </div>

              {invite.isError ? (
                <Errata heading="Not invited" live>
                  {invite.error instanceof ApiError && invite.error.detail
                    ? invite.error.detail
                    : "That invitation could not be created. Nobody has been invited."}
                </Errata>
              ) : null}

              <div className="row">
                <button
                  className="plate plate--primary"
                  type="submit"
                  disabled={!email.trim() || invite.isPending}
                >
                  {invite.isPending ? "Inviting…" : "Create invitation"}
                  {invite.isPending ? null : <Plus size={13} />}
                </button>
              </div>
            </form>

            {slip ? (
              <Slip
                token={slip.token}
                email={slip.email}
                days={slip.days}
                onDone={() => setSlip(null)}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
