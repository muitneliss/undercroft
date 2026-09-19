/**
 * Reading `UNDERCROFT_SUPERADMINS`.
 *
 * A pure function, so these are cheap -- but they are not busywork: this parse decides who
 * may act on every customer on the platform, and its failure mode is quiet. A separator the
 * parser mishandles produces a *plausible* configuration with the wrong people in it, which
 * is why "what does it refuse" is tested as carefully as "what does it accept".
 */

import { describe, expect, test as it } from "bun:test";
import { isSuperadmin, NO_SUPERADMINS, parseSuperadmins } from "./superadmin.ts";

describe("the list is comma-separated and normalised", () => {
  it("reads several addresses, trimming and lowercasing each", () => {
    const list = parseSuperadmins(" Ada@Example.test , bob@example.test ");

    expect([...list.addresses].toSorted()).toEqual(["ada@example.test", "bob@example.test"]);
    expect(list.rejected).toEqual([]);
  });

  it("matches an address the identity provider returns in a different case", () => {
    // Google lowercases; a person typing into the OTP form does not. Both must match the
    // same entry, or the panel looks right and nobody can get in.
    const { addresses } = parseSuperadmins("Ada@Example.test");

    expect(isSuperadmin(addresses, "  ADA@EXAMPLE.TEST ")).toBe(true);
  });

  it("an unset variable names nobody", () => {
    const list = parseSuperadmins(undefined);

    expect(list.addresses.size).toBe(0);
    expect(list.rejected).toEqual([]);
  });

  it("a trailing comma is not reported as a mistake", () => {
    // Ordinary when a list is edited in a web form; reporting it would train the reader to
    // ignore the warning that matters.
    const list = parseSuperadmins("ada@example.test,");

    expect([...list.addresses]).toEqual(["ada@example.test"]);
    expect(list.rejected).toEqual([]);
  });
});

describe("an entry that is not an address is reported, not silently dropped", () => {
  it("the wrong separator is refused rather than read as one absurd address", () => {
    // The failure this exists for: a semicolon yields ONE entry containing two addresses,
    // which would otherwise be accepted as a single unmatchable string and leave the
    // platform with no administrators and no sign that anything was wrong.
    const list = parseSuperadmins("ada@example.test;bob@example.test");

    expect(list.addresses.size).toBe(0);
    expect(list.rejected).toEqual(["ada@example.test;bob@example.test"]);
  });

  it("a good entry beside a bad one still counts", () => {
    const list = parseSuperadmins("ada@example.test, not-an-address");

    expect([...list.addresses]).toEqual(["ada@example.test"]);
    expect(list.rejected).toEqual(["not-an-address"]);
  });
});

describe("membership of the list", () => {
  it("an address that is not on it is not a superadmin", () => {
    const { addresses } = parseSuperadmins("ada@example.test");

    expect(isSuperadmin(addresses, "mallory@example.test")).toBe(false);
  });

  it("an empty address is never a superadmin", () => {
    // An identity provider can return no address at all, and the answer has to be no.
    expect(isSuperadmin(new Set([""]), "")).toBe(false);
  });

  it("nobody is a superadmin when none are configured", () => {
    expect(isSuperadmin(NO_SUPERADMINS, "ada@example.test")).toBe(false);
  });
});
