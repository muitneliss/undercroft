/**
 * How a saved question is drawn, as a small printed mark beside its name in the Reports list.
 *
 * It shows the PRESENTATION type the author saved, never a result: a list that sketched live
 * figures would have to run every question to draw itself, and a sketch of a figure is read
 * as the figure. Five types have a mark -- the ones a reader meets most, and the ones a
 * line of ink can tell apart at this size; the other eleven of the sixteen (ADR 0020) are
 * named in words, because a mark nobody can tell from its neighbour is worse than the word.
 *
 * The mark is decoration for a sighted reader; the type's name is always the text, hidden
 * visually where the mark stands in for it, so a screen reader hears the same column either
 * way. Drawn in `currentColor` so it takes the cell's quiet ink, not a wheel hue.
 */

import type { ChartType } from "@undercroft/contracts/bi";
import { useTranslation } from "react-i18next";

import { CHART_TYPE_KEY } from "@/lib/chartTypes.ts";

/** The strokes of each mark, on a 24 x 16 box. */
const MARKS: Partial<Record<ChartType, React.JSX.Element>> = {
  table: <path d="M2 3H22M2 8H22M2 13H22M9 1V15M16 1V15" strokeWidth="1" />,
  number: <path d="M6 3V13M4 5L6 3M4 13H8M12 4H17L13 13M19 4V13" strokeWidth="1.4" />,
  bar: <path d="M4 15V9M10 15V4M16 15V7M22 15V2" strokeWidth="3" />,
  line: <path d="M1 13L7 8L12 10L17 4L23 2" strokeWidth="1.4" />,
  area: (
    <path
      d="M1 13L7 8L12 10L17 4L23 2V15H1Z"
      strokeWidth="1"
      fill="currentColor"
      fillOpacity="0.25"
    />
  ),
};

export function ChartGlyph({ type }: { type: ChartType }): React.JSX.Element {
  const { t } = useTranslation();
  const word = t(CHART_TYPE_KEY[type]);
  const mark = MARKS[type];

  if (mark === undefined) {
    return <span>{word}</span>;
  }
  return (
    <span className="glyph">
      <svg
        aria-hidden="true"
        className="glyph__mark"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 16"
      >
        {mark}
      </svg>
      <span className="visually-hidden">{word}</span>
    </span>
  );
}
