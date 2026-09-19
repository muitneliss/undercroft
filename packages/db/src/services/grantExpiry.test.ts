import { describe, expect, test as it } from "bun:test";

import { grantExpiryFor } from "./grantExpiry.ts";

const NOW = new Date("2026-09-19T10:00:00.000Z");

describe("grantExpiryFor", () => {
  it("a Xero grant lapses sixty days after it was last renewed", () => {
    expect(grantExpiryFor("xero", NOW)).toBe("2026-11-18T10:00:00.000Z");
  });

  it("a provider that announces no end gets none, never a guess", () => {
    for (const source of ["gmail", "drive", "hubspot", "demo"]) {
      expect(grantExpiryFor(source, NOW)).toBeNull();
    }
  });
});
