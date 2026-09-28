/**
 * The Xero side of the Xero → lake check, read from the files Xero's web app exports: the
 * invoice export (Sales invoices, Bills) and the contacts export.
 *
 * The export is the source of record here because it is what an owner can take from Xero
 * without an app of their own. It carries no Xero ids, so a document is known by its type,
 * number, contact, date and total; see `xeroCompare.ts` for how that finds the lake's copy.
 *
 * Everything is normalised into the shape `xeroLake.ts` reads the lake into, so the comparison
 * is one of equal strings (see `normalise.ts`).
 */

import { parseAmount } from "@undercroft/core/money";
import { type CsvRow, cell, csvRows } from "./csv.ts";
import { amount, bare, byCode, digits, NO_AMOUNT, signed, unsigned, words } from "./normalise.ts";

/** Which side of the ledger a document belongs to: an export holds one or both. */
export type LedgerSide = "sales" | "purchases";

/** One kind of document, as the export names it and as the lake keeps it. */
export interface DocumentKind {
  readonly entity: "invoices" | "credit_notes" | "overpayments" | "prepayments";
  readonly type: string;
  readonly side: LedgerSide;
}

/** The export's `Type` column, and where the lake keeps each. */
export const KINDS: Readonly<Record<string, DocumentKind>> = {
  "Sales invoice": { entity: "invoices", type: "ACCREC", side: "sales" },
  "Sales credit note": { entity: "credit_notes", type: "ACCRECCREDIT", side: "sales" },
  "Sales overpayment": { entity: "overpayments", type: "RECEIVE-OVERPAYMENT", side: "sales" },
  "Sales prepayment": { entity: "prepayments", type: "RECEIVE-PREPAYMENT", side: "sales" },
  Bill: { entity: "invoices", type: "ACCPAY", side: "purchases" },
  "Bill credit note": { entity: "credit_notes", type: "ACCPAYCREDIT", side: "purchases" },
  "Bill overpayment": { entity: "overpayments", type: "SPEND-OVERPAYMENT", side: "purchases" },
  "Bill prepayment": { entity: "prepayments", type: "SPEND-PREPAYMENT", side: "purchases" },
};

/** One line item. Every value is a string, so two lines compare as text. */
export interface Line {
  readonly description: string;
  readonly quantity: string;
  /** `null` where it cannot be compared: a tax-inclusive document (see `xeroCompare.ts`). */
  readonly unit: string | null;
  readonly amount: string;
  readonly account: string;
  readonly tax: string;
  readonly taxAmount: string;
}

/** One document, on either side. */
export interface XeroDocument {
  readonly kind: string;
  readonly number: string;
  readonly contact: string;
  readonly date: string;
  readonly total: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly lines: readonly Line[];
}

/** A document read from an export, and where: a test that cannot find it names the row. */
export interface ExportedDocument extends XeroDocument {
  readonly file: string;
  readonly row: number;
}

/** One contact, on either side. */
export interface XeroContact {
  readonly name: string;
  readonly fields: Readonly<Record<string, string>>;
}

export interface ExportedContact extends XeroContact {
  readonly file: string;
  readonly row: number;
}

const EXPORT_DATE = /^(?<day>\d{1,2})\/(?<month>\d{1,2})\/(?<year>\d{4})$/u;

/** `27/09/2026` or `7/09/2026` as `2026-09-27`; empty stays empty. */
export function exportDate(text: string, where: string): string {
  if (text === "") {
    return "";
  }
  const { day, month, year } = EXPORT_DATE.exec(text)?.groups ?? {};
  if (day === undefined || month === undefined || year === undefined) {
    throw new Error(`${where}: expected a day/month/year date`);
  }
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** The export's words for a status, as Xero's API spells it. */
const STATUS: Readonly<Record<string, string>> = {
  Paid: "PAID",
  "Awaiting Payment": "AUTHORISED",
  "Awaiting Approval": "SUBMITTED",
  Draft: "DRAFT",
  Voided: "VOIDED",
  Deleted: "DELETED",
};

const INVOICE_COLUMNS = [
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

function exportedLine(row: CsvRow, negative: boolean): Line {
  return {
    description: bare(cell(row, "Description")),
    quantity: unsigned(cell(row, "Quantity")),
    unit: unsigned(cell(row, "UnitAmount")),
    amount: signed(cell(row, "LineAmount"), negative),
    // The export can write an account code in lower case where the API writes upper.
    account: cell(row, "AccountCode").toUpperCase(),
    tax: cell(row, "TaxType"),
    taxAmount: signed(cell(row, "TaxAmount"), negative),
  };
}

function exportedFields(head: CsvRow, kind: DocumentKind, where: string): Record<string, string> {
  // The export writes a credit note or an overpayment negative; Xero keeps it positive.
  const negative = parseAmount(cell(head, "Total"))?.lt(0) ?? false;
  const fields: Record<string, string> = {
    status: STATUS[cell(head, "Status")] ?? cell(head, "Status"),
    date: exportDate(cell(head, "InvoiceDate"), where),
    currency: cell(head, "Currency"),
    total: signed(cell(head, "Total"), negative),
    totalTax: signed(cell(head, "TaxTotal"), negative),
    reference: cell(head, "Reference").trim(),
  };
  if (kind.entity === "invoices") {
    fields.dueDate = exportDate(cell(head, "DueDate"), where);
    fields.amountPaid = amount(cell(head, "InvoiceAmountPaid"));
    fields.amountDue = amount(cell(head, "InvoiceAmountDue"));
  } else {
    fields.remaining = signed(cell(head, "InvoiceAmountDue"), negative);
  }
  return fields;
}

function exportedDocument(rows: readonly CsvRow[], file: string, at: number): ExportedDocument {
  const [head] = rows;
  if (head === undefined) {
    throw new Error(`${file}: a document with no rows`);
  }
  const where = `${file} row ${at}`;
  const type = cell(head, "Type");
  const kind = KINDS[type];
  if (kind === undefined) {
    throw new Error(`${where}: unknown document type ${JSON.stringify(type)}`);
  }
  const fields = exportedFields(head, kind, where);
  const negative = parseAmount(cell(head, "Total"))?.lt(0) ?? false;
  return {
    kind: type,
    number: cell(head, "InvoiceNumber").trim(),
    contact: cell(head, "ContactName").trim(),
    date: fields.date ?? "",
    total: fields.total ?? NO_AMOUNT,
    fields,
    lines: rows
      .filter((row) => cell(row, "Description") !== "" || cell(row, "LineAmount") !== "")
      .map((row) => exportedLine(row, negative)),
    file,
    row: at,
  };
}

/**
 * One document per group of rows: the export writes a document once per line, repeating its
 * header on each. Rows are grouped by type, number, contact, date and total, so documents
 * Xero holds twice over, identical, arrive as one group and are compared as one.
 */
export function invoiceExport(text: string, file: string): ExportedDocument[] {
  const groups = new Map<string, { rows: CsvRow[]; at: number }>();
  for (const [index, row] of csvRows(text, file, INVOICE_COLUMNS).entries()) {
    const key = [cell(row, "Type"), cell(row, "InvoiceNumber").trim()]
      .concat([
        cell(row, "ContactName").trim(),
        cell(row, "InvoiceDate"),
        amount(cell(row, "Total")),
      ])
      .join("\u0000");
    const group = groups.get(key);
    if (group === undefined) {
      // Row 1 is the header, so the first document starts on row 2.
      groups.set(key, { rows: [row], at: index + 2 });
    } else {
      group.rows.push(row);
    }
  }
  return [...groups.values()].map(({ rows, at }) => exportedDocument(rows, file, at));
}

const ADDRESS = [
  "AttentionTo",
  "AddressLine1",
  "AddressLine2",
  "AddressLine3",
  "AddressLine4",
  "City",
  "Region",
  "PostalCode",
  "Country",
] as const;

/** The address parts in a fixed order, joined, so two addresses compare as one string. */
export function addressText(part: (name: (typeof ADDRESS)[number]) => string): string {
  return ADDRESS.map((name) => words(part(name))).join(" | ");
}

/** Contact people, each first name, last name and email, sorted, so order does not count. */
export function peopleText(people: readonly (readonly [string, string, string])[]): string {
  return people
    .map((person) => person.map(words).join(" "))
    .sort(byCode)
    .join(" | ");
}

const PEOPLE = [1, 2, 3, 4, 5] as const;

function exportedPeople(row: CsvRow): string {
  return peopleText(
    PEOPLE.filter(
      (n) => cell(row, `Person${n}FirstName`) !== "" || cell(row, `Person${n}Email`) !== "",
    ).map(
      (n) =>
        [
          cell(row, `Person${n}FirstName`),
          cell(row, `Person${n}LastName`),
          cell(row, `Person${n}Email`),
        ] as const,
    ),
  );
}

/** The contacts export: one contact per row, known by its name (the export has no id). */
export function contactsExport(text: string, file: string): ExportedContact[] {
  const needed = ["*ContactName", "EmailAddress", "FirstName", "LastName", "BankAccountNumber"];
  return csvRows(text, file, needed).map((row, index) => ({
    name: words(cell(row, "*ContactName")),
    fields: {
      email: words(cell(row, "EmailAddress")),
      firstName: words(cell(row, "FirstName")),
      lastName: words(cell(row, "LastName")),
      postalAddress: addressText((part) => cell(row, `PO${part}`)),
      streetAddress: addressText((part) => cell(row, `SA${part}`)),
      phone: digits(cell(row, "PhoneNumber")),
      fax: digits(cell(row, "FaxNumber")),
      mobile: digits(cell(row, "MobileNumber")),
      directDial: digits(cell(row, "DDINumber")),
      bankAccount: words(cell(row, "BankAccountNumber")),
      taxNumber: words(cell(row, "TaxNumber")),
      companyNumber: words(cell(row, "CompanyNumber")),
      people: exportedPeople(row),
    },
    file,
    row: index + 2,
  }));
}
