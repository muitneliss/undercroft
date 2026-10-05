/**
 * The globals of an Excel 97–2003 workbook: what every sheet's cells refer to. The shared
 * strings a `LABELSST` indexes, the number formats an `XF` names, the sheets and where their
 * records begin, the 1904 epoch -- and whether the workbook is encrypted from here on, which
 * ends the read. [MS-XLS] §2.1.7.20.1; `biff8.ts` reads the sheets.
 */

import { type BiffRecord, Cursor, RECORD } from "./biffRecords.ts";
import { formatCode } from "./numberFormats.ts";
import type { SheetKind, SheetState } from "./workbookPackage.ts";

/** Why a BIFF8 workbook is not read: locked, or not a stream these records can be read from. */
export type Biff8Refusal = "encrypted" | "unreadable";

/** A sheet the globals list, in tab order, and the offset of its `BOF` in the stream. */
export interface ListedSheet {
  readonly index: number;
  readonly name: string;
  readonly kind: SheetKind | null;
  readonly state: SheetState;
  readonly at: number;
}

/** What the globals say, and where each sheet's records begin. */
export interface Globals {
  readonly date1904: boolean;
  readonly shared: readonly string[];
  readonly formatOf: (xf: number) => string | null;
  readonly sheets: readonly ListedSheet[];
}

const KINDS: ReadonlyMap<number, SheetKind> = new Map([
  [0x00, "worksheet"],
  [0x01, "macrosheet"],
  [0x02, "chartsheet"],
]);
const STATES: readonly SheetState[] = ["visible", "hidden", "veryHidden"];
const VB_MODULE = 0x06;

export function readGlobals(records: readonly BiffRecord[]): Globals | Biff8Refusal {
  let date1904 = false;
  let shared: string[] = [];
  const custom = new Map<number, string>();
  const formatIds: number[] = [];
  const sheets: ListedSheet[] = [];
  for (const record of records) {
    const cursor = new Cursor(record);
    switch (record.type) {
      case RECORD.filePass:
        return "encrypted";
      case RECORD.dateMode:
        date1904 = cursor.uint16() === 1;
        break;
      case RECORD.format: {
        const id = cursor.uint16();
        custom.set(id, cursor.string());
        break;
      }
      case RECORD.xf:
        cursor.skip(2);
        formatIds.push(cursor.uint16());
        break;
      case RECORD.boundSheet: {
        const at = cursor.uint32();
        const state = STATES[cursor.byte() & 0x03] ?? "visible";
        const type = cursor.byte();
        const name = cursor.shortString();
        if (type !== VB_MODULE) {
          sheets.push({ index: sheets.length + 1, name, kind: KINDS.get(type) ?? null, state, at });
        }
        break;
      }
      case RECORD.sst: {
        cursor.skip(4);
        const unique = cursor.uint32();
        shared = Array.from({ length: unique }, () => cursor.richString());
        break;
      }
      case RECORD.eof:
        return {
          date1904,
          shared,
          formatOf: (xf) => formatCode(formatIds[xf] ?? null, custom),
          sheets,
        };
      default:
        break;
    }
  }
  return "unreadable";
}
