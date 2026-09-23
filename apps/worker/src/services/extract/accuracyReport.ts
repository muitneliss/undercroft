/**
 * The accuracy run, written out for a person.
 *
 * SEPARATE FROM THE MEASUREMENT so that the thing which decides what a number MEANS is not
 * also the thing deciding how wide a column is -- and so that a suite can assert the property
 * that matters about the output rather than about the counters behind it: no character of a
 * customer's document appears in it. `accuracyReport.test.ts` asserts exactly that, over the
 * rendered string, which is the only place it can be checked end to end.
 *
 * IT OWNS THE LAST SECTION, and the caller cannot omit it. `renderReport` appends this run's
 * own gaps and then the standing `UNMEASURED` list itself, so a report without a statement of
 * what it did not establish is not a thing this module can produce. That is law 3 made
 * structural: the alternative is a caller who forgets, and a reader who then takes a tier A
 * figure for a statement about the corpus.
 *
 * EVERY RATE CARRIES ITS DENOMINATOR, for the same reason.
 */

import type { GoldScore, Gap } from "./accuracy.ts";
import { UNMEASURED } from "./accuracy.ts";
import type { CorpusReport } from "./corpusSignals.ts";
import type { RecallSummary } from "./ooxmlOracle.ts";

export interface AccuracyRun {
  /** When it ran. A measurement without a date is not re-checkable. */
  readonly at: string;
  readonly gold: GoldScore;
  /** `null` where there was no database to read. Never an empty report standing in for one. */
  readonly corpus: CorpusReport | null;
  /** The sample reached its cap, so every corpus rate is conditional on it. */
  readonly corpusCapped: boolean;
  /** `null` where there was no object store to fetch document bytes from. */
  readonly recall: RecallSummary | null;
  /** Gaps particular to THIS run, ahead of the standing ones. */
  readonly gaps: readonly Gap[];
}

/** A rate never travels without the two numbers it came from. */
function rate(part: number, whole: number): string {
  return whole === 0 ? "n/a (nothing to measure)" : `${percent(part, whole)} (${part}/${whole})`;
}

function percent(part: number, whole: number): string {
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function goldSection(score: GoldScore): string[] {
  const lines = [
    "TIER A -- authored gold set, scored against the shipped readers",
    "",
    "  Every expected string was written from the document's own markup before any reader was",
    "  run against it, and none of these documents appears in a test suite: a sample the",
    "  readers were tuned on gives an upper bound rather than an estimate.",
    "",
  ];

  for (const one of score.cases) {
    lines.push(
      one.measured
        ? `  ${one.id.padEnd(22)} ${(one.method ?? "REFUSED").padEnd(9)} ` +
            `${rate(one.fidelity.kept, one.fidelity.expected).padEnd(18)} ` +
            `+${one.fidelity.added} added   ${one.feature}`
        : `  ${one.id.padEnd(22)} UNMEASURED  ${one.why}   ${one.feature}`,
    );
  }

  lines.push(
    "",
    `  CHARACTER FIDELITY ${rate(score.kept, score.expected)} over ${score.measured} documents, ` +
      `${score.unmeasured} unmeasured`,
    `  Characters beyond the authored text: ${score.added}. An UPPER bound on invention -- a`,
    "  reader's own cell and part separators land there too.",
  );
  return lines;
}

function methodRow(tally: CorpusReport["methods"][number]): string {
  return (
    `  ${tally.method.padEnd(11)}${String(tally.documents).padStart(6)}` +
    `${String(tally.chars).padStart(11)}` +
    `${rate(tally.vietnamese, tally.documents).padStart(20)}` +
    `${String(tally.garbage).padStart(9)}` +
    `${String(tally.truncated).padStart(11)}` +
    `${String(tally.silentZero).padStart(10)}` +
    `${String(tally.terseForSize).padStart(15)}`
  );
}

function corpusSection(report: CorpusReport, capped: boolean): string[] {
  const cap = capped ? "  CAP REACHED: the corpus is larger than this sample." : "";
  const lines = [
    "TIER B -- the real corpus, counted",
    "",
    `  ${report.documents} extracted documents sampled.${cap}`,
    "  Counts and rates only: no excerpt and no document id leaves this measurement.",
    "",
    "  method      docs      chars          vietnamese  garbage  truncated  silent-0  terse-for-size",
    ...report.methods.map(methodRow),
    "",
    "  THE VIETNAMESE COLUMN IS A CROSS-METHOD REFERENCE, not a fact about customers. The",
    "  text-layer path needs no language pack, so it is the control: an OCR method sitting near",
    "  zero beside it means `tesseract-ocr-vie` is absent or ineffective on that host. A real",
    "  finding about a deployment, with no ground truth and no human.",
    "",
    "  GARBAGE AND TERSE-FOR-SIZE ARE LEADS, NOT DEFECTS. Confirming one means opening the",
    "  document. SILENT-0 is different: a method with no characters is a claim to have read",
    "  something that says nothing, which is the one shape rule 2 refuses outright.",
    "",
    "  refusals:",
  ];

  if (report.reasons.length === 0) {
    lines.push("    none");
  }
  for (const tally of report.reasons) {
    lines.push(`    ${tally.reason.padEnd(34)} ${tally.documents}`);
  }
  return lines;
}

function recallSection(summary: RecallSummary): string[] {
  const lines = [
    "TIER B -- the OOXML oracle, over real documents with no ground truth",
    "",
    "  Every <w:t> and <t> run in every part IS text the document shows, so a sweep of them",
    "  says what the output should have contained. A reader that drops a part scores below 1.",
    "",
  ];

  if (summary.byKind.length === 0) {
    lines.push("  no OOXML documents in the sample");
  }
  for (const audit of summary.byKind) {
    lines.push(
      `  ${audit.kind.padEnd(9)} ${String(audit.documents).padStart(5)} docs   ` +
        `recall ${rate(audit.found, audit.declared)}   ${audit.short} scored short`,
      audit.kind === "word"
        ? "            a shortfall here is a DEFECT: the document declares text the reader did not produce"
        : "            a shortfall here is a LEAD: an unreferenced shared string scores short on a correct read",
    );
  }

  lines.push(`  ${summary.unscored} documents the oracle had no opinion about`);
  return lines;
}

function gapSection(gaps: readonly Gap[]): string[] {
  const lines = [
    "TIER C -- what this run did NOT measure",
    "",
    "  Saying so is part of the measurement rather than a failure of it. A number is",
    "  conditional on what it was taken over, and the conditions have to travel with it.",
    "",
  ];
  for (const gap of gaps) {
    lines.push(`  * ${gap.what}`, `      ${gap.why}`, "");
  }
  return lines;
}

/** A gold case this machine could not run is a gap in THIS run, not a standing one. */
function unmeasuredCases(score: GoldScore): Gap[] {
  return score.cases.flatMap((one) =>
    one.measured
      ? []
      : [
          {
            what: `${one.id} (${one.feature})`,
            why: `${one.why} on this machine, so it scored neither pass nor zero.`,
          },
        ],
  );
}

function missing(tier: string): string[] {
  return [tier, "", "  NOT MEASURED. See tier C."];
}

export function renderReport(run: AccuracyRun): string {
  const lines = [
    `EXTRACTION ACCURACY -- ${run.at}`,
    "",
    ...goldSection(run.gold),
    "",
    ...(run.corpus === null
      ? missing("TIER B -- the real corpus")
      : corpusSection(run.corpus, run.corpusCapped)),
    "",
    ...(run.recall === null ? missing("TIER B -- the OOXML oracle") : recallSection(run.recall)),
    "",
    ...gapSection([...run.gaps, ...unmeasuredCases(run.gold), ...UNMEASURED]),
  ];
  return `${lines.join("\n")}\n`;
}
