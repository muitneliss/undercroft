/**
 * The first question, asked in both languages at once: every word after it depends on it.
 */

import type { Locale } from "@undercroft/core/locale";
import type { ReactNode } from "react";
import { useCommands, useT, useWizard } from "../context.ts";
import { Plates, StepFrame, StepNav } from "../fields.tsx";

/** Each language named in itself, which is how a person looks for their own. */
const LANGUAGES: readonly { readonly value: Locale; readonly label: string }[] = [
  { value: "vi", label: "Tiếng Việt" },
  { value: "en", label: "English" },
];

export function LanguageStep(): ReactNode {
  const t = useT();
  const locale = useWizard((wizard) => wizard.locale);
  const commands = useCommands();
  return (
    <StepFrame actions={<StepNav />} lead={t("language.lead")} title={t("language.title")}>
      <Plates
        chosen={locale}
        legend={t("steps.language")}
        name="language"
        onChoose={(chosen): void => void commands.chooseLanguage(chosen)}
        plates={LANGUAGES}
      />
    </StepFrame>
  );
}
