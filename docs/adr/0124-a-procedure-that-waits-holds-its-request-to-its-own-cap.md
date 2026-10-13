# 124. A procedure that waits holds its request open to its own cap, and nothing else does

- Status: Accepted
- Date: 2026-10-13
- Amends: [ADR 0111](0111-an-export-is-a-link-to-a-streamed-csv.md), item 8 ("the two long
  requests lift Bun's idle timeout, and nothing else does"); everything else in it is unchanged

## Context

Issue #440: after `runs.trigger`, every agent wrote its own loop to learn when the run ended --
52 of 121 triggers in an audit of 119 sessions were followed at once by a shell loop that re-listed
runs until a status changed, each turn costing a 5-40 KB list. The fix is a read that waits:
`runs.get` with `waitSeconds` answers as soon as the run is no longer `running`.

A wait is a request that sends nothing until it answers, and `Bun.serve` closes a request that has
sent nothing for its `idleTimeout`, ten seconds on both servers. Measured against Bun 1.4.2 with a
one-second timeout: a handler that sleeps six seconds is cut (`The socket connection was closed
unexpectedly`); the same handler after `server.timeout(request, 20)` answers. ADR 0111 item 8
decided that only an export's two routes lift the timeout, by turning it off for that request.

`models.build` (issue #441, a later change) has the same shape: it waits on the worker for up to
two minutes, and is cut at ten seconds today for the same reason.

## Decision

1. **A procedure that waits on purpose declares it, in its tRPC meta**: `holdsOpenSeconds`, the
   longest it may keep its request open -- its own cap on the wait plus a margin to read and send
   the answer. `runs.get` declares 60: a wait of at most 50 seconds, plus ten.
2. **One middleware at the root of the router acts on it** (`publicProcedure` in
   `handlers/trpc.ts`), after the grant guard, by calling `ctx.holdOpen(seconds)`. So it holds at
   every door that reaches the router, for every procedure that declares it, and a procedure needs
   nothing else to be held.
3. **The door owns the hold.** `Context.holdOpen` is a closure, as `endSession` is: `createContext`
   builds one that holds nothing, and `/trpc` and `/mcp` replace it with `holdFor(c.env, request)`
   (`handlers/holdOpen.ts`), which calls `liftIdleTimeout` on the server for that request alone.
   No procedure, service or middleware reaches Bun. The assistant and an export's download keep
   the one that holds nothing: the assistant's catalogue gives its model no `waitSeconds`, and the
   download lifts the timeout itself.
4. **The cap is lifted TO, not turned off.** `liftIdleTimeout(env, request, seconds)` sets the
   request's timeout to the declared seconds, where an export passes `0`. A wait that went wrong is
   still cut, a little after its own cap; Bun takes at most 255 seconds.
5. **The wait itself is bounded and honest** (`services/runWait.ts`): at most 50 seconds, re-read
   once a second, stopped by the request's abort signal (the fetch adapter's at `/trpc`, the MCP
   exchange's at `/mcp`). For an ingest that closed ok it waits up to ten seconds more for the
   transform it chains, so `childRun` is not reported `null` a moment before it exists. When it
   runs out the run still says `running`: there is no fourth status (ADR 0051), and none is
   guessed.

ADR 0111 item 8 therefore reads: **the export's two routes lift Bun's idle timeout altogether,
because a worker deadline bounds them; a procedure that declares `holdsOpenSeconds` lifts it to
that many seconds, because its own cap bounds it; and nothing else lifts it.**
`handlers/holdOpen.test.ts` lists the procedures that declare it, so a new one is seen.

## Options rejected

- **Turn the timeout off for a waiting request, as an export does.** A wait has a cap of its own,
  and a timeout matched to it is a second bound for free; off would leave only the code's word.
- **Raise the servers' `idleTimeout` for everyone.** Every request that hangs would then hang
  longer, which is what the ten seconds exist to prevent.
- **Lift the timeout inside the procedure.** The procedure would need the request and the server,
  which no procedure has (`layering.md`), and each new long procedure would repeat it.
- **A separate `runs.wait({ runIds[] })`.** A second read of the same run, with its own shape to
  keep in step with `runs.get`; `runs.list({ ids })` already answers "where are these runs now".
- **Send bytes while waiting.** tRPC's JSON answer cannot: a byte sent early commits the status
  line before the answer is known. The MCP SDK's own keep-alive, where it answers with a stream,
  comes every fifteen seconds, after Bun's ten.

## Consequences

- An agent reaches trigger → ingest → transform in three short calls: `runs.trigger`,
  `runs.get({ runId, waitSeconds })` whose `childRun` names the transform, and the same for it.
- `models.build` is held the same way; the amendment below records how long, and what else it
  decided.
- Every client keeps a timeout above the longest hold: the CLI waits 180 seconds (it was 120, which
  cut a build the server was still waiting on); an MCP host's tool timeout is its own, and a host
  whose timeout is shorter uses `wait: false` below.

## Amendment: `models.build` (issue #442, issue #441)

Written into this ADR rather than a new one because it is the second procedure this ADR's
mechanism holds, decided in the same series of changes before either merged.

1. **`models.build` declares `holdsOpenSeconds: 160`**: the control plane's wait on the worker
   (`BUILD_DEADLINE_MS`, 150 s -- the worker's two-minute build, its 20-second wait for a turn
   inside that, then the steps, counts and preview) plus the ten seconds to answer that `runs.get`
   uses. Under Bun's 255. Any shorter and a build the worker is still legitimately running is cut
   at the door and reported as nothing; any longer and a hung worker holds a socket past the point
   anything is still waiting for it. `holdOpen.test.ts` pins both procedures.
2. **`wait: false`** answers as soon as the worker has opened the run, with `{ waited: false, runId
}`, and the build continues exactly as a waited one does: the same editor turn (ADR 0088), the
   same deadline, the same lock. The caller then waits with `runs.get({ runId, waitSeconds })`,
   which holds for at most 60 seconds per call. The waited answer is `{ waited: true, ... }`: one
   output, a discriminated union, rather than a second procedure whose input would repeat this
   one's.
3. **One run for several models.** `names` takes up to 20 selectors, each `name`, `+name` or
   `name+` and nothing else of dbt's grammar, passed to one `dbt build` as one argv item each.
   Every bare name must be a model of the tenant, checked before the worker is called: a selector
   matching nothing is a green build of nothing, which is a success that did not happen.
4. **A refused build names its holder.** The worker's 409 already carried the holder's run id;
   the control plane now reads it, adds `startedAt` from the ledger, and refuses CONFLICT with
   both as facts and in the sentence. A holder the ledger no longer has is not named.
5. **The answer leads with a summary** (issue #441): `stepSummary`, then the steps `steps` asks for
   (`problems` by default), through the same `reportSteps` as `runs.get`, and `rowCounts` -- one
   per named model, counted as the BI login inside a ten-second budget shared by all of them, and
   `null`, never `0`, for a model that did not build in this run or a count that could not be read.
   The preview is kept for a selection of one model only. A further page of steps is read with
   `runs.get` on the build's run: its cursor is the run's, and a build is not repeated to page.

Rejected: a separate `models.start` for the build not waited for (two procedures with one input
to keep in step); the full dbt selector grammar (`tag:`, `path:`, `@`, wildcards reach further than
the names show, and cannot be checked against the tenant's models); counting every model the `+`
reached (a figure for a model nobody named is an answer the caller did not ask for, and pays for in
time); and a count in the worker's ledger write (a count is a reading of the table now, not part of
what the run recorded).
