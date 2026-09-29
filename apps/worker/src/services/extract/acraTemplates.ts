/**
 * The ACRA Business Profile templates this platform can read, one entry per template.
 *
 * THIS IS THE CONFIGURATION. A template is recognised by its `$template.name`, and reading it
 * well needs two things only the template itself can say: how it writes a date, and which of
 * its fields holds which item of a profile. Both are data, so they live here as data, and
 * `acraBusinessProfile.ts` holds no template name and no field name at all. Adding a template
 * is adding an entry here, with a test document signed in its shape.
 *
 * EACH ENTRY IS WRITTEN AGAINST ITS OWN TEMPLATE, NEVER COPIED FROM ANOTHER. ACRA renamed and
 * added fields between 2022 and 2024 (`productCode` became `productId`; officers gained
 * `isNominee` and `entryDate`), and assuming a new template's fields mean what an old one's did
 * is how a column fills with wrong values (ADR 0048). So a template name absent from this table
 * is read as the generic unwrapped `data`, and an item a template has no confirmed field for is
 * `ABSENT`, which reads as `null`, rather than borrowed from a field with a similar name.
 *
 * ONE PROFILE SHAPE, SO A MODEL READS EVERY TEMPLATE THE SAME WAY. The 2024 entry carries every
 * key the 2022 one does, in the same place, and adds its own after them; the 2022 entry is the
 * layout that shipped with ADR 0048 and must not move, because dbt models parse it.
 *
 * WHERE THE 2024 LAYOUT CAME FROM: the key set and value shapes of 418 verified
 * `BP-COMPANY-2024-1` profiles held on production on 2026-09-29, surveyed by shape only. Every
 * date there is `DD Mon YYYY`; `isNominee` is `true`, `false` or missing; `addressChanged` is a
 * date; `qrCode` is a PNG data URL of the verification link. No value from them is in this repo
 * (`pii.md`).
 */

/** How a template writes a date. Each is read strictly, and anything else becomes `null`. */
export type DateForm = "DD/MM/YYYY" | "DD Mon YYYY";

/** Where one item of a profile comes from, and how it is read. */
export type AcraField =
  | { readonly kind: "text"; readonly from: string }
  | { readonly kind: "date"; readonly from: string }
  | { readonly kind: "flag"; readonly from: string }
  | { readonly kind: "activities"; readonly from: string }
  | { readonly kind: "list"; readonly from: string; readonly of: AcraLayout }
  | { readonly kind: "object"; readonly from: string; readonly of: AcraLayout }
  | { readonly kind: "section"; readonly of: AcraLayout }
  | { readonly kind: "absent" };

/** A profile's keys, in the order they are written, each with where it comes from. */
export type AcraLayout = Readonly<Record<string, AcraField>>;

export interface AcraTemplate {
  readonly dates: DateForm;
  /** A profile with no UEN or no name is not one; both are required of every template. */
  readonly layout: AcraLayout & { readonly uen: AcraField; readonly name: AcraField };
}

/** The document's own string, or `null` when it has none. */
function text(from: string): AcraField {
  return { kind: "text", from };
}
/** A date in the template's form, as `YYYY-MM-DD`, or `null`. */
function date(from: string): AcraField {
  return { kind: "date", from };
}
/** `true` or `false` as the document states it; `null` when it states neither. */
function flag(from: string): AcraField {
  return { kind: "flag", from };
}
/** A list of rows, each laid out by `of`. */
function list(from: string, of: AcraLayout): AcraField {
  return { kind: "list", from, of };
}
/** A nested record laid out by `of`, or `null` when the document has none. */
function object(from: string, of: AcraLayout): AcraField {
  return { kind: "object", from, of };
}
/** A group of the document's own top-level fields, gathered under one key. */
function section(of: AcraLayout): AcraField {
  return { kind: "section", of };
}
/** An item this template has no confirmed field for. */
const ABSENT: AcraField = { kind: "absent" };

/** A local address carries its parts, a foreign one its lines; either keeps its formatted form. */
const ADDRESS: AcraLayout = {
  kind: text("type"),
  houseNumber: text("houseNumber"),
  streetName: text("streetName"),
  floor: text("floor"),
  unit: text("unit"),
  buildingName: text("buildingName"),
  postalCode: text("postalCode"),
  address1: text("address1"),
  address2: text("address2"),
  country: text("country"),
  formattedAddress: text("formattedAddress"),
};

const CAPITAL: AcraLayout = {
  type: text("type"),
  amount: text("amount"),
  numberOfShares: text("shares"),
  currency: text("currency"),
  shareType: text("sharesType"),
};

const TEMPLATE: AcraLayout = {
  name: text("name"),
  type: text("type"),
  rendererUrl: text("url"),
};

const BP_COMPANY_2022_1: AcraTemplate = {
  dates: "DD/MM/YYYY",
  layout: {
    uen: text("uen"),
    name: text("entityName"),
    companyType: text("companyType"),
    status: text("status"),
    statusDate: date("statusDate"),
    incorporationDate: date("incorporationDate"),
    gazettedIndicator: text("gazettedIndicator"),
    registeredAddress: object("address", ADDRESS),
    changeOfAddressDate: date("changeOfAddressDate"),
    activities: { kind: "activities", from: "activities" },
    capitals: list("capitals", CAPITAL),
    // A representative, whatever the role: the document says Director, Secretary, and others.
    officers: list("representatives", {
      name: text("name"),
      identificationNumber: text("id"),
      nationality: text("nationality"),
      position: text("position"),
      appointmentDate: date("appointmentDate"),
      addressSource: text("addressSource"),
      address: object("address", ADDRESS),
    }),
    // Laid out on its own: a shareholder carries shares where an officer carries a role.
    shareholders: list("shareholders", {
      name: text("name"),
      identificationNumber: text("id"),
      nationality: text("nationality"),
      numberOfShares: text("shares"),
      shareType: text("sharesType"),
      currency: text("currency"),
      addressSource: text("addressSource"),
      address: object("address", ADDRESS),
    }),
    document: section({
      productCode: text("productCode"),
      transactionNumber: text("transactionNumber"),
      receiptNumber: text("receiptNumber"),
      receiptDate: date("receiptDate"),
      verificationUrl: text("verifyLink"),
      template: object("$template", TEMPLATE),
    }),
  },
};

const BP_COMPANY_2024_1: AcraTemplate = {
  dates: "DD Mon YYYY",
  layout: {
    uen: text("uen"),
    name: text("entityName"),
    companyType: text("companyType"),
    status: text("status"),
    statusDate: date("statusDate"),
    incorporationDate: date("incorporationDate"),
    gazettedIndicator: text("gazettedIndicator"),
    registeredAddress: object("address", ADDRESS),
    changeOfAddressDate: date("changeOfAddressDate"),
    activities: { kind: "activities", from: "activities" },
    capitals: list("capitals", CAPITAL),
    officers: list("representatives", {
      name: text("name"),
      identificationNumber: text("id"),
      nationality: text("nationality"),
      position: text("position"),
      appointmentDate: date("appointmentDate"),
      // 2024 names no source for an address.
      addressSource: ABSENT,
      address: object("address", ADDRESS),
      entryDate: date("entryDate"),
      isNominee: flag("isNominee"),
      addressChangedDate: date("addressChanged"),
    }),
    shareholders: list("shareholders", {
      name: text("name"),
      identificationNumber: text("id"),
      nationality: text("nationality"),
      numberOfShares: text("shares"),
      shareType: text("sharesType"),
      currency: text("currency"),
      addressSource: ABSENT,
      address: object("address", ADDRESS),
      position: text("position"),
      appointmentDate: date("appointmentDate"),
      entryDate: date("entryDate"),
      isNominee: flag("isNominee"),
      addressChangedDate: date("addressChanged"),
    }),
    document: section({
      // `productId` holds codes of the same family, but nothing states it is the same item, so
      // it is kept under its own name rather than filed as the 2022 `productCode`.
      productCode: ABSENT,
      transactionNumber: text("transactionNumber"),
      receiptNumber: text("receiptNumber"),
      receiptDate: date("receiptDate"),
      verificationUrl: text("verifyLink"),
      template: object("$template", TEMPLATE),
      productId: text("productId"),
      signatureName: text("signatureName"),
      qrCode: text("qrCode"),
    }),
    registrationDate: date("registrationDate"),
    formerNames: list("formerNames", { name: text("name") }),
    changeOfNameDate: date("changeOfNameDate"),
    annualFilings: list("agm", {
      currentFinancialYearEnd: date("currentFyeDate"),
      lastAgmDate: date("lastAgmDate"),
      lastAnnualReturnDate: date("lastArDate"),
      lastAnnualReturnFinancialYearEnd: date("lastArDateFye"),
    }),
    auditFirms: list("auditFirms", { name: text("name") }),
    // `amountSecured` stays the words the issuer signed ("All Monies" is one), never a number.
    charges: list("charges", {
      chargeNumber: text("chargeNumber"),
      dateRegistered: date("dateRegistered"),
      amountSecured: text("amountSecured"),
      chargees: text("chargees"),
    }),
  },
};

/**
 * Every template read as a Business Profile, by `$template.name`.
 *
 * A `Map`, not an object literal: the key is a string from a document, and looking
 * `constructor` up in a plain object answers with something that is not a template.
 */
export const ACRA_TEMPLATES: ReadonlyMap<string, AcraTemplate> = new Map([
  ["BP-COMPANY-2022-1", BP_COMPANY_2022_1],
  ["BP-COMPANY-2024-1", BP_COMPANY_2024_1],
]);

/**
 * The generation of this table, stamped on every text as `layout_version`.
 *
 * RAISE IT WHENEVER AN ENTRY IS ADDED OR CHANGED. The next extract run then lays out again,
 * from the verified data it already holds, every OpenAttestation text written under an older
 * generation -- which is how a profile read as unwrapped `data` before its template was known
 * becomes a Business Profile without being fetched or verified again. See `relaid` in
 * `openAttestation.ts` and ADR 0081.
 *
 * Generation 1 is `BP-COMPANY-2024-1`, issue #313.
 */
export const ACRA_LAYOUT_VERSION = 1;
