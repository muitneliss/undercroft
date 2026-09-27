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
 * `auth.scopes`; the second test is what keeps the copy honest.
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

function specScopes(): readonly string[] {
  const spec = parseSpec(readFileSync(XERO_SPEC, "utf8"));
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
});
