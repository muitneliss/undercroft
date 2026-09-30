/**
 * What a gauge or a progress bar may draw: the reading as a share of its author's bound, or
 * nothing at all and the reason why.
 *
 * A share is a claim about two numbers, and only one of them comes from the result. The
 * other -- the bound -- is a fact about the business that only the question's author knows:
 * a target, a budget, a capacity. Before ADR 0090 the drawing stood in for it with the
 * largest value in the result, else 100, which drew a needle three quarters of the way round
 * against a figure nobody chose, indistinguishable from one against a real target. That is a
 * guess presented as a figure, which CLAUDE.md rule 2 forbids, so it is gone: with no bound
 * set there is no share, and the drawing says the bound is missing. ADR 0090.
 *
 * A missing READING draws no share either. The drawing used to position a needle at zero for
 * it, and a needle at zero is a claim that the value is zero (`.claude/rules/money.md`).
 *
 * Wordless on purpose: the drawings in `components/charts/readings.tsx` choose the words.
 */

import type { ChartConfig } from "@undercroft/contracts/bi";

export type ReadingShare =
  /** Draw `value` against `max`. */
  | { readonly kind: "share"; readonly value: number; readonly max: number }
  /** The question's author set no bound; draw no share. */
  | { readonly kind: "noBound" }
  /** There is a bound but no reading to draw against it. */
  | { readonly kind: "noValue" };

/** The bound the author set, when it is one a share can be drawn against. */
function boundOf(chart: ChartConfig): number | null {
  const configured = chart.options.max;
  return typeof configured === "number" && Number.isFinite(configured) && configured > 0
    ? configured
    : null;
}

/** What to draw for `value`, the first reading's plot position, under `chart`. */
export function readingShare(value: number | null, chart: ChartConfig): ReadingShare {
  const max = boundOf(chart);
  if (max === null) {
    return { kind: "noBound" };
  }
  if (value === null) {
    return { kind: "noValue" };
  }
  return { kind: "share", value, max };
}
