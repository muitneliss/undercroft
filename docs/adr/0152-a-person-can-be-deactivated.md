# 152. A person can be deactivated, platform-wide, by a superadmin

- Status: Accepted
- Date: 2026-11-03
- Corrects: [ADR 0060](0060-an-agent-reaches-undercroft-over-mcp.md), which says a personal
  token "dies with" its person because "removing someone's access removes their tokens' at once",
  and [ADR 0062](0062-a-refused-bearer-is-logged-and-an-access-token-lives-eight-hours.md), which
  says "removing the person does the same" for an OAuth app. Both sentences are true of a
  deleted `app.app_user` and of nothing else, and nothing in the product deletes one. Neither ADR
  is edited; this one says what removing a person now means, and how.
- Beside: [ADR 0110](0110-a-tenant-can-be-deactivated.md), which deactivates a CUSTOMER and
  rejected deactivating a person as "a different question". This is that question.
- Follows: [ADR 0013](0013-superadmins-named-in-the-environment.md), whose environment list still
  outranks any column.

## Context

A customer's admin removed a person from the customer (`people.removeMember`). The removal did
what it says: the membership row went, and every data call after it was refused `NOT_FOUND`. But
the person's agent kept connecting over `/mcp` the next day, and its calls to `session.me` and
`tenants.list` were logged as done.

Removal deletes one `app.tenant_member` row and nothing else. Every door resolves a credential to
its person through one function, and that function only asked whether an `app.app_user` row
existed. It did, so the person's personal access tokens, their OAuth apps' consents and refresh
tokens and their browser sessions all went on authenticating -- as somebody who belongs to no
customer, but somebody. Nothing anyone could press revoked another person's credential: the
account page revokes only the caller's own.

A person can belong to several customers (`app.tenant_member` is keyed by both), so "this person
has left" is not a decision any one customer's admin can make.

## Decision

1. **A platform superadmin deactivates a person, everywhere at once.** `users.deactivate`,
   `users.reactivate` and `users.list`, all `superadminProcedure`, in a new `users` namespace; the
   web UI offers them on the customer index, under adding a customer, to a superadmin only.
2. **One column holds the state.** `app.app_user.deactivated_at` (`660_user_deactivation.sql`),
   `NULL` while the person may act. As for a customer, "active" is derived and stored nowhere, and
   each transition is a conditional UPDATE, so two superadmins pressing at once make one
   transition and the second is told. Both are in `ops.audit_log` as `users.deactivate` and
   `users.reactivate`, naming the person.
3. **From the next request, the person is nobody at every door.** `standingOf`
   (`services/invite.ts`), the one function every door resolves a credential through, answers
   `deactivated` -- the cookie, `/trpc` with a token, `/mcp` with a token or an OAuth JWT, an
   export's download and the assistant all refuse them as they refuse a stranger. A bearer refused
   for a person who is deactivated is logged with the reason `deactivated`, in place of the
   `revoked` that is only its consequence.
4. **They cannot sign in, even holding a live invitation.** The sign-in gate refuses the address
   (`admissionRefusal`), records `auth.refused` with the new reason `DEACTIVATED`, and mails no
   code; the provisioning hook redeems no invitation for it. Otherwise a customer's admin who
   could not see the deactivation would undo it by inviting the person to their customer.
5. **Every credential they hold is revoked, for good.** In the same act: their personal access
   tokens (`revoked_at`, in the same statement as the state change); and, through Better Auth's
   own adapter, every OAuth app's refresh tokens (`revoked`), every consent, and every session.
   The counts are in the audit row and in the procedure's answer. Reactivating gives none of them
   back: the person signs in again and mints new tokens.
6. **Their memberships are kept.** Reactivating restores their access exactly as it was. While
   they are deactivated a kept admin membership mails them nothing (`listAdmins` skips them).
7. **Two addresses cannot be deactivated:** the superadmin's own, and any address
   `UNDERCROFT_SUPERADMINS` names -- the environment admits such an address before any query
   (ADR 0013), so the column could revoke its credentials and never keep it out. The refusal says
   to take the address off the list first. For the same reason `standingOf` never answers
   `deactivated` for a listed address: a person deactivated earlier and later named in the list
   is a superadmin, as the list says.
8. **`destructive`, unlike a customer's deactivation.** `tenants.deactivate` is a `write` because
   it deletes nothing and is undone whole. This revokes credentials that stay revoked, so the CLI
   asks for confirmation and the browser asks for a second press.

## Why the revocation is two writes

The state and the personal tokens are our tables and change in one statement. Sessions, consents
and refresh tokens are Better Auth's, written through its adapter wherever its `database` keeps
them -- in the offline gate, its in-memory store. A `DELETE` of ours against those tables would
be a second writer of tables whose shape a plugin upgrade may change, and would revoke nothing in
the gate's store, so the suite could not prove it. They cannot share a transaction, so Better
Auth's go first: a failure there leaves the person not yet deactivated, and pressing again repeats
the whole thing. The other order would leave a deactivated person whose refresh tokens nobody
retries, because the second press answers "already deactivated". The door does not wait on
either write: a deactivated person is refused whatever they present.

## Options rejected

- **Deleting the `app.app_user` row.** Every credential cascades away with it, which is what ADR
  0060 assumed. But the row keys the audit trail, the person's memberships, and everything they
  saved; deleting it loses who did what, and there is no coming back.
- **Revoking a person's credentials automatically when their last membership is removed.** A
  person with no customer can be someone about to be invited to another, and a superadmin holds
  no memberships at all. Declined: whether someone has left is a decision a person makes.
- **Letting a customer's admin deactivate.** They cannot see the person's other customers, and
  would cut the person off from them. Removing a member from their own customer stays theirs.
- **Revoking credentials only, with no state.** A person who still has an invitation, or who
  signs in again with Google, would be back the next minute.
- **Clearing memberships on deactivation.** Reactivation would then mean re-inviting the person
  to every customer by hand, from memory.

## Consequences

- An operator offboarding someone deactivates them on the customer index, or with
  `undercroft users deactivate --email …`. Removing them from one customer remains
  `people.removeMember`, and no longer pretends to do more.
- A customer's roster still lists a deactivated member, since the membership is kept; the
  customer's admin may remove it. A customer whose only admin is deactivated keeps that admin's
  row, and its failure notices go to the superadmins, as for a customer with no admin.
- A rotated refresh token answered from Better Auth's short replay window repeats the answer it
  was given before, whose tokens the deactivation already revoked; it mints nothing new.
