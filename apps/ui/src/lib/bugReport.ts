/**
 * The address of a bug report that already says which request failed, and on which build.
 *
 * One module because it is one piece of knowledge: where the issue form lives, which template
 * it is, and the ids of the two fields it prefills. GitHub's issue forms take a field's value
 * from a query parameter named by that field's `id` in `.github/ISSUE_TEMPLATE/bug_report.yml`,
 * so renaming either id there silently turns the prefill into an empty box -- this is the only
 * place in the UI that names them.
 *
 * The version is `RELEASE`, the same stamp the colophon prints, never a second source: a
 * report that names a different build from the one on the reader's screen sends whoever
 * triages it to the wrong code.
 */

import { RELEASE } from "@/lib/release.ts";

const ISSUE_FORM = "https://github.com/muitneliss/undercroft/issues/new";

/** A new bug report prefilled with the request's trace id and this tab's release. */
export function bugReportUrl(traceId: string): string {
  const url = new URL(ISSUE_FORM);
  url.searchParams.set("template", "bug_report.yml");
  url.searchParams.set("trace-id", traceId);
  url.searchParams.set("version", RELEASE);
  return url.toString();
}
