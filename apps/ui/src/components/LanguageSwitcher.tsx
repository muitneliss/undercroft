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

import { LOCALES, type Locale } from "@undercroft/core/locale";
import { useTranslation } from "react-i18next";

import { useUiStore } from "@/store";

const SHORT = { vi: "lang.viShort", en: "lang.enShort" } as const;
const FULL = { vi: "lang.vi", en: "lang.en" } as const;

export function LanguageSwitcher() {
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
          onClick={() => {
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
