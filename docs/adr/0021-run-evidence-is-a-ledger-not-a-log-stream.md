# 21. A run's evidence is a ledger in `ops`, not a log stream

- Status: Accepted
- Date: 2026-09-19

## Decision

The worker appends **enumerated events** to a new table, `ops.run_event`, as a run proceeds.
The control plane reads them through `runs.events`, and the journal's leaf re-reads them
every two seconds while a run is live.

The worker's JSONL on stdout is unchanged and stays the operator's channel (ADR: the
docstring on `packages/core/src/log.ts`). This is a second, narrower channel with a different
audience: the customer's administrator, in their own language, in the browser.

## The problem it answers

Three runs on 2026-09-19 for one tenant, all green or still going, and the interface could
not say a word about any of them:

- A Gmail ingest sat at `running` for sixteen minutes. It was not stuck -- one paced
  `messages.get` per message is minutes for a real mailbox -- but `runs.get` withholds counts
  while a run is in progress ("a count that is still changing is not a count"), so every
  column read `—` for the duration.
- Three Drive ingests closed `ok` in under half a second with `files 0 / documents 0`. The
  picked folder held no PDFs one level down, which is the documented behaviour and exactly
  the sentence nobody could read.
- Every transform closed `ok` with no steps, because the tenant has no models and dbt is
  never spawned for a tenant with none.

In each case the worker had already said so on stdout, inside a container the control plane
has no path to. The evidence existed and was unreachable by the person who asked for the run.

## Why a table rather than a stream

**Server-Sent Events from the worker, proxied by the control plane**, was the obvious
alternative and is the wrong shape for this question. A stream exists only while somebody is
watching it: a reload, a redeploy or a worker restart loses it, and the commonest reading of
this evidence is the next morning, about a run nobody watched. It would also add a streaming
route through the trigger-token hop and a per-run subscriber registry in the worker, for an
answer that is worse at the thing being asked for.

**Mirroring stdout into the table** was rejected on the payload boundary. A log line is the
least controlled surface in the system -- an exception message routinely embeds the row that
caused it, and dbt's output can echo the values of a failing test, which is why `transform.ts`
keeps only a twenty-line tail. A table of free-text lines in `ops` is one grant away from a
dashboard. So the feed carries a verb from a fixed set plus counts and opaque provider ids,
`createRunJournal` strips `errorMessage` on the way in, and the wording is entirely in the
UI's catalogues, which is also what makes the feed readable in Vietnamese.

**A log aggregator** answers an operator's question, not a customer's, and adds a service to
a host with no swap.

## What follows from it

- **Granted like `ops.run_refusal`, not like `ops.run`.** BI keeps its read on `ops.run` --
  whether a sync happened is a reportable fact -- and is refused the feed beneath it, as it
  is refused refusals today. No dbt role gets either.
- **Bounded, and the bound reports itself.** 200 events per run; past that only warnings and
  errors, and one `events_truncated` row so a short feed says it is short. Progress lines are
  coalesced to one per entity per two seconds off an injected `Clock`, so a long ingest writes
  tens of rows rather than thousands.
- **Writing evidence never fails the work.** The journal writes on a serialised chain that
  the caller does not await; a failure is reported to the log and the run continues. Losing a
  sync because `ops` was full would be the tail wagging the dog.
- **It goes when the run goes.** `ON DELETE CASCADE`: this is evidence about a run, not an
  archive of its own.

## The rule it restores

One thing found on the way is not about the feed at all. `readOneFile` in the Drive collector
dropped a directly-picked non-PDF and returned nothing, so "we were given nothing" and "we
refused what we were given" were the same green run landing 0. It now returns the refusal and
the run records it with its reason, which is what CLAUDE.md rule 2 asks for and what the
run_refusal table has existed for since ADR 0004.
