/**
 * The desktop app's catalogue, reachable only through `messages`.
 *
 * The same shape as `apps/installer-cli/src/i18n` and for the same reasons: its own i18next
 * instance, a key type the compiler checks, and `en` annotated as `typeof vi` so a key
 * Vietnamese declares cannot be left unanswered in English.
 *
 * Both processes word through it: the main process for the tray and its dialogs, the webview
 * for the wizard. Neither reads the language from anywhere ambient. The wizard's store owns the
 * reader's choice and the view asks `messages` for it on every render; the main process is told
 * the choice over RPC and rewords the tray. A translator holding a language of its own would be
 * a second copy of that choice, and the two would disagree the moment the first step changed it.
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

export const catalogues = { vi, en: english } as const;

const instance = createInstance();

void instance.init({
  resources: { vi: { translation: vi }, en: { translation: english } },
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: LOCALES,
  // Off: React escapes what the view renders, and a native menu or dialog does not read `&lt;`.
  interpolation: { escapeValue: false },
  // i18next is synchronous with in-memory resources only when told so; the first render must
  // not paint raw keys while an init promise settles.
  initAsync: false,
});

/** The words in `locale`. */
export function messages(locale: Locale): Translate {
  const t = instance.getFixedT(locale);
  return (key, vars): string => t(key, key, vars ?? {});
}
