/**
 * Turn a probe's calls into the summary a person reads.
 *
 * It answers the design questions the semantic projection is waiting on, one section each: what
 * a call costs in time and tokens, whether more questions cost more, how confident the answers
 * are, what a long text does, and what the whole tenant would cost. It says what it could not
 * measure in its own last section, because a number whose conditions travel separately is a
 * number the next reader will misread -- the rule `accuracyReport.ts` follows. Whether the
 * answers are RIGHT is the other half, and lives in the sheet `probeCsv.ts` writes.
 *
 * Everything is rendered generically from the questions' kinds, so changing what the probe asks
 * changes no code here.
 */

import { type ProviderAnswer, runnerUp, type SemanticQuestions } from "./definition.ts";
import type { Call, Pass } from "./probe.ts";

export interface ProbeRun {
  readonly at: string;
  readonly tenantId: string;
  readonly maxChars: number;
  /** The tenant's readable texts by digest; what the sample was drawn from. */
  readonly catalogue: {
    readonly digests: number;
    readonly documents: number;
    readonly cutChars: number;
  };
  readonly single: SemanticQuestions;
  readonly multi: SemanticQuestions;
  readonly calls: readonly Call[];
}

const CONFIDENCE_EDGES = [0.5, 0.7, 0.9, 0.95] as const;
const PROBABILITY_EDGES = [0.1, 0.5, 0.9] as const;
const SIZE_EDGES = [2000, 8000] as const;
/** The threshold the design notes propose; reported so the proposal meets a number. */
const PROPOSED_THRESHOLD = 0.9;

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** A measured number, or the em dash that says none was measured -- never a zero. */
function show(value: number | null, digits = 0): string {
  return value === null ? "—" : value.toFixed(digits);
}

function share(part: number, whole: number): string {
  return whole === 0 ? "—" : `${((part / whole) * 100).toFixed(1)}%`;
}

function bucketLabels(edges: readonly number[]): string[] {
  return [
    `< ${edges[0]}`,
    ...edges.slice(1).map((edge, i) => `${edges[i]}–${edge}`),
    `≥ ${edges.at(-1)}`,
  ];
}

function bucketCounts(values: readonly number[], edges: readonly number[]): number[] {
  const counts = new Array<number>(edges.length + 1).fill(0);
  for (const value of values) {
    const found = edges.findIndex((edge) => value < edge);
    const index = found === -1 ? edges.length : found;
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
}

function histogram(title: string, values: readonly number[], edges: readonly number[]): string[] {
  const labels = bucketLabels(edges);
  const counts = bucketCounts(values, edges);
  return [
    `  ${title}`,
    ...labels.map((label, i) => `    ${label.padEnd(12)} ${String(counts[i]).padStart(5)}`),
  ];
}

function tally(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(
      ([value, count]) =>
        `    ${value.padEnd(24)} ${String(count).padStart(5)}  ${share(count, values.length)}`,
    );
}

function ofPass(calls: readonly Call[], pass: Pass): Call[] {
  return calls.filter((call) => call.pass === pass);
}

function callSection(calls: readonly Call[]): string[] {
  const lines = [
    "1. CALLS",
    "  pass     calls  failed  p50 ms  p95 ms  max ms  in tok/call  out tok/call",
  ];
  const failures: string[] = [];
  for (const pass of ["single", "multi"] as const) {
    const these = ofPass(calls, pass);
    const ok = these.flatMap((call) => (call.outcome.ok ? [call.outcome] : []));
    const ms = these.map((call) => call.ms);
    lines.push(
      [
        `  ${pass.padEnd(8)}`,
        String(these.length).padStart(5),
        String(these.length - ok.length).padStart(7),
        show(percentile(ms, 50)).padStart(7),
        show(percentile(ms, 95)).padStart(7),
        show(percentile(ms, 100)).padStart(7),
        show(mean(ok.map((o) => o.inputTokens))).padStart(12),
        show(mean(ok.map((o) => o.outputTokens))).padStart(13),
      ].join(" "),
    );
    failures.push(...these.flatMap((call) => (call.outcome.ok ? [] : [call.outcome.reason])));
  }
  lines.push("  failures by reason (SDK retries were off, so each is a first attempt):");
  lines.push(...(failures.length === 0 ? ["    none"] : tally(failures)));
  const models = new Set<string>();
  for (const call of calls) {
    if (call.outcome.ok) {
      models.add(call.outcome.model);
    }
  }
  lines.push(`  model(s) that answered: ${models.size === 0 ? "—" : [...models].join(", ")}`);
  return lines;
}

/** Same texts, one question set against the other: what asking more costs. */
function pairedSection(run: ProbeRun): string[] {
  const multi = ofPass(run.calls, "multi").filter((call) => call.outcome.ok);
  const asked = new Set(multi.map((call) => call.document.documentId));
  const single = ofPass(run.calls, "single").filter(
    (call) => call.outcome.ok && asked.has(call.document.documentId),
  );
  function row(label: string, these: Call[]): string {
    const tokens = these.flatMap((call) => (call.outcome.ok ? [call.outcome.inputTokens] : []));
    const p50 = percentile(
      these.map((c) => c.ms),
      50,
    );
    return `  ${label.padEnd(34)} n=${String(these.length).padStart(4)}  p50 ms ${show(p50).padStart(6)}  in tok ${show(mean(tokens)).padStart(7)}`;
  }
  return [
    "2. ONE QUESTION SET AGAINST ANOTHER, SAME TEXTS",
    row(`single (${Object.keys(run.single).length} question)`, single),
    row(`multi (${Object.keys(run.multi).length} questions)`, multi),
  ];
}

function answersTo(calls: readonly Call[], name: string): ProviderAnswer[] {
  return calls.flatMap((call) => {
    const judgement = call.outcome.ok ? call.outcome.judgements[name] : undefined;
    return judgement?.status === "classified" ? [judgement.answer] : [];
  });
}

function refusalsOf(calls: readonly Call[], name: string): string[] {
  return calls.flatMap((call) => {
    const judgement = call.outcome.ok ? call.outcome.judgements[name] : undefined;
    return judgement?.status === "invalid-response" ? [judgement.reason] : [];
  });
}

function questionSection(name: string, pass: Pass, calls: readonly Call[]): string[] {
  const answers = answersTo(calls, name);
  const lines = [
    `  ${name} (${pass} pass): ${answers.length} of ${calls.length} calls answered it`,
  ];
  const choices = answers.flatMap((a) => (a.kind === "choice" ? [a] : []));
  const booleans = answers.flatMap((a) => (a.kind === "boolean" ? [a.probability] : []));
  const scores = answers.flatMap((a) => (a.kind === "score" ? [a] : []));
  if (choices.length > 0) {
    const confidence = choices.map((a) => a.confidence);
    const margins = choices.map((a) => a.confidence - (runnerUp(a)?.[1] ?? 0));
    const sure = confidence.filter((c) => c >= PROPOSED_THRESHOLD).length;
    lines.push("    label", ...tally(choices.map((a) => a.label)));
    lines.push(...histogram("confidence", confidence, CONFIDENCE_EDGES));
    lines.push(
      `    at ≥ ${PROPOSED_THRESHOLD}: ${sure} of ${choices.length} (${share(sure, choices.length)})`,
    );
    lines.push(`    median margin over the runner-up: ${show(percentile(margins, 50), 3)}`);
  }
  if (booleans.length > 0) {
    lines.push(...histogram("probability of yes", booleans, PROBABILITY_EDGES));
  }
  if (scores.length > 0) {
    lines.push("    level (rounded)", ...tally(scores.map((a) => String(Math.round(a.score)))));
    lines.push(
      ...histogram(
        "confidence",
        scores.map((a) => a.confidence),
        CONFIDENCE_EDGES,
      ),
    );
  }
  const refused = refusalsOf(calls, name);
  lines.push(`    out-of-contract answers: ${refused.length}`, ...tally(refused));
  return lines;
}

function sizeSection(calls: readonly Call[]): string[] {
  const single = ofPass(calls, "single");
  function bucketOf(call: Call): string {
    if (call.document.cut) {
      return "cut";
    }
    const index = SIZE_EDGES.findIndex((edge) => call.document.chars < edge);
    return bucketLabels(SIZE_EDGES)[index === -1 ? SIZE_EDGES.length : index] ?? "";
  }
  const lines = [
    "4. INPUT SIZE (single pass, characters)",
    "  size          calls  failed  p50 ms  in tok/call",
  ];
  for (const bucket of [...bucketLabels(SIZE_EDGES), "cut"]) {
    const these = single.filter((call) => bucketOf(call) === bucket);
    const ok = these.flatMap((call) => (call.outcome.ok ? [call.outcome.inputTokens] : []));
    lines.push(
      `  ${bucket.padEnd(12)} ${String(these.length).padStart(6)} ${String(these.length - ok.length).padStart(7)} ${show(
        percentile(
          these.map((c) => c.ms),
          50,
        ),
      ).padStart(7)} ${show(mean(ok)).padStart(12)}`,
    );
  }
  return lines;
}

function costSection(run: ProbeRun): string[] {
  const ok = ofPass(run.calls, "single").flatMap((call) =>
    call.outcome.ok
      ? [{ chars: Math.min(call.document.chars, run.maxChars), tokens: call.outcome.inputTokens }]
      : [],
  );
  const chars = ok.reduce((sum, o) => sum + o.chars, 0);
  const tokens = ok.reduce((sum, o) => sum + o.tokens, 0);
  const perThousand = chars === 0 ? null : (tokens / chars) * 1000;
  return [
    "5. THE WHOLE TENANT",
    `  readable texts: ${run.catalogue.digests} distinct, held by ${run.catalogue.documents} documents`,
    `  input tokens per 1,000 characters sent: ${show(perThousand, 1)}`,
    `  estimated input tokens to ask the single set of every text once: ${show(perThousand === null ? null : (perThousand * run.catalogue.cutChars) / 1000)}`,
    "  (tokens only: this tool does not know the provider's price)",
  ];
}

function gapSection(run: ProbeRun): string[] {
  const sampled = ofPass(run.calls, "single").length;
  return [
    "6. NOT MEASURED HERE",
    "  - whether the answers are RIGHT: open the documents in the CSV beside this report and check.",
    "  - throughput under concurrency, and the provider's rate limit: calls were one at a time.",
    `  - anything past ${run.maxChars} characters of a text: longer texts were cut there, counted as "cut" above.`,
    ...(sampled < run.catalogue.digests
      ? [
          `  - ${run.catalogue.digests - sampled} of the tenant's texts: the sample is ${sampled}, drawn by md5 of the digest.`,
        ]
      : []),
  ];
}

export function renderProbeReport(run: ProbeRun): string {
  const lines = [
    `Semantic probe, ${run.at}`,
    `tenant ${run.tenantId}; ${ofPass(run.calls, "single").length} distinct texts sampled; each cut at ${run.maxChars} characters`,
    "",
    ...callSection(run.calls),
    "",
    ...pairedSection(run),
    "",
    "3. ANSWERS",
    ...(["single", "multi"] as const).flatMap((pass) =>
      Object.keys(run[pass]).flatMap((name) =>
        questionSection(name, pass, ofPass(run.calls, pass)),
      ),
    ),
    "",
    ...sizeSection(run.calls),
    "",
    ...costSection(run),
    "",
    ...gapSection(run),
  ];
  return `${lines.join("\n")}\n`;
}
