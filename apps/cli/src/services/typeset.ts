/**
 * The type the CLI's pages are set in: spans with a tone, lines of spans, and the few moves a
 * compositor makes with them -- wrap, leader, flush right, the margin.
 *
 * The web UI is a reference manual lying open (`apps/ui/src/index.css`), and the pages built
 * on this are the same book set in type: `titlePage.ts` while nobody is signed in,
 * `contentsPage.ts` once someone is, and `erratum.ts` when something failed.
 * `docs/design/cli-home-and-sign-in.md` holds the frames; the rules they share live here:
 *
 * - **Every stroke is 7-bit ASCII.** The mark, the rule, the leaders and the code's cells are
 *   drawn in characters any terminal has, so the page looks the same over a serial console,
 *   in `LANG=C` and in a modern emulator. Only the WORDS use the locale's letters.
 * - **Rank is form, not colour.** Position, capitals, leaders and spacing carry the
 *   hierarchy; bold and dim only repeat it. With colour off nothing is lost, which is why
 *   `color: false` still sets every line the same.
 * - **Red is held for errata.** Exactly one thing may be red: a failure.
 * - **The page has a measure.** Never wider than 77 columns, never stretched on a wide
 *   terminal; below 60 a page stacks into one column instead of letting the terminal wrap it.
 *
 * Pure: values in, strings out. The handlers decide which page to draw and write it.
 */

export interface PageStyle {
  /** The terminal's width; 80 when the stream does not say. */
  readonly columns: number;
  readonly color: boolean;
}

export type Tone = "plain" | "bold" | "dim" | "red";

const SGR: Readonly<Record<Exclude<Tone, "plain">, readonly [string, string]>> = {
  bold: ["\u001b[1m", "\u001b[22m"],
  dim: ["\u001b[2m", "\u001b[22m"],
  red: ["\u001b[1;31m", "\u001b[22;39m"],
};

/** `text` in `tone`, or as it is when colour is off. */
export function toned(text: string, tone: Tone, color: boolean): string {
  if (!color || tone === "plain" || text === "") {
    return text;
  }
  const [open, close] = SGR[tone];
  return `${open}${text}${close}`;
}

export interface Span {
  readonly text: string;
  readonly tone: Tone;
}

export type Line = readonly Span[];

export function plain(text: string): Span {
  return { text, tone: "plain" };
}

export function bold(text: string): Span {
  return { text, tone: "bold" };
}

export function dim(text: string): Span {
  return { text, tone: "dim" };
}

export function red(text: string): Span {
  return { text, tone: "red" };
}

export const MARGIN = "   ";
/** The widest a line may be, margin included. */
const MEASURE = 77;
/** Below this many columns a page stacks into one column. */
const NARROW = 60;

const COMBINING = /\p{M}/gu;
const SEPARATORS = /\s+/u;

/** Display columns, not `.length`: a decomposed Vietnamese letter is several code units. */
export function widthOf(text: string): number {
  return [...text.normalize("NFC").replace(COMBINING, "")].length;
}

export function lineWidth(line: Line): number {
  return line.reduce((sum, span) => sum + widthOf(span.text), 0);
}

/** The columns inside the margin: what a page's lines are measured against. */
export function innerOf(style: PageStyle): number {
  return Math.min(MEASURE, style.columns - 1) - MARGIN.length;
}

/** Whether there is room to set a page in two columns rather than stacking it. */
export function isWide(inner: number): boolean {
  return inner >= NARROW - MARGIN.length;
}

/** The lines, each set in the margin (a blank line stays blank), as terminal text. */
export function setPage(lines: readonly Line[], color: boolean): string[] {
  return lines.map((line) =>
    (line.length === 0 ? line : [plain(MARGIN), ...line])
      .map((span) => toned(span.text, span.tone, color))
      .join("")
      .trimEnd(),
  );
}

/** Greedy word wrap. A single word wider than the line is left whole rather than broken. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(SEPARATORS)) {
    const next = current === "" ? word : `${current} ${word}`;
    if (widthOf(next) > width && current !== "") {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current !== "") {
    lines.push(current);
  }
  return lines;
}

/** `line` pushed right so it ends at `width`, having already used `from` columns. */
export function flushRight(line: Line, from: number, width: number): Line {
  return [plain(" ".repeat(Math.max(0, width - from - lineWidth(line)))), ...line];
}

/**
 * `left` and `right` joined by a dot leader across `width` columns.
 *
 * The dots sit on alternate ABSOLUTE columns rather than counting from the end of `left`, so
 * every leader on the page lines up down the page, as a typesetter's leaders do.
 */
export function leader(left: Line, right: Line, width: number): Line {
  const start = lineWidth(left);
  const end = width - lineWidth(right);
  let dots = "";
  for (let column = start; column < end; column += 1) {
    const onGrid = (column + MARGIN.length) % 2 === 0;
    dots += onGrid && column > start && column < end - 1 ? "." : " ";
  }
  return [...left, dim(dots), ...right];
}

/** A label and the command it names; the command drops to its own line when both do not fit. */
export function door(label: string, command: string, width: number): Line[] {
  if (widthOf(label) + widthOf(command) + 4 <= width) {
    return [leader([plain(label)], [bold(command)], width)];
  }
  return [[plain(label)], [plain("  "), bold(command)]];
}
