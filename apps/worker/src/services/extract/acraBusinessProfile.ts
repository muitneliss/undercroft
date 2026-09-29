/**
 * A verified ACRA Business Profile, in names a reader of it would use.
 *
 * WHY A PLATFORM WITH NO BUSINESS SCHEMA MAPS ONE. This is not a table. `CLAUDE.md` forbids a
 * `customers` table because a customer's model belongs in their dbt project, and it still
 * does: what this produces is the TEXT of a document, written to `raw.document_text` like a
 * PDF's, which a customer's model parses or ignores. It exists because the document's own
 * field names are an issuer's internals (`representatives`, `id`, `sharesType`) and its dates
 * are a template's own form; reading one well is a reader's job, the same way laying out a
 * workbook's rows is `xlsx.ts`'s.
 *
 * ONLY FOR A DOCUMENT ACRA ISSUED IN A TEMPLATE WE KNOW. Every issuer must prove its identity at
 * `acratrustbar.gov.sg`, and `$template.name` must be an entry of `ACRA_TEMPLATES`; anything
 * else stays the generic unwrapped data. What each template's fields mean is that table's, and
 * this module knows no template name and no field name of its own. The check is not a trust
 * decision: it runs only on a document whose signature and issuer identity have ALREADY
 * verified (`openAttestation.ts`).
 *
 * NOTHING IS GUESSED AND NOTHING IS DROPPED. A field the document does not carry is `null`, a
 * date that is not a real date in the template's own form is `null` rather than a locale's
 * reading of it, a flag the document does not state is `null` and not `false`, and an amount
 * stays the string the issuer signed (`money.md`); a currency stays its words, because a table
 * from "UNITED STATES OF AMERICA, DOLLARS" to `USD` is a guess this reader would own. An
 * activity keeps its description whole when it carries no trailing SSIC code.
 */

import { ACRA_TEMPLATES, type AcraField, type AcraLayout, type DateForm } from "./acraTemplates.ts";

const ACRA_IDENTITY_LOCATION = "acratrustbar.gov.sg";

/** A five-digit SSIC code in parentheses at the very end of an activity's name. */
const SSIC_SUFFIX = /^(?<description>[\s\S]*?)\s*\((?<code>\d{5})\)\s*$/u;

/**
 * Each date form, as exactly the shape it names. `DD Mon YYYY` is a two-digit day, an English
 * month abbreviation in the case ACRA writes it, and a four-digit year: `1 July 2026` and
 * `01 JUL 2026` are other shapes and read as `null`, not as a lenient parser's best effort.
 */
const DATE_SHAPES: Readonly<Record<DateForm, RegExp>> = {
  "DD/MM/YYYY": /^(?<day>\d{2})\/(?<month>\d{2})\/(?<year>\d{4})$/u,
  "DD Mon YYYY":
    /^(?<day>\d{2}) (?<month>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?<year>\d{4})$/u,
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Row = Record<string, unknown>;

/** Only where each issuer proved itself is consulted. */
export interface ProfileIssuer {
  readonly location: string;
}

/** The profile, or `null` when this is not an ACRA document in a template we know. */
export function acraBusinessProfile(data: Row, issuers: readonly ProfileIssuer[]): Row | null {
  const template = ACRA_TEMPLATES.get(text(record(data.$template), "name") ?? "");
  const fromAcra = issuers.every(
    (issuer) => issuer.location.toLowerCase() === ACRA_IDENTITY_LOCATION,
  );
  if (template === undefined || !fromAcra) {
    return null;
  }
  const profile = laidOut(template.layout, data, template.dates);
  return profile.uen === null || profile.name === null ? null : profile;
}

function laidOut(layout: AcraLayout, row: Row, dates: DateForm): Row {
  return Object.fromEntries(
    Object.entries(layout).map(([key, field]) => [key, fieldValue(field, row, dates)]),
  );
}

function fieldValue(field: AcraField, row: Row, dates: DateForm): unknown {
  switch (field.kind) {
    case "text":
      return text(row, field.from);
    case "date":
      return isoDate(text(row, field.from), dates);
    case "flag":
      return flagOf(row[field.from]);
    case "activities":
      return rows(row[field.from]).map(activity);
    case "list":
      return rows(row[field.from]).map((item) => laidOut(field.of, item, dates));
    case "object": {
      const nested = record(row[field.from]);
      return Object.keys(nested).length === 0 ? null : laidOut(field.of, nested, dates);
    }
    case "section":
      return laidOut(field.of, row, dates);
    case "absent":
      return null;
    default:
      return field satisfies never;
  }
}

function activity(row: Row): Row {
  const name = text(row, "name");
  const match = name === null ? null : SSIC_SUFFIX.exec(name);
  return match?.groups === undefined
    ? { description: name, ssicCode: null }
    : { description: match.groups.description, ssicCode: match.groups.code };
}

/** A date in `form` as `YYYY-MM-DD`, or `null` when it is not that shape or not a real date. */
function isoDate(value: string | null, form: DateForm): string | null {
  const parts = value === null ? undefined : DATE_SHAPES[form].exec(value)?.groups;
  if (parts === undefined) {
    return null;
  }
  const { day = "", month = "", year = "" } = parts;
  const monthIndex = MONTHS.indexOf(month);
  const mm = monthIndex < 0 ? month : String(monthIndex + 1).padStart(2, "0");
  const iso = `${year}-${mm}-${day}`;
  // A calendar check without a locale: the UTC date round-trips only if it exists. A day or
  // month past any calendar's makes no date at all, and `toISOString` throws on one.
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(iso) ? iso : null;
}

/** The word the issuer signed, unwrapped as text (`unsalted`); anything else is unstated. */
function flagOf(value: unknown): boolean | null {
  if (value === "true") {
    return true;
  }
  return value === "false" ? false : null;
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
