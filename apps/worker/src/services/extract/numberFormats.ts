/**
 * What number format a workbook cell carries: the code Excel uses to show a serial as a date or
 * a ratio as a percent, read from the styles part and recorded as a FACT (ADR 0104 decision 2).
 *
 * The platform never acts on it. A model reading a hand-made sheet needs to know that column A
 * is formatted `dd/mm/yyyy` to tell a date serial from a count; deciding that it IS a date is
 * the model's call, because a format is what a person chose to display, not what the value is.
 *
 * A cell names a style (`s`), the style names a format id (`cellXfs/xf/@numFmtId`), and the id
 * is either the workbook's own (`numFmts/numFmt`) or one of Excel's built-ins.
 */

import { attributesOf, PREFIX } from "./xml.ts";

const NUMBER_FORMAT = new RegExp(`<${PREFIX}numFmt\\b(?<attributes>[^>]*?)\\/?>`, "gu");
const CELL_FORMATS = new RegExp(
  `<${PREFIX}cellXfs\\b[^>]*?(?:\\/>|>(?<body>[\\s\\S]*?)<\\/${PREFIX}cellXfs>)`,
  "u",
);
const CELL_FORMAT = new RegExp(`<${PREFIX}xf\\b(?<attributes>[^>]*?)\\/?>`, "gu");
const DIGITS = /^\d+$/u;

/**
 * The built-in number formats whose code ECMA-376 Part 1 §18.8.30 fixes.
 *
 * The others -- 5–8 and 23–44's currency and accounting forms, 50 and above for East Asian
 * calendars, and 14 and 22, which Excel renders in the reader's own short-date order -- depend
 * on the locale of whoever opens the file. Each of those is recorded as `builtin:<id>` rather
 * than expanded into a code the file did not state.
 */
const BUILTIN_FORMATS: ReadonlyMap<number, string> = new Map([
  [1, "0"],
  [2, "0.00"],
  [3, "#,##0"],
  [4, "#,##0.00"],
  [9, "0%"],
  [10, "0.00%"],
  [11, "0.00E+00"],
  [12, "# ?/?"],
  [13, "# ??/??"],
  [15, "d-mmm-yy"],
  [16, "d-mmm"],
  [17, "mmm-yy"],
  [18, "h:mm AM/PM"],
  [19, "h:mm:ss AM/PM"],
  [20, "h:mm"],
  [21, "h:mm:ss"],
  [37, "#,##0 ;(#,##0)"],
  [38, "#,##0 ;[Red](#,##0)"],
  [39, "#,##0.00;(#,##0.00)"],
  [40, "#,##0.00;[Red](#,##0.00)"],
  [45, "mm:ss"],
  [46, "[h]:mm:ss"],
  [47, "mmss.0"],
  [48, "##0.0E+0"],
  [49, "@"],
]);

export function integerOf(value: string | undefined): number | null {
  // An index, not an amount (money.grit's docstring).
  return value !== undefined && DIGITS.test(value) ? Number.parseInt(value, 10) : null;
}

/** Style index → format code, from the styles part. General, or no styles at all, is `null`. */
export function numberFormatsOf(xml: string | null): (styleIndex: number) => string | null {
  if (xml === null) {
    return () => null;
  }
  const custom = new Map<number, string>();
  for (const match of xml.matchAll(NUMBER_FORMAT)) {
    const attributes = attributesOf(match.groups?.attributes ?? "");
    const id = integerOf(attributes.get("numFmtId"));
    const code = attributes.get("formatCode");
    if (id !== null && code !== undefined) {
      custom.set(id, code);
    }
  }
  const body = CELL_FORMATS.exec(xml)?.groups?.body ?? "";
  const formatIds = [...body.matchAll(CELL_FORMAT)].map((match) =>
    integerOf(attributesOf(match.groups?.attributes ?? "").get("numFmtId")),
  );
  return (styleIndex) => {
    const id = formatIds[styleIndex] ?? null;
    if (id === null || id === 0) {
      return null;
    }
    return custom.get(id) ?? BUILTIN_FORMATS.get(id) ?? `builtin:${String(id)}`;
  };
}
