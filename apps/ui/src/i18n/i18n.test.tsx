/**
 * Two promises the type system cannot make, and one it cannot make alone.
 *
 * 1. **Every key is answered in both languages.** `@/i18n` pins that `en` carries every key
 *    `vi` does, but a plural form is invisible to that check: `caption_other` in Vietnamese
 *    and `caption_one` in English are different property names, so a catalogue could satisfy
 *    the compiler while leaving one plural branch untranslated. The symptom is a raw key
 *    like `tenants.caption_other` printed in front of a customer.
 *
 * 2. **Choosing a language actually changes the page.** The chain that has to hold is store
 *    -> i18next -> re-render -> `<html lang>`, across four modules and a library. Nothing
 *    about it is expressible as a type, and every link in it is one somebody could
 *    plausibly "simplify" away.
 *
 * No mocks: the real store, the real i18next instance, the real catalogues and a real route
 * component. `.claude/rules/tests.md` -- a suite that asserts a translator was called is
 * green whether or not the reader can read the page.
 */

// biome-ignore-all lint/nursery/useNamedCaptureGroup: These regexes match one thing and read it out of group 1 on the next line. A name helps a pattern with several groups; every one of these has one.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and deliberately not done here: hoisting these literals touches many files and belongs in its own commit where the diff is reviewable, rather than buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_LOCALE } from "@undercroft/core/locale";

import { LanguageSwitcher } from "@/components/LanguageSwitcher.tsx";
import { Lake } from "@/routes/Lake.tsx";
import { useUiStore } from "@/store.ts";
import { en } from "./en.ts";
import { translatorFor } from "./index.ts";
import { vi } from "./vi.ts";

/**
 * Every leaf path in a catalogue, with i18next's plural suffix removed.
 *
 * Stripping the suffix is the whole point: it turns the Vietnamese `caption_other` and the
 * English `caption_one`/`caption_other` into the one key `caption`, which is the thing the
 * two catalogues have to agree about.
 */
function isBranch(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function keys(catalogue: Record<string, unknown>, prefix = ""): Set<string> {
  const found = new Set<string>();
  for (const [name, value] of Object.entries(catalogue)) {
    const base = name.replace(/_(zero|one|two|few|many|other)$/u, "");
    const path = prefix === "" ? base : `${prefix}.${base}`;
    if (isBranch(value)) {
      for (const nested of keys(value, path)) {
        found.add(nested);
      }
    } else {
      found.add(path);
    }
  }
  return found;
}

afterEach(() => {
  // The store is a module singleton and `persist` writes to localStorage, so a test that
  // left it in English would hand the next one a language it did not choose.
  useUiStore.getState().setLocale(DEFAULT_LOCALE);
  // Said here rather than left to Testing Library's own registration, which lands in
  // whichever file imports it FIRST: a UI test file sorting ahead of this one takes the
  // cleanup with it, and these renders start leaking into each other a file later.
  cleanup();
});

describe("the catalogues", () => {
  it("answer exactly the same keys as each other", () => {
    const viKeys = [...keys(vi)].sort();
    const enKeys = [...keys(en)].sort();

    // Reported as sorted arrays rather than as `size`, so a failure names the missing key
    // instead of saying two numbers differ.
    expect(enKeys).toEqual(viKeys);
  });

  it("answer every key with a translation rather than with the key itself", () => {
    // i18next returns the key when it cannot resolve one, which looks like text and passes
    // any "is it non-empty" assertion. This is the check that does not.
    for (const locale of ["vi", "en"] as const) {
      const t = translatorFor(locale);
      for (const key of keys(vi)) {
        // The key is also passed as the default, which is the overload that accepts a key
        // computed at runtime. It changes nothing about what is being asserted: i18next
        // returns the default when it cannot resolve, and the default here IS the key.
        expect(t(key, key, { count: 2 })).not.toBe(key);
      }
    }
  });

  it("English agrees with its count and Vietnamese does not have to", () => {
    // The reason plurals go through i18next at all. A ternary in a component would have
    // produced "1 khách hàngs" the first time this catalogue was not English.
    expect(translatorFor("en")("tenants.caption", { count: 1 })).toBe("1 customer");
    expect(translatorFor("en")("tenants.caption", { count: 4 })).toBe("4 customers");
    expect(translatorFor("vi")("tenants.caption", { count: 1 })).toBe("1 khách hàng");
    expect(translatorFor("vi")("tenants.caption", { count: 4 })).toBe("4 khách hàng");
  });
});

describe("choosing a language", () => {
  it("Vietnamese is what a reader who has chosen nothing gets", () => {
    render(<Lake tenantId="CASE-0042" />);

    expect(screen.getByRole("heading", { name: "Hồ dữ liệu thô" })).toBeDefined();
  });

  it("pressing English rewrites the page and the document's language", async () => {
    render(
      <>
        <LanguageSwitcher />
        <Lake tenantId="CASE-0042" />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    expect(await screen.findByRole("heading", { name: "Raw lake" })).toBeDefined();
    expect(document.documentElement.lang).toBe("en");
    // The store is the owner, and the button wrote to it rather than to i18next directly.
    expect(useUiStore.getState().locale).toBe("en");
  });

  it("the language not in use stays on the page, so it can be pressed", () => {
    // A dropdown would hide it. The one reader who most needs this control is the one who
    // cannot read the label on it, which is why both faces are always drawn.
    render(<LanguageSwitcher />);

    expect(screen.getByRole("button", { name: "Tiếng Việt" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});
