/**
 * Locale negotiation, and the one thing it must never do.
 *
 * A locale is chosen on every request, and the failure it can cause is silent: a reader
 * who asked for nothing gets answered in the wrong language and nothing raises. So the
 * default is asserted directly rather than inferred from a happy path, and `parseLocale` is
 * pinned from both sides -- it reads what it should and refuses what it should not.
 */

import { describe, expect, test as it } from "bun:test";

import { DEFAULT_LOCALE, negotiateLocale, parseLocale } from "./locale.ts";

describe("parseLocale", () => {
  it("reads a tag we speak, with or without a region", () => {
    expect(parseLocale("vi")).toBe("vi");
    expect(parseLocale("en-SG")).toBe("en");
    expect(parseLocale(" VI-vn ")).toBe("vi");
  });

  it("refuses a tag we do not speak rather than guessing one", () => {
    // The guard's quiet side. A parser that answered "vi" here would make every
    // unreadable preference indistinguishable from a real Vietnamese one.
    expect(parseLocale("fr")).toBeNull();
    expect(parseLocale("")).toBeNull();
    expect(parseLocale(null)).toBeNull();
    expect(parseLocale(undefined)).toBeNull();
  });
});

describe("negotiateLocale", () => {
  it("Vietnamese is what a request with no preference gets", () => {
    // Not a fallback: the operators read Vietnamese. If this ever returns "en" the
    // product's default language has changed without anyone deciding to change it.
    expect(DEFAULT_LOCALE).toBe("vi");
    expect(negotiateLocale(null)).toBe("vi");
    expect(negotiateLocale("")).toBe("vi");
    expect(negotiateLocale("fr-FR,de;q=0.8")).toBe("vi");
  });

  it("honours the highest-weighted language we speak, not header order", () => {
    expect(negotiateLocale("en-GB")).toBe("en");
    expect(negotiateLocale("fr-FR,en;q=0.9,vi;q=0.4")).toBe("en");
    expect(negotiateLocale("en;q=0.4,vi;q=0.9")).toBe("vi");
  });

  it("a language explicitly refused with q=0 is not selected", () => {
    // "en;q=0" means "not acceptable". Ranking it last instead of dropping it would
    // still select it when it is the only tag we recognise.
    expect(negotiateLocale("en;q=0")).toBe("vi");
    expect(negotiateLocale("vi;q=0,en;q=0.5")).toBe("en");
  });
});
