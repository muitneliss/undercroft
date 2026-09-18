/**
 * Which language the manual is printed in.
 *
 * Two plates side by side, never a dropdown. A control that hides the language you are not
 * reading in is useless to the person who most needs it -- someone who opened the app in a
 * language they cannot read, and who therefore cannot find a menu labelled "Language". Both
 * faces are always on the page, and each carries its own name in its own language, so
 * "English" is legible to a reader of Vietnamese and "Tiếng Việt" to a reader of English.
 *
 * The short face is what is drawn; the full name is the accessible name. A screen reader
 * that announced "VEE EYE" would say nothing useful, and `lang` on the button is what makes
 * "Tiếng Việt" come out in Vietnamese phonemes rather than mangled through an English voice.
 *
 * No `useState`, and not because the rule says so: the chosen language is read in three
 * places -- here, the i18next instance, and the tRPC link's `accept-language` header -- so a
 * local copy would be exactly the third unowned source of truth `state.md` describes.
 */

// biome-ignore-all lint/a11y/useSemanticElements: The rule suggests <fieldset> for role="group". A fieldset takes its accessible name from a <legend> and brings default borders and box model that the design system would immediately have to undo; the explicit role plus aria-label gives assistive technology exactly the same grouping.
// biome-ignore-all lint/performance/noJsxPropsBind: Inline handlers on components that render a handful of rows. The re-render the rule is about matters under a memoised list of hundreds; these lists are bounded by how many connections a tenant has.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { LOCALES, type Locale } from "@undercroft/core/locale";
import { useTranslation } from "react-i18next";

import { useUiStore } from "@/store.ts";

const SHORT = { vi: "lang.viShort", en: "lang.enShort" } as const;
const FULL = { vi: "lang.vi", en: "lang.en" } as const;

export function LanguageSwitcher(): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const setLocale = useUiStore((state) => state.setLocale);

  return (
    <div className="langset" role="group" aria-label={t("lang.label")}>
      {LOCALES.map((candidate: Locale) => (
        <button
          key={candidate}
          type="button"
          className="plate plate--small"
          lang={candidate}
          aria-pressed={locale === candidate}
          onClick={(): void => {
            setLocale(candidate);
          }}
        >
          <span aria-hidden="true">{t(SHORT[candidate])}</span>
          <span className="visually-hidden">{t(FULL[candidate])}</span>
        </button>
      ))}
    </div>
  );
}
