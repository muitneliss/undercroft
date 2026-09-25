/**
 * What the HubSpot picker offers for each object. Two ways it could mislead the admin choosing
 * what a customer's CRM hands over: a property the spec always reads offered as a tick that
 * looks as if it could be taken away, and a saved tick HubSpot no longer lists hidden where
 * nobody can take it back.
 */

import { describe, expect, test as it } from "bun:test";

import { propertiesByObject } from "./hubspotProperties.ts";

const LISTING = [
  { id: "name", name: "Company name", kind: "system", entity: "companies", always: true },
  { id: "annualrevenue", name: "Annual Revenue", kind: "system", entity: "companies" },
  { id: "x_onboarding_stage", name: "Onboarding stage", kind: "user", entity: "companies" },
] as const;

describe("propertiesByObject", () => {
  it("offers what may be added, and keeps what the spec always reads out of the ticks", () => {
    const [companies] = propertiesByObject(LISTING, {});

    expect(companies?.always.map((item) => item.id)).toEqual(["name"]);
    expect(companies?.choosable.map((item) => item.id)).toEqual([
      "annualrevenue",
      "x_onboarding_stage",
    ]);
  });

  it("shows a saved property HubSpot no longer lists, unowned, so it can be unticked", () => {
    const [companies] = propertiesByObject(LISTING, { companies: ["annualrevenue", "x_retired"] });

    expect(companies?.choosable.at(-1)).toEqual({ id: "x_retired", name: "x_retired", kind: null });
  });
});
