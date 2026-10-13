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
- `models.build` can be held by declaring `holdsOpenSeconds` (its two-minute build deadline plus a
  margin) and nothing more.
- Every client keeps a timeout above 60 seconds for these calls: the CLI waits 120 seconds; an MCP
  host's tool timeout is its own.
