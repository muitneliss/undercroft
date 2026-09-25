# 58. Every request is traced, into the host's shared otel-lgtm stack

- Status: Accepted
- Date: 2026-09-25

## Context

When something failed, nobody could get from the report to the server's record of it.

- The worker stamped an `x-request-id` on its REST answers.
- The control plane, the UI and the CLI carried no id at all.
- An unexpected tRPC error was logged nowhere. The browser was told `internal_error` and
  showed exactly that string.
- A bug report could quote the words on the screen and a time, and the operator then had to
  search two containers' stdout by hand for the minute it happened in.

The Dokploy host already runs an observability project for its tenants: `grafana/otel-lgtm`,
which is an OpenTelemetry collector, Tempo, Loki, Prometheus and Grafana in one container.

- It sits on the shared `dokploy-network` as `otel-lgtm`.
- It accepts OTLP/HTTP on port 4318.
- It is not this repo's to change.

## Decision

**Every HTTP request to the control plane or the worker gets a W3C trace**, and its id is
the one handle a person quotes back:

- Every response carries it as `x-trace-id`. The worker's lake API also carries it as
  `x-request-id`, which its callers already read: one id under two names.
- Every tRPC error carries it as `data.traceId`.
- Every log line written while serving the request carries it as `traceId`, including a
  run's lines written after the response has gone.
- The UI's error slip shows it with a link to the bug form prefilled. The CLI's envelope
  carries it as `error.traceId`. The issue forms ask for it.

A request continues the caller's `traceparent`, and the control plane sends its own on every
call to the worker, so one id covers the whole click. The Kestra flows name their execution
in `x-kestra-execution-id`. A run tags its request's span with `undercroft.run_id`, so a run
leads to its trace.

**Spans and log lines are exported over OTLP to the host's existing `otel-lgtm`** when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set, as `http://otel-lgtm:4318` in production.

- **Unset means export is off.** The ids are stamped either way: a trace id is a promise
  of every response, not of a configured deployment.
- **Export is added to stdout, not a replacement for it.** Each JSONL line still goes to
  stdout, where the container runtime collects it as before, and is also emitted as an
  OTLP log record.

**One package, `@undercroft/telemetry`, holds it.** It exposes a Hono middleware, the current
trace id, a traced `fetch`, an `annotate`, and the logger's sink and context. The OTel
dependencies stop at that package: `core`, the CLI and the browser never import them. `core`'s
logger gained only a `context` option, read per line.

**The spans are manual.** OTel's auto-instrumentation patches modules through `require` hooks,
which Bun does not run. One server span per request is the whole surface.

**The worker joins `dokploy-network`**, which is the one way to reach the collector without
leaving the host.

- Nothing in the stack resolves a name on that network: every reference is an `undercroft-`
  alias on `default` (`deployment.md`).
- Compose also names the service plain `worker` there. No other project on the host used
  that name when this was added.

**The payload boundary is the logger's** (ADR 0021, `describeError`).

- A span carries method, path, route, status, an error's type, and the ids above.
- It never carries a body, a query string or an error message.

**`task obs:*` (`scripts/observe.ts`) reads it back, and the `debug-trace` skill drives it.**
It reads a trace from Tempo, lines from Loki, and a container's log over read-only SSH. Every
credential is looked up at run time:

- the Dokploy key from the environment or the gitignored `.dokploy.json`;
- Grafana's from the `otel-lgtm` compose's own Dokploy entry;
- the SSH host by matching the Dokploy host's IP against `~/.ssh/config`.

Nothing is stored.

## Options rejected

- **A collector or Tempo of our own in the compose file.** It adds a service to a host with
  no swap, which is the cost ADR 0021 refused for a log stream. The host already runs one for
  every tenant.
- **Export through the public `kanna-otel.lowbit.link` endpoint.** It needs no network
  change, but the telemetry would leave the host and come back through Cloudflare and Traefik
  to reach a container two hops away.
- **Keep the request id and add nothing.** An id that only one service knows cannot follow a
  click into the worker, and no store holds what it points at.
- **Auto-instrumentation (`@opentelemetry/sdk-node`).** Its hooks do not run under Bun. It
  would install, report nothing, and look like a working setup.
- **Put the trace id in the error message.** The message is worded for a person in their
  language. An agent matches on fields, and the CLI already passes `data` through.

## Consequences

- A bug report with a trace id is one lookup: `task obs:trace TRACE=<id>`.
- An internal error is logged as `trpc_failed` with its path, code and error type. Before,
  it was not logged at all.
- Nine `@opentelemetry/*` packages enter the control plane's and the worker's images. This
  includes the worker, which is the one process holding `UNDERCROFT_SECRET_KEY`. They are
  the project's official SDK, pinned exactly.
- `@opentelemetry/api` being installed switches on Better Auth's own spans, which it
  declares as an optional peer.
- **The collector's public OTLP endpoint accepts writes from anyone.** That is the
  observability project's to close. Undercroft does not use it, and it is recorded here so
  it is not mistaken for this stack's.
- An id from before this change, or from a deployment with export off, has no trace.
  `task obs:host-logs` still finds it in the container log until the container is recreated.
