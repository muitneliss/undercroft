/**
 * The colours a chart may use, and why they are not the wheel.
 *
 * The seven-hue wheel already means something: hue is DIVISION (ADR 0010, ADR 0019), so a
 * bar in chrome would read as "sources" and a line in violet as "models". And the wheel's
 * own values are the wrong weight for a mark on the leaf -- chrome `#eda600` sits under
 * 2:1 against `#fbf8f0`, invisible as a thin line. So charts get a categorical set of their
 * own: the wheel's hue FAMILIES, restepped in OKLCH lightness off the board values (the
 * deep hues lighter, the middle ones darker, so the set also spreads in lightness for a
 * reader who cannot tell the hues apart) until no slot is a board hue and every slot
 * clears 3:1 on the leaf (the WCAG 2.1 floor for a graphical object), with vermilion held
 * out exactly as the wheel holds it out, for the errata slip alone.
 *
 * The set once carried six of the seven board hexes verbatim under this same paragraph, so a
 * one-series chart in Reports was drawn in People's board. `plotPalette.test.ts` now fails
 * if any slot or ramp step is a division's board.
 *
 * The dataviz validator the design method asks for was not available in this checkout, so
 * the contrast floor is pinned the other way: `plotPalette.test.ts` computes every slot's
 * ratio against the leaf with `lib/acetate`'s WCAG maths and fails below 3:1. The ordering
 * is by hue distance from its neighbours, so the first three series read apart.
 *
 * Sequential is the ultramarine family light to dark; diverging runs sienna through the leaf
 * to ultramarine. Status tones are the four marks' own colours, so a chart of run outcomes
 * says what the journal says.
 */

/** Categorical slots, in the order series take them. Past seven, series fold to "Other". */
export const CATEGORICAL: readonly string[] = [
  "#3e6abf", // ultramarine family, lifted from #234c9e (people's board)
  "#ca6133", // oxide family, lifted from #b24b1a (customers')
  "#215b06", // grass family, deepened from #3e782b (journal's)
  "#7f6ad1", // violet family, lifted from #634cb0 (models')
  "#005957", // teal family, deepened from #0f7673 (lake's)
  "#602403", // sienna family, deepened from #7f4023 (reports')
  "#7a5a00", // chrome family, deepened from #eda600 to clear the floor (sources')
];

/** The colour "Other" takes when series past the seventh are folded: the quiet ink. */
export const OTHER = "#6b6450";

/** The four marks' own colours, for a chart of outcomes. */
export const STATUS = {
  granted: "#1c5c33",
  pending: "#6b4a00",
  lapsed: "#8c1c09",
  absent: "#56513f",
} as const;

/** Ultramarine, light to dark. */
const SEQUENTIAL: readonly string[] = [
  "#c9d4ec",
  "#98abd6",
  "#6a86bf",
  "#3f66ab",
  "#1f4590",
  "#173570",
];

/** Sienna through the leaf to ultramarine. */
const DIVERGING: readonly string[] = ["#692d0e", "#b98a74", "#e8d9cf", "#98abd6", "#1f4590"];

/** The colour for the `index`th series, cycling past the end. */
export function colourFor(index: number): string {
  return CATEGORICAL[index % CATEGORICAL.length] ?? OTHER;
}

/** `n` steps of the sequential ramp, evenly spaced along it. */
export function sequential(n: number): string[] {
  return steps(SEQUENTIAL, n);
}

/** `n` steps of the diverging ramp, evenly spaced along it. */
export function diverging(n: number): string[] {
  return steps(DIVERGING, n);
}

function steps(ramp: readonly string[], n: number): string[] {
  if (n <= 0) {
    return [];
  }
  if (n === 1) {
    return [ramp.at(-1) ?? OTHER];
  }
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const at = Math.round((i * (ramp.length - 1)) / (n - 1));
    out.push(ramp[at] ?? OTHER);
  }
  return out;
}
