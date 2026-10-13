---
title: >-
  ADR 0124 A Procedure That Waits Holds Its Request Open to Its Own Cap, and
  Nothing Else Does
type: source
date: 2026-10-13
tags: []
source: docs/adr/0124-a-procedure-that-waits-holds-its-request-to-its-own-cap.md
source_path: docs/adr/0124-a-procedure-that-waits-holds-its-request-to-its-own-cap.md
source_hash: ff0a6e1c3ca199daae8f9af3fbd43ee4676e62acf923914cd38ca25bdcba8289
ingested: 2026-10-13
---

# ADR 0124 A Procedure That Waits Holds Its Request Open to Its Own Cap, and Nothing Else Does

Amends item 8 of [[ADR 0111 An Export Is a Link to a Streamed CSV]], which said only an export's two routes lift Bun's ten-second idle timeout. Issue #440 added a read that waits -- `runs.get` with `waitSeconds` -- because 52 of 121 `runs.trigger` calls in an audit were followed by a hand-written shell loop re-listing runs; a wait sends nothing until it answers, and Bun cuts a request silent for its `idleTimeout` (measured on Bun 1.4.2 with a one-second timeout: a six-second sleep is cut, the same after `server.timeout(request, 20)` answers).

**Decision.** (1) A procedure that waits on purpose declares `holdsOpenSeconds` in its tRPC meta -- its own cap plus a margin to answer; `runs.get` declares 60 (a wait of at most 50, plus ten). (2) One middleware at the router's root (`publicProcedure` in `handlers/trpc.ts`), after the grant guard, calls `ctx.holdOpen(seconds)`, so it holds at every door and for every procedure that declares it. (3) The door owns the hold: `createContext` builds a context that holds nothing, and `/trpc` and `/mcp` replace it with `holdFor(c.env, request)` (`handlers/holdOpen.ts`), which calls `liftIdleTimeout` on the server for that request alone; the assistant and the export download keep the one that holds nothing. (4) The timeout is lifted TO the declared seconds, not turned off as an export's is, so a wait that went wrong is still cut; Bun takes at most 255. (5) The wait itself (`services/runWait.ts`) is at most 50 seconds, re-reads once a second, stops on the request's abort signal, waits up to ten seconds more after an ingest closes ok for the transform it chains so `childRun` is not reported `null` too early, and when it runs out still says `running` -- no fourth status ([[ADR 0051 A Deploy Stops a Run at a Safe Point, and the Run Keeps Its Counts]]).

Item 8 of ADR 0111 now reads: an export's two routes lift the timeout altogether (a worker deadline bounds them); a procedure declaring `holdsOpenSeconds` lifts it to that many seconds (its own cap bounds it); nothing else lifts it. `handlers/holdOpen.test.ts` lists the procedures that declare it and proves both doors hold over a real socket.

**Rejected.** Turning the timeout off for a wait (loses a free second bound); raising every request's `idleTimeout`; lifting it inside the procedure (no procedure holds the request or server, and each would repeat it); a separate `runs.wait` (a second read of a run, and `runs.list({ ids })` already answers "where are these runs"); sending bytes while waiting (tRPC's JSON answer cannot without committing the status line; the MCP SDK's keep-alive comes every fifteen seconds, after Bun's ten).

**Consequences.** trigger -> ingest -> transform is three short calls (`runs.trigger`, `runs.get` with `waitSeconds` whose `childRun` names the transform, the same for it). `models.build` can be held by declaring its two-minute build deadline plus a margin. Clients keep a timeout above 60 seconds: the CLI waits 120; an MCP host's is its own.
