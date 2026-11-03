---
title: ADR 0152 A Person Can Be Deactivated Platform-Wide by a Superadmin
type: source
date: 2026-11-03
tags: []
source: docs/adr/0152-a-person-can-be-deactivated.md
source_path: docs/adr/0152-a-person-can-be-deactivated.md
source_hash: 7862529ef941a61234f848d63f1a15e592b371164f349232d00d7c02934ea914
ingested: 2026-11-03
---

# ADR 0152 A Person Can Be Deactivated Platform-Wide by a Superadmin

Corrects [[ADR 0060: An agent reaches Undercroft over MCP, with a credential a person holds]] and [[ADR 0062: A refused bearer is logged with its reason, and an access token lives eight hours]], whose sentences that removing a person removes their tokens hold only for a deleted `app.app_user`, which nothing in the product deletes; neither is edited. Beside [[ADR 0110 A Tenant Can Be Deactivated]], which deactivates a customer and rejected deactivating a person as a different question. Follows [[ADR 0013 Superadmins Named in the Environment]], whose list still outranks any column.

**Why.** `people.removeMember` deletes one `app.tenant_member` row. Every door resolved a credential through a function that only asked whether an `app_user` existed, so a removed person's personal tokens, OAuth consents and refresh tokens and sessions kept authenticating -- as somebody of no customer, but somebody -- and nothing let anyone revoke another person's credential. A person may belong to several customers, so "this person has left" is not one customer admin's decision.

**Decision.** A platform superadmin deactivates a person everywhere: `users.list`, `users.deactivate`, `users.reactivate`, all `superadminProcedure`, offered in the web UI on the customer index to a superadmin only. One column, `app.app_user.deactivated_at` (`660_user_deactivation.sql`); conditional UPDATEs, so a race makes one transition; `users.deactivate`/`users.reactivate` in `ops.audit_log`. From the next request the person is nobody at every door (`standingOf`, `services/invite.ts`), and a bearer refused for them is logged `deactivated`, the cause, in place of `revoked`. Sign-in refuses the address even with a live invitation (`admissionRefusal`, `auth.refused` reason `DEACTIVATED`, no code mailed, no invitation redeemed). Every credential is revoked for good: personal tokens in the same statement as the state; OAuth refresh tokens, consents and sessions through Better Auth's own adapter (`handlers/signIns.ts`); counts in the audit row and the answer. Memberships are kept, so reactivation restores access as it was; a kept admin membership is mailed nothing meanwhile. The caller's own address and any address in `UNDERCROFT_SUPERADMINS` are refused, and `standingOf` never answers `deactivated` for a listed address. `users.deactivate` is `destructive`, unlike `tenants.deactivate`, because the revocation cannot be undone.

**Two writes.** Better Auth's tables are written through its adapter, wherever its database is (in the offline gate, its in-memory store), so they cannot share a transaction with ours: they go first, so a failure leaves the person not yet deactivated and a second press repeats it whole.

**Rejected.** Deleting the `app_user` (loses the audit key and everything they saved); revoking automatically on the last membership's removal (declined: leaving is a person's decision, and a superadmin holds no memberships); letting a customer's admin do it; revoking credentials with no state (an invitation or Google sign-in would readmit them); clearing memberships.

**Consequences.** Offboarding is the customer index or `undercroft users deactivate --email`. A roster still lists a deactivated member. A rotated refresh token answered from Better Auth's replay window repeats an answer whose tokens are already revoked.
