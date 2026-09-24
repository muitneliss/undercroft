/**
 * A verified ACRA Business Profile, in names a reader of it would use.
 *
 * WHY A PLATFORM WITH NO BUSINESS SCHEMA MAPS ONE. This is not a table. `CLAUDE.md` forbids a
 * `customers` table because a customer's model belongs in their dbt project, and it still
 * does: what this produces is the TEXT of a document, written to `raw.document_text` like a
 * PDF's, which a customer's model parses or ignores. It exists because the document's own
 * field names are an issuer's internals (`representatives`, `id`, `sharesType`) and its dates
 * are `DD/MM/YYYY`; reading one well is a reader's job, the same way laying out a workbook's
 * rows is `xlsx.ts`'s.
 *
 * ONLY FOR A DOCUMENT ACRA ISSUED IN A TEMPLATE WE KNOW. Every issuer must prove its identity at
 * `acratrustbar.gov.sg`, and `$template.name` must be one listed below; anything else stays the
 * generic unwrapped data. The list is a list because ACRA will publish another template, and
 * guessing that its fields mean what this one's do is how a column fills with wrong values.
 * The check is not a trust decision: it runs only on a document whose signature and issuer
 * identity have ALREADY verified (`openAttestation.ts`).
 *
 * NOTHING IS GUESSED AND NOTHING IS DROPPED. A field the document does not carry is `null`, a
 * date that is not a real `DD/MM/YYYY` is `null` rather than a locale's reading of it, and an
 * amount stays the string the issuer signed (`money.md`); a currency stays its words, because
 * a table from "UNITED STATES OF AMERICA, DOLLARS" to `USD` is a guess this reader would own.
 * An activity keeps its description whole when it carries no trailing SSIC code.
 */

import type { OaIssuer } from "./openAttestationVerify.ts";

const ACRA_IDENTITY_LOCATION = "acratrustbar.gov.sg";
/** The templates whose fields this mapping was written against. */
const KNOWN_TEMPLATES: ReadonlySet<string> = new Set(["BP-COMPANY-2022-1"]);

/** A five-digit SSIC code in parentheses at the very end of an activity's name. */
const SSIC_SUFFIX = /^(?<description>[\s\S]*?)\s*\((?<code>\d{5})\)\s*$/u;
const DD_MM_YYYY = /^(?<day>\d{2})\/(?<month>\d{2})\/(?<year>\d{4})$/u;

type Row = Record<string, unknown>;

/** The profile, or `null` when this is not an ACRA document in a template we know. */
export function acraBusinessProfile(data: Row, issuers: readonly OaIssuer[]): Row | null {
  const template = record(data.$template);
  const acraTemplate =
    issuers.every((issuer) => issuer.location.toLowerCase() === ACRA_IDENTITY_LOCATION) &&
    KNOWN_TEMPLATES.has(text(template, "name") ?? "");
  if (!acraTemplate) {
    return null;
  }
  const uen = text(data, "uen");
  const name = text(data, "entityName");
  if (uen === null || name === null) {
    return null;
  }
  return {
    uen,
    name,
    companyType: text(data, "companyType"),
    status: text(data, "status"),
    statusDate: isoDate(text(data, "statusDate")),
    incorporationDate: isoDate(text(data, "incorporationDate")),
    gazettedIndicator: text(data, "gazettedIndicator"),
    registeredAddress: address(data.address),
    changeOfAddressDate: isoDate(text(data, "changeOfAddressDate")),
    activities: rows(data.activities).map(activity),
    capitals: rows(data.capitals).map(capital),
    officers: rows(data.representatives).map(officer),
    shareholders: rows(data.shareholders).map(shareholder),
    document: {
      productCode: text(data, "productCode"),
      transactionNumber: text(data, "transactionNumber"),
      receiptNumber: text(data, "receiptNumber"),
      receiptDate: isoDate(text(data, "receiptDate")),
      verificationUrl: text(data, "verifyLink"),
      template: {
        name: text(template, "name"),
        type: text(template, "type"),
        rendererUrl: text(template, "url"),
      },
    },
  };
}

function capital(row: Row): Row {
  return {
    type: text(row, "type"),
    amount: text(row, "amount"),
    numberOfShares: text(row, "shares"),
    currency: text(row, "currency"),
    shareType: text(row, "sharesType"),
  };
}

/** A representative, whatever the role: the document says Director, Secretary, and others. */
function officer(row: Row): Row {
  return {
    name: text(row, "name"),
    identificationNumber: text(row, "id"),
    nationality: text(row, "nationality"),
    position: text(row, "position"),
    appointmentDate: isoDate(text(row, "appointmentDate")),
    addressSource: text(row, "addressSource"),
    address: address(row.address),
  };
}

/** Mapped on its own: a shareholder carries shares where an officer carries a role. */
function shareholder(row: Row): Row {
  return {
    name: text(row, "name"),
    identificationNumber: text(row, "id"),
    nationality: text(row, "nationality"),
    numberOfShares: text(row, "shares"),
    shareType: text(row, "sharesType"),
    currency: text(row, "currency"),
    addressSource: text(row, "addressSource"),
    address: address(row.address),
  };
}

function activity(row: Row): Row {
  const name = text(row, "name");
  const match = name === null ? null : SSIC_SUFFIX.exec(name);
  return match?.groups === undefined
    ? { description: name, ssicCode: null }
    : { description: match.groups.description, ssicCode: match.groups.code };
}

/** A local address carries its parts, a foreign one its lines; either keeps its formatted form. */
function address(value: unknown): Row | null {
  const row = record(value);
  if (Object.keys(row).length === 0) {
    return null;
  }
  return {
    kind: text(row, "type"),
    houseNumber: text(row, "houseNumber"),
    streetName: text(row, "streetName"),
    floor: text(row, "floor"),
    unit: text(row, "unit"),
    buildingName: text(row, "buildingName"),
    postalCode: text(row, "postalCode"),
    address1: text(row, "address1"),
    address2: text(row, "address2"),
    country: text(row, "country"),
    formattedAddress: text(row, "formattedAddress"),
  };
}

/** `DD/MM/YYYY` as `YYYY-MM-DD`, or `null` when it is not that shape or not a real date. */
function isoDate(value: string | null): string | null {
  const parts = value === null ? undefined : DD_MM_YYYY.exec(value)?.groups;
  if (parts === undefined) {
    return null;
  }
  const { day = "", month = "", year = "" } = parts;
  const iso = `${year}-${month}-${day}`;
  // A calendar check without a locale: the UTC date round-trips only if it exists.
  return new Date(`${iso}T00:00:00Z`).toISOString().startsWith(iso) ? iso : null;
}

function text(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Row {
  return isRow(value) ? value : {};
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(record) : [];
}
