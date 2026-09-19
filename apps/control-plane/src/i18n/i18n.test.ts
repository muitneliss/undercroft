/**
 * The catalogue, and the email it composes.
 *
 * Almost nothing this server produces is read by a person, so what little is has to be
 * right. The invitation is the sharpest case: it goes to somebody who has never signed in,
 * it is the only thing they receive before they can use the product, and nobody sees it
 * before it is sent -- there is no screen on which a bad translation would be noticed.
 *
 * `index.ts` pins that `en` answers every key `vi` has. What it cannot pin is the reverse
 * (a key left in `en` after `vi` dropped it) or the case where a catalogue answers with the
 * key itself, which looks like text and satisfies any "is it non-empty" check.
 */

// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.

import { describe, expect, test as it } from "bun:test";

import { invitationMessage } from "../services/people.ts";
import { en } from "./en.ts";
import { messages } from "./index.ts";
import { vi } from "./vi.ts";

function isBranch(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function keys(catalogue: Record<string, unknown>, prefix = ""): Set<string> {
  const found = new Set<string>();
  for (const [name, value] of Object.entries(catalogue)) {
    const path = prefix === "" ? name : `${prefix}.${name}`;
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

describe("the catalogues", () => {
  it("answer exactly the same keys as each other", () => {
    expect([...keys(en)].sort()).toEqual([...keys(vi)].sort());
  });

  it("answer every key with a sentence rather than with the key itself", () => {
    for (const locale of ["vi", "en"] as const) {
      const t = messages(locale);
      for (const key of keys(vi)) {
        expect(t(key as Parameters<typeof t>[0])).not.toBe(key);
      }
    }
  });
});

describe("the invitation email", () => {
  const args = ["ada@example.test", "CASE-0042", "https://app.example.test"] as const;

  it("is written in the language it was asked for", () => {
    const vietnamese = invitationMessage(...args, "vi");
    const english = invitationMessage(...args, "en");

    expect(vietnamese.subject).not.toBe(english.subject);
    expect(vietnamese.text).toContain("Hãy đăng nhập tại");
    expect(english.text).toContain("Sign in at");
  });

  it("tells the reader all three things they need, in both languages", () => {
    // Which customer, where to sign in, and which address to use. An interpolation that
    // silently stopped resolving would leave `{{publicUrl}}` in an email nobody proofreads.
    for (const locale of ["vi", "en"] as const) {
      const message = invitationMessage(...args, locale);

      expect(message.to).toBe("ada@example.test");
      expect(message.text).toContain("CASE-0042");
      expect(message.text).toContain("https://app.example.test");
      expect(message.text).toContain("ada@example.test");
      expect(message.text).not.toContain("{{");
    }
  });
});
