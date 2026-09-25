---
title: 'ADR 0058: Every request is traced, into the host''s shared otel-lgtm stack'
type: source
date: 2026-09-25
tags: []
source: docs/adr/0058-requests-are-traced-into-the-hosts-otel-lgtm.md
source_path: docs/adr/0058-requests-are-traced-into-the-hosts-otel-lgtm.md
source_hash: f4c5fd8458192b47805a880096c97b6e3ca93c335306adb421542bfb907ce264
ingested: 2026-09-25
---

# ADR 0058: Every request is traced, into the host's shared otel-lgtm stack

Accepted 2026-09-25. Builds on [[ADR 0021: Run evidence is a ledger, not a log stream]]'s payload boundary and [[ADR 0049: Dokploy clones the compose file from main]].

**Context.** A failure could not be followed from the report to the server's record of it: only the worker stamped an `x-request-id`, the control plane, UI and CLI carried no id, an unexpected tRPC error was logged nowhere and the browser showed the raw `internal_error`. The Dokploy host already runs `grafana/otel-lgtm` (collector, Tempo, Loki, Prometheus, Grafana) for every tenant, on the shared `dokploy-network` as `otel-lgtm`, and it is not this repo's.

**Decision.** Every HTTP request to the control plane or the worker gets a W3C trace whose id is the handle a person quotes: `x-trace-id` on every response (and `x-request-id` on the worker's lake API, the same id), `data.traceId` on every tRPC error, `traceId` on every log line written while serving it -- a run's later lines included. The UI's error slip shows it with a prefilled bug-report link, the CLI envelope carries `error.traceId`, and the issue forms ask for it. The caller's `traceparent` is continued and the control plane sends its own to the worker, so one id covers a click; Kestra names its execution in `x-kestra-execution-id` and a run tags its request's span with `undercroft.run_id`. With `OTEL_EXPORTER_OTLP_ENDPOINT` set (`http://otel-lgtm:4318` in production) spans and log lines are exported over OTLP, beside stdout rather than instead of it; unset is export off with the ids still stamped. One package, `@undercroft/telemetry`, holds it, with manual spans because Bun runs no `require` hooks; the worker joins `dokploy-network` to reach the collector; spans carry method, path, route, status and an error's type, never a body, query or message. `task obs:*` (`scripts/observe.ts`) and the `debug-trace` skill read a trace back, looking every credential up at run time.

**Rejected.** A collector of our own (a service on a host with no swap, when one already runs); the public `kanna-otel.lowbit.link` endpoint (telemetry leaves the host and returns through Cloudflare); keeping only the worker's request id (it cannot follow a click); `@opentelemetry/sdk-node` auto-instrumentation (silent under Bun); the id inside the error message (a person's sentence, not a field).

**Consequences.** A report with a trace id is one lookup; internal errors are logged as `trpc_failed`. Nine pinned `@opentelemetry/*` packages enter both images, the worker included, and Better Auth's own spans switch on. The collector's public OTLP endpoint accepts writes from anyone -- the observability project's to close. An id from before this change or with export off has no trace, and `task obs:host-logs` still finds it in the container log.
