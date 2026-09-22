/**
 * What a Word document says, as text.
 *
 * The OOXML half of the `.docx` reader; `zip.ts` is the container half, unchanged from the
 * workbook reader because a `.docx` is the same archive of XML parts a `.xlsx` is. Its "the
 * central directory is the authority" rule matters MORE here: Word Online and server-side
 * writers commonly emit data descriptors, which leave the local header's size and method
 * fields zeroed.
 *
 * IT READS THE XML LEXICALLY, AND THAT IS THE DESIGN RATHER THAN A SHORTCUT. Turn the tags
 * that end a line into a line break, the one that ends a table cell into a separator, drop the
 * rest, decode the entities. Nothing here asks what kind of container it is inside, which is
 * the whole point -- a sibling project at this company walked the document model instead and
 * paid for it twice:
 *
 *   - a naive table-cell read OMITTED NESTED TABLES, so a questionnaire whose answers sat in a
 *     nested table extracted blank and the customer looked like they had left it empty
 *     (2026-08-04, a recorded incident);
 *   - the helper written to fix that STILL MISSES TEXT BOXES (`w:txbxContent`), so Vietnamese
 *     contracts that put the fee in a text box extract empty. That one is an open TODO in
 *     their repo today.
 *
 * Both bugs are the same bug: a structural walk visits the shapes it was taught about, and a
 * document is always allowed to nest a shape it was not. A lexical pass cannot have them,
 * because it never enumerates shapes at all -- a nested table is just more `</w:tc>` and a
 * text box is just more `</w:p>`. It is also what `xlsx.ts` already does, so it is the house
 * style rather than a new one. The tests pin both cases; break either rule below and they go
 * red.
 *
 * FOR THE SAME REASON IT OMITS NOTHING IT FINDS. Field instructions (`w:instrText`) and text
 * struck under tracked changes (`w:delText`) come through as words, which is noise in a search
 * index and is the direction to err in: the reader above records what a document says, and the
 * failure that costs a customer is the clause that silently was not there, never the extra
 * one that was. Every omission rule the sibling reader grew is where a bug came from.
 *
 * IT READS EVERY PART, NOT JUST THE BODY. Headers, footers, footnotes and endnotes are
 * separate parts of the archive, and a contract's payment terms in a footer are invisible to a
 * body-only read.
 *
 * LINE STRUCTURE SURVIVES. The same sibling repo records that collapsing whitespace destroys
 * table semantics irrecoverably, and that recovering it afterwards took a "first number within
 * 140 characters of the label" heuristic that caused most of their extraction errors.
 * `normalizeText` in `extractText.ts` exists for the PDF threshold check and is never applied
 * to stored text; nothing here flattens either.
 */

import { decodeXmlText } from "./xlsx.ts";
import { readZipIndex, readZipText } from "./zip.ts";

const BODY = "word/document.xml";

/** Cells across, parts down; the shapes mirror `xlsx.ts` so two readers' output reads alike. */
const CELL_SEPARATOR = " | ";
const PART_SEPARATOR = "\n\n";

/**
 * The parts that hold text besides the body, and where each sits in the output.
 *
 * A document has `header1.xml`..`headerN.xml` for its first page, odd and even pages; likewise
 * footers; and at most one each of `footnotes.xml` and `endnotes.xml`. They are enumerated out
 * of the index rather than guessed at by number, exactly as `worksheetNames` does, because an
 * absent `header2.xml` is ordinary and a probe for one would have to decide what a miss means.
 */
const SUPPORTING = /^word\/(?<kind>header|footer|footnotes|endnotes)(?<at>\d*)\.xml$/u;
const KIND_ORDER: readonly string[] = ["header", "footer", "footnotes", "endnotes"];

/**
 * What ends a line, what ends a cell, and what a run puts in the middle of one.
 *
 * `<w:br/>` and `<w:tab/>` are here for a reason stronger than tidiness: without them the runs
 * either side are concatenated, and "Acme" followed by "Holdings" across a break arrives as
 * the word `AcmeHoldings`, which is a token nobody wrote. Gluing two words invents a third.
 *
 * The tab pattern matches the EMPTY `<w:tab/>` only. The identically named element inside
 * `<w:tabs>` is a tab STOP -- a paragraph property carrying `w:val` and `w:pos`, never a
 * character -- and it always has attributes, so the two are told apart lexically without
 * anything here having to know what a paragraph property is.
 *
 * ORDER IS PART OF THE GRAMMAR. A cell's contents are paragraphs, so `</w:p>` always fires
 * just before the `</w:tc>` that closes it, and a cell rule that ignored the break it left
 * would put every cell of a row on a line of its own -- the row would stop being a row, which
 * is precisely the table semantics collapsing whitespace destroys. The cell pattern therefore
 * runs second and eats the breaks immediately before it. A break anywhere ELSE inside the cell
 * survives, so a cell of two paragraphs keeps both lines rather than gluing them.
 */
const BREAKS: readonly (readonly [string | RegExp, string])[] = [
  ["</w:p>", "\n"],
  ["</w:tr>", "\n"],
  [/\n*<\/w:tc>/gu, CELL_SEPARATOR],
  [/<w:br\b[^>]*>/gu, "\n"],
  [/<w:tab\s*\/>/gu, "\t"],
];

/** Everything else. What is left between tags is the text the document shows. */
const TAG = /<[^>]*>/gu;

/**
 * The separators a row leaves hanging off its end, since every cell writes one including the
 * last. A line whose own text ENDS in a pipe loses it, which is the one thing this costs and
 * is worth it: a document trailing `... | | |` off every row teaches a reader to skip the ends
 * of lines, which is where a table's last column is.
 */
const LINE_END = /[\s|]+$/u;

/**
 * One part's text.
 *
 * Empty lines are dropped and the rest kept verbatim, which is `sheetText`'s rule in
 * `xlsx.ts`: a document is mostly empty paragraphs, and a row of blank cells says nothing that
 * a blank line does not. A line with ANY content keeps its gaps, because the gaps are which
 * column a value was in.
 */
function partText(xml: string): string {
  let marked = xml;
  for (const [pattern, mark] of BREAKS) {
    marked = marked.replaceAll(pattern, mark);
  }

  // Tags first, entities second. The other order would decode `&lt;w:p&gt;` into something
  // that then looks like markup and gets stripped -- text the document quoted, deleted.
  return decodeXmlText(marked.replaceAll(TAG, ""))
    .split("\n")
    .map((line) => line.replace(LINE_END, ""))
    .filter((line) => line !== "")
    .join("\n");
}

/** The supporting parts this archive actually has, headers first and numbered parts in order. */
function supportingParts(index: ReadonlyMap<string, unknown>): string[] {
  const parts: { name: string; kind: number; at: number }[] = [];
  for (const name of index.keys()) {
    const matched = SUPPORTING.exec(name);
    if (matched === null) {
      continue;
    }
    // `footnotes.xml` carries no number, where headers and footers always do. Zero rather
    // than `NaN`, which would make the sort below decide nothing.
    const at = matched.groups?.at ?? "";
    parts.push({
      name,
      kind: KIND_ORDER.indexOf(matched.groups?.kind ?? ""),
      at: at === "" ? 0 : Number.parseInt(at, 10),
    });
  }
  return parts.sort((a, b) => a.kind - b.kind || a.at - b.at).map((part) => part.name);
}

/**
 * Read a `.docx` into text, or `null` if these bytes are not a document we can open.
 *
 * `null` covers a corrupt archive, bytes that are not a zip at all, and a zip holding no
 * `word/document.xml` -- a workbook renamed, say, or an HTML sign-in page a sync collected
 * under the wrong content type. Each is "we could not read this", which the caller records as
 * a reason; none of them is a document that says nothing, and returning `""` for them would
 * make the two one fact (`CLAUDE.md` rule 2).
 *
 * A PART THAT CANNOT BE INFLATED FAILS THE WHOLE READ, as `readXlsx` does. Returning the parts
 * that did parse would store a short document that does not say it is short, and downstream
 * that reads exactly like a complete one missing the clause somebody went looking for.
 */
export function readDocx(bytes: Uint8Array): string | null {
  const index = readZipIndex(bytes);
  const texts: string[] = [];

  for (const name of [BODY, ...supportingParts(index)]) {
    const xml = readZipText(bytes, index, name);
    if (xml === null) {
      return null;
    }
    const text = partText(xml);
    if (text !== "") {
      texts.push(text);
    }
  }

  return texts.join(PART_SEPARATOR);
}
