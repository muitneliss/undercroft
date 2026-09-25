/**
 * Follow one failure through the host's observability stack: the trace in Tempo, the log
 * lines in Loki, and -- when those do not say enough -- the container's own log over
 * read-only SSH. The `debug-trace` skill drives it; `task obs:*` is how it is invoked.
 *
 *   bun run scripts/observe.ts creds
 *   bun run scripts/observe.ts trace <traceId>
 *   bun run scripts/observe.ts logs <traceId|runId|text> [since]
 *   bun run scripts/observe.ts search run=<runId> | kestra=<executionId> | errors [since]
 *   bun run scripts/observe.ts host-logs <worker|control-plane|kestra> <needle> [since]
 *
 * Every credential is looked up at run time from what this checkout already holds, and none
 * is stored or printed; `observeAccess.ts` says where each comes from.
 *
 * Read-only by construction. The Grafana calls are queries; the SSH commands are `docker ps`
 * and `docker logs`, and the only caller-supplied text that reaches the remote shell is a
 * needle checked against a strict pattern first.
 */

import process from "node:process";
import {
  composeNamed,
  datasource,
  dokploy,
  fail,
  getJson,
  type Grafana,
  grafana,
  OBSERVABILITY_COMPOSE,
  ssh,
  sshHost,
  type Dokploy,
} from "./observeAccess.ts";
import { type OtlpTrace, spanTree } from "./observeTrace.ts";

const UNDERCROFT_COMPOSE = "undercroft";
const DEFAULT_SINCE = "1h";
const LOG_LIMIT = 200;
const SEARCH_LIMIT = 20;
const NS_PER_MS = 1_000_000n;
const MS_PER_UNIT: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

const TRACE_ID = /^[0-9a-f]{32}$/u;
/** What may reach a remote shell: an id, a run id, an event name. Nothing that quotes. */
const NEEDLE = /^[A-Za-z0-9_.:-]{3,120}$/u;
const SINCE = /^(?<amount>\d{1,4})(?<unit>[smhd])$/u;
const SERVICES = new Set(["worker", "control-plane", "kestra"]);

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function sinceMs(since: string): number {
  const match = SINCE.exec(since);
  const amount = match?.groups?.amount;
  const unit = match?.groups?.unit;
  if (amount === undefined || unit === undefined) {
    return fail(`"${since}" is not a duration like 30m, 6h or 2d`);
  }
  return Number.parseInt(amount, 10) * (MS_PER_UNIT[unit] ?? 0);
}

async function showTrace(g: Grafana, traceId: string): Promise<void> {
  if (!TRACE_ID.test(traceId)) {
    fail(`"${traceId}" is not a trace id (32 lowercase hex characters)`);
  }
  const body = (await datasource(g, "tempo", `/api/v2/traces/${traceId}`)) as {
    trace?: OtlpTrace;
  };
  const tree = spanTree(body.trace);
  if (tree.spans === 0) {
    out(`no spans for ${traceId} in Tempo (retention, or the service was not exporting)`);
    return;
  }
  out(`trace ${traceId}: ${tree.spans} spans, ${tree.failed} failed`);
  for (const line of tree.lines) {
    out(line);
  }
}

// --- logs -------------------------------------------------------------------

async function showLogs(g: Grafana, needle: string, since: string): Promise<void> {
  const end = BigInt(Date.now()) * NS_PER_MS;
  const start = end - BigInt(sinceMs(since)) * NS_PER_MS;
  const query = `{service_name=~"undercroft.*"} |= ${JSON.stringify(needle)}`;
  const params = new URLSearchParams({
    query,
    start: start.toString(),
    end: end.toString(),
    limit: String(LOG_LIMIT),
    direction: "forward",
  });
  const body = (await datasource(g, "loki", `/loki/api/v1/query_range?${params.toString()}`)) as {
    data?: {
      result?: readonly {
        stream?: Record<string, string>;
        values?: readonly [string, string][];
      }[];
    };
  };
  const lines = (body.data?.result ?? [])
    .flatMap((stream) =>
      (stream.values ?? []).map(([ns, line]) => ({
        ns: BigInt(ns),
        text: `[${stream.stream?.service_name ?? "?"}] ${line}`,
      })),
    )
    .sort((a, b) => (a.ns < b.ns ? -1 : 1));
  out(`${lines.length} log lines in Loki matching ${JSON.stringify(needle)} over ${since}`);
  for (const line of lines) {
    out(line.text);
  }
}

// --- search -----------------------------------------------------------------

async function search(g: Grafana, what: string, since: string): Promise<void> {
  const [kind = "", value = ""] = what.split("=", 2);
  const needle = value.replace(/[^A-Za-z0-9_.:-]/gu, "");
  const byKind: Record<string, string> = {
    run: `{ span.undercroft.run_id = "${needle}" }`,
    kestra: `{ span.kestra.execution_id = "${needle}" }`,
    errors: `{ resource.service.name =~ "undercroft.*" && status = error }`,
  };
  const traceql = byKind[kind] ?? fail("search needs run=ID, kestra=ID or errors");
  const end = Math.floor(Date.now() / 1000);
  const start = end - Math.floor(sinceMs(since) / 1000);
  const params = new URLSearchParams({
    q: traceql,
    start: String(start),
    end: String(end),
    limit: String(SEARCH_LIMIT),
  });
  const body = (await datasource(g, "tempo", `/api/search?${params.toString()}`)) as {
    traces?: readonly {
      traceID: string;
      rootServiceName?: string;
      rootTraceName?: string;
      startTimeUnixNano?: string;
      durationMs?: number;
    }[];
  };
  const traces = body.traces ?? [];
  out(`${traces.length} traces for ${traceql} over ${since}`);
  for (const trace of traces) {
    const at =
      trace.startTimeUnixNano === undefined
        ? "?"
        : new Date(
            Number.parseInt((BigInt(trace.startTimeUnixNano) / NS_PER_MS).toString(), 10),
          ).toISOString();
    out(
      `${trace.traceID}  ${at}  [${trace.rootServiceName ?? "?"}] ${trace.rootTraceName ?? "?"}  ${trace.durationMs ?? "?"}ms`,
    );
  }
}

// --- host -------------------------------------------------------------------

async function hostLogs(
  api: Dokploy,
  service: string,
  needle: string,
  since: string,
): Promise<void> {
  if (!SERVICES.has(service)) {
    fail(`service must be one of ${[...SERVICES].join(", ")}`);
  }
  if (!NEEDLE.test(needle)) {
    fail(`"${needle}" is not a plain id; only letters, digits and _ . : - are sent to the host`);
  }
  sinceMs(since);
  const [host, stack] = await Promise.all([sshHost(api), composeNamed(api, UNDERCROFT_COMPOSE)]);
  const [container] = (
    await ssh(
      host,
      `docker ps --filter label=com.docker.compose.project=${stack.appName} --filter label=com.docker.compose.service=${service} --format '{{.Names}}'`,
    )
  )
    .trim()
    .split("\n");
  if (container === undefined || container === "") {
    fail(`no running ${service} container in ${stack.appName}`);
  }
  const text = await ssh(
    host,
    `docker logs --since ${since} ${container} 2>&1 | grep -F -- ${needle} || true`,
  );
  const lines = text.split("\n").filter((line) => line !== "");
  out(`${lines.length} lines in ${container}'s log matching ${needle} over ${since}`);
  for (const line of lines) {
    out(line);
  }
}

async function creds(): Promise<void> {
  const api = dokploy();
  out(
    `dokploy   ${api.endpoint} (key from ${process.env.DOKPLOY_API_KEY ? "environment" : ".dokploy.json"})`,
  );
  const g = await grafana(api);
  const sources = (
    await getJson<readonly { uid: string; type: string }[]>(`${g.url}/api/datasources`, {
      authorization: g.authorization,
    })
  ).map((source) => `${source.uid}:${source.type}`);
  out(
    `grafana   ${g.url} (admin from the ${OBSERVABILITY_COMPOSE} compose) datasources ${sources.join(", ")}`,
  );
  const host = await sshHost(api);
  const whoami = (await ssh(host, "docker ps --format '{{.Names}}' | grep -c . || true")).trim();
  out(`ssh       ${host} (${whoami} containers running)`);
}

async function main(): Promise<void> {
  const [command = "", first = "", second = "", third = ""] = process.argv.slice(2);
  switch (command) {
    case "creds":
      return await creds();
    case "trace":
      return await showTrace(await grafana(dokploy()), first);
    case "logs":
      return await showLogs(
        await grafana(dokploy()),
        first || fail("logs what?"),
        second || DEFAULT_SINCE,
      );
    case "search":
      return await search(await grafana(dokploy()), first, second || DEFAULT_SINCE);
    case "host-logs":
      return await hostLogs(dokploy(), first, second, third || DEFAULT_SINCE);
    default:
      fail(
        "usage: observe.ts creds | trace <id> | logs <needle> [since] | search <run=|kestra=|errors> [since] | host-logs <service> <needle> [since]",
      );
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
