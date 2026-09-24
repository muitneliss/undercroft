/**
 * What a web page says, as text.
 *
 * READ LEXICALLY, FOR THE REASON `docx.ts` GIVES. A tag that ends a block becomes a line
 * break, a table cell's end becomes a separator, every other tag is dropped and the entities
 * are decoded. Nothing asks what an element is nested in, so a table inside a table and a
 * `<div>` inside a `<td>` arrive as text rather than as the shapes a structural walk was not
 * taught. What a registry's page saved as evidence says is in its text nodes; a DOM would buy
 * layout, which this index does not store.
 *
 * TWO KINDS OF ELEMENT ARE REMOVED WHOLE: `<script>` and `<style>` (and `<template>`,
 * `<noscript>`), whose content is program text a reader never sees on the page. Everything
 * else a person could read is kept, `<title>` included.
 *
 * WHAT IT DOES NOT DECODE. HTML names over two thousand character references; the handful
 * below are the ones a saved page actually carries in the measured Drive, plus every numeric
 * form. An unrecognised `&name;` is left standing -- visibly odd, never silently deleted --
 * which is `decodeXmlText`'s rule, reused rather than restated.
 */

import { TextDecoder as LabelledDecoder } from "node:util";

import { decodeXmlText } from "./xlsx.ts";

/** Elements whose content is never text on the page. */
const INVISIBLE = /<(?<tag>script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\k<tag>\s*>/giu;
const COMMENT = /<!--[\s\S]*?-->/gu;
/** A tag whose opening or closing starts a new line of reading. */
const BLOCK =
  /<\/?(?:p|div|br|hr|li|ul|ol|tr|table|thead|tbody|tfoot|h[1-6]|title|section|article|header|footer|blockquote|pre|dt|dd|dl|address|figcaption|form|fieldset|legend|nav|aside|main)\b[^>]*>/giu;
const CELL_END = /<\/t[dh]\s*>/giu;
const TAG = /<[^>]*>/gu;
/** Named references past XML's five that a page routinely carries. */
const HTML_NAMED: Readonly<Record<string, string>> = {
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  deg: "°",
  middot: "·",
  bull: "•",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};
const HTML_ENTITY = /&(?<name>[a-z]+);/giu;
const SPACE_RUN = /[ \t\f\v ]+/gu;
const BLANK_RUN = /\n{3,}/gu;
const CRLF = /\r\n?/gu;

/** A page's readable text, one block per line, cells separated as `docx.ts` separates them. */
export function htmlToText(html: string): string {
  const lines = html
    .replaceAll(COMMENT, "")
    .replaceAll(INVISIBLE, "")
    .replaceAll(CELL_END, " | ")
    .replaceAll(BLOCK, "\n")
    .replaceAll(TAG, "")
    .replaceAll(CRLF, "\n");
  const decoded = decodeXmlText(
    lines.replaceAll(HTML_ENTITY, (whole, name: string) => HTML_NAMED[name.toLowerCase()] ?? whole),
  );
  return decoded
    .split("\n")
    .map((line) => line.replaceAll(SPACE_RUN, " ").trim())
    .join("\n")
    .replaceAll(BLANK_RUN, "\n\n")
    .trim();
}

/** Where a page may declare its charset: `<meta charset>` or the `http-equiv` form. */
const META_CHARSET = /<meta\b[^>]*?charset\s*=\s*["']?(?<charset>[\w-]+)/iu;
/** The WHATWG prescan looks at the first 1024 bytes, and so does this. */
const PRESCAN_BYTES = 1024;

/**
 * A page's bytes as text, in the charset it declares -- UTF-8 when it declares none or one
 * this runtime cannot decode. Non-fatal either way, for `readPlainText`'s reason: a stray byte
 * costs that byte and arrives as a visible replacement character.
 */
export function decodeHtmlBytes(bytes: Uint8Array): string {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, PRESCAN_BYTES));
  const declared = META_CHARSET.exec(head)?.groups?.charset;
  return decodeCharset(bytes, declared);
}

/** Bytes in a named charset, or UTF-8 when the name is absent or not one TextDecoder knows. */
export function decodeCharset(bytes: Uint8Array, charset: string | undefined): string {
  if (charset !== undefined) {
    try {
      // `node:util`'s decoder, which is the global one, typed to take any label: the global's
      // type lists Bun's encodings, and a charset comes from a document. An unknown label
      // raises, which is the case the catch below exists for.
      return new LabelledDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
    } catch {
      // An unknown label raises RangeError. UTF-8 is the default every format here names.
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
