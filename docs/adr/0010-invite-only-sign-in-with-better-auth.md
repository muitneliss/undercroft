# 10. Invite-only sign-in with Better Auth

- Status: Accepted
- Date: 2026-09-18

## Decision

The control plane authenticates people with **Better Auth 1.7.5**: Google, plus a one-time
code emailed to an address. There are no passwords. Sign-in is **invite-only** — an address
must match a live row in `app.invitation` or an existing `app.app_user`.

Better Auth owns four new tables of its own, `app.auth_user`, `app.auth_session`,
`app.auth_account` and `app.auth_verification`, created by `packages/db/sql/060_auth.sql`.
`app.app_user` remains the platform's user identity: it is what `app.tenant_member`
references and what `Context.user.userId` always carries. **The two identities are joined on
email address.**

`UNDERCROFT_SESSION_SECRET` — declared in both compose files since the deploy landed and
read by no code until now — is that secret.

This closes the follow-up ADR 0008 recorded under accepted risks ("the control plane is
public before its auth is wired… Follow-up: wire `UNDERCROFT_SESSION_SECRET` and the OAuth
flow"). ADR 0008 is unchanged; its risk stands as recorded history.

## Why a library, in a repo that writes its own SQL

The parts of sign-in that are easy to get subtly wrong — OAuth `state` and PKCE, cookie
signing, OTP attempt limits and expiry, account linking — are the parts where being subtly
wrong is a silent authentication bypass rather than a failing test. `@undercroft/crypto`
already has the primitives (`randomToken`, `hashToken`, `createPkce`), so writing this by
hand was available and was rejected: the primitives are not the hard part, the protocol
state machine is.

Better Auth's sessions are database-backed by default, which is the one property this
codebase could not compromise on. `trpc.ts` is explicit that a stateless token is
unacceptable because "the buttons behind this cookie mint OAuth tokens into a customer's
accounting system". A JWT-mode library would have contradicted that.

## Invite-only is enforced three times

One gate that fails open is an open control plane, so there are three, in different places:

1. **`user.validateUserInfo`** refuses an uninvited identity before it is created, and again
   on every returning _Google_ sign-in — so withdrawing access takes effect at the next
   sign-in rather than whenever a session happens to expire. Better Auth fails this hook
   closed: if it throws, the sign-in is refused.
2. **`sendVerificationOTP`** will not put a code in the post for an address that could not
   use it. Without this, anyone could make the platform email an arbitrary stranger on
   demand.
3. **`resolveCaller`** (in `server.ts`) resolves no `Context.user` without an
   `app.app_user` row, so even a validly signed session for a removed account arrives
   unauthenticated. This is the layer that covers a returning sign-in _by code_, which
   `validateUserInfo` does not see.

`databaseHooks.user.create.before` is the provisioning step, not a fourth gate: it is where
an invitation becomes a membership.

### `disableSignUp` is deliberately NOT set

It reads like the obvious way to express invite-only. It is the wrong tool, and quietly:
Better Auth's OTP send endpoint returns success **without mailing anything** to an address
that has no account yet — which is every invited person's first sign-in. Setting it would
make sign-in by code silently impossible for exactly the people it exists for.

### The sign-in form does not say who has access

Requesting a code for an uninvited address returns success and sends nothing. Answering
honestly would turn the form into an oracle for which addresses can sign in — the same
enumeration argument `trpc.ts` already makes for answering 404 rather than 403 to a
non-member. The UI copy therefore promises a code only _if_ the address has access, because
it cannot promise more than the server was willing to confirm.

## The cost of joining on email

This is the sharp edge of letting Better Auth own its own user table, and it is a real cost
rather than a theoretical one:

- **A changed provider address is a new identity.** If the primary email on a Google account
  moves, the join points somewhere else, or nowhere. `validateUserInfo` runs on the fresh
  provider email, so the outcome is a _refused sign-in_ rather than a silent identity swap —
  which is the safe direction, not a fix.
- **An invitation must be accepted from the address it was sent to.** `SignIn.tsx`'s denied
  copy already said this before the flow existed.
- **`+` aliases are different people.** `a+b@x` and `a@x` are different strings and get
  different `app_user` rows. Accepted; a canonicalisation rule would surprise someone.
- **Case had to be pinned in the database.** `app.app_user.email` is `text UNIQUE`, which is
  case-sensitive, while Better Auth lowercases on write. `060_auth.sql` adds
  `UNIQUE (lower(email))`, closing a latent duplicate-identity bug that predates this work.

The alternative — mapping Better Auth onto `app.app_user` — keeps one user table but
requires altering a table other things reference, and Better Auth's schema check refuses a
required column it does not itself write. The join was the smaller risk. A link column on
`app.auth_user` was also rejected: a nullable link is a link that can be null, which is a
link you cannot trust.

## What changed about sessions

- `session.cookieCache` is **off**, and must stay off. It would answer from a signed cookie
  without reading the database, so a revoked session would keep working until the cache
  expired — reintroducing exactly the stateless-token behaviour above. The config carries a
  comment saying so, because a future reader will see an easy query to save.
- `session.signOut` now **deletes** the session row, stronger than the `revoked_at` flag it
  replaces: the next request cannot be authenticated by a row that no longer exists.
- Resolving a caller is now two queries rather than one — Better Auth reads its session row,
  then we resolve the address to an `app_user`. For a control plane that is the right trade,
  and it is stated here rather than discovered later.
- **`app.session` is superseded and unread.** It is left in place: dropping a table is a
  separate, destructive migration and this one is additive. A later migration may remove it.

## Consequences

- **Migrations can finally be applied.** `migrate()` had no caller outside the tests, so
  there was no supported way to put the schema into a deployed database. `bun run migrate`
  exists now, as its own deploy step rather than a call at service boot — two replicas
  racing the same DDL is a failure that surfaces under the worst possible load.
- **A forgotten grant is now caught.** `040_grants.sql` grants `ALL TABLES IN SCHEMA app`, a
  one-shot snapshot that never re-runs, so `060_auth.sql` carries its own grants and a new
  test enumerates the whole `app` schema rather than naming tables.
- **Login tokens are encrypted at rest** (`account.encryptOAuthTokens`). They are identity
  scopes only; Gmail and Drive access remains a separate per-tenant consent in the sealed
  `app.connection_secret` registry, so signing in never hands over a mailbox.
- **Invitations are managed in the product**, not in SQL: `people.members`,
  `people.invitations`, `people.invite` and `people.revokeInvitation`, with the People
  division as their surface. Inviting is admin-only, re-inviting an address refreshes the one
  open invitation rather than adding a second, and whether the invitee was actually emailed
  is **reported** rather than assumed — with no mail configured the invitation still works
  and the admin is told to pass the address on. The **first** admin — the one nobody is
  signed in to invite — comes from `bun run invite`, a second caller of the same
  `people.invite` service, which is why that service returns values rather than `TRPCError`.
  No path needs SQL.
- **A refused sign-in is recorded.** It was not at first, and that cost real time: the first
  production sign-in showed "No access" with nothing written anywhere, so a correct gate and
  a broken one looked identical from outside. `auth.refused` now lands in `ops.audit_log`
  with the address as `actor` and no tenant — the one fact that tells a typo or the wrong
  Google account from a bug. The refusal stays silent to the _caller_, because saying "not
  invited" would turn the form into an oracle for who has access; the trail is therefore the
  only place the truth is written down, which is exactly why it has to be.
- **No invitation token is issued.** `app.invitation.token_sha256` is filled with a digest of
  a random value and never used: Google and a one-time code already prove the person controls
  the address, which is the only thing a token would have proved. Requiring both would add a
  step that demonstrates nothing new.
- **The offline gate proves the whole ring**, over a real loopback `Bun.serve`: an uninvited
  address is mailed nothing, an invited one gets exactly one code, the code becomes a signed
  cookie, that cookie resolves `session.me` to the `app_user` uuid, the invitation is redeemed
  into the promised membership, and signing out stops that same cookie working. Better Auth
  runs against its own `memoryAdapter` while `app.app_user` and `app.invitation` live in
  PGlite — no Docker, no egress, no credentials.

  Two harness details are load-bearing and were each a wasted hour. Calling the Hono app
  in-process does **not** surface `Set-Cookie` (true of a stock Better Auth password sign-in
  too), so the cookie can only be asserted over a socket. And `bunfig.toml` preloads
  happy-dom globally, whose `Response` class `Bun.serve` rejects and whose `fetch` cannot
  parse a real HTTP response — so that test file unregisters it and puts it back.

- **`session.signOut` goes through Better Auth**, not a `DELETE` of ours. The first cut wrote
  its own SQL, which was correct in production and a silent no-op against any other backing
  store. The revocation test is what caught it, and the seam now runs through the code that
  owns the table — which is the "one writer" rule applied to a table this repo does not own.
- **A schema mismatch refuses every request — it is not a warning.** This was got wrong once,
  in this file, and the first production deploy corrected it. Better Auth runs a schema check
  and raises `SchemaMismatchError`, so with the tables absent the control plane logged
  `sign_in_configured` and then answered **500 to every `/api/auth/*` request**:

  ```
  ERROR [Better Auth]: Database schema mismatch
    Missing tables
      auth_user, auth_session, auth_account, auth_verification
  ```

  The failure is at least loud and specific rather than silent. But it means the migration is
  not an operational nicety to be done "before people start using it" — nothing works until
  it has run. Hence `db-migrate`, the one-shot compose service that applies the schema before
  the control plane or the worker starts, so a deploy can no longer land code against a
  schema that does not have its tables.

- **The real `pg` path is exercised on deploy, not in the gate.** Better Auth emits
  unqualified table names against a pool whose `search_path` is `app`; the offline gate uses
  the memory adapter. Verified working against the live stack.
