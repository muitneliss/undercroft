import { describe, expect, it } from "bun:test";
import { LOCALES } from "@undercroft/core/locale";
import { catalogues, type MessageKey, messages } from "./index.ts";

/** Every leaf's dotted path. */
function keys(node: object, prefix = ""): string[] {
  return Object.entries(node).flatMap(([name, value]: [string, unknown]) =>
    typeof value === "object" && value !== null
      ? keys(value, `${prefix}${name}.`)
      : [`${prefix}${name}`],
  );
}

function byName(a: string, b: string): number {
  return a.localeCompare(b);
}

describe("the desktop app's catalogues", () => {
  it("answer the same keys in Vietnamese and English", () => {
    expect(keys(catalogues.en).toSorted(byName)).toEqual(keys(catalogues.vi).toSorted(byName));
  });

  it("never render a key as its own text, in either language", () => {
    const every = keys(catalogues.vi) as MessageKey[];
    for (const locale of LOCALES) {
      const t = messages(locale);
      expect(every.filter((key) => t(key) === key || t(key).trim() === "")).toEqual([]);
    }
  });
});
