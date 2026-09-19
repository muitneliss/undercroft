/**
 * The i18next instance, and the one direction the language flows in.
 *
 * A module-level singleton, the same idiom `main.tsx` uses for the query client, the tRPC
 * client and `auth.ts` -- and blessed by `.claude/rules/state.md` for the same reason: this
 * is a browser-only SPA, so one instance per tab is correct.
 *
 * ## The store owns the language; i18next renders it
 *
 * i18next keeps a `language` of its own and react-i18next re-renders off it, which makes it
 * look like a second home for state next to the Zustand store. It is not, and the
 * subscription below is what keeps that true: the store is the only thing a button writes
 * to, and this module pushes every change down into i18next and onto `<html lang>`. Nothing
 * in the app calls `changeLanguage` directly.
 *
 * Going the other way -- letting the switcher call `i18n.changeLanguage` and reading the
 * language back out of react-i18next -- would put the user's choice inside a library, where
 * the store cannot see it, nothing persists it, and the tRPC link that has to send it to the
 * server would be reading a different value from the one the UI renders. That is the two
 * -values-that-should-be-one bug `state.md` exists to prevent, arriving through a
 * dependency instead of through `useState`.
 *
 * ## Keys are typechecked
 *
 * `CustomTypeOptions` below points i18next's types at `vi`, so `t("tenants.titel")` is a
 * compile error rather than a key rendered raw on the page. `vi` is the source of truth for
 * which keys exist; `english` pins that `en` answers all of them, and `i18n.test.ts` covers
 * what types cannot -- a plural form present in one catalogue and missing from the other.
 */

import { DEFAULT_LOCALE, LOCALES, type Locale } from "@undercroft/core/locale";
import i18next, { type TFunction } from "i18next";
import { initReactI18next } from "react-i18next";

import { useUiStore } from "@/store.ts";
import { en } from "./en.ts";
import { vi } from "./vi.ts";

/**
 * Every key in `vi` is answered by `en`, checked by the compiler.
 *
 * The annotation is the assertion: `en` may carry more (English pluralises, Vietnamese does
 * not), but it may never carry less, and a key added to `vi` alone fails `bun run typecheck`
 * rather than rendering as its own key in front of an English reader.
 */
const english: typeof vi = en;

export const resources = {
  vi: { translation: vi },
  en: { translation: english },
} as const;

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof vi };
  }
}

void i18next.use(initReactI18next).init({
  resources,
  lng: useUiStore.getState().locale,
  // Vietnamese, not English and not a language list: an unanswerable key falls back to the
  // product's own default rather than to whichever language happens to be first.
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: LOCALES,
  // React escapes for us. Leaving i18next's escaping on would render an apostrophe in a
  // customer's name as `&#39;` inside a text node that is already safe.
  interpolation: { escapeValue: false },
});

/**
 * Push the chosen language down into the two places that render it.
 *
 * `<html lang>` is not decoration: it is what tells a screen reader which voice to use and a
 * browser which hyphenation and quotation rules apply, and it is the one part of the page
 * React does not own.
 */
function project(locale: Locale): void {
  if (i18next.language !== locale) {
    void i18next.changeLanguage(locale);
  }
  document.documentElement.lang = locale;
}

project(useUiStore.getState().locale);
useUiStore.subscribe((state) => {
  project(state.locale);
});

/**
 * A `t` bound to one language, for callers that are not components.
 *
 * The pure libraries (`@/lib/connectionState`, `@/lib/when`, `@/lib/verdict`) take a `t`
 * rather than reaching for a global, which is what lets a test render the same card in both
 * languages in one run and compare them. Production code inside React should use
 * `useTranslation()` instead, so it re-renders when the language changes.
 */
export function translatorFor(locale: Locale): TFunction {
  return i18next.getFixedT(locale);
}

export { default as i18next } from "i18next";
