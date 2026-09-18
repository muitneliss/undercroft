/**
 * The control plane's own catalogue, for the few things it says to a person.
 *
 * Two emails and four refusals. Everything else this server produces is read by a
 * TypeScript client, and a code is not a sentence -- `trpc.ts` deliberately strips the
 * message off an INTERNAL_SERVER_ERROR for exactly that reason.
 *
 * ## Why the server translates at all, rather than sending the UI a code
 *
 * An email is the case that settles it. Nobody's browser is open when an invitation is
 * sent, so there is no client to localise it; the only place that can know which language
 * to write it in is the request that asked for it. Once the server has to hold a catalogue
 * for that, having the same request's refusals come back already worded is the smaller
 * surface -- the alternative is a parallel set of error codes that the UI maps, which is
 * two things to keep in step instead of one.
 *
 * The locale arrives as `Accept-Language` and is resolved once per request in
 * `handlers/server.ts`, onto `Context.locale`.
 *
 * ## Its own instance, not the process default
 *
 * `createInstance()` rather than the `i18next` singleton: the singleton is global state,
 * and a worker or a test that loaded a different catalogue into it would silently change
 * what this server writes. This one is reachable only through `messages`.
 */

// biome-ignore-all lint/complexity/noVoid: `void` here marks a promise deliberately not awaited, at the two places where that is correct and where dropping the marker would make it look like an oversight.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.

import { DEFAULT_LOCALE, LOCALES, type Locale } from "@undercroft/core";
import { createInstance } from "i18next";

import { en } from "./en.ts";
import { vi } from "./vi.ts";

/** Every key in `vi` is answered by `en`, checked by the compiler. */
const english: typeof vi = en;

/**
 * The dotted key paths of a catalogue, as a type.
 *
 * Hand-rolled rather than taken from i18next's `CustomTypeOptions`, because that
 * augmentation is global to a TypeScript program and the UI already owns it for its own,
 * much larger catalogue. Two augmentations of one module would fight; this stays local.
 */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends object ? `${K}.${Leaves<T[K]>}` : K;
}[keyof T & string];

export type MessageKey = Leaves<typeof vi>;

const instance = createInstance();

void instance.init({
  resources: { vi: { translation: vi }, en: { translation: english } },
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: LOCALES,
  // These are plain-text emails and HTTP error messages, never HTML. i18next's escaping is
  // for interpolating into markup; leaving it on would put `&#39;` in an email body and in
  // a customer's name inside a refusal.
  interpolation: { escapeValue: false },
});

/**
 * The words for one request, in the language it asked for.
 *
 * Takes the locale rather than reading one from anywhere: `handlers/server.ts` resolved it
 * from this request's headers, and a translator that consulted ambient state would answer
 * two concurrent requests in whichever language arrived last.
 */
export function messages(
  locale: Locale,
): (key: MessageKey, vars?: Record<string, string>) => string {
  const t = instance.getFixedT(locale);
  // The key is passed as its own default, which is the i18next overload that accepts a key
  // whose type is a plain string. It has to be that overload: `apps/ui` augments i18next's
  // `CustomTypeOptions` with the UI catalogue, and because the UI imports the router as a
  // type, these files are compiled inside the UI's program too -- where the typed `t` would
  // only accept a UI key. Behaviour is unchanged: i18next already returns the key when it
  // cannot resolve one, and `i18n.test.ts` asserts that no key here is left unresolved.
  return (key, vars): string => t(key, key, vars ?? {});
}
