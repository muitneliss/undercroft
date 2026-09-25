/**
 * The title page: what `undercroft` shows a person who is not signed in.
 *
 * The mark, the name at its top line and the imprint at its foot -- edition, server, the
 * session's state -- where a publisher's imprint sits on a title page. Under it, the lines a
 * reader may follow: the two first steps when no server is named, otherwise the door for
 * agents and the language switch, with the sign-in form following on the page itself.
 * Set in `typeset.ts`, whose docstring holds the rules every page keeps.
 */

import { LOCALES, type Locale } from "@undercroft/core/locale";
import type { Translate } from "../i18n/index.ts";
import {
  bold,
  dim,
  door,
  innerOf,
  isWide,
  type Line,
  lineWidth,
  type PageStyle,
  plain,
  setPage,
  wrap,
} from "./typeset.ts";

/** The gutter between the mark and the words beside it. */
const GUTTER = "     ";

/**
 * The device from `apps/ui/src/components/Mark.tsx`, rasterized from its path onto a 20 x 10
 * grid of half-cells: a block with a round-headed arch of three orders cut through it, the
 * impost ties bridging each pier at the springing line. `"` is the top half of a cell,
 * `.`/`_` the bottom half, `'` a rounded bottom corner.
 */
const MARK: readonly string[] = [
  ".##################.",
  '#######""""""#######',
  '#####"   ..   "#####',
  '###"  .######.  "###',
  "###  .##    ##.  ###",
  '###"""##    ##"""###',
  "###   ##    ##   ###",
  "###   ##    ##   ###",
  "###___##____##___###",
  "'##################'",
];

/** The block before any cutting. */
const SOLID: readonly string[] = [
  ".##################.",
  ...Array.from({ length: 8 }, () => "####################"),
  "'##################'",
];

/** The block with only the outer order cut. */
const OUTER: readonly string[] = [
  ".##################.",
  '#######""""""#######',
  '#####"        "#####',
  '###"            "###',
  "###              ###",
  "###              ###",
  "###              ###",
  "###              ###",
  "###______________###",
  "'##################'",
];

/**
 * The mark being cut, one frame at a time: the solid block, the outer order opened, then the
 * ring filled back and the core opened -- the three orders `Mark.tsx` describes. The last
 * frame is the mark at rest.
 */
export const CUT: readonly (readonly string[])[] = [SOLID, OUTER, MARK];

export interface TitleFacts {
  readonly version: string;
  readonly locale: Locale;
  /** `null` when this run names no server at all. */
  readonly server: { readonly origin: string; readonly profile: string | null } | null;
  /** Whether the sign-in form follows the page; its own line is left out when it does. */
  readonly formFollows: boolean;
}

function spaced(name: string): string {
  return [...name.toUpperCase()].join(" ");
}

function otherLocale(locale: Locale): Locale {
  return LOCALES.find((candidate) => candidate !== locale) ?? locale;
}

function imprint(t: Translate, facts: TitleFacts): Line[] {
  const lines: Line[] = [[dim(t("page.edition", { version: facts.version }))]];
  if (facts.server === null) {
    lines.push([plain(t("page.noServer"))]);
    return lines;
  }
  const { origin, profile } = facts.server;
  lines.push(
    profile === null
      ? [dim(origin)]
      : [dim(origin), plain("  "), dim(t("page.profile", { profile }))],
  );
  lines.push([plain(t("page.signedOut"))]);
  return lines;
}

function doors(t: Translate, facts: TitleFacts, width: number): Line[] {
  const language = door(
    t("page.otherLanguage"),
    `undercroft --lang ${otherLocale(facts.locale)}`,
    width,
  );
  if (facts.server === null) {
    // Numbered because the order is the point: there is nothing to sign in to until a
    // server is chosen.
    return [
      ...door(`1  ${t("page.chooseServer")}`, t("page.setProfileCommand"), width),
      ...door(`2  ${t("page.signIn")}`, "undercroft auth login", width),
      [],
      ...door(t("page.everyCommand"), "undercroft describe", width),
      ...language,
    ];
  }
  const agents = door(t("page.forAgents"), "undercroft describe --agent", width);
  if (facts.formFollows) {
    return [...agents, ...language];
  }
  return [
    ...door(t("page.signIn"), "undercroft auth login", width),
    ...agents,
    ...door(t("page.everyCommand"), "undercroft describe", width),
    ...language,
  ];
}

/**
 * The name at the top line of the mark, the tagline under it, the imprint at its foot.
 * `null` when the tagline does not fit between them.
 */
function besideMark(
  mark: readonly string[],
  name: Line,
  tagline: readonly string[],
  foot: readonly Line[],
): Line[] | null {
  const side: Line[] = Array.from({ length: mark.length }, () => []);
  side[0] = name;
  const footStart = mark.length - foot.length;
  // One blank row under the name, and at least one above the imprint.
  if (2 + tagline.length > footStart - 1) {
    return null;
  }
  for (const [index, words] of tagline.entries()) {
    side[2 + index] = [plain(words)];
  }
  for (const [index, line] of foot.entries()) {
    side[footStart + index] = line;
  }
  return mark.map((row, index) => {
    const words = side[index] ?? [];
    return words.length === 0 ? [plain(row)] : [plain(row), plain(GUTTER), ...words];
  });
}

/** The title page, with the mark at `frame` of `CUT` (the finished mark by default). */
export function titlePage(
  t: Translate,
  facts: TitleFacts,
  style: PageStyle,
  frame = CUT.length - 1,
): string[] {
  const inner = innerOf(style);
  const mark = CUT[frame] ?? MARK;
  const name: Line = [bold(spaced(t("page.name")))];
  const foot = imprint(t, facts);
  const sideWidth = inner - (mark[0]?.length ?? 0) - GUTTER.length;
  const fits = isWide(inner) && [name, ...foot].every((line) => lineWidth(line) <= sideWidth);
  const top = fits ? besideMark(mark, name, wrap(t("page.tagline"), sideWidth), foot) : null;
  const head: Line[] = top ?? [
    name,
    [],
    ...wrap(t("page.tagline"), inner).map((words) => [plain(words)]),
    [],
    ...foot,
  ];
  return setPage([[], ...head, [], ...doors(t, facts, inner), []], style.color);
}
