/**
 * The scopes a Xero consent asks for.
 *
 * Xero retired its broad Accounting scopes: an app created on or after 2 March 2026 cannot be
 * granted `accounting.transactions` or `accounting.reports.read` at all, and every older app
 * loses them in September 2027. A consent that asks for one is refused at `login.xero.com`
 * before the administrator sees an organisation, so the list is pinned here rather than
 * discovered by the first customer to press Connect.
 *
 * The control plane does not read specs, so the table is a hand copy of the spec's
 * `auth.scopes`; the third test is what keeps the copy honest, and the fourth that every entity
 * the spec reads is read under a scope the copy asks for.
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
 * The granular read scope each Xero list is read under, as Xero's granular scope table assigns
 * them. `/Items` is also reachable under `accounting.settings.read`; this consent reaches it
 * through invoices, which it already holds.
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
  "/Items": "accounting.invoices.read",
  "/Payments": "accounting.payments.read",
  "/Overpayments": "accounting.payments.read",
  "/Prepayments": "accounting.payments.read",
  "/BatchPayments": "accounting.payments.read",
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
        "offline_access",
      ].sort(),
    );
  });

  it("is the list the spec declares, so a run is never narrower than the consent", () => {
    expect([...asked].sort()).toEqual([...specScopes()].sort());
  });

  it("covers every entity the spec reads, each by the scope Xero reads its list under", () => {
    // An entity whose list is not in the table fails here as `undefined`: say which scope reads
    // it before the spec may declare it, or its first run meets a 401 part-way through.
    const needed = xeroSpec().entities.map((entity) => [
      entity.name,
      SCOPE_BY_PATH[entity.request.path],
    ]);
    expect(needed.filter(([, scope]) => scope === undefined || !asked.includes(scope))).toEqual([]);
  });
});
