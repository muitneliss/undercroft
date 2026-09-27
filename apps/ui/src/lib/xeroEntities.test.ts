/**
 * The Xero picker offers exactly the entities the shipped spec declares, in its order, each
 * named in both languages.
 *
 * The list is a hand copy -- the interface does not read specs -- so this is what keeps it
 * honest. An entity the spec declares and the picker lacks can never be ticked on its own; one
 * the picker offers and the spec lacks is a tick that reads nothing. Issue 271 added nine at once.
 */

import { describe, expect, test as it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpec } from "@undercroft/contracts";

import { translatorFor } from "@/i18n/index.ts";

import { describeXeroEntity, XERO_ENTITIES } from "./xeroEntities.ts";

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

describe("the Xero entities the picker offers", () => {
  it("are the shipped spec's, in the spec's order", () => {
    const declared = parseSpec(readFileSync(XERO_SPEC, "utf8")).entities.map((e) => e.name);
    const offered: readonly string[] = XERO_ENTITIES;

    expect([...offered]).toEqual(declared);
  });

  it("each have a word in both languages, never their id", () => {
    for (const locale of ["vi", "en"] as const) {
      const t = translatorFor(locale);
      const unnamed = XERO_ENTITIES.filter((entity) => {
        const word = describeXeroEntity(t, entity);
        return word === entity || word.startsWith("scope.");
      });

      expect(unnamed).toEqual([]);
    }
  });
});
