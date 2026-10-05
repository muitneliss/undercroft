/**
 * A workbook's shared string table, read as it inflates.
 *
 * Excel keeps every distinct text of a workbook once, in `sharedStrings.xml`, and a cell points
 * at it by index. For a large ledger that part is as large as a sheet, so it is streamed like
 * one (ADR 0106): only the strings are kept, never the XML they came in. A table that cannot be
 * read to its end is no table at all -- every text cell would read as a missing string -- so the
 * caller refuses the workbook rather than reading it with its words gone.
 */

import { decodeXmlText, PREFIX } from "./xml.ts";
import type { StreamEnd } from "./zip.ts";

const PHONETIC = new RegExp(`<${PREFIX}rPh\\b[\\s\\S]*?<\\/${PREFIX}rPh>`, "gu");
const TEXT_RUN = new RegExp(
  `<${PREFIX}t\\b[^>]*?(?:\\/>|>(?<body>[\\s\\S]*?)<\\/${PREFIX}t>)`,
  "gu",
);
const SHARED_ITEM = new RegExp(
  `<${PREFIX}si\\b[^>]*?(?:\\/>|>(?<body>[\\s\\S]*?)<\\/${PREFIX}si>)`,
  "gu",
);

/** Every `<t>` run inside one element, joined, phonetic guides excluded. */
export function stringRuns(xml: string): string {
  let text = "";
  // `<rPh>` carries furigana over characters the `<t>` runs already hold; read naively, every
  // such string would arrive doubled.
  for (const run of xml.replaceAll(PHONETIC, "").matchAll(TEXT_RUN)) {
    text += decodeXmlText(run.groups?.body ?? "");
  }
  return text;
}

/**
 * The table by index, or `null` when the part stopped short. Each piece is appended to what is
 * left of the last; every whole `<si>` in it is taken, and only the partial one at its end is
 * carried into the next.
 */
export async function readSharedStrings(
  stream: AsyncGenerator<string, StreamEnd>,
): Promise<string[] | null> {
  const strings: string[] = [];
  let buffer = "";
  let step = await stream.next();
  while (step.done !== true) {
    buffer += step.value;
    let taken = 0;
    for (const item of buffer.matchAll(SHARED_ITEM)) {
      strings.push(stringRuns(item.groups?.body ?? ""));
      taken = (item.index ?? 0) + item[0].length;
    }
    buffer = buffer.slice(taken);
    step = await stream.next();
  }
  return step.value === "complete" ? strings : null;
}
