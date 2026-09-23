/**
 * What a refusal reason MEANS, and whether anybody has to do anything about it.
 *
 * The worker records a code -- `image-too-small-to-read`, `extractor-missing:pdftotext` -- and
 * the whole sentence lives here, because a code is not a language (`i18n.md`) and an operator
 * should not have to learn the vocabulary to read the page. The code is still printed beside
 * the sentence in mono: somebody quoting a refusal to a developer needs the code, not the
 * translation of it.
 *
 * THE SEVERITY IS THE POINT, not decoration. 230 email signature images under the OCR size gate
 * and one missing `pdftotext` binary are both "refused", and until now they rendered
 * identically -- which is how a perfectly healthy run came to look like a fault and sent
 * somebody to an SSH session. ADR 0039.
 *
 * WHICH IS WHICH IS THE TWO LISTS BELOW, and they are the only place it is written down.
 * `DOCUMENT_REASONS` is a fact about a document that nobody can act on; `DEPLOYMENT_REASONS`
 * is a fact about this deployment that somebody can. Severity is DERIVED from which list a
 * code is in, so there is no second table to fall out of step with the sentences: a reason
 * cannot be given words without first being put in a list, and a reason added to a list
 * without words is a compile error. There is deliberately no third list -- a "maybe" would be
 * read as an act by the anxious and a benign by the tired.
 *
 * A REASON IN NEITHER LIST RENDERS ITS CODE AND SAYS SO. That is a visible gap rather than a
 * blank, and it matters because the ingest verbs refuse with their own vocabulary out of the
 * connector runtime -- a reason added to the worker with no word added here should look
 * unfinished, not look like nothing happened.
 */

import type { TFunction } from "i18next";

/** Whether a reader can act on this, or it is simply what the document is. */
export type ReasonSeverity = "benign" | "act";

/** Facts about a document. Nobody can fix these and nobody should try. */
const DOCUMENT_REASONS = [
  "image-too-small-to-read",
  "ocr-found-nothing",
  "document-has-no-bytes",
  "legacy-doc-unsupported",
  "legacy-xls-unsupported",
  "unsupported-content-type",
] as const;

/** Facts about this deployment. Each one has somebody who can act. */
const DEPLOYMENT_REASONS = [
  "pdftotext-failed",
  "pdftoppm-failed",
  "tesseract-failed",
  "ocr-out-of-time",
  "xlsx-unreadable",
  "docx-unreadable",
  "lake-object-unreadable",
] as const;

type DocumentReason = (typeof DOCUMENT_REASONS)[number];
type DeploymentReason = (typeof DEPLOYMENT_REASONS)[number];

/** The prefix `extractorMissing` writes in the worker, with the program after the colon. */
const EXTRACTOR_MISSING = "extractor-missing:";

/** Sets rather than array scans: the membership question is asked once per rendered row. */
const DOCUMENT_SET: ReadonlySet<string> = new Set(DOCUMENT_REASONS);
const DEPLOYMENT_SET: ReadonlySet<string> = new Set(DEPLOYMENT_REASONS);

function isDocumentReason(code: string): code is DocumentReason {
  return DOCUMENT_SET.has(code);
}

function isDeploymentReason(code: string): code is DeploymentReason {
  return DEPLOYMENT_SET.has(code);
}

export interface PresentedReason {
  /** The raw code, always shown: it is what an operator quotes to a developer. */
  readonly code: string;
  /** One sentence saying what happened. */
  readonly title: string;
  /** What to do about it, or that there is nothing to do. */
  readonly note: string;
  readonly severity: ReasonSeverity;
  /** False when this codebase has no words for the code -- a gap, drawn as one. */
  readonly known: boolean;
}

/**
 * The severity of one code, translator not required.
 *
 * Wordless, beside the worded function below: a decision that needs no sentence gets its own
 * function, so a caller choosing a heading does not have to render one to ask (`i18n.md`).
 * Anything not in the benign list counts as actionable -- the safe direction, since the
 * alternative is telling a reader there is nothing to do about a reason we cannot name.
 */
export function severityOf(code: string): ReasonSeverity {
  return isDocumentReason(code) ? "benign" : "act";
}

/** Does anything in this rollup need a person? The question the band's heading answers. */
export function anyActionable(reasons: readonly { readonly reason: string }[]): boolean {
  return reasons.some(({ reason }) => severityOf(reason) === "act");
}

/**
 * A reason as a reader should meet it.
 *
 * Takes `t` rather than reaching for a global translator, which is what lets one test render
 * both languages in a single run (`i18n.md`).
 */
export function presentReason(t: TFunction, code: string): PresentedReason {
  if (code.startsWith(EXTRACTOR_MISSING)) {
    const program = code.slice(EXTRACTOR_MISSING.length);
    return {
      code,
      title: t("journal.reason.extractorMissing", { program }),
      note: t("journal.reason.extractorMissingNote", { program }),
      severity: "act",
      known: true,
    };
  }
  if (isDocumentReason(code)) {
    return { code, severity: "benign", known: true, ...aboutTheDocument(t, code) };
  }
  if (isDeploymentReason(code)) {
    return { code, severity: "act", known: true, ...aboutTheDeployment(t, code) };
  }
  return {
    code,
    title: t("journal.reason.unknown"),
    note: t("journal.reason.unknownNote"),
    severity: "act",
    known: false,
  };
}

/** A reason's two sentences. */
interface Words {
  title: string;
  note: string;
}

/**
 * Spelled out as a switch rather than as a table of key fragments.
 *
 * `t` is typed against `vi.ts`, so a key built by interpolation is not a key as far as the
 * compiler is concerned, and a typo in one would ship as a raw string on a page.
 * `eventSentence` in `runs.ts` is written out for the same reason.
 */
function aboutTheDocument(t: TFunction, code: DocumentReason): Words {
  switch (code) {
    case "image-too-small-to-read":
      return {
        title: t("journal.reason.imageTooSmall"),
        note: t("journal.reason.imageTooSmallNote"),
      };
    case "ocr-found-nothing":
      return {
        title: t("journal.reason.ocrFoundNothing"),
        note: t("journal.reason.ocrFoundNothingNote"),
      };
    case "document-has-no-bytes":
      return { title: t("journal.reason.noBytes"), note: t("journal.reason.noBytesNote") };
    case "legacy-doc-unsupported":
      return { title: t("journal.reason.legacyDoc"), note: t("journal.reason.legacyDocNote") };
    case "legacy-xls-unsupported":
      return { title: t("journal.reason.legacyXls"), note: t("journal.reason.legacyXlsNote") };
    case "unsupported-content-type":
      return {
        title: t("journal.reason.unsupportedType"),
        note: t("journal.reason.unsupportedTypeNote"),
      };
    default: {
      const exhaustive: never = code;
      throw new Error(`unhandled document reason ${String(exhaustive)}`);
    }
  }
}

function aboutTheDeployment(t: TFunction, code: DeploymentReason): Words {
  switch (code) {
    case "pdftotext-failed":
      return {
        title: t("journal.reason.pdftotextFailed"),
        note: t("journal.reason.pdftotextFailedNote"),
      };
    case "pdftoppm-failed":
      return {
        title: t("journal.reason.pdftoppmFailed"),
        note: t("journal.reason.pdftoppmFailedNote"),
      };
    case "tesseract-failed":
      return {
        title: t("journal.reason.tesseractFailed"),
        note: t("journal.reason.tesseractFailedNote"),
      };
    case "ocr-out-of-time":
      return {
        title: t("journal.reason.ocrOutOfTime"),
        // biome-ignore lint/security/noSecrets: a catalogue key long enough to read as high entropy.
        note: t("journal.reason.ocrOutOfTimeNote"),
      };
    case "xlsx-unreadable":
      return {
        title: t("journal.reason.xlsxUnreadable"),
        note: t("journal.reason.xlsxUnreadableNote"),
      };
    case "docx-unreadable":
      return {
        title: t("journal.reason.docxUnreadable"),
        note: t("journal.reason.docxUnreadableNote"),
      };
    case "lake-object-unreadable":
      return {
        title: t("journal.reason.lakeUnreadable"),
        note: t("journal.reason.lakeUnreadableNote"),
      };
    default: {
      const exhaustive: never = code;
      throw new Error(`unhandled deployment reason ${String(exhaustive)}`);
    }
  }
}
