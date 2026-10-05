/**
 * An Excel binary workbook (`.xlsb`, BIFF12) read into the same sheets of rows an `.xlsx` gives.
 * ADR 0109, which extends ADR 0104 decision 7 to it; [MS-XLSB].
 *
 * An `.xlsb` is the `.xlsx` package with every part written as binary records instead of XML: the
 * same relationships lead from `_rels/.rels` to the workbook part and from there to each sheet,
 * the shared strings and the styles (`opcPackage.ts`), and a sheet's relationship type names its
 * kind exactly as it does in an `.xlsx`. What changes is inside each part, and that is
 * `xlsbRecords.ts`'s grammar. So this reads, in process and with no dependency for ADR 0028's
 * reason, the facts the other two readers read: the sheets in tab order with their names and
 * visibility, the 1904 epoch, the shared strings, the number format each cell format names --
 * and each sheet's cells, merged ranges, hidden rows and declared range (`xlsbSheet.ts`).
 *
 * A WORKBOOK PART THAT CANNOT BE READ TO ITS END IS NO WORKBOOK, and neither is a shared string
 * table or a styles part that breaks off: every text cell would read as a missing string, every
 * date as a bare number. The workbook is refused whole rather than read with them gone
 * (`CLAUDE.md` rule 2). A sheet that breaks off is a sheet that stopped short, with the rows
 * before it kept, as in the other readers.
 */

import { formatCode } from "./numberFormats.ts";
import { OpcPackage, type PartBytes, partOfType } from "./opcPackage.ts";
import { type SheetState, sheetKindOf } from "./workbookPackage.ts";
import { bit, Fields } from "./xlsbFields.ts";
import { BRT, recordsOf, type XlsbRecord } from "./xlsbRecords.ts";
import { type XlsbBook, scanXlsbSheet } from "./xlsbSheet.ts";
import { assembleWorkbook, type SheetSource, type WorkbookReading } from "./xlsx.ts";

/** `BrtBundleSh.hsState` (§2.5.143), by value. */
const STATES: readonly SheetState[] = ["visible", "hidden", "veryHidden"];
const VERY_HIDDEN = 2;
/** `BrtWbProp.f1904` (§2.4.866): bit 0 of its flags. */
const F1904 = 0;
/** `BrtBundleSh.iTabID`, between the state and the relationship id; the list's order is the tabs'. */
const TAB_ID_BYTES = 4;
/** `BrtXF.ixfeParent`, before the number-format id (§2.4.876). */
const PARENT_BYTES = 2;

const BOOK_RECORDS: ReadonlySet<number> = new Set([BRT.beginBook, BRT.wbProp, BRT.bundleSh]);
const SST_RECORDS: ReadonlySet<number> = new Set([BRT.sstItem]);
const STYLE_RECORDS: ReadonlySet<number> = new Set([
  BRT.fmt,
  BRT.beginCellXFs,
  BRT.xf,
  BRT.endCellXFs,
]);

/** One sheet the workbook part lists: its name, its state, and the relationship to its part. */
interface Listed {
  readonly name: string;
  readonly state: SheetState;
  readonly relationshipId: string | null;
}

interface BookFacts {
  date1904: boolean;
  readonly sheets: Listed[];
}

/**
 * Each record of `wanted` types a part holds, handed to `each` in order; `false` when the part
 * could not be read to its end exactly, or held a record shorter than its own layout.
 */
async function eachRecord(
  open: PartBytes,
  wanted: ReadonlySet<number>,
  each: (record: XlsbRecord, fields: Fields) => void,
): Promise<boolean> {
  const records = recordsOf(open(), wanted);
  try {
    let step = await records.next();
    while (step.done !== true) {
      each(step.value, new Fields(step.value.data));
      step = await records.next();
    }
    return step.value === "complete";
  } catch {
    // A field read past its record's end (`RangeError`): the record is not what it says it is.
    return false;
  } finally {
    await records.return("complete");
  }
}

/** A sheet as `BrtBundleSh` lists it (§2.4.316), or `null` for a module sheet, which holds code. */
function listedSheet(fields: Fields): Listed | null {
  const hsState = fields.uint32();
  fields.skip(TAB_ID_BYTES);
  const relationshipId = fields.nullableWideString();
  const name = fields.wideString();
  // A very hidden sheet with no part is a VBA module (§2.4.316), not a sheet of cells.
  if (relationshipId === null && hsState === VERY_HIDDEN) {
    return null;
  }
  return { name, state: STATES[hsState] ?? "visible", relationshipId };
}

/** What the workbook part says, or `null` when it is not a workbook part read to its end. */
async function readBook(open: PartBytes): Promise<BookFacts | null> {
  const facts: BookFacts = { date1904: false, sheets: [] };
  let begun: boolean | null = null;
  const read = await eachRecord(open, BOOK_RECORDS, (record, fields) => {
    // The part's first record is `BrtBeginBook`; one that does not begin so is not a workbook.
    begun ??= record.type === BRT.beginBook;
    if (record.type === BRT.wbProp) {
      facts.date1904 = bit(fields.uint32(), F1904);
    } else if (record.type === BRT.bundleSh) {
      const sheet = listedSheet(fields);
      if (sheet !== null) {
        facts.sheets.push(sheet);
      }
    }
  });
  return read && begun === true ? facts : null;
}

/** The shared string table by index (`BrtSSTItem`, §2.4.807), or `null` when it breaks off. */
async function readSharedStrings(open: PartBytes | null): Promise<string[] | null> {
  if (open === null) {
    return null;
  }
  const strings: string[] = [];
  const read = await eachRecord(open, SST_RECORDS, (_record, fields) => {
    strings.push(fields.richString());
  });
  return read ? strings : null;
}

/**
 * Cell format index → number-format code, from the styles part: the workbook's own formats
 * (`BrtFmt`) and the format id of each cell format between `BrtBeginCellXFs` and
 * `BrtEndCellXFs` -- the list a cell's `iStyleRef` indexes, not the cell-style list before it.
 */
async function readFormats(open: PartBytes | null): Promise<XlsbBook["formatOf"] | null> {
  if (open === null) {
    return null;
  }
  const custom = new Map<number, string>();
  const formatIds: number[] = [];
  let inCellFormats = false;
  const read = await eachRecord(open, STYLE_RECORDS, (record, fields) => {
    if (record.type === BRT.fmt) {
      const id = fields.uint16();
      custom.set(id, fields.wideString());
    } else if (record.type === BRT.xf) {
      if (inCellFormats) {
        fields.skip(PARENT_BYTES);
        formatIds.push(fields.uint16());
      }
    } else {
      // `BrtBeginCellXFs` opens the list a cell indexes, `BrtEndCellXFs` closes it.
      inCellFormats = record.type === BRT.beginCellXFs;
    }
  });
  return read ? (xf): string | null => formatCode(formatIds[xf] ?? null, custom) : null;
}

/** The sheets as sources: each found through the workbook's relationships, kind and part. */
function sourcesOf(
  parts: OpcPackage,
  workbookPart: string,
  sheets: readonly Listed[],
  book: XlsbBook,
): SheetSource[] {
  const relationships = parts.relationships(workbookPart);
  return sheets.map((sheet, at) => {
    const id = sheet.relationshipId;
    const relationship = id === null ? undefined : relationships.get(id);
    const kind = sheetKindOf(relationship?.type);
    const part =
      kind === null || relationship === undefined ? null : parts.bytes(relationship.part);
    return {
      index: at + 1,
      name: sheet.name,
      nameReason: null,
      kind,
      state: sheet.state,
      scan:
        part === null ? null : (): ReturnType<typeof scanXlsbSheet> => scanXlsbSheet(part, book),
    };
  });
}

/**
 * A binary workbook read into sheets of rows and their text, or `null` when it cannot be read
 * exactly: no workbook part, one that breaks off, a shared string table or styles part that is
 * declared and cannot be read whole, or no sheet readable at all.
 */
export async function readXlsb(
  bytes: Uint8Array,
  textLimit: number,
): Promise<WorkbookReading | null> {
  const parts = new OpcPackage(bytes);
  const workbookPart = parts.mainPart();
  const open = workbookPart === undefined ? null : parts.bytes(workbookPart);
  const facts = open === null ? null : await readBook(open);
  if (workbookPart === undefined || facts === null) {
    return null;
  }
  const relationships = parts.relationships(workbookPart);
  const sharedPart = partOfType(relationships, "sharedstrings");
  const stylesPart = partOfType(relationships, "styles");
  // A workbook with no shared strings keeps its text inline, and one with no styles is General
  // throughout; neither is an error. One that names a part it cannot read is.
  const shared = sharedPart === undefined ? [] : await readSharedStrings(parts.bytes(sharedPart));
  const formatOf =
    stylesPart === undefined ? (): null => null : await readFormats(parts.bytes(stylesPart));
  if (shared === null || formatOf === null) {
    return null;
  }
  const sources = sourcesOf(parts, workbookPart, facts.sheets, { shared, formatOf });
  return await assembleWorkbook(
    { container: "xlsb", date1904: facts.date1904 },
    sources,
    textLimit,
  );
}
