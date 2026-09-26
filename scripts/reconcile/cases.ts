/**
 * Building test cases: the shape every suite reports in, and the one way a leg's record
 * verdicts become a case -- counts, the status `legStatus` derives, and the non-matching
 * records written as evidence. One builder, so no suite can fold a PENDING leg into a PASS.
 */

import type { RecordResult } from "./model.ts";
import type { EvidenceSink } from "./evidence.ts";
import {
  type Leg,
  legStatus,
  type SourceName,
  type TestGroup,
  type TestResult,
  tally,
} from "./model.ts";

export type CaseFields = Omit<TestResult, "id" | "title" | "source" | "group"> & {
  group?: TestGroup;
};

export function makeCase(
  source: SourceName | "system",
  head: { id: string; title: string },
  fields: CaseFields,
): TestResult {
  return { id: head.id, title: head.title, source, group: fields.group ?? "live", ...fields };
}

export interface LegMeta {
  readonly source: SourceName;
  readonly id: string;
  readonly title: string;
  readonly leg: Leg;
  /** The client's CASE-ID; absent for a leg over a whole mailbox, portal or lake source. */
  readonly client?: string;
  readonly requirement: string;
  readonly contract: string;
  readonly preconditions: string;
  readonly expected: string;
  /** What was compared, in words; defaults to the verdict counts. */
  readonly actual?: string;
  readonly finding?: string;
  /** Extra facts worth keeping beside the records: sizes, watermarks, fields compared. */
  readonly facts?: Readonly<Record<string, unknown>>;
}

/** A leg's record verdicts as a case. `synchronised` is the target's own "my run completed". */
export function legCase(
  sink: EvidenceSink,
  meta: LegMeta,
  records: readonly RecordResult[],
  synchronised: boolean,
): TestResult {
  const counts = tally(records);
  const verdict = legStatus(counts, synchronised);
  sink.judged?.(meta.id, records);
  const evidence = [
    {
      label: "non-matching records",
      path: sink.rows(
        meta.id,
        records.filter((record) => record.verdict !== "MATCH"),
      ),
    },
    ...(meta.facts === undefined
      ? []
      : [{ label: "facts", path: sink.json(`${meta.id}-facts`, meta.facts) }]),
  ];
  const nonzero = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name}=${n}`)
    .join(" ");
  return makeCase(meta.source, meta, {
    leg: meta.leg,
    ...(meta.client === undefined ? {} : { client: meta.client }),
    ...(meta.finding === undefined ? {} : { finding: meta.finding }),
    requirement: meta.requirement,
    contract: meta.contract,
    preconditions: meta.preconditions,
    expected: meta.expected,
    actual: meta.actual ?? `${records.length} keyed record(s): ${nonzero || "none"}`,
    status: verdict.status,
    reason: verdict.reason,
    counts,
    evidence,
  });
}

/** An ISO time, or a plain statement that there is none. */
export function stamp(at: number | null): string {
  return at === null ? "none known" : new Date(at).toISOString();
}
