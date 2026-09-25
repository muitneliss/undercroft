---
name: debug-trace
description: Debug a production problem in a deployed Undercroft by following it through the host's observability stack. It reads the trace from Tempo, its log lines from Loki, and the container's own log over read-only SSH to the Dokploy host, looking up every credential at run time from this checkout. Use this skill whenever someone hands you a trace id (32 hex characters, an `x-trace-id`, the "Trace ID" in a GitHub issue or the UI's error box, `error.traceId` in a CLI envelope), a run id (`run-…`) that failed, or a Kestra execution id. Also use it when they ask why something failed, errored, hung or showed `internal_error` in production or on the server, or what happened to a request, a sync or an ingest, even if they never say "trace" or "Grafana". Use it before guessing at a cause from the code alone.
---

# Follow a failure through the running system

A trace id is the one handle that joins the three places a failure leaves evidence:

- **Tempo**: one span per request, joined across services. The control plane's call to
  the worker is a child span of the browser's request, so one id covers the whole click.
- **Loki**: every log line either service wrote while serving that request. Each line
  carries `traceId`, and a run started by the request keeps writing lines with the same id
  after the response has gone.
- **The container's own log on the host**: the same JSONL lines as they reached stdout.
  Read it over SSH when Loki has nothing: export was off, the collector was down, or it
  was before tracing shipped.

The design and its limits are in `docs/adr/0058-requests-are-traced-into-the-hosts-otel-lgtm.md`.

## The tools: `task obs:*`, and nothing else

Every lookup goes through a task, per `.claude/rules/tooling.md`. Each one finds its own
credentials: the Dokploy key, then Grafana's admin credentials from the shared `otel-lgtm`
compose, then the SSH host by matching the Dokploy host's IP against `~/.ssh/config`. No
secret is printed. Don't go looking for credentials by hand, and don't paste one into a
command. If a task says what it could not find, pass that sentence on to the person. It
names the missing piece, for example "no Host in ~/.ssh/config has HostName …".

| Task                                                  | Answers                                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task obs:creds`                                      | Can I reach Dokploy, Grafana and the host? Run it first when anything else fails.                                                                 |
| `task obs:trace TRACE=<id>`                           | What did this request do? Prints the span tree: service, route, status, duration, `✗` on failed spans, the run id or Kestra execution it touched. |
| `task obs:logs FOR=<id> SINCE=6h`                     | Every Loki line containing the id, oldest first. `FOR` can be a trace id, a run id or an event name.                                              |
| `task obs:search FOR=run=<runId> SINCE=2d`            | Which trace opened this run? (`kestra=<executionId>` and `errors` also work.)                                                                     |
| `task obs:search FOR=status=401 SINCE=6h`             | Which requests were answered with this status? `errors` lists only 5xx, so a refused request (401, 403) is found here and nowhere else.           |
| `task obs:logs FOR=mcp_refused SINCE=6h`              | Every bearer `/mcp` refused, with its `reason` and, when proven, the `credential`. What the refused client itself was never told.                 |
| `task obs:host-logs SERVICE=worker FOR=<id> SINCE=6h` | The raw container log on the host, filtered to the id. `SERVICE` is `worker`, `control-plane` or `kestra`.                                        |

`SINCE` takes `30m`, `6h` or `2d`, and defaults to `1h`. When a search comes back empty,
widen it before you conclude anything. An empty window is not an absence.

## How to work a case

1. **Get to a trace id.**
   - A trace id: use it.
   - A run id: `task obs:search FOR=run=<runId>` finds the request that opened it. If that
     comes back empty, `task obs:logs FOR=<runId>` finds its lines, and each line carries
     the `traceId`.
   - A Kestra execution: `task obs:search FOR=kestra=<id>`.
   - Only a symptom ("the sync failed last night"): `task obs:search FOR=errors SINCE=1d`
     lists recent failed traces. Pick the one whose time and route match.
   - A client says it failed but nothing is in the logs, typically an MCP client "failing after
     it worked for a while": the door refused it, which is a 401 or 403, never an error span,
     and the client rarely shows the `x-trace-id` it got.
     `task obs:search FOR=status=401 SINCE=6h` lists the refused requests, and
     `task obs:logs FOR=mcp_refused SINCE=6h` says why each one was refused. `reason` is `expired` (the token ran out and the client did not
     renew it), `revoked` (the person revoked the token or the app), `no_person` (their access
     was removed), `missing` (no bearer at all, which is also every OAuth client's first
     contact), `malformed` or `unknown` (not a credential this server issued for `/mcp`), or
     `insufficient_scope` (a 403: the person granted neither read nor write). `credential` is
     the `upat_…` id or `oauth:<clientId>` when one was proven, the same id the client's
     `mcp_call` lines carry, so `task obs:logs FOR=<credential>` shows when it last worked.
2. **Read the trace**: `task obs:trace TRACE=<id>`. The `✗` spans are where it failed, and
   `error.type` is the exception class. The deepest failed span is usually the cause and
   the ones above it are the consequence.
3. **Read the logs**: `task obs:logs FOR=<id>`. The lines around the failure say what the
   code was doing: `run_opened`, `trpc_failed`, `request_failed`, the connector's events.
   A run keeps logging under the same trace after the response, so its later lines are here too.
4. **Fall back to the host** when Loki is empty or a line is missing:
   `task obs:host-logs SERVICE=<svc> FOR=<id>`. The worker is where runs, connectors and
   dbt live. The control plane holds tRPC, sign-in and the assistant.
5. **Then read the code** at the route or event you found. The trace tells you where to
   look. Only the code tells you why.

## What you report

Lead with the answer. Say what failed, where, and the evidence for it, in this shape:

```
Cause: <one sentence, or "not established" and why>
Where: <service> <route or event>, <time UTC>
Evidence:
- trace <id>: <the failed span(s), with error.type and status>
- log: <the one or two lines that show it, quoted>
Next step: <the fix, the question for the person, or the follow-up lookup>
```

A trace with no failed span, or a window with no lines, is **not** proof that nothing went
wrong. It is the absence of evidence, and you should say so. Name what you searched and over
what window, so the person can widen it. This is the repo's "never guess" rule
(CLAUDE.md, rule 2) applied to debugging.

## Boundaries

- **Read-only.** The tasks only query Grafana and run `docker ps` or `docker logs` on the
  host. Don't restart, exec into, or edit anything on the server. A change goes through the
  Dokploy API (`task cd:*`, `.claude/rules/deployment.md`). If the fix is operational, say
  what should be done and let the person decide.
- **The observability stack is shared and not ours.** It belongs to the host's
  `observability` project. Don't change its compose, its env or its Grafana settings.
- **Logs are operator data.** A log line can hold a tenant id or a connector's event name,
  but never a body (ADR 0021's payload boundary). Before quoting anything into a GitHub
  issue, which is public, replace tenant ids and addresses with `CASE-0042` and
  `acme@example.test` (`.claude/rules/pii.md`).
- **No trace at all** for an id from before tracing shipped, or from a deployment without
  `OTEL_EXPORTER_OTLP_ENDPOINT` set: `obs:host-logs` still finds the id in the container
  log, as long as the container has not been recreated since.
