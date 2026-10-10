# 120. An agent's reads, and every sign-in event, are on the record

- Status: Accepted
- Date: 2026-10-11
- Supersedes: from [ADR 0113](0113-every-action-is-in-the-audit-log-and-people-can-read-it.md),
  for the CLI, `/mcp` and the assistant only, the sentence in its first decision that "plain reads
  are not actions here", the `"none"` entry that recorded nothing for a POST that changes nothing,
  and the rejected option "Log every call, reads included"; and its fifth decision's list of the
  events written outside the router, which this extends
- Keeps: everything else in ADR 0113 -- `AUDITED` and who writes an action's row, the attempt
  recorded however it ends, a non-member's attempt kept out of the tenant's log, the actor by id
  and door, the three readers on their three gates, and the append-only table. A read through the
  browser is still not recorded, for 0113's reason.

## Context

ADR 0113 made every action recordable and readable, and left two things out on purpose.

**Reads.** "Every page polls; the actions would drown." That holds for the browser. It does not
hold for the other three doors. A person who lets an agent in -- a claude.ai connector, the CLI in
a coding agent, the assistant -- hands it their authority over every customer they belong to, and
what it _read_ with that authority is most of what it did: a `lake.query` over a customer's raw
records, the models, the run history. Under 0113 none of it left a trace; only a write did. The
person, and the customer's admin, could not answer "what did the agent look at".

**Sign-in events beyond the session itself.** 0113 recorded a sign-in and an address turned away
for not being invited. It did not record:

1. a bearer credential refused at `/mcp` or at an export's download -- expired, revoked, not
   ours, granting nothing -- which the operator's `mcp_refused` log line (ADR 0062) saw and
   nobody reading the activity did;
2. a person consenting to a model-context app (ADR 0061), which is what lets that app act at all;
3. a sign-out through Better Auth's own `/sign-out`: only the `session.signOut` procedure wrote a
   row, so the same act left a row or none depending on which button sent it;
4. a wrong one-time code offered for a real person's address.

The request, in its author's words: "the Activity log must log all of the activity, such as login,
mcp or cli calling, etc." Two decisions were made with them: reads through the agent doors are
logged, and the four missing events are added.

## Decision

1. **A read through an agent's door is recorded; a read through the browser is not.** A read is
   a query, or a POST that `AUDITED` now marks `"read"` (the entry was `"none"`): `lake.query`,
   `models.check`, `macros.check`, `bi.answer`, `bi.runQuestion`. When `ctx.channel` is `cli`,
   `mcp` or `assistant`, the router's middleware writes one row per call however it ends: `ok`,
   `refused` or `failed`, with the channel and the credential as for an action. `web` writes
   none (`isRecorded` in `handlers/audited.ts`). The decision is on the channel, not on the
   credential, because the CLI holds a session like the browser and the assistant reuses the
   browser's.

2. **A read's row copies nothing of its input but the tenant it named.** A read's input is SQL, a
   question, a search term -- text that may quote a customer's data -- and the row is read by the
   tenant's admin. `detail` is `{}`, or `{ tenantId }` for a refused non-member exactly as in 0113.
   The tenant is attributed by the same check a refused attempt gets (`recordAttempt`), not taken
   on trust from a successful call: `audit.all` takes a tenant as a filter, and a superadmin's
   filter naming no customer is not that customer's row.

3. **The events written outside the router gain four** (`EventAction` in `services/audit.ts`),
   each written once, where every way to it passes:
   - `auth.tokenRefused`: a bearer refused at any door that reads one, written by
     `bearerContext` (`handlers/context.ts`), the one function both `/mcp` and the export download
     admit through. Every reason but `missing`: no header at all is every OAuth client's first
     contact, with nobody behind it. The row names the credential's owner where an account was
     read for it (a personal token whose row was found, an OAuth token whose consent was read),
     carries the credential's id (`upat_…`, `oauth:<client>`), never the token, and is `refused`
     with the refusal's reason. Its channel is `mcp`, the bearer door's.
   - `auth.consentGranted`: an after-hook on Better Auth's `/oauth2/consent`, because the
     provider writes the consent through its own adapter, so no database hook sees it, and offers
     no callback (`@better-auth/oauth-provider` 1.7.5). It records only an answer that accepted
     and issued an authorization code, names the app as `oauth:<client>` -- the id its later calls
     carry -- and the scopes as the stored consent holds them. Never the app's own name, which
     whoever registered it chose.
   - `auth.signOut`: Better Auth's `session.delete.after` database hook, for a deletion made by
     `/sign-out`. Both ways out reach it -- the procedure calls `auth.api.signOut` -- so
     `session.signOut` becomes `"service"` in `AUDITED`: the router no longer writes its success,
     and one sign-out is one row whichever way it went. Other deletions (an expired session swept
     by `/get-session`, a removed person's sessions) are not sign-outs and are not recorded as one.
   - `auth.refused` is no longer only "not invited". It is `refused` with a reason this log owns:
     `NOT_INVITED`, or, for an address that may sign in, `WRONG_CODE`, `CODE_EXPIRED` or
     `TOO_MANY_ATTEMPTS` -- an after-hook on `/sign-in/email-otp` mapping the email-OTP plugin's
     error codes. A row names the `app_user` its address belongs to when there is one, so a person
     finds in their own log that somebody offered a code for their address. A code offered for an
     address that may not sign in is not recorded: none was ever sent, the request for one was
     recorded as `NOT_INVITED`, and a row per guess would be the log filling itself on a stranger's
     behalf.

4. **A row may name nobody.** A token this server never issued has no owner, so `actor` is NULL
   for it (`520_audit_log_unattributed_actor.sql`) and the readers print it as missing. Nothing
   else about the table changes; it stays append-only.

5. **Better Auth's hooks that write the log are one plugin**, `auditPlugin` in
   `handlers/authAudit.ts`: the session hooks through its `init`, the two after-hooks beside them.
   The configuration in `auth.ts` says sign-in is audited in one line, and one module says how.

6. **The browser labels every procedure.** `AuditAction` is now every procedure path, not every
   mutation path, plus the events; `activity.actions` in both catalogues answers each one, in
   Vietnamese first, and the `satisfies` keeps it total.

## Consequences

- **Volume.** Every call an agent makes is now a row: a model-context session that lists runs,
  reads a model and queries the lake is three. Retention is still unbounded, as ADR 0113 left it;
  with reads on the record the retention decision it deferred is nearer, and is a follow-up.
- **An unauthenticated caller can write a row.** A garbage bearer sent to `/mcp` writes one
  `auth.tokenRefused`, naming nobody, per request -- as asking for a code for an uninvited address
  already wrote one `auth.refused`. Neither is rate-limited. A limit at the door is a follow-up.
- An export downloaded through an agent's door is three rows: asked for (`bi.exports.create`),
  read (`bi.exports.get`, which the download route calls through the router as its caller), and
  taken (`bi.exports.download`).
- A read of the log through the CLI or `/mcp` records itself, after the page it answered with.
- A write tool a read token names directly is refused by `/mcp` before the router runs, so the
  door writes the row itself, through the same `recordCall` the router's middleware uses: the
  procedure's path, `refused`, `WRITES_DISABLED`, the token, and the tenant its arguments named
  under the same authority check. An unlisted tool name, `tools/list` and `resources/read` have
  no procedure behind them; they are protocol traffic, leave no row, and stay in the `mcp_call`
  log line.
- `auth.refused` rows written before this keep `outcome` `ok` and no `reason`; `session.signOut`
  rows written before this keep their name and label.

## Options rejected

- **Log reads through the browser too.** The reason ADR 0113 gave stands for that door: the SPA
  polls, and its reads would bury the actions beside them.
- **Keep reads out everywhere.** What an agent read of a customer's data on a person's authority
  stays invisible to that person and to the customer's admin, which is the gap this closes.
- **Copy a read's input into `detail`.** SQL and questions quote customer data, and the row is
  read by people the data was not addressed to.
- **Record a refused bearer in each door** (`mcp.ts`'s `refuse`, the export route). Two sites
  drift, and a third door would add a third; `bearerContext` is where every bearer is admitted.
- **Record `missing` too.** One row per connector per session, each naming nobody, each the
  protocol working as designed.
- **Name an unowned bearer by a placeholder** -- an empty string, its id, "unknown". It would
  read as somebody in the "who" column. NULL is visibly missing.
- **Keep `session.signOut` written by the router and add a hook for `/sign-out` alone.** Two
  writers keyed by which path ran, where the session's deletion is the one place both pass.
- **A new event for a wrong code.** `auth.refused` already means "turned away at sign-in"; the
  reason says why, and one action keeps the reader's question -- who was turned away -- one filter.
- **Read a consent from what the consent page sent.** The stored row is what `/mcp` reads on every
  call, so it is what was granted.
