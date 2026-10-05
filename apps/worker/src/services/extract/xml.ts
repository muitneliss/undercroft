/**
 * The little XML the in-process readers need: entities decoded, attributes read, and an
 * element name matched whatever namespace prefix its writer chose.
 *
 * NOT AN XML PARSER, for the reason `zip.ts` is not a zip library: the readers that use it
 * (`docx.ts`, `xlsx.ts`, `workbookPackage.ts`, `html.ts`) read a handful of elements lexically,
 * in the one process that holds `UNDERCROFT_SECRET_KEY`, and a dependency there is a
 * supply-chain surface for a grammar this short (ADR 0028).
 */

const NAMED_ENTITY: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const ENTITY = /&(?<body>#x?[0-9a-f]+|[a-z]+);/giu;

/**
 * XML entities resolved, including the numeric forms Excel uses for control characters.
 *
 * An entity this function does not recognise is left standing rather than dropped: `&foo;` on
 * the page is visibly odd, where silently deleting it edits the document.
 */
export function decodeXmlText(value: string): string {
  return value.replaceAll(ENTITY, (whole, body: string) => {
    const named = NAMED_ENTITY[body.toLowerCase()];
    if (named !== undefined) {
      return named;
    }
    if (!body.startsWith("#")) {
      return whole;
    }
    const hex = body.startsWith("#x") || body.startsWith("#X");
    // `Number.parseInt`, not `Number()`: a code point is an integer index, not an amount.
    // money.grit's docstring names this exact distinction.
    const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10_ff_ff
      ? String.fromCodePoint(code)
      : whole;
  });
}

/**
 * The namespace prefix an element MAY carry, as a regular-expression fragment.
 *
 * Excel writes SpreadsheetML in the default namespace (`<row>`), but the namespace is what the
 * format fixes, not the prefix: a writer is free to bind it to `x:` and write `<x:row>`, and a
 * pattern that spelled `<row` would read such a workbook as having no rows at all.
 */
export const PREFIX = "(?:[A-Za-z_][\\w.-]*:)?";

const ATTRIBUTE = /(?<name>[A-Za-z_][\w:.-]*)\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)')/gu;

/**
 * An element's attributes by name, values decoded.
 *
 * Either quote is legal XML and both occur: Excel writes `"`, and some writers emit `'`.
 */
export function attributesOf(source: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE)) {
    const { name, double, single } = match.groups ?? {};
    if (name !== undefined) {
      attributes.set(name, decodeXmlText(double ?? single ?? ""));
    }
  }
  return attributes;
}
