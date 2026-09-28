/**
 * The scopes a Xero consent asks for.
 *
 * Xero retired its broad Accounting scopes: an app created on or after 2 March 2026 cannot be
 * granted `accounting.transactions` or `accounting.reports.read` at all, and every older app
 * loses them in September 2027. A consent that asks for one is refused at `login.xero.com`
 * before the administrator sees an organisation, so the list is pinned here rather than
 * discovered by the first customer to press Connect.
 *
 * The consent's table is a hand copy of the spec's `auth.scopes` (the card reads only the spec's
 * per-list scopes, at boot); the third test is what keeps the copy honest, and the fourth that every entity
 * the spec reads names, as its `readScope`, the scope Xero reads its list under.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseSpec } from "@undercroft/contracts";
import { describe, expect, test as it } from "bun:test";

import { PROVIDERS } from "./oauthProviders.ts";

/** The shipped spec, read and never written. */
const XERO_SPEC = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "specs",
  "connectors",
  "xero.yaml",
);

/** The broad scopes Xero no longer grants a new app. */
const RETIRED = new Set([
  "accounting.transactions",
  "accounting.transactions.read",
  "accounting.reports.read",
]);

/**
 * The granular read scope each Xero list is read under: the `security` of its GET in Xero's
 * OpenAPI document (`xero_accounting.yaml`). `/Items` was held here under invoices once, which
 * Xero's granular scope table also lists it under; live Xero answers it 401 there (#276).
 * The document still puts the last three under the broad `accounting.transactions`, which a new
 * app cannot be granted; Xero's granular scope table splits it, and is their source (#308).
 */
const SCOPE_BY_PATH: Readonly<Record<string, string>> = {
  "/Contacts": "accounting.contacts.read",
  "/ContactGroups": "accounting.contacts.read",
  "/Invoices": "accounting.invoices.read",
  "/CreditNotes": "accounting.invoices.read",
  "/Quotes": "accounting.invoices.read",
  "/PurchaseOrders": "accounting.invoices.read",
  "/RepeatingInvoices": "accounting.invoices.read",
  "/LinkedTransactions": "accounting.invoices.read",
  "/Payments": "accounting.payments.read",
  "/Overpayments": "accounting.payments.read",
  "/Prepayments": "accounting.payments.read",
  "/BatchPayments": "accounting.payments.read",
  "/Items": "accounting.settings.read",
  "/Accounts": "accounting.settings.read",
  "/TrackingCategories": "accounting.settings.read",
  "/TaxRates": "accounting.settings.read",
  "/Currencies": "accounting.settings.read",
  "/BankTransactions": "accounting.banktransactions.read",
  "/BankTransfers": "accounting.banktransactions.read",
  "/ManualJournals": "accounting.manualjournals.read",
};

function xeroSpec(): ReturnType<typeof parseSpec> {
  return parseSpec(readFileSync(XERO_SPEC, "utf8"));
}

function specScopes(): readonly string[] {
  const spec = xeroSpec();
  return spec.auth.kind === "oauth2" ? (spec.auth.scopes ?? []) : [];
}

describe("the Xero consent's scopes", () => {
  const asked = PROVIDERS.xero.scopes.xero ?? [];

  it("asks for no scope Xero has retired", () => {
    expect(asked.filter((scope) => RETIRED.has(scope))).toEqual([]);
  });

  it("asks for the granular scopes behind every entity the spec reads, and a refresh token", () => {
    expect([...asked].sort()).toEqual(
      [
        "accounting.contacts.read",
        "accounting.invoices.read",
        "accounting.payments.read",
        "accounting.settings.read",
        "accounting.banktransactions.read",
        "accounting.manualjournals.read",
        "offline_access",
      ].sort(),
    );
  });

  it("is the list the spec declares, so a run is never narrower than the consent", () => {
    expect([...asked].sort()).toEqual([...specScopes()].sort());
  });

  it("has every entity name the scope Xero reads its list under, and asks for it", () => {
    // An entity whose list is not in the table fails here as `undefined`: say which scope reads
    // it before the spec may declare it. One that names another scope is read on a grant Xero
    // will answer 401 -- which is what reading items under invoices did (#276).
    const wrong = xeroSpec()
      .entities.map((entity) => ({
        entity: entity.name,
        named: entity.readScope,
        xero: SCOPE_BY_PATH[entity.request.path],
      }))
      .filter(({ named, xero }) => xero === undefined || named !== xero || !asked.includes(xero));
    expect(wrong).toEqual([]);
  });
});
