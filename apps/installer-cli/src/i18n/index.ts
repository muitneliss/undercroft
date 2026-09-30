/**
 * The setup wizard's catalogue, reachable only through `messages`.
 *
 * The same shape as `apps/cli/src/i18n` and for the same reasons: its own i18next instance, a
 * key type the compiler checks, and `en` annotated as `typeof vi` so a key Vietnamese declares
 * cannot be left unanswered in English. The locale is decided once, in `main.ts`, and the
 * translator is handed down -- the wizard asks for the language as its first question, and a
 * translator that read ambient state could not follow that answer.
 */

import { DEFAULT_LOCALE, LOCALES, type Locale } from "@undercroft/core/locale";
import { createInstance } from "i18next";
import { en } from "./en.ts";
import { vi } from "./vi.ts";

/** Every key in `vi` is answered by `en`, checked by the compiler. */
const english: typeof vi = en;

type Leaves<T> = {
  [K in keyof T & string]: T[K] extends object ? `${K}.${Leaves<T[K]>}` : K;
}[keyof T & string];

export type MessageKey = Leaves<typeof vi>;

export type Translate = (key: MessageKey, vars?: Readonly<Record<string, string>>) => string;

const instance = createInstance();

void instance.init({
  resources: { vi: { translation: vi }, en: { translation: english } },
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: LOCALES,
  // Off: nothing here is markup, and a terminal does not render `&lt;`.
  interpolation: { escapeValue: false },
});

/** The words for one run of the wizard, in the language it was asked for. */
export function messages(locale: Locale): Translate {
  const t = instance.getFixedT(locale);
  return (key, vars): string => t(key, key, vars ?? {});
}
