/**
 * The correction slip.
 *
 * A publisher tips an errata slip into a book when something already printed is
 * wrong and cannot be unprinted. That is exactly the shape of a lapsed grant: the
 * schedule still says the source is connected, the customer still believes it
 * is, and the record is wrong until someone acts.
 *
 * Vermilion is held out of the seven-hue section wheel so that this slip is the
 * only thing in the entire interface wearing it. That is the whole reason the
 * wheel has a colour missing from it -- an alert colour that also appears as a
 * section, a chart series or a hover state is not an alert colour.
 *
 * `role="alert"` is deliberate and is not used for anything routine. This
 * component is for a state that needs a person, which is why it also insists on
 * carrying its own recovery action rather than describing one.
 *
 * ## A slip about a failed request
 *
 * Handed the request's `error` rather than prose, the slip words it and signs it. The words
 * are the server's own, which it composes in the reader's language -- except for an internal
 * failure, which the control plane deliberately answers with the bare code `internal_error`
 * (exception text routinely embeds the offending row), and which is therefore the one message
 * the slip translates itself. The signature is the request's trace id, the one thing a reader
 * can quote back that leads to the server's side of the failure, set as a selectable `<code>`
 * beside a link that opens a bug report already carrying it. No trace id, no line: an empty
 * label with nothing to copy would be a promise the slip cannot keep.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Errata as ErrataMark } from "@/components/Icon.tsx";
import { bugReportUrl } from "@/lib/bugReport.ts";

/**
 * A failed request as the slip needs it. Structural, so a tRPC client error fits without a
 * cast; `data.traceId` is what the control plane's `errorFormatter` stamps on every error.
 */
export interface ServerError {
  readonly message: string;
  readonly data?: { readonly traceId?: string | null | undefined } | null | undefined;
}

/** The code the control plane answers an internal failure with, in place of its detail. */
const INTERNAL = "internal_error";

/** Either the slip's own prose, or the failed request it reports -- never both. */
type Body = { children: ReactNode; error?: never } | { error: ServerError; children?: never };

export function Errata({
  heading,
  action,
  live = false,
  ...body
}: {
  heading: string;
  action?: ReactNode;
  /** Announce it when it appears. For a state that arrived, not one already on the page. */
  live?: boolean;
} & Body): React.JSX.Element {
  return (
    <div className="errata" {...(live ? { role: "alert" } : {})}>
      <span className="errata__mark">
        <ErrataMark size={13} />
        {heading}
      </span>
      {body.error === undefined ? (
        <div className="errata__body">{body.children}</div>
      ) : (
        <FailedRequest error={body.error} />
      )}
      {action}
    </div>
  );
}

function FailedRequest({ error }: { error: ServerError }): React.JSX.Element {
  const { t } = useTranslation();
  const traceId = error.data?.traceId ?? "";

  return (
    <>
      <div className="errata__body">
        {error.message === INTERNAL ? t("errata.internal") : error.message}
      </div>
      {traceId === "" ? null : (
        <p className="errata__trace">
          <span className="label">{t("errata.traceLabel")}</span>
          <code>{traceId}</code>
          <a href={bugReportUrl(traceId)} rel="noreferrer" target="_blank">
            {t("errata.report")}
          </a>
        </p>
      )}
    </>
  );
}
