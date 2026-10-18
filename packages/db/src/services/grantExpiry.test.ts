import { describe, expect, test as it } from "bun:test";

import { grantExpiryAfterRefresh, grantExpiryFor } from "./grantExpiry.ts";

const NOW = new Date("2026-09-19T10:00:00.000Z");
const STATED = "2026-09-26T10:00:00.000Z";

describe("grantExpiryFor", () => {
  it("a Xero grant lapses sixty days after it was last renewed", () => {
    expect(grantExpiryFor("xero", { now: NOW })).toBe("2026-11-18T10:00:00.000Z");
  });

  it("a provider that announces no end gets none, never a guess", () => {
    for (const source of ["gmail", "drive", "hubspot", "demo"]) {
      expect(grantExpiryFor(source, { now: NOW })).toBeNull();
      expect(grantExpiryFor(source, { now: NOW, stated: null })).toBeNull();
    }
  });

  it("an end the provider stated is the end, for a Google project still in Testing", () => {
    expect(grantExpiryFor("drive", { now: NOW, stated: STATED })).toBe(STATED);
    expect(grantExpiryFor("gmail.a1b2c3d4e5f6", { now: NOW, stated: STATED })).toBe(STATED);
  });

  it("the provider's own word outranks the rule we keep for it", () => {
    expect(grantExpiryFor("xero", { now: NOW, stated: STATED })).toBe(STATED);
  });
});

describe("grantExpiryAfterRefresh", () => {
  it("a rotated Xero token moves the end sixty days out again", () => {
    expect(grantExpiryAfterRefresh("xero", { now: NOW, rotated: true })).toBe(
      "2026-11-18T10:00:00.000Z",
    );
  });

  it("Google's unrotated refresh token keeps the end its consent recorded", () => {
    for (const source of ["gmail", "drive", "drive.a1b2c3d4e5f6"]) {
      expect(grantExpiryAfterRefresh(source, { now: NOW, rotated: false })).toBe("unchanged");
    }
  });

  it("a rotated token from a provider that dates nothing has no known end", () => {
    expect(grantExpiryAfterRefresh("demo", { now: NOW, rotated: true })).toBeNull();
  });
});
