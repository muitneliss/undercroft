/**
 * A check's answer as a caller reads it: each finding and each thing it could not verify, with
 * its sentence in the caller's language.
 *
 * One function for `models.check` and `macros.check`, because both answer in the same words
 * (`modelFindings.ts`) and a second copy of the mapping is where the two answers would start to
 * differ. A finding code is also the reason `macros.save` refuses a definition, so the refusal
 * reads the same sentence through `findingSentence`.
 */

import type { Locale } from "@undercroft/core";
import type { Finding, FindingCode, ModelCheck, UnverifiedCode } from "@undercroft/db/services";

import { messages } from "../i18n/index.ts";

export interface WordedCheck {
  readonly findings: (Finding & { readonly message: string })[];
  readonly unverified: { readonly code: UnverifiedCode; readonly message: string }[];
}

export function findingSentence(locale: Locale, code: FindingCode, subject: string | null): string {
  return messages(locale)(`modelCheck.finding.${code}`, { subject: subject ?? "" });
}

/** A finding's sentence, led by the test it is in when it is about one of the model's tests. */
export function testedFindingSentence(locale: Locale, finding: Finding): string {
  const message = findingSentence(locale, finding.code, finding.subject);
  return finding.test === undefined
    ? message
    : messages(locale)("modelCheck.inTest", { test: finding.test, message });
}

export function wordCheck(locale: Locale, checked: ModelCheck): WordedCheck {
  const t = messages(locale);
  return {
    findings: checked.findings.map((finding) => ({
      ...finding,
      message: testedFindingSentence(locale, finding),
    })),
    unverified: checked.unverified.map((code) => ({
      code,
      message: t(`modelCheck.unverified.${code}`),
    })),
  };
}
