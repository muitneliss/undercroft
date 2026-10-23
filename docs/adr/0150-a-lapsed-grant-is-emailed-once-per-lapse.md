# 150. A lapsed grant is emailed once per lapse

- Status: Accepted
- Date: 2026-10-23
- Touches: [ADR 0030](0030-an-email-is-a-leaf-of-the-book-posted.md), whose family of leaves gains
  one, written like the others. [ADR 0110](0110-a-tenant-can-be-deactivated.md): a lapse at a
  deactivated customer is claimed and withheld, like every other notice.
  [ADR 0144](0144-a-refresh-token-s-stated-end-is-the-grant-s-end.md) warns BEFORE a grant ends;
  this one tells AFTER a provider refused it.

## Context

When a provider refuses a grant -- Google's `invalid_grant`, a Xero refresh token gone unused --
the worker marks the connection `expired` (`accessToken`'s `expire` in
`packages/db/src/services/credentials.ts`, and `resolveToken` in
`apps/worker/src/services/runTypes.ts`). The card then says "Cần cấp lại quyền" and offers the
reconnect. Nobody is told who does not open the card.

What an admin did get was the failed-run email of the run that found the lapse. Its correction
slip carries `ops.run.error`, which is the provider's own English ("Google answered 400
invalid_grant"), and its lead says the data will not change until a run succeeds. It never says
that no run can succeed until somebody reconnects. And a lapse found outside a run -- by a scope
browse (`apps/worker/src/services/browseScope.ts`) -- sent nothing at all.

## Decision

**The alert tick emails a tenant's admins when a grant has lapsed, once per lapse.**

- **Lapsed means `ops.connection.status = 'expired'`.** One SQL fragment in
  `packages/db/src/repos/connections.ts` (`LAPSED`) says so, and the claim, the failed-run check
  and the re-arm all read it. `error` is not in it, although the card shows it with the same
  "reconnect" (`presentStatus`). Nothing writes `error` today, and the email says the grant lapsed
  or was withdrawn. A provider fault, which is what `error` would mean, does not fit those words.
- **Claimed once, on `app.connection_secret.lapse_told_at`.** `claimLapsedGrants` is one UPDATE
  that marks and returns, the shape of every other claim (110_alerts.sql). The column is on the
  secret's table, not on `ops.connection`, because BI reads `ops.connection` and a table-level
  grant reaches a column added later (640_lapse_notice.sql).
- **A reconnect re-arms it.** `writeCredential` clears the marker when it writes a credential for
  a connection that is not lapsed. A reconnect is that write: `storeCredential` records
  `connected` before it seals, in one transaction. A refresh that succeeds while the connection
  still reads `expired` keeps the marker. That can happen when a browse runs in a process with the
  refresher after a run without one marked the connection. Without the guard, the next tick would
  tell a lapse that was already told and still stands.
- **Lapses standing when this ships are told on the first tick.** There is no backfill: nobody was
  told about them, so the first tick tells them.
- **It replaces the failed-run email for the run that found the lapse.** `tellFailures` sends no
  email for a failed run whose connection is lapsed. The run is still claimed as `sent`, so the
  operators' red card posts and its green one follows a recovery. `resolveToken` writes `expired`
  before the run is closed failed, so by the time the run is claimed the status can be read.
- **Email only, like the warnings about grants and keys.** It is not claimed when the deployment
  has no email, so a claim never stands for a notice nobody received. It goes to the same people,
  through `recipientsFor`: the tenant's admins in each one's language, or the superadmins when
  there are none. Its words are the card's: lapsed or withdrawn, nothing lost, reconnecting picks
  up where the last sync finished. It names the account where a source may hold several (ADR 0043) and links to the customer's sources, where the reconnect button is.

## Consequences

- **A lapse found after its run failed is told twice, as two discoveries.** If a run fails for
  another reason and a later browse then finds the grant lapsed, the failed-run email has already
  gone. The lapse notice follows on its own.
- **A lapse found by a browse reaches the operators only through the card**, not their Lark
  group. The group follows runs, and that lapse has no run.
- **Who is told stays a role, not a permission.** `listAdmins` is unchanged, for every notice
  alike. Whether a notice should go to whoever holds `sources:manage` is a separate question, and
  a separate change.

## Options rejected

- **Keep the failed-run email and add the lapse email beside it.** One cause would arrive as two
  emails, one of them carrying the provider's raw English. The admin's question is the same in
  both, and only one of them answers it.
- **Mark the lapse on `ops.connection`.** It is BI-readable, so when an admin was emailed would
  sit one dbt model from a customer's dashboard.
- **Clear the marker on every credential write.** A successful refresh while the connection still
  reads `expired` would re-send the notice on the next tick, for a lapse nothing has repaired.
- **Re-arm it in `upsertConnection`, on the move to `connected`.** The writer of `ops.connection`
  would then write the secret's table as a side effect. The decision belongs with the credential:
  a new credential for a usable connection is the reconnect.
- **A trigger on the status change.** It would hide a write that the repos otherwise all make in
  plain sight, and a trigger is the one place a reader of `connections.ts` would not look.
- **Mark the lapses standing on the day this ships as already told.** Nobody had been told about
  them. A backfill would make the ledger claim a notice that never went out.
