/**
 * How this extractor runs a native program, and how it tells "not installed" apart from "ran
 * and failed".
 *
 * THE BINARIES ARE INVOKED, NOT IMPORTED. `pdftotext` is poppler and `tesseract` is tesseract;
 * both are native programs that ship in the worker image, in exactly the category `CLAUDE.md`
 * already grants dbt -- "an invoked dependency in its own container". No Python enters this
 * repo's source to read a PDF, and none needs to.
 *
 * SPAWN IS INJECTED, for the reason `transform.ts` injects it: the offline gate runs with no
 * Docker, no network and no credentials, and therefore with neither of those binaries. A test
 * passes a spawn that answers as the program would; the process passes one that runs it. The
 * shape is deliberately `transform.ts`'s, not a second one -- a second way to spawn a child is
 * a second place for a timeout to be forgotten.
 *
 * A MISSING BINARY IS A REFUSAL, NOT A CRASH. An image with no `tesseract` behind it is
 * recorded as `extractor-missing:tesseract` and the run stays green. The alternative -- failing
 * the run -- turns one absent package into "your documents did not extract", which is both
 * less true and less actionable than the name of the program to install.
 *
 * IT IS ITS OWN MODULE rather than a private function in `extractText.ts` because two things
 * now need it: the dispatcher, for `pdftotext`, and `ocr.ts`, for `tesseract`. The dispatcher
 * imports `ocr.ts` to reach the image reader, so `ocr.ts` reaching back for a spawn helper
 * would make the two modules import each other -- and a cycle here is how the one place that
 * knows what an absent binary means quietly becomes two.
 */

import type { Spawn, SpawnOptions } from "../transform.ts";
import type { OpenAttestationDeps } from "./openAttestationVerify.ts";

export interface ExtractDeps {
  /** Injected in tests; the process passes one that runs the real program. */
  readonly spawn: Spawn;
  /** Where a document's bytes are written for a binary to open. One directory per document. */
  readonly workDir: string;
  /**
   * How long ONE child may run, and -- for a reader that spends it across several -- how long
   * the whole document may take. A 200-page scan is slow; a hung child must still end.
   */
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Milliseconds since the epoch, injected so a deadline can be tested without waiting.
   *
   * It exists because one reader spends the budget above across SEVERAL children: a scanned
   * PDF is one `pdftoppm` and up to thirty `tesseract` runs, and passing `timeoutMs` to each
   * of them would hand that one document thirty times the deadline every other reader gets.
   * `ocr.ts` divides it instead, which it can only do by asking what time it is between
   * children. Nothing else here needs a clock, so it stays optional.
   */
  readonly now?: () => number;
  /** The DNS an OpenAttestation issuer's identity is checked against. `openAttestation.ts`. */
  readonly openAttestation?: OpenAttestationDeps;
}

/** Long enough for a large scan, short enough that a hung child does not hold the run open. */
export const DEFAULT_EXTRACT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * What every "the program is not here" reason starts with.
 *
 * Its own constant because two callers now need the same string for opposite purposes: the
 * function below WRITES one, and `accuracy.ts` READS one back, to tell a machine that lacks
 * poppler apart from a reader that got the document wrong. Those are different facts and a
 * measurement that confused them would report a clean score for a document nothing opened.
 */
export const EXTRACTOR_MISSING = "extractor-missing:";

/**
 * `extractor-missing:<program>` carries the program's name because that IS the fix: "install
 * poppler-utils" is a different afternoon from "the PDF is corrupt", and a bare "could not
 * read" makes them look identical.
 */
export function extractorMissing(program: string): string {
  return `${EXTRACTOR_MISSING}${program}`;
}

/**
 * Run one program and hand back its stdout, or say it is not installed.
 *
 * `Bun.spawn` raises rather than exiting non-zero when the executable does not exist, so the
 * "not installed" case arrives as a thrown error and not as a status code. Both end here, and
 * both are told apart from "the program ran and failed" by the caller, which is why this
 * returns a tagged result instead of a string.
 *
 * THE TIMEOUT IS CAUGHT HERE AND NOWHERE ELSE. A killed child is a child that did not finish,
 * which is a fact about this document; a sibling project let a `pdftotext` timeout escape to
 * its caller and lost the whole document from its shard rather than just the text. A reader
 * that added a path around this would put that back.
 *
 * A FAILED RUN KEEPS WHAT THE PROGRAM SAID. One exit code covers several causes -- `pdftotext`
 * exits 1 for a corrupt file and for a password-protected one alike -- so a reader that can
 * name the cause needs the diagnostic, and one that cannot simply ignores it. A program that
 * never started said nothing, which is the empty string.
 */
export async function runProgram(
  deps: ExtractDeps,
  cmd: readonly string[],
): Promise<{ ok: true; output: string } | { ok: false; missing: boolean; output: string }> {
  const options: SpawnOptions = {
    cwd: deps.workDir,
    env: deps.env ?? {},
    timeoutMs: deps.timeoutMs ?? DEFAULT_EXTRACT_TIMEOUT_MS,
  };
  try {
    const { exitCode, output } = await deps.spawn(cmd, options);
    return exitCode === 0 ? { ok: true, output } : { ok: false, missing: false, output };
  } catch {
    // A spawn that could not start at all. Treated as "the program is not here", which is
    // what it means in practice and what the operator can fix.
    return { ok: false, missing: true, output: "" };
  }
}
