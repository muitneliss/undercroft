/**
 * A trace from Tempo as a span tree a person can read in a terminal: one line per span,
 * indented under its parent, with the service, the duration, whether it failed and the few
 * attributes that say where the request went. `observe.ts trace` prints it.
 */

const NS_PER_MS = 1_000_000n;

interface OtlpValue {
  readonly stringValue?: string;
  readonly intValue?: string | number;
  readonly boolValue?: boolean;
}

interface OtlpSpan {
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly status?: { readonly code?: string | number };
  readonly attributes?: readonly { readonly key: string; readonly value: OtlpValue }[];
}

export interface OtlpTrace {
  readonly resourceSpans?: readonly {
    readonly resource?: { readonly attributes?: OtlpSpan["attributes"] };
    readonly scopeSpans?: readonly { readonly spans?: readonly OtlpSpan[] }[];
  }[];
}

interface Row {
  readonly service: string;
  readonly span: OtlpSpan;
}

/** The attributes worth a line: where the request went, how it ended, what it touched. */
const SHOWN = [
  "http.route",
  "url.path",
  "http.response.status_code",
  "error.type",
  "undercroft.run_id",
  "kestra.execution_id",
];

function textOf(value: OtlpValue): string {
  return String(value.stringValue ?? value.intValue ?? value.boolValue ?? "");
}

function attribute(attributes: OtlpSpan["attributes"], key: string): string {
  const found = attributes?.find((entry) => entry.key === key);
  return found === undefined ? "" : textOf(found.value);
}

function isError(span: OtlpSpan): boolean {
  const code = span.status?.code;
  return code === 2 || code === "STATUS_CODE_ERROR";
}

function durationMs(span: OtlpSpan): string {
  const ns = BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano);
  return `${(ns / NS_PER_MS).toString()}ms`;
}

function render(rows: readonly Row[], parent: string | undefined, depth: number): string[] {
  return rows
    .filter((row) => (row.span.parentSpanId || undefined) === parent)
    .sort((a, b) => (BigInt(a.span.startTimeUnixNano) < BigInt(b.span.startTimeUnixNano) ? -1 : 1))
    .flatMap((row) => {
      const facts = SHOWN.map((key) => [key, attribute(row.span.attributes, key)] as const)
        .filter(([, value]) => value !== "")
        .map(([key, value]) => `${key}=${value}`)
        .join(" ");
      const line = `${"  ".repeat(depth)}${isError(row.span) ? "✗" : "·"} [${row.service}] ${row.span.name} ${durationMs(row.span)} ${facts}`;
      return [line.trimEnd(), ...render(rows, row.span.spanId, depth + 1)];
    });
}

/** The spans of one trace, as the lines `render` draws and the counts above them. */
export function spanTree(trace: OtlpTrace | undefined): {
  readonly spans: number;
  readonly failed: number;
  readonly lines: readonly string[];
} {
  const rows: Row[] = (trace?.resourceSpans ?? []).flatMap((resource) =>
    (resource.scopeSpans ?? []).flatMap((scope) =>
      (scope.spans ?? []).map((span) => ({
        service: attribute(resource.resource?.attributes, "service.name"),
        span,
      })),
    ),
  );
  const known = new Set(rows.map((row) => row.span.spanId));
  // A span whose parent is not in Tempo -- the caller's, from a browser or Kestra -- is a root.
  const rooted = rows.map((row) =>
    row.span.parentSpanId && !known.has(row.span.parentSpanId)
      ? { ...row, span: { ...row.span, parentSpanId: "" } }
      : row,
  );
  return {
    spans: rows.length,
    failed: rows.filter((row) => isError(row.span)).length,
    lines: render(rooted, undefined, 0),
  };
}
