/**
 * Every request gets a trace, and the trace id is the one handle a person quotes back.
 *
 * The host already runs a Grafana otel-lgtm stack (collector, Tempo, Loki) for every tenant
 * on it; this module is how the control plane and the worker reach it. ADR 0058.
 *
 * Why manual spans and no auto-instrumentation: the instrumentation packages patch modules
 * through `require` hooks, which Bun does not run. One server span per HTTP request, plus
 * the W3C `traceparent` carried on the calls between our own services, is the whole surface
 * -- and it is small enough to hold by hand.
 *
 * Why tracing is installed on first use rather than only by `startTelemetry`: a trace id is a
 * promise of every response, not of a configured deployment. A server built in a test, or a
 * deployment with no collector, still stamps a real id on the response and in the log line;
 * only the export is absent. An endpoint left unset is export off, never a guessed default.
 *
 * The payload boundary is the logger's (`describeError`, ADR 0021): a span carries method,
 * route, status and an error's type -- never a body, a query string or an error message,
 * because an exception message routinely embeds the row that caused it.
 */

import process from "node:process";
import {
  type Attributes,
  context,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { type Logger as OtelLogger, SeverityNumber } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { type Resource, resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { MiddlewareHandler } from "hono";

/** The response header a person copies into a bug report. */
export const TRACE_HEADER = "x-trace-id";

const TRACER = "undercroft";
const TRAILING_SLASHES = /\/+$/u;

export interface TelemetryOptions {
  /** `service.name` in Tempo and Loki when `OTEL_SERVICE_NAME` does not say, e.g. `undercroft-worker`. */
  readonly service: string;
  /**
   * The process environment, passed in by the entrypoint rather than read here. Three values
   * are read from it: `OTEL_EXPORTER_OTLP_ENDPOINT`, the collector's OTLP/HTTP base (unset or
   * empty: export off); `OTEL_SERVICE_NAME`; and `UNDERCROFT_RELEASE`, the release tag the image
   * was built from (`""`: left off the trace rather than guessed).
   */
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface Telemetry {
  /** Whether spans and log records leave the process. */
  readonly exporting: boolean;
  /**
   * What `createLogger` takes to join its lines to the trace. `sink` writes each JSONL line
   * to stdout as always and -- when exporting -- the same line as an OTLP log record, emitted
   * in the active context so the collector joins it to the request's trace. `context` puts
   * the request's `traceId` on every line written inside one.
   */
  readonly logging: {
    readonly sink: (line: string) => void;
    readonly context: () => { readonly traceId: string | null };
  };
  /** Flush what is buffered. Called once, when the process is stopping. */
  readonly shutdown: () => Promise<void>;
}

let installed = false;

function install(resource: Resource, spanProcessors: SpanProcessor[]): void {
  // Replacing is deliberate: `startTelemetry` supersedes the default installed on first use.
  trace.disable();
  context.disable();
  propagation.disable();
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(new BasicTracerProvider({ resource, spanProcessors }));
  installed = true;
}

function ensureInstalled(): void {
  if (!installed) {
    install(resourceFromAttributes({ "service.name": "undercroft" }), []);
  }
}

function writeStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}

const SEVERITY: Record<string, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

function emitLine(logger: OtelLogger, line: string): void {
  // The line is the logger's own JSON; `level`, `event` and `component` become indexable
  // attributes and the whole line stays the body, so `| json` in LogQL reads it.
  const parsed: unknown = JSON.parse(line);
  const fields = typeof parsed === "object" && parsed !== null ? parsed : {};
  function text(key: string): string | undefined {
    const value: unknown = Reflect.get(fields, key);
    return typeof value === "string" ? value : undefined;
  }
  const level = text("level") ?? "info";
  logger.emit({
    severityNumber: SEVERITY[level] ?? SeverityNumber.INFO,
    severityText: level,
    body: line,
    attributes: Object.fromEntries(
      ["event", "component"].flatMap((key) => {
        const value = text(key);
        return value === undefined ? [] : [[key, value]];
      }),
    ),
  });
}

function logContext(): { readonly traceId: string | null } {
  return { traceId: currentTraceId() };
}

/**
 * Install tracing for this process, exporting when the environment names a collector.
 *
 * Called once, by the entrypoint, before anything logs -- so every line, the boot lines
 * included, goes wherever the trace export goes.
 */
export function startTelemetry(options: TelemetryOptions): Telemetry {
  const { env } = options;
  const version = env.UNDERCROFT_RELEASE ?? "";
  const named = env.OTEL_SERVICE_NAME ?? "";
  const resource = resourceFromAttributes({
    "service.name": named === "" ? options.service : named,
    ...(version === "" ? {} : { "service.version": version }),
  });
  const endpoint = (env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").replace(TRAILING_SLASHES, "");
  if (endpoint === "") {
    install(resource, []);
    return {
      exporting: false,
      logging: { sink: writeStdout, context: logContext },
      shutdown: async () => undefined,
    };
  }

  const spans = new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }));
  install(resource, [spans]);
  const logs = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs` }),
      }),
    ],
  });
  const logger = logs.getLogger(TRACER);

  return {
    exporting: true,
    logging: {
      sink: (line): void => {
        writeStdout(line);
        emitLine(logger, line);
      },
      context: logContext,
    },
    shutdown: async (): Promise<void> => {
      await Promise.allSettled([spans.shutdown(), logs.shutdown()]);
    },
  };
}

/** The trace id of the request this code is running inside, or `null` outside one. */
export function currentTraceId(): string | null {
  const span = trace.getActiveSpan();
  if (span === undefined) {
    return null;
  }
  const { traceId } = span.spanContext();
  return trace.isSpanContextValid(span.spanContext()) ? traceId : null;
}

/**
 * The `traceparent` header for a call this request makes to another of our services, so the
 * callee's span joins this trace. Empty outside a request.
 */
function traceHeaders(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

/**
 * A fetch that carries the active request's `traceparent`, for calls between our own
 * services: one trace from the browser's click to the run it started.
 */
export function traced(
  doFetch: (input: string, init?: RequestInit) => Promise<Response>,
): (input: string, init?: RequestInit) => Promise<Response> {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(traceHeaders())) {
      headers.set(name, value);
    }
    return doFetch(input, { ...init, headers });
  };
}

/**
 * Tag the current request's span, e.g. with the run it opened, so Tempo can find the trace
 * by that value. A no-op outside a request.
 */
export function annotate(attributes: Attributes): void {
  trace.getActiveSpan()?.setAttributes(attributes);
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function finish(span: Span, status: number, error: unknown): void {
  span.setAttribute("http.response.status_code", status);
  if (error !== undefined) {
    span.setAttribute("error.type", errorType(error));
  }
  if (status >= 500) {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
  span.end();
}

/**
 * One server span per request, continuing the caller's `traceparent` when it sent one.
 *
 * The id is set on the response BEFORE the handler runs, so it rides on the response
 * whichever way the request ends, including through the app's error boundary -- and again
 * after, onto a Response a handler built for itself.
 */
export function traceRequests(): MiddlewareHandler {
  return async (c, next) => {
    ensureInstalled();
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const parent = propagation.extract(context.active(), headers);
    const span = trace.getTracer(TRACER).startSpan(
      c.req.method,
      {
        kind: SpanKind.SERVER,
        attributes: { "http.request.method": c.req.method, "url.path": c.req.path },
      },
      parent,
    );
    c.header(TRACE_HEADER, span.spanContext().traceId);
    try {
      await context.with(trace.setSpan(parent, span), next);
    } catch (error) {
      finish(span, 500, error);
      throw error;
    }
    // A handler that returns its own Response -- tRPC's adapter, Better Auth, the assistant's
    // stream -- skips the headers `c.header` prepared, and the Response it built may hold
    // immutable ones; rewrapping it is how the id reaches that answer too.
    if (!c.res.headers.has(TRACE_HEADER)) {
      c.res = new Response(c.res.body, c.res);
      c.res.headers.set(TRACE_HEADER, span.spanContext().traceId);
    }
    span.updateName(`${c.req.method} ${c.req.routePath}`);
    span.setAttribute("http.route", c.req.routePath);
    finish(span, c.res.status, c.error);
  };
}
