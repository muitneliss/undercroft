/**
 * The wheel is full, and it is still a wheel: seven divisions, seven hues, none of them the
 * errata's, and every one opening at its own path under the customer.
 */

import { describe, expect, test as it } from "bun:test";

import { held } from "@/test/access.ts";

import { bookPath, closedTo, DIVISIONS, division, divisionPath } from "./divisions.ts";

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

  it("closes to each built-in role the divisions whose permission it lacks (ADR 0119, 0139, 0147)", () => {
    function closedFor(role: "viewer" | "member" | "builder" | "admin"): string[] {
      return DIVISIONS.filter(
        (d) => closedTo(d, { tenantId: "CASE-0042", permissions: held(role) }) !== null,
      ).map((d) => d.id);
    }
    const readsReportsAlone = ["sources", "journal", "lake", "models", "people"];

    expect({
      viewer: closedFor("viewer"),
      member: closedFor("member"),
      builder: closedFor("builder"),
      admin: closedFor("admin"),
    }).toEqual({
      viewer: readsReportsAlone,
      member: readsReportsAlone,
      builder: ["people"],
      admin: [],
    });
  });

  it("opens People to a reader holding people:manage whatever their role is called", () => {
    // The permission decides, never the role's name: a customer's own role (PR 2) holding
    // people:manage must find the division open, which a check on "admin" would refuse.
    expect(closedTo(people, { tenantId: "CASE-0042", permissions: ["people:manage"] })).toBeNull();
  });

  it("closes nothing on permissions it does not know yet, so an admin's tab never turns over on a guess", () => {
    expect(closedTo(people, { tenantId: "CASE-0042", permissions: undefined })).toBeNull();
  });
});

describe("bookPath", () => {
  it("opens a book at Sources for its reader, and a reader of Reports alone at Reports", () => {
    expect(bookPath("CASE-0042", held("builder"))).toBe("/tenants/CASE-0042");
    expect(bookPath("CASE-0042", held("viewer"))).toBe("/tenants/CASE-0042/reports");
    // Not known yet: Sources, as ever, rather than a guess that would send an admin elsewhere.
    expect(bookPath("CASE-0042", undefined)).toBe("/tenants/CASE-0042");
  });
});
