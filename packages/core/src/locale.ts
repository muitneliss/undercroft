/**
 * Which language a reader is being answered in.
 *
 * It lives in `core` rather than in the UI because the answer has to be the same on both
 * sides of the wire: the browser renders in it, and the control plane composes an
 * invitation email and a refusal message in it. Two definitions of "which languages exist"
 * is how a locale the client can select becomes a locale the server silently ignores.
 *
 * **Vietnamese is the default, and that is a product decision, not a fallback.** The people
 * who operate this control plane read Vietnamese; English is the second language, carried
 * for the colleagues and auditors who do not. So an unreadable or absent preference lands
 * on `vi`, never on `en`.
 *
 * `parseLocale` refuses rather than guesses, per rule 2 in CLAUDE.md: a string that is not
 * one of ours returns `null` and the caller decides what absence means. `negotiateLocale` is
 * the caller that decides, and it says so in its own name -- picking a default is a
 * deliberate step with a documented rule, not a shrug inside a parser.
 *
 * ## Also exported as `@undercroft/core/locale`
 *
 * The browser imports the subpath, never the root barrel. `index.ts` re-exports `ids.ts`,
 * which imports `node:crypto`; pulling the barrel into the SPA fails the Vite build outright,
 * and the day it stops failing is the day a Node built-in is shimmed into the bundle that
 * holds the session. Same reasoning as `@undercroft/db`'s `./repos` and `./services`.
 */

export type Locale = "vi" | "en";

/** Every locale this platform speaks, in the order it speaks them. */
export const LOCALES: readonly Locale[] = ["vi", "en"] as const;

/** What a reader gets when they have expressed no readable preference. */
export const DEFAULT_LOCALE: Locale = "vi";

/** A `q` value of zero, in any of its spellings: the client refusing that language. */
const ZERO_WEIGHT = /^0(\.0+)?$/u;

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Read a locale tag, or `null` when it is not one of ours.
 *
 * The primary subtag is what is compared, so `vi-VN` and `en-SG` resolve; a region we do
 * not distinguish must not be a reason to fail. Anything else -- `fr`, `""`, `undefined` --
 * is unreadable, and unreadable is reported rather than rounded to a language.
 */
export function parseLocale(value: string | null | undefined): Locale | null {
  if (value === null || value === undefined) {
    return null;
  }
  const primary = value.trim().toLowerCase().split("-")[0] ?? "";
  return isLocale(primary) ? primary : null;
}

/**
 * The locale for one request, from its `Accept-Language` header.
 *
 * Entries are taken in descending q-order, and the first one we speak wins; a header that
 * names none of them, or no header at all, is answered in {@link DEFAULT_LOCALE}. A missing
 * `q` is 1 by RFC 9110, and `q=0` means "not acceptable", so it is dropped rather than
 * ranked last.
 */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (header === null || header === undefined) {
    return DEFAULT_LOCALE;
  }

  const ranked = header
    .split(",")
    .map((entry) => {
      const [tag = "", ...params] = entry.split(";").map((part) => part.trim());
      const q = params.find((p) => p.startsWith("q="))?.slice(2);
      // parseFloat is banned repo-wide and this is a weight, not an amount -- but the ban
      // is absolute on purpose, so the three weights that can change the outcome are
      // compared as strings instead of parsed into one.
      return { locale: parseLocale(tag), weight: q === undefined ? "1" : q };
    })
    .filter((entry): entry is { locale: Locale; weight: string } => entry.locale !== null)
    .filter((entry) => !ZERO_WEIGHT.test(entry.weight))
    .sort((a, b) => b.weight.localeCompare(a.weight, "en"));

  return ranked[0]?.locale ?? DEFAULT_LOCALE;
}
