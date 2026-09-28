/**
 * The lake side of the Xero → lake check: a Xero payload as the lake keeps it, read into the
 * same shape `xeroExport.ts` reads the export into.
 *
 * The payload arrives through `lossless-json` (see `lakeCli.ts`), so every amount is read as
 * the digits Xero sent. Where the two spellings differ -- a tax code against its display name,
 * a Microsoft JSON date against a day -- this file turns the lake's into the export's.
 */

import { getPath, getStringPath, isoInstant } from "@undercroft/core";
import { amount, bare, difference, digits, unsigned, words } from "./normalise.ts";
import {
  addressText,
  KINDS,
  type Line,
  peopleText,
  type XeroContact,
  type XeroDocument,
} from "./xeroExport.ts";

/** A lake document, with what the export cannot show: its id, status and version. */
export interface LakeDocument extends XeroDocument {
  readonly id: string;
  readonly status: string;
  /** ISO-8601 UTC, or `null` if the payload carries none. */
  readonly updatedAt: string | null;
  /** Tax-inclusive: its line amounts include tax, and unit prices cannot be set side by side. */
  readonly inclusive: boolean;
}

export interface LakeContact extends XeroContact {
  readonly id: string;
  readonly status: string;
  readonly updatedAt: string | null;
}

/** The export's name for each Xero `Type`. */
const KIND_OF_TYPE = new Map(Object.entries(KINDS).map(([name, kind]) => [kind.type, name]));

const NUMBER_FIELD: Readonly<Record<string, string>> = {
  invoices: "InvoiceNumber",
  credit_notes: "CreditNoteNumber",
};

const ID_FIELD: Readonly<Record<string, string>> = {
  invoices: "InvoiceID",
  credit_notes: "CreditNoteID",
  overpayments: "OverpaymentID",
  prepayments: "PrepaymentID",
};

/** A text field, or empty. */
function text(payload: unknown, path: string): string {
  return getStringPath(payload, path) ?? "";
}

/** A Microsoft JSON date (`/Date(1758931200000+0000)/`) as the day it names, in UTC. */
export function xeroDay(payload: unknown, path: string): string {
  const instant = isoInstant(text(payload, path));
  return instant === null ? "" : instant.slice(0, "YYYY-MM-DD".length);
}

function xeroInstant(payload: unknown, path: string): string | null {
  return isoInstant(text(payload, path));
}

function items(payload: unknown, path: string): readonly unknown[] {
  const value = getPath(payload, path);
  return Array.isArray(value) ? value : [];
}

/**
 * The export writes a tax rate's display name where the API writes its code. These are the
 * codes this estate's documents use; any other code is left as it is and shows as a
 * difference, rather than being guessed.
 */
export function taxName(code: string): string {
  if (code === "") {
    return "";
  }
  if (code === "NONE") {
    return "No Tax";
  }
  if (code.startsWith("ZERORATED")) {
    return code.includes("OUTPUT") ? "Zero-Rated Supplies" : "Zero-Rated Purchases";
  }
  if (code.startsWith("OUTPUT")) {
    return "Standard-Rated Supplies";
  }
  if (code.startsWith("INPUT")) {
    return "Standard-Rated Purchases";
  }
  return code;
}

function lakeLine(item: unknown, inclusive: boolean): Line {
  const lineAmount = amount(getStringPath(item, "LineAmount"));
  const taxAmount = amount(getStringPath(item, "TaxAmount"));
  return {
    description: bare(getStringPath(item, "Description")),
    // Xero's API leaves `Quantity` out of an empty line, where the export writes 0. Every line
    // without one seen in a real estate had no amount either, so absent is read as 0 here.
    quantity: unsigned(getStringPath(item, "Quantity") ?? "0"),
    // A tax-inclusive price includes tax in Xero and not in the export: not comparable.
    unit: inclusive ? null : unsigned(getStringPath(item, "UnitAmount")),
    // The export writes a tax-inclusive line before tax; the API writes it with tax.
    amount: inclusive ? difference(lineAmount, taxAmount) : lineAmount,
    account: text(item, "AccountCode").toUpperCase(),
    tax: taxName(text(item, "TaxType")),
    taxAmount,
  };
}

/** One lake document, or `null` for a `Type` the export never lists. */
export function lakeDocument(payload: unknown, entity: string): LakeDocument | null {
  const kind = KIND_OF_TYPE.get(text(payload, "Type"));
  if (kind === undefined) {
    return null;
  }
  const inclusive = text(payload, "LineAmountTypes") === "Inclusive";
  const fields: Record<string, string> = {
    status: text(payload, "Status"),
    date: xeroDay(payload, "Date"),
    currency: text(payload, "CurrencyCode"),
    total: amount(getStringPath(payload, "Total")),
    totalTax: amount(getStringPath(payload, "TotalTax")),
    reference: text(payload, "Reference").trim(),
  };
  if (entity === "invoices") {
    fields.dueDate = xeroDay(payload, "DueDate");
    fields.amountPaid = amount(getStringPath(payload, "AmountPaid"));
    fields.amountDue = amount(getStringPath(payload, "AmountDue"));
  } else {
    fields.remaining = amount(getStringPath(payload, "RemainingCredit"));
  }
  const numberField = NUMBER_FIELD[entity];
  return {
    kind,
    id: text(payload, ID_FIELD[entity] ?? ""),
    status: fields.status ?? "",
    updatedAt: xeroInstant(payload, "UpdatedDateUTC"),
    inclusive,
    number: numberField === undefined ? "" : text(payload, numberField).trim(),
    contact: text(payload, "Contact.Name").trim(),
    date: fields.date ?? "",
    total: fields.total ?? "",
    fields,
    lines: items(payload, "LineItems").map((item) => lakeLine(item, inclusive)),
  };
}

/** The address of one type (`POBOX`, `STREET`) in the export's order of parts. */
function lakeAddress(payload: unknown, type: string): string {
  const found = items(payload, "Addresses").find((item) => text(item, "AddressType") === type);
  return addressText((part) => text(found, part));
}

/** A phone of one type, country, area and number run together, then only the digits. */
function lakePhone(payload: unknown, type: string): string {
  const found = items(payload, "Phones").find((item) => text(item, "PhoneType") === type);
  return digits(
    `${text(found, "PhoneCountryCode")}${text(found, "PhoneAreaCode")}${text(found, "PhoneNumber")}`,
  );
}

export function lakeContact(payload: unknown): LakeContact {
  return {
    id: text(payload, "ContactID"),
    status: text(payload, "ContactStatus"),
    updatedAt: xeroInstant(payload, "UpdatedDateUTC"),
    name: words(text(payload, "Name")),
    fields: {
      email: words(text(payload, "EmailAddress")),
      firstName: words(text(payload, "FirstName")),
      lastName: words(text(payload, "LastName")),
      postalAddress: lakeAddress(payload, "POBOX"),
      streetAddress: lakeAddress(payload, "STREET"),
      phone: lakePhone(payload, "DEFAULT"),
      fax: lakePhone(payload, "FAX"),
      mobile: lakePhone(payload, "MOBILE"),
      directDial: lakePhone(payload, "DDI"),
      bankAccount: words(text(payload, "BankAccountDetails")),
      taxNumber: words(text(payload, "TaxNumber")),
      companyNumber: words(text(payload, "CompanyNumber")),
      people: peopleText(
        items(payload, "ContactPersons").map(
          (person) =>
            [
              text(person, "FirstName"),
              text(person, "LastName"),
              text(person, "EmailAddress"),
            ] as const,
        ),
      ),
    },
  };
}
