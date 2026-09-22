/**
 * What the Word reader promises: everything the document says arrives, wherever the document
 * chose to put it, and bytes nobody can open are refused by name rather than stored as a
 * document that says nothing.
 *
 * The first two suites below are bugs somebody else already paid for. A sibling project walked
 * the document model, lost the text of nested tables in a customer questionnaire, and still
 * loses the text of text boxes today; `docx.ts` reads lexically so that neither is expressible,
 * and these are the tests that hold it there. Break either rule in `BREAKS` and they go red --
 * which is the only evidence that they are tests and not decoration.
 *
 * No mocks and no committed binary fixture: `zipOf` builds a real archive, shared with the
 * `.xlsx` suite. Fixtures are invented per `pii.md`, and Vietnamese is a first-class case
 * because 17% of the corpus carries it.
 */

import { describe, expect, test as it } from "bun:test";
import type { Spawn } from "../transform.ts";
import { readDocx } from "./docx.ts";
import { DOCX_UNREADABLE, type Extracted, extractDocument } from "./extractText.ts";
import { type ZipMember, zipOf } from "./testing.ts";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const utf8 = new TextEncoder();

function run(text: string): string {
  return `<w:r><w:t>${text}</w:t></w:r>`;
}

function paragraph(text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${run(text)}</w:p>`;
}

function cell(inner: string): string {
  return `<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>${inner}</w:tc>`;
}

function row(cells: readonly string[]): string {
  return `<w:tr>${cells.join("")}</w:tr>`;
}

function table(rows: readonly string[]): string {
  return `<w:tbl>${rows.join("")}</w:tbl>`;
}

function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="urn:w"><w:body>${body}</w:body></w:document>`;
}

/** A `.docx` holding this body, plus whatever other parts a case needs. */
function docx(body: string, extra: readonly ZipMember[] = []): Uint8Array {
  return zipOf([
    { name: "[Content_Types].xml", body: "<Types/>", stored: true },
    { name: "word/document.xml", body: documentXml(body) },
    ...extra,
  ]);
}

/** The invoice table an ordinary letter carries: two columns, all of it at one level. */
const FLAT_TABLE = table([
  row([cell(paragraph("Khách hàng")), cell(paragraph("Acme Holdings"))]),
  row([cell(paragraph("Tiền thanh toán")), cell(paragraph("1.000.000"))]),
]);

/**
 * The 2026-08-04 shape: a questionnaire whose answer sits in a table INSIDE a cell of the
 * table that asked the question. The sibling reader returned the question and not the answer,
 * so the customer looked like they had left it blank.
 */
const NESTED_TABLE = table([
  row([
    cell(paragraph("Câu hỏi 2: đã ký chưa?")),
    cell(table([row([cell(paragraph("Đã ký ngày 12 tháng 3"))])])),
  ]),
]);

/** The one still open in their repo: a Vietnamese contract that puts the fee in a text box. */
const TEXT_BOX =
  "<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>" +
  paragraph("Phí dịch vụ: 5.000.000 VND") +
  "</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>";

const HEADER: ZipMember = {
  name: "word/header1.xml",
  body: `<w:hdr xmlns:w="urn:w">${paragraph("Acme Holdings — hợp đồng dịch vụ")}</w:hdr>`,
};
const FOOTER: ZipMember = {
  name: "word/footer1.xml",
  body: `<w:ftr xmlns:w="urn:w">${paragraph("Thanh toán trong 30 ngày kể từ ngày nhận hoá đơn")}</w:ftr>`,
};
const FOOTNOTES: ZipMember = {
  name: "word/footnotes.xml",
  body: `<w:footnotes xmlns:w="urn:w">${paragraph("Chưa bao gồm thuế GTGT")}</w:footnotes>`,
};

/** Must never fire: every reader in this suite works in process. */
const spawnNothing: Spawn = () => Promise.reject(new Error("no binary should be spawned"));

function extract(bytes: Uint8Array, contentType = DOCX_TYPE): Promise<Extracted> {
  return extractDocument(
    { spawn: spawnNothing, workDir: "/tmp/docx-test" },
    { contentType, bytes, path: "/tmp/docx-test/doc" },
  );
}

describe("a document's tables", () => {
  it("give up the text of a table nested inside a cell", () => {
    // The recorded incident. A structural walk reads the cell it knows about and stops; this
    // reader never asks what a cell contains, so the answer comes out with the question.
    const text = readDocx(docx(NESTED_TABLE)) ?? "";

    expect(text).toContain("Câu hỏi 2: đã ký chưa?");
    expect(text).toContain("Đã ký ngày 12 tháng 3");
    // And beside its question rather than adrift: an answer on a line of its own is an answer
    // nobody can tell belongs to that row.
    expect(text).toContain("Câu hỏi 2: đã ký chưa? | Đã ký ngày 12 tháng 3");
  });

  it("still read a flat table, cells across and rows down", () => {
    // The quiet half: a reader that only ever concatenated everything would pass the test
    // above and destroy the ordinary case. The separator is what says which column a value
    // was in, and `.claude/rules/money.md`'s amount is copied through as the file wrote it.
    const text = readDocx(docx(FLAT_TABLE)) ?? "";

    expect(text).toContain("Khách hàng | Acme Holdings");
    expect(text).toContain("Tiền thanh toán | 1.000.000");
  });
});

describe("text the document did not put in a paragraph of its body", () => {
  it("includes a text box, which is where a contract's fee hides", () => {
    // Still open in the sibling repo: their helper visits paragraphs, tables and cells, and a
    // `w:txbxContent` is none of those, so the fee extracts as an empty document.
    const text = readDocx(docx(TEXT_BOX + paragraph("Điều 1. Phạm vi công việc"))) ?? "";

    expect(text).toContain("Phí dịch vụ: 5.000.000 VND");
    expect(text).toContain("Điều 1. Phạm vi công việc");
  });

  it("adds nothing to a document that has no text box", () => {
    // The quiet half. A reader cannot earn the test above by inventing text.
    const text = readDocx(docx(paragraph("Điều 1. Phạm vi công việc"))) ?? "";

    expect(text).toBe("Điều 1. Phạm vi công việc");
  });
});

describe("the parts beside the body", () => {
  it("are read too, so a payment term in a footer is not invisible", () => {
    // A body-only read is the failure this pins: the clause that decides when we get paid is
    // routinely in the footer, and it would have been absent without a word about it.
    const text = readDocx(docx(paragraph("Điều 1."), [HEADER, FOOTER, FOOTNOTES])) ?? "";

    expect(text).toContain("Acme Holdings — hợp đồng dịch vụ");
    expect(text).toContain("Thanh toán trong 30 ngày kể từ ngày nhận hoá đơn");
    expect(text).toContain("Chưa bao gồm thuế GTGT");
  });

  it("are optional: a document with none of them reads its body", () => {
    // The quiet half -- enumerating the index rather than probing for `header1.xml` is what
    // makes an absent part ordinary instead of a miss somebody has to interpret.
    expect(readDocx(docx(paragraph("Điều 1.")))).toBe("Điều 1.");
  });

  it("fail the WHOLE read when one of them cannot be inflated", () => {
    // `readXlsx`'s rule, for the same reason: handing back the parts that did parse stores a
    // short document that does not say it is short, and that reads downstream exactly like a
    // complete one missing the clause somebody went looking for.
    const bytes = docx(paragraph("Điều 1."), [{ ...FOOTER, corrupt: true }]);

    expect(readDocx(bytes)).toBeNull();
  });
});

describe("the shape of the text that comes out", () => {
  it("survives a self-closing run without swallowing what surrounds it", () => {
    // `<w:t/>` is legal and a reader that pair-matched `<w:t>...</w:t>` would match from the
    // run before it to the run after, eating both. The same alternation `xlsx.ts` documents.
    const text =
      readDocx(docx(`<w:p>${run("Trước")}<w:r><w:t/></w:r>${run(" và sau")}</w:p>`)) ?? "";

    expect(text).toContain("Trước");
    expect(text).toContain("và sau");
  });

  it("keeps a line break as a break, so two words are never glued into a third", () => {
    // Gluing invents a token nobody wrote: without this, `Acme Holdings` across a break
    // arrives as `AcmeHoldings` and no search for either finds it.
    const text = readDocx(docx(`<w:p>${run("Acme")}<w:r><w:br/></w:r>${run("Holdings")}</w:p>`));

    expect(text).toBe("Acme\nHoldings");
  });

  it("leaves a tab STOP out of the text, being a property rather than a character", () => {
    // The quiet half of the tab rule. `<w:tab w:val="left" w:pos="360"/>` inside `<w:tabs>`
    // defines where a tab lands; only the bare `<w:tab/>` in a run is one.
    const stops = '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="360"/></w:tabs></w:pPr>';

    expect(readDocx(docx(`${stops}${run("Điều 1.")}</w:p>`))).toBe("Điều 1.");
    expect(readDocx(docx(`<w:p>${run("Tổng")}<w:r><w:tab/></w:r>${run("1.000.000")}</w:p>`))).toBe(
      "Tổng\t1.000.000",
    );
  });

  it("decodes the entities the document wrote, and only those", () => {
    expect(readDocx(docx(paragraph("Ghi chú &amp; điều khoản")))).toBe("Ghi chú & điều khoản");
  });
});

describe("bytes that are not a document we can open", () => {
  it("are refused by name, never stored as a document that says nothing", () => {
    // CLAUDE.md rule 2 in one assertion: `""` here is indistinguishable downstream from a
    // genuinely blank document, and one of those is a fact and the other is a failure.
    const notAZip = readDocx(utf8.encode("<html>Sign in to continue</html>"));

    expect(notAZip).toBeNull();
    expect(notAZip).not.toBe("");
  });

  it("include an archive whose end has been cut off", () => {
    const whole = docx(paragraph("Điều 1."));

    expect(readDocx(whole.subarray(0, whole.byteLength - 8))).toBeNull();
  });

  it("include a zip holding no document part at all, such as a workbook renamed", () => {
    expect(
      readDocx(zipOf([{ name: "xl/worksheets/sheet1.xml", body: "<worksheet/>" }])),
    ).toBeNull();
  });

  it("stay quiet for a document that IS readable", () => {
    // A rule with only its firing case is satisfied by code that always refuses (`tests.md`).
    expect(readDocx(docx(paragraph("Điều 1.")))).not.toBeNull();
  });
});

describe("the extract dispatch", () => {
  it("reads a document in process, spawning no binary", async () => {
    const result = await extract(docx(FLAT_TABLE, [FOOTER]));

    expect(result.method).toBe("docx");
    expect(result.reason).toBeNull();
    expect(result.text).toContain("Acme Holdings");
    expect(result.text).toContain("Thanh toán trong 30 ngày");
  });

  it("refuses an unopenable document with its own reason", async () => {
    const result = await extract(utf8.encode("not a zip"));

    expect(result.method).toBeNull();
    expect(result.reason).toBe(DOCX_UNREADABLE);
    expect(result.text).toBe("");
  });
});
