/**
 * Thirteen documents we wrote, and exactly what each one says.
 *
 * THE POINT OF AUTHORING THEM HERE IS THAT THE SUITES CANNOT DO THIS JOB. `docx.test.ts`,
 * `xlsx.test.ts` and `ocr.test.ts` were written WHILE those readers were being built, against
 * the shapes the author had in mind, and the sibling project's second law is about precisely
 * that: a sample you tuned on is burnt, and its score is an upper bound rather than an
 * estimate. They measured 100% on their tuned sample and 85% on a held-out one with the same
 * code. So these are different documents, with different content, and every `expected` string
 * below was written from the document's own markup before any reader was run against it.
 *
 * THEY ARE INVENTED, NOT ANONYMISED (`pii.md`). `Acme Holdings Pte Ltd`, `CASE`-shaped ids and
 * invented Vietnamese company names; nothing here is derived from a real customer's file, and
 * an anonymised one would have kept the shapes, amounts and dates that re-identify.
 *
 * WHAT `expected` IS, EXACTLY: the text the document shows, in the order a reader emits its
 * parts, with no separators of its own. `docx.ts` writes ` | ` between table cells and a blank
 * line between parts, and scoring those would be measuring a convention rather than a
 * document -- `align` collapses whitespace and counts a separator as an insertion, so a
 * correct table read keeps every authored character and adds a handful. What the ordering
 * convention is NOT is a claim these cases test: a part emitted in a different order would
 * score badly here for something no customer would notice, and what the multi-part case is
 * actually for is that no part is DROPPED.
 *
 * WHAT IS DELIBERATELY ABSENT. No Vietnamese OCR case, and the reason is a measurement rather
 * than an omission: a gold page can only be rendered in the fonts poppler substitutes for the
 * base-14 set, none of which holds a Vietnamese glyph. `pdftotext` reads `Hợp đồng` out of
 * `pdfOf`'s output exactly and the same file rasterised loses the accents entirely, so a score
 * from it would be measuring the fixture's font. `accuracy.ts`'s `UNMEASURED` says so, and
 * that gap is the one that matters most -- OCR without the language pack does not produce
 * garbage, it produces clean confident English words that were never on the page.
 *
 * Nor is there a second plain-text case: `text/csv`, `text/plain` and
 * `text/tab-separated-values` are one reader, and which types reach it is pinned by
 * `extractText.test.ts`. A redundant case is a defect (`tests.md`).
 */

import { extractDocument } from "./extractText.ts";
import type { Extracted } from "./extractText.ts";
import { ocrScan } from "./ocr.ts";
import { pdfOf, zipOf } from "./testing.ts";
import type { GoldCase, GoldDocument } from "./accuracy.ts";
import type { ExtractDeps } from "./program.ts";

const utf8 = new TextEncoder();

/** The ordinary door: the content type the catalogue would carry, through the shipped table. */
function viaContentType(
  contentType: string,
): (deps: ExtractDeps, document: GoldDocument) => Promise<Extracted> {
  return (deps, document) => extractDocument(deps, { ...document, contentType });
}

/**
 * A `.docx` is these parts and nothing else a reader needs.
 *
 * Stored rather than deflated for the supporting parts and deflated for the body, so one
 * fixture exercises both compression methods the wild actually contains.
 */
function docxOf(parts: Readonly<Record<string, string>>): Uint8Array {
  return zipOf(
    Object.entries(parts).map(([name, body]) => ({
      name,
      body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`,
      stored: name !== "word/document.xml",
    })),
  );
}

function wordBody(inner: string): string {
  return `<w:document xmlns:w="x"><w:body>${inner}</w:body></w:document>`;
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function cell(text: string): string {
  return `<w:tc>${paragraph(text)}</w:tc>`;
}

function nestedCell(inner: string): string {
  return `<w:tc>${inner}</w:tc>`;
}

function rowOf(...cells: readonly string[]): string {
  return `<w:tr>${cells.join("")}</w:tr>`;
}

/**
 * A workbook is a shared string table and some sheets.
 *
 * The sheets carry their own numbers and go into the archive in the order given, which is what
 * lets a case put `sheet10.xml` before `sheet1.xml` on the wire: a reader that sorted its
 * parts lexicographically would then read them in the wrong order, and a fixture that handed
 * them over already sorted could never say so.
 */
interface GoldSheet {
  readonly at: number;
  readonly rows: string;
}

function xlsxOf(shared: readonly string[], sheets: readonly GoldSheet[]): Uint8Array {
  return zipOf([
    {
      name: "xl/sharedStrings.xml",
      body: `<sst xmlns="x" count="${String(shared.length)}" uniqueCount="${String(shared.length)}">${shared.map((item) => `<si>${item}</si>`).join("")}</sst>`,
    },
    ...sheets.map((sheet) => ({
      name: `xl/worksheets/sheet${String(sheet.at)}.xml`,
      body: `<worksheet xmlns="x"><sheetData>${sheet.rows}</sheetData></worksheet>`,
    })),
  ]);
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * A fee schedule whose middle row holds a whole table of its own.
 *
 * The recorded incident this is for: a sibling reader walked the document model, visited the
 * cells it knew about, and extracted a questionnaire's nested answers as blank -- so the
 * customer looked like they had left it empty. Nothing about the failure was visible in the
 * output, which is why it wants a fidelity number and not a smoke test.
 */
const NESTED_TABLE: GoldCase = {
  id: "docx-nested-table",
  feature: "a table cell holding another table",
  bytes: docxOf({
    "word/document.xml": wordBody(
      paragraph("Schedule of Fees") +
        "<w:tbl>" +
        rowOf(cell("Service"), cell("Amount")) +
        rowOf(
          cell("Incorporation"),
          nestedCell(
            "<w:tbl>" +
              rowOf(cell("Name reservation"), cell("15.00")) +
              rowOf(cell("ACRA filing"), cell("300.00")) +
              "</w:tbl>",
          ),
        ) +
        rowOf(cell("Total"), cell("315.00")) +
        "</w:tbl>",
    ),
  }),
  expected:
    "Schedule of Fees Service Amount Incorporation Name reservation 15.00 ACRA filing 300.00 Total 315.00",
  read: viaContentType(DOCX),
};

/**
 * The fee in a text box, which is where a Vietnamese contract usually puts it.
 *
 * Still an open TODO in the sibling project's own repo: their structural walk reaches cells
 * and not `w:txbxContent`, so a contract's only statement of the amount extracts as nothing.
 */
const TEXT_BOX: GoldCase = {
  id: "docx-text-box",
  feature: "a floating text box (w:txbxContent)",
  bytes: docxOf({
    "word/document.xml": wordBody(
      paragraph("Notice of Engagement") +
        `<w:p><w:r><mc:AlternateContent xmlns:mc="x"><mc:Choice Requires="wps"><w:drawing><wps:txbx xmlns:wps="x"><w:txbxContent>${paragraph("Fee payable 2,400.00 SGD")}</w:txbxContent></wps:txbx></w:drawing></mc:Choice></mc:AlternateContent></w:r></w:p>` +
        paragraph("Signed for Acme Holdings Pte Ltd"),
    ),
  }),
  expected: "Notice of Engagement Fee payable 2,400.00 SGD Signed for Acme Holdings Pte Ltd",
  read: viaContentType(DOCX),
};

/** Payment terms in the footer, which a body-only read never sees. */
const SUPPORTING_PARTS: GoldCase = {
  id: "docx-parts",
  feature: "header, footer and footnote parts beside the body",
  bytes: docxOf({
    "word/document.xml": wordBody(
      paragraph("Master Services Agreement") + paragraph("The parties agree as set out below."),
    ),
    "word/header1.xml": `<w:hdr xmlns:w="x">${paragraph("Acme Holdings Pte Ltd Confidential")}</w:hdr>`,
    "word/footer1.xml": `<w:ftr xmlns:w="x">${paragraph("Payment terms net thirty days")}</w:ftr>`,
    "word/footnotes.xml": `<w:footnotes xmlns:w="x">${paragraph("Rates are reviewed each January.")}</w:footnotes>`,
  }),
  expected:
    "Master Services Agreement The parties agree as set out below. Acme Holdings Pte Ltd Confidential Payment terms net thirty days Rates are reviewed each January.",
  read: viaContentType(DOCX),
};

/**
 * Vietnamese, an entity, a tab and a line break in one document.
 *
 * The break and the tab are here because without them the runs either side are concatenated
 * and `Khách hàng` followed by `Acme` arrives as one token nobody wrote -- gluing two words
 * invents a third, which is the same category of error as inventing a number.
 */
const VIETNAMESE_WORD: GoldCase = {
  id: "docx-vietnamese",
  feature: "Vietnamese diacritics, an XML entity, a tab and a break",
  bytes: docxOf({
    "word/document.xml": wordBody(
      paragraph("Hợp đồng dịch vụ kế toán") +
        "<w:p><w:r><w:t>Khách hàng</w:t><w:tab/><w:t>Acme Holdings Pte Ltd</w:t></w:r></w:p>" +
        "<w:p><w:r><w:t>Phí dịch vụ 2.400.000 VND</w:t><w:br/><w:t>Thời hạn ba mươi ngày</w:t></w:r></w:p>" +
        paragraph("Điều khoản &amp; điều kiện"),
    ),
  }),
  expected:
    "Hợp đồng dịch vụ kế toán Khách hàng Acme Holdings Pte Ltd Phí dịch vụ 2.400.000 VND Thời hạn ba mươi ngày Điều khoản & điều kiện",
  read: viaContentType(DOCX),
};

/**
 * A workbook with every cell shape that changes the answer.
 *
 * The empty row and the empty cell are the ones worth stating: a pattern that only matched a
 * filled `<c>` slides a row's columns left, so the amount ends up under the wrong heading --
 * a wrong value, not a missing one. The phonetic run is here because a naive collection
 * doubles the string it annotates, and a doubled value is invented text.
 */
const WORKBOOK: GoldCase = {
  id: "xlsx-cells",
  feature: "shared, inline and numeric cells, an empty row, a gap, a phonetic run",
  bytes: xlsxOf(
    [
      "<t>Client</t>",
      "<t>Amount</t>",
      "<t>Acme Holdings Pte Ltd</t>",
      '<t>Tokyo branch</t><rPh sb="0" eb="5"><t>とうきょう</t></rPh>',
      "<t>Notes</t>",
    ],
    [
      {
        at: 1,
        rows:
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1234.1000</v></c></row>' +
          '<row r="3"/>' +
          '<row r="4"><c r="A4"/><c r="B4" t="inlineStr"><is><t>paid in full</t></is></c></row>',
      },
      {
        at: 2,
        rows:
          '<row r="1"><c r="A1" t="s"><v>3</v></c><c r="B1" t="s"><v>4</v></c></row>' +
          '<row r="2"><c r="A2"><v>46286</v></c></row>',
      },
    ],
  ),
  expected: "Client Amount Acme Holdings Pte Ltd 1234.1000 paid in full Tokyo branch Notes 46286",
  read: viaContentType(XLSX),
};

/** The same reader over Vietnamese, since a workbook is the likeliest place an amount sits. */
const VIETNAMESE_WORKBOOK: GoldCase = {
  id: "xlsx-vietnamese",
  feature: "Vietnamese shared strings beside an unformatted amount",
  bytes: xlsxOf(
    ["<t>Hóa đơn</t>", "<t>Khách hàng</t>", "<t>Công ty Acme</t>", "<t>Thành tiền</t>"],
    [
      {
        at: 1,
        rows:
          '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c></row>' +
          '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>2400000</v></c></row>',
      },
    ],
  ),
  expected: "Hóa đơn Khách hàng Công ty Acme Thành tiền 2400000",
  read: viaContentType(XLSX),
};

/**
 * Runs split mid-word, a numeric entity, a table in the header, and an endnote.
 *
 * THE ONE CASE HERE THAT IS NOT A FEATURE ANYBODY BUILT FOR. Word splits a run wherever a
 * spell-check mark or a revision id lands, so `Acme Hold` and `ings Pte Ltd` in adjacent runs
 * is the ordinary shape of a real document and not a contrived one -- a reader that put
 * anything at all between runs would return the company name as two tokens nobody wrote. The
 * suites do not ask this, the header-table nesting, or `&#8217;`, which is why they are here.
 */
const SPLIT_RUNS: GoldCase = {
  id: "docx-split-runs",
  feature: "runs split mid-word, a numeric entity, a table inside a header, an endnote",
  bytes: docxOf({
    "word/document.xml": wordBody(
      "<w:p><w:r><w:t>Acme Hold</w:t><w:t>ings Pte Ltd</w:t></w:r></w:p>" +
        paragraph("Director&#8217;s resolution") +
        paragraph("Dated 14 March 2026"),
    ),
    "word/header1.xml": `<w:hdr xmlns:w="x"><w:tbl>${rowOf(cell("Ref"), cell("CASE-0042"))}</w:tbl></w:hdr>`,
    "word/endnotes.xml": `<w:endnotes xmlns:w="x">${paragraph("Filed with ACRA on 20 March 2026.")}</w:endnotes>`,
  }),
  expected:
    "Acme Holdings Pte Ltd Director’s resolution Dated 14 March 2026 Ref CASE-0042 Filed with ACRA on 20 March 2026.",
  read: viaContentType(DOCX),
};

/**
 * Sheets out of order on the wire, a formula's cached string, and a boolean.
 *
 * `sheet10.xml` is written into the archive FIRST. A reader ordering its parts the way a
 * directory listing does would put it before `sheet1`, so the balance would land above the
 * heading it belongs under -- which reads as data rather than as a bug. The cached formula
 * result and the boolean are both cells whose `t` attribute the suites never exercise.
 */
const SHEET_ORDER: GoldCase = {
  id: "xlsx-sheet-order",
  feature: "sheet10 before sheet1 on the wire, a cached formula string, a boolean cell",
  bytes: xlsxOf(
    ["<t>Ref</t>", "<t>Status</t>", "<t>Balance</t>"],
    [
      {
        at: 10,
        rows: '<row r="1"><c r="A1" t="s"><v>2</v></c><c r="B1"><v>9876.5400</v></c></row>',
      },
      { at: 1, rows: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' },
      {
        at: 2,
        rows:
          '<row r="1"><c r="A1" t="str"><f>CONCAT(X)</f><v>CASE-0042</v></c>' +
          '<c r="B1" t="b"><v>1</v></c></row>',
      },
    ],
  ),
  expected: "Ref Status CASE-0042 1 Balance 9876.5400",
  read: viaContentType(XLSX),
};

const CSV_TEXT = [
  "Khách hàng,Dịch vụ,Thành tiền",
  'Công ty Acme,"Kế toán, thuế",2400000',
  "Xưởng Bình Minh,Lập báo cáo,1150000",
].join("\n");

/** A delimited file is text, so what this measures is that the decode leaves it alone. */
const CSV: GoldCase = {
  id: "csv-vietnamese",
  feature: "UTF-8 Vietnamese through the plain-text reader",
  bytes: utf8.encode(CSV_TEXT),
  expected: CSV_TEXT,
  read: viaContentType("text/csv"),
};

const INVOICE_PAGES: readonly (readonly string[])[] = [
  [
    "Acme Holdings Pte Ltd",
    "Invoice ACME-0042",
    "Services rendered March 2026",
    "Total due 1,234.10 SGD",
  ],
  ["Payment terms net thirty days", "Remit to account 000-123456-001"],
];

/** Poppler's text layer over two pages, which is how most PDFs in the lake are read. */
const PDF_TEXT: GoldCase = {
  id: "pdf-text-ascii",
  feature: "a two-page text layer read by pdftotext",
  bytes: pdfOf(INVOICE_PAGES),
  expected: INVOICE_PAGES.flat().join(" "),
  read: viaContentType("application/pdf"),
};

const VIETNAMESE_PDF_LINES: readonly string[] = [
  "Hợp đồng dịch vụ kế toán",
  "Khách hàng Công ty Acme",
  "Phí dịch vụ 2.400.000 VND",
  "Thời hạn thanh toán ba mươi ngày",
];

/**
 * Vietnamese through the text layer, which is the one path that can carry it here.
 *
 * Comfortably over `TEXT_LAYER_MIN_CHARS` on purpose: a shorter page would be routed to OCR
 * and this case would silently stop testing what it names.
 */
const VIETNAMESE_PDF: GoldCase = {
  id: "pdf-text-vietnamese",
  feature: "Vietnamese diacritics surviving the PDF text layer",
  bytes: pdfOf([VIETNAMESE_PDF_LINES]),
  expected: VIETNAMESE_PDF_LINES.join(" "),
  read: viaContentType("application/pdf"),
};

const STATEMENT_PAGES: readonly (readonly string[])[] = [
  ["Acme Holdings Pte Ltd", "Statement of Account", "Balance brought forward 4,500.00"],
  ["Invoice ACME-0043 1,200.00", "Balance carried forward 5,700.00"],
];

/**
 * Two pages rasterised at the shipped DPI and read by tesseract.
 *
 * IT NAMES `ocrScan` RATHER THAN GOING THROUGH THE DISPATCH TABLE, and that is forced rather
 * than chosen: a PDF whose pages carry real glyphs carries a text layer too, so
 * `extractDocument` would route it to `pdf_text` and OCR would never run. Which documents get
 * routed to a scan is `extractText.test.ts`'s question; this one is about what the scanned
 * reader produces once it is reached.
 *
 * A machine without poppler or tesseract reports this UNMEASURED rather than zero, which is
 * every machine the offline gate runs on.
 */
const PDF_SCAN: GoldCase = {
  id: "pdf-ocr-ascii",
  feature: "a two-page render at 150 DPI read by tesseract",
  bytes: pdfOf(STATEMENT_PAGES),
  expected: STATEMENT_PAGES.flat().join(" "),
  read: async (deps, document): Promise<Extracted> => {
    const scan = await ocrScan(deps, document.path);
    return scan.ok
      ? { method: "pdf_ocr", reason: null, text: scan.text, truncated: scan.truncated }
      : { method: null, reason: scan.reason, text: "", truncated: false };
  },
};

const SMALL_PRINT: readonly string[] = [
  "Acme Holdings Pte Ltd",
  "Invoice ACME-0044",
  "Consultancy fee 3,750.00 SGD",
  "Payment due 30 April 2026",
];

/**
 * The same OCR path at the size a real invoice is actually set in.
 *
 * Point size is the variable OCR is most sensitive to, and 14pt is generous to the point of
 * flattering. Ten is ordinary body text on a statement, so this is where the reader's real
 * margin shows -- and if the two cases ever diverge, the DPI in `pdfPages.ts` is the knob that
 * argument is about.
 */
const PDF_SCAN_SMALL: GoldCase = {
  id: "pdf-ocr-small-print",
  feature: "a 10pt render at 150 DPI read by tesseract",
  bytes: pdfOf([SMALL_PRINT], { pointSize: 10 }),
  expected: SMALL_PRINT.join(" "),
  read: PDF_SCAN.read,
};

export const GOLD_SET: readonly GoldCase[] = [
  NESTED_TABLE,
  TEXT_BOX,
  SUPPORTING_PARTS,
  VIETNAMESE_WORD,
  SPLIT_RUNS,
  WORKBOOK,
  VIETNAMESE_WORKBOOK,
  SHEET_ORDER,
  CSV,
  PDF_TEXT,
  VIETNAMESE_PDF,
  PDF_SCAN,
  PDF_SCAN_SMALL,
];
