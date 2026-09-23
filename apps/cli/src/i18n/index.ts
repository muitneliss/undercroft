/**
 * The CLI's catalogue, reachable only through `messages` and `procedureSentence`.
 *
 * The same shape as `apps/control-plane/src/i18n` and for the same reasons: its own i18next
 * instance rather than the process singleton, a hand-rolled key type so the compiler checks
 * every key, and `en` annotated as `typeof vi` so a key Vietnamese declares cannot be left
 * unanswered in English.
 *
 * The locale is decided once, in `main.ts`, from `--lang` -- and a translator that consulted
 * ambient state could not be told which one that was.
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
  // Off: nothing here is markup. Escaping would put `&#39;` into a terminal and into the
  // `message` of a JSON envelope, where nobody renders HTML.
  interpolation: { escapeValue: false },
});

/** The words for one run of the CLI, in the language it was asked for. */
export function messages(locale: Locale): Translate {
  const t = instance.getFixedT(locale);
  return (key, vars): string => t(key, key, vars ?? {});
}

function isBranch(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

/**
 * The sentence that describes one procedure, found by its dotted path, or `null`.
 *
 * Walked by hand rather than asked of i18next, because i18next answers a missing key with
 * the key itself, and `runs.trigger` printed as a description looks like a description.
 * `null` is what lets the build refuse a procedure nobody described.
 */
export function procedureSentence(locale: Locale, path: string): string | null {
  let node: unknown = (locale === "en" ? english : vi).procedures;
  for (const segment of path.split(".")) {
    node = isBranch(node) ? node[segment] : undefined;
  }
  return typeof node === "string" ? node : null;
}

/** The sentence for a topic by its oclif id (`bi:questions`), or `null`. See `vi.topics`. */
export function topicSentence(locale: Locale, topic: string): string | null {
  const key = topic
    .split(":")
    .map((word, index) => (index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join("");
  const sentence: unknown = Reflect.get((locale === "en" ? english : vi).topics, key);
  return typeof sentence === "string" ? sentence : null;
}
