/**
 * The wheel is full, and it is still a wheel: seven divisions, seven hues, none of them the
 * errata's, and every one opening at its own path under the customer.
 */

import { describe, expect, test as it } from "bun:test";

import { closedTo, DIVISIONS, division, divisionPath } from "./divisions.ts";

/** `--errata` in index.css. Held out of the wheel so the slip is the only thing wearing it. */
const ERRATA = "#cf2f16";

describe("DIVISIONS", () => {
  it("binds seven divisions in ring order, each with a hue of its own", () => {
    expect(DIVISIONS.map((d) => d.id)).toEqual([
      "customers",
      "sources",
      "journal",
      "lake",
      "models",
      "reports",
      "people",
    ]);
    expect(new Set(DIVISIONS.map((d) => d.hue)).size).toBe(DIVISIONS.length);
    expect(DIVISIONS.map((d) => d.hue)).not.toContain(ERRATA);
  });

  it("every division but the customers list belongs to one customer's book", () => {
    expect(DIVISIONS.filter((d) => !d.scoped).map((d) => d.id)).toEqual(["customers"]);
  });
});

describe("divisionPath", () => {
  it("opens under the customer, with Sources as the customer's front page", () => {
    expect(divisionPath("journal", "CASE-0042")).toBe("/tenants/CASE-0042/journal");
    expect(divisionPath("reports", "CASE-0042")).toBe("/tenants/CASE-0042/reports");
    expect(divisionPath("sources", "CASE-0042")).toBe("/tenants/CASE-0042");
  });

  it("with no customer chosen, every scoped division sends the reader to choose one", () => {
    expect(divisionPath("journal", undefined)).toBe("/tenants");
    expect(divisionPath("customers", undefined)).toBe("/tenants");
  });
});

describe("closedTo", () => {
  const people = division("people");

  it("closes People to a member and a viewer of the open book, and to nobody else (ADR 0119)", () => {
    const closed = (["viewer", "member", "admin"] as const).map((role) =>
      closedTo(people, { tenantId: "CASE-0042", role }),
    );
    expect(closed).toEqual(["admin-only", "admin-only", null]);
    expect(
      DIVISIONS.filter((d) => closedTo(d, { tenantId: "CASE-0042", role: "viewer" }) !== null),
    ).toEqual([people]);
  });

  it("closes nothing on a role it does not know yet, so an admin's tab never turns over on a guess", () => {
    expect(closedTo(people, { tenantId: "CASE-0042", role: undefined })).toBeNull();
  });
});
