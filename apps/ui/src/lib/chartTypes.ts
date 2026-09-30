/**
 * The reader's word for each of the sixteen drawings (ADR 0020), as catalogue keys: the
 * type plates in `ChartOptions` and the Reports list's chart-type column name a type the
 * same way, from here.
 */

import type { ChartType } from "@undercroft/contracts/bi";

export const CHART_TYPE_KEY = {
  table: "chart.table",
  number: "chart.number",
  bar: "chart.bar",
  line: "chart.line",
  area: "chart.area",
  pie: "chart.pie",
  doughnut: "chart.doughnut",
  scatter: "chart.scatter",
  bubble: "chart.bubble",
  radar: "chart.radar",
  combo: "chart.combo",
  funnel: "chart.funnel",
  gauge: "chart.gauge",
  progress: "chart.progress",
  pivot: "chart.pivot",
  map: "chart.map",
} as const satisfies Record<ChartType, string>;
