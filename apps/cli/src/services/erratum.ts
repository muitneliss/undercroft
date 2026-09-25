/**
 * How a failure reads to a person, on stderr: the one red thing on any page.
 *
 * The code stays the first word after the label, so a person grepping a log for
 * `PERMISSION_DENIED` still finds it; the server's sentence follows, then the details and the
 * trace id a bug report quotes. A cancel is set dim and without the label, because the person
 * chose it -- it is not an erratum. Agent mode never sees this: it gets the envelope.
 */

import type { Translate } from "../i18n/index.ts";
import type { Failure } from "./output.ts";
import {
  bold,
  dim,
  innerOf,
  type Line,
  type PageStyle,
  plain,
  red,
  setPage,
  wrap,
} from "./typeset.ts";

/** The body hangs under the code, two columns in. */
const HANG = "  ";

function hung(text: string, tone: "plain" | "dim", width: number): Line[] {
  return wrap(text, width).map((words) => [{ text: `${HANG}${words}`, tone }]);
}

export function erratum(t: Translate, error: Failure, style: PageStyle): string[] {
  if (error.code === "CANCELLED") {
    return setPage([[dim(error.message)]], style.color);
  }
  const width = innerOf(style) - HANG.length;
  const body: Line[] = hung(error.message, "plain", width);
  if (error.details !== undefined) {
    body.push(
      ...JSON.stringify(error.details, null, 2)
        .split("\n")
        .map((text) => [dim(`${HANG}${text}`)]),
    );
  }
  if (error.traceId !== undefined) {
    body.push(...hung(t("error.traceId", { traceId: error.traceId }), "dim", width));
  }
  return setPage(
    [[red(`x ${t("page.erratum")}`), plain("  "), bold(error.code)], ...body],
    style.color,
  );
}
