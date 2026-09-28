/**
 * The offline half of the Xero → lake check: reading the exports, reading the lake's payloads,
 * matching the two and comparing them. Everything is built in memory from invented documents;
 * no file, no network, no credential, no mock.
 *
 * All names, numbers and amounts are invented.
 */

import { describe, expect, test as it } from "bun:test";
import { getStringPath, parseLossless } from "@undercroft/core";
import { parseCsv } from "./csv.ts";
import { type Cli, lakeRows, lastRunStart } from "./lakeCli.ts";
import { compareContact, compareDocument, matchDocuments } from "./xeroCompare.ts";
import { NO_AMOUNT } from "./normalise.ts";
import { contactsExport, type ExportedDocument, invoiceExport } from "./xeroExport.ts";
import { type LakeDocument, lakeContact, lakeDocument } from "./xeroLake.ts";

const INVOICE_HEADER = [
  "ContactName",
  "InvoiceNumber",
  "Reference",
  "InvoiceDate",
  "DueDate",
  "Total",
  "TaxTotal",
  "InvoiceAmountPaid",
  "InvoiceAmountDue",
  "Description",
  "Quantity",
  "UnitAmount",
  "LineAmount",
  "AccountCode",
  "TaxType",
  "TaxAmount",
  "Currency",
  "Type",
  "Status",
] as const;

type Column = (typeof INVOICE_HEADER)[number];

/** One export row: a bill for Acme with one line, unless `changes` says otherwise. */
function billRow(changes: Partial<Record<Column, string>> = {}): Record<Column, string> {
  return {
    ContactName: "Acme Supplies",
    InvoiceNumber: "B-100",
    Reference: "PO 7",
    InvoiceDate: "5/03/2026",
    DueDate: "04/04/2026",
    Total: "11.2400",
    TaxTotal: "0.0000",
    InvoiceAmountPaid: "11.2400",
    InvoiceAmountDue: "0.0000",
    Description: "Paper",
    Quantity: "50.0000",
    UnitAmount: "0.2248",
    LineAmount: "11.2400",
    AccountCode: "429a",
    TaxType: "No Tax",
    TaxAmount: "0.0000",
    Currency: "SGD",
    Type: "Bill",
    Status: "Paid",
    ...changes,
  };
}

function quote(cell: string): string {
  return /[",\n]/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

function exportText(rows: readonly Record<Column, string>[]): string {
  return [
    INVOICE_HEADER.join(","),
    ...rows.map((row) => INVOICE_HEADER.map((column) => quote(row[column])).join(",")),
  ].join("\r\n");
}

/** A bill's payload as the lake keeps it: the JSON text Xero sent, read losslessly. */
function billPayload(changes: Record<string, unknown> = {}, line: Record<string, unknown> = {}) {
  return parseLossless(
    JSON.stringify({
      Type: "ACCPAY",
      InvoiceID: "inv-1",
      InvoiceNumber: "B-100",
      Reference: "PO 7",
      Status: "PAID",
      Contact: { Name: "Acme Supplies" },
      Date: "/Date(1772668800000+0000)/",
      DueDate: "/Date(1775260800000+0000)/",
      UpdatedDateUTC: "/Date(1772700000000+0000)/",
      CurrencyCode: "SGD",
      LineAmountTypes: "Exclusive",
      Total: "@11.24",
      TotalTax: "@0",
      AmountPaid: "@11.24",
      AmountDue: "@0",
      LineItems: [
        {
          Description: "Paper",
          Quantity: "@50",
          UnitAmount: "@0.2248",
          LineAmount: "@11.24",
          AccountCode: "429A",
          TaxType: "NONE",
          TaxAmount: "@0",
          ...line,
        },
      ],
      ...changes,
    }).replaceAll(/"@(?<digits>-?[\d.]+)"/gu, "$<digits>"),
  );
}

function lakeBill(changes: Record<string, unknown> = {}, line: Record<string, unknown> = {}) {
  const document = lakeDocument(billPayload(changes, line), "invoices");
  if (document === null) {
    throw new Error("the invented bill is not a document the export lists");
  }
  return document;
}

function onlyExported(rows: readonly Record<Column, string>[]): ExportedDocument {
  const [document] = invoiceExport(exportText(rows), "bills.csv");
  if (document === undefined) {
    throw new Error("the invented export holds no document");
  }
  return document;
}

describe("parseCsv", () => {
  it("reads quoted commas, doubled quotes, line breaks, CRLF and a leading BOM", () => {
    const text = '\uFEFFa,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "two\nlines"],
    ]);
  });

  it("keeps a quote in the middle of an unquoted field as text", () => {
    expect(parseCsv('ref "7" here,b')).toEqual([['ref "7" here', "b"]]);
  });
});

describe("invoiceExport", () => {
  it("makes one document of the rows that repeat its header, one per line", () => {
    const documents = invoiceExport(
      exportText([billRow(), billRow({ Description: "Ink", UnitAmount: "0.0000", Quantity: "1" })]),
      "bills.csv",
    );
    expect(documents).toHaveLength(1);
    expect(documents[0]?.lines).toHaveLength(2);
    expect(documents[0]?.fields).toMatchObject({
      status: "PAID",
      date: "2026-03-05",
      dueDate: "2026-04-04",
      total: "11.2400",
    });
    expect(documents[0]?.row).toBe(2);
  });

  it("turns a credit note's negative amounts positive, as Xero keeps them", () => {
    const [note] = invoiceExport(
      exportText([
        billRow({
          Type: "Bill credit note",
          Total: "-5.0000",
          LineAmount: "-5.0000",
          UnitAmount: "-5.0000",
          Quantity: "1.0000",
          InvoiceAmountDue: "-5.0000",
          InvoiceAmountPaid: "",
        }),
      ]),
      "bills.csv",
    );
    expect(note?.fields).toMatchObject({ total: "5.0000", remaining: "5.0000" });
    expect(note?.lines[0]).toMatchObject({ amount: "5.0000", unit: "5.0000" });
  });

  it("refuses a file without the columns it compares, and an unknown document type", () => {
    expect(() => invoiceExport("ContactName,Total\r\nAcme,1", "odd.csv")).toThrow(
      "no column InvoiceNumber",
    );
    expect(() => invoiceExport(exportText([billRow({ Type: "Receipt" })]), "odd.csv")).toThrow(
      'unknown document type "Receipt"',
    );
  });
});

describe("lakeDocument", () => {
  it("reads each amount as the digits Xero sent, never through a float", () => {
    // A double holds about 16 significant digits; this total has 19 and would come back changed.
    expect(lakeBill({ Total: "@12345678901234567.89" }).fields.total).toBe(
      "12345678901234567.8900",
    );
    expect(lakeBill().lines[0]).toMatchObject({ unit: "0.2248", amount: "11.2400" });
  });

  it("writes an absent amount as absent, not as zero", () => {
    expect(lakeBill({ AmountDue: null }).fields.amountDue).toBe(NO_AMOUNT);
  });

  it("returns nothing for a type the export never lists", () => {
    expect(lakeDocument(billPayload({ Type: "SPEND" }), "invoices")).toBeNull();
  });
});

describe("compareDocument", () => {
  it("passes a bill the lake holds with the same header and lines", () => {
    expect(compareDocument(onlyExported([billRow()]), [lakeBill()])).toEqual({ kind: "same" });
  });

  it("names a unit price the lake holds rounded to two places", () => {
    const rounded = lakeBill({}, { UnitAmount: "@0.22" });
    expect(compareDocument(onlyExported([billRow()]), [rounded])).toEqual({
      kind: "different",
      fields: ["line.unit"],
    });
  });

  it("names each header field that differs", () => {
    const lake = lakeBill({ Status: "AUTHORISED", AmountDue: "@11.24" });
    expect(compareDocument(onlyExported([billRow()]), [lake])).toEqual({
      kind: "different",
      fields: ["amountDue", "status"],
    });
  });

  it("tells a line missing from the lake apart from a line that differs", () => {
    const two = onlyExported([billRow(), billRow({ Description: "Ink" })]);
    expect(compareDocument(two, [lakeBill()])).toEqual({ kind: "different", fields: ["lines"] });
  });

  it("compares a tax-inclusive line before tax, and leaves its unit price out", () => {
    // The export writes this line's amount and unit price before tax; the API, with tax.
    const exported = onlyExported([
      billRow({
        Total: "10.9000",
        TaxTotal: "0.9000",
        InvoiceAmountPaid: "10.9000",
        UnitAmount: "0.2000",
        LineAmount: "10.0000",
        TaxAmount: "0.9000",
      }),
    ]);
    const lake = lakeBill(
      { LineAmountTypes: "Inclusive", Total: "@10.90", TotalTax: "@0.90", AmountPaid: "@10.90" },
      { UnitAmount: "@0.218", LineAmount: "@10.90", TaxAmount: "@0.90" },
    );
    expect(compareDocument(exported, [lake])).toEqual({ kind: "same" });
  });
});

describe("matchDocuments", () => {
  function exported(changes: Partial<Record<Column, string>>): ExportedDocument {
    return onlyExported([billRow(changes)]);
  }

  function lake(id: string, changes: Record<string, unknown>): LakeDocument {
    return lakeBill({ InvoiceID: id, ...changes });
  }

  it("finds a document by type, number, contact, date and total", () => {
    const { matched, onlyExport, onlyLake } = matchDocuments([exported({})], [lake("a", {})]);
    expect(matched.map((m) => m.lake.map((d) => d.id))).toEqual([["a"]]);
    expect([onlyExport, onlyLake]).toEqual([[], []]);
  });

  it("falls back to contact, date and total when the number changed", () => {
    const { matched } = matchDocuments([exported({ InvoiceNumber: "B-100-old" })], [lake("a", {})]);
    expect(matched.map((m) => m.lake.map((d) => d.id))).toEqual([["a"]]);
  });

  it("takes identical documents Xero holds twice as one group", () => {
    const { matched } = matchDocuments([exported({})], [lake("a", {}), lake("b", {})]);
    expect(matched.map((m) => m.lake.map((d) => d.id))).toEqual([["a", "b"]]);
  });

  it("leaves what only one side holds unmatched, on each side", () => {
    const { matched, onlyExport, onlyLake } = matchDocuments(
      [exported({ InvoiceNumber: "B-1", Total: "1.0000", InvoiceDate: "01/01/2026" })],
      [lake("z", { InvoiceNumber: "B-9", Total: "@9" })],
    );
    expect(matched).toEqual([]);
    expect(onlyExport.map((d) => d.number)).toEqual(["B-1"]);
    expect(onlyLake.map((d) => d.id)).toEqual(["z"]);
  });
});

describe("contacts", () => {
  const header = [
    "*ContactName",
    "EmailAddress",
    "FirstName",
    "LastName",
    "BankAccountNumber",
    "PhoneNumber",
    "SAAddressLine1",
    "SACity",
    "Person1FirstName",
    "Person1Email",
  ].join(",");
  const [exported] = contactsExport(
    `${header}\r\nAcme  Supplies,ap@example.test,Ann,Lee,12-3,+65 6123 4567,1 Main St,Lyon,Bo,bo@example.test`,
    "contacts.csv",
  );

  function lakeAcme(changes: Record<string, unknown> = {}) {
    return lakeContact(
      parseLossless(
        JSON.stringify({
          ContactID: "c-1",
          ContactStatus: "ACTIVE",
          Name: "Acme Supplies",
          EmailAddress: "ap@example.test",
          FirstName: "Ann",
          LastName: "Lee",
          BankAccountDetails: "12-3",
          Phones: [{ PhoneType: "DEFAULT", PhoneCountryCode: "65", PhoneNumber: "6123 4567" }],
          Addresses: [{ AddressType: "STREET", AddressLine1: "1 Main St", City: "Lyon" }],
          ContactPersons: [{ FirstName: "Bo", EmailAddress: "bo@example.test" }],
          ...changes,
        }),
      ),
    );
  }

  it("passes a contact with the same details, a phone compared by its digits", () => {
    if (exported === undefined) {
      throw new Error("the invented export holds no contact");
    }
    expect(exported.name).toBe(lakeAcme().name);
    expect(compareContact(exported, lakeAcme())).toEqual({ kind: "same" });
  });

  it("names each detail that differs", () => {
    if (exported === undefined) {
      throw new Error("the invented export holds no contact");
    }
    expect(compareContact(exported, lakeAcme({ EmailAddress: "old@example.test" }))).toEqual({
      kind: "different",
      fields: ["email"],
    });
  });
});

describe("lakeCli for Xero", () => {
  function cliAnswering(answers: readonly (readonly [readonly string[], unknown])[]): Cli {
    const recorded = new Map(
      answers.map(([args, envelope]) => [args.join(" "), JSON.stringify(envelope)]),
    );
    return {
      run(args: readonly string[]): Promise<string> {
        const stdout = recorded.get(args.join(" "));
        return stdout === undefined
          ? Promise.reject(new Error(`nothing recorded for undercroft ${args.join(" ")}`))
          : Promise.resolve(stdout);
      },
    };
  }

  it("reads a Xero entity and keeps a payload's amounts as their digits", async () => {
    const args = ["lake", "records", "--tenant-id", "CASE-0042", "--source", "xero"];
    const cli = cliAnswering([
      [
        [...args, "--entity", "invoices", "--limit", "50"],
        {
          ok: true,
          data: {
            items: [{ sourceRecordId: "inv-1", payload: '{"Total":27.3600}', deletedAt: null }],
          },
        },
      ],
    ]);
    const [row] = await lakeRows(cli, "CASE-0042", "invoices", "xero");
    expect(getStringPath(row?.payload, "Total")).toBe("27.3600");
  });

  it("finds the newest ingest run of the source asked for", async () => {
    const runs = [
      { source: "hubspot", kind: "ingest", startedAt: "2026-01-03T00:00:00Z" },
      { source: "xero", kind: "ingest", startedAt: "2026-01-02T00:00:00Z" },
    ];
    const cli = cliAnswering([
      [
        ["runs", "list", "--tenant-id", "CASE-0042", "--limit", "50"],
        { ok: true, data: { items: runs } },
      ],
    ]);
    expect(await lastRunStart(cli, "CASE-0042", "xero")).toBe("2026-01-02T00:00:00Z");
  });
});
