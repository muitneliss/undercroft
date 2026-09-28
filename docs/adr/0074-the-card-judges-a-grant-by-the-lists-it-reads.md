# 74. The card judges a grant by the lists it reads, from the spec the run reads

- Status: Accepted
- Date: 2026-09-28
- Supersedes: one consequence of
  [ADR 0073](0073-a-list-its-grant-cannot-read-is-named-not-failed.md), that "the card of every
  such connection reads **reconnect**, because `presentStatus` compares the grant with the
  consent". ADR 0073's decisions all stand.

## Context

ADR 0073 made a run read every list its recorded grant reaches and name the rest. The card kept
the older rule: `presentStatus` showed `needs_reconnect` whenever the grant did not cover the
whole consent. So every Xero connection made before the consent asked for
`accounting.settings.read` read "the access has lapsed or been withdrawn". Its card offered no
**Run now** and hid its schedule, although its grant still reads twelve lists. Issue 277 asked
that such a connection "keep reading every list it can already read until it reconnects". The
runs did. The card said they did not.

The schedule itself was not stopped. The due list (`listDueCandidates`) selects on the stored
`ops.connection.status = 'connected'`, and `nextRunAt` and `isDue` read that stored status too.
`needs_reconnect` for a narrow grant is a derivation for the card alone, so the scheduler kept
starting these runs. Only the card, and the **Run now** it withholds, were wrong.

To say which lists a grant reaches, the card needs each list's `readScope`. That is in the
spec, and the control plane did not read specs: its Xero consent is a hand copy of the spec's
`auth.scopes`, and the interface's list of Xero entities is another.

## Decision

**A grant that lacks some of the consent is runnable when it still reads a list the connection
would read.** The card shows it `connected`, with **Run now** and its schedule. It also carries
`ungranted`, the lists the run will skip and the scope each needs. The card words them, one
sentence per missing permission, and its primary plate is **Reconnect**. A grant that reads none
of those lists stays `needs_reconnect`, and so does one lacking a capability that gates no list,
such as Xero's `offline_access`. Gmail and Drive read under one scope, so a grant without it
reaches nothing and stays `needs_reconnect`, as before. An empty recorded grant is still not
judged.

**One rule, in `@undercroft/contracts`.** `partitionByGrant` moves from the worker to
`specGrant.ts`, and it applies the admin's Xero choice as well as the grant, so a list nobody
chose is never named. The worker's `openSpecRun` and the card's `presentStatus` both call it.

**The control plane reads the specs the image carries, at boot.** `apps/control-plane/src/specs.ts`
reads `specs/connectors/*.yaml`, like `skills.ts` reads `skills/`. The Dockerfile copies `specs`
into the control plane's image as it already does into the worker's. `ServerDeps.specReads`
reaches the context, and `connections.list` takes it. A spec that fails to read is logged, and
that source's grant is judged whole, the rule before ADR 0073.

## Consequences

- A Xero connection recorded before `accounting.settings.read` shows **Run now**, its cadence
  and its next run. It names items, the chart of accounts, tracking categories, tax rates and
  currencies as not read under that scope, and offers the reconnect that adds them.
- The card and the run cannot disagree about a list: both ask the same function of the same
  `readScope`.
- The next scope added to a spec source's consent needs no change here.
- Every tRPC `Context` carries `specReads`. A test context that lists no cards passes an empty
  map.

## Rejected

- **Keep a per-list scope table in the control plane or the UI.** That is a third copy of the
  spec's `readScope`. The mistake behind issue 276 was a list under the wrong scope, and a copy
  can repeat it.
- **Ask the worker, which already reads the specs.** The card list is the page every customer
  lands on. It would depend on a second process answering, and it reads nothing from the worker
  today.
- **Read the last run's `entity_not_granted` warnings.** A connection that has not run since
  the change has none, and after a reconnect they describe a grant that is gone.
- **Show a fifth card state.** "Runs, but not everything" needs no state of its own: the
  connected card already offers what it needs, and the reconnect is its one next step.
