/**
 * The plate that copies the page's own address, for a dashboard or a question.
 *
 * The address is the whole share: filter values (`p.<name>`), the open pane and the way back
 * to a dashboard already ride in it, so copying `location.href` hands a colleague exactly
 * these figures and nothing else is needed. It grants nothing, and the note says so -- the
 * recipient still meets the server's role gate.
 *
 * A clipboard call can be refused (no permission, an insecure origin), and a copy that fails
 * silently leaves the reader pasting whatever was on the clipboard before. So the copy is a
 * mutation, the one thing that knows whether it succeeded, and the note reports what actually
 * happened -- as `OneTimeSecret` does. No `useState`, per `state.md`.
 */

import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

export function CopyLink(): React.JSX.Element {
  const { t } = useTranslation();
  const copy = useMutation({
    mutationFn: (href: string) => navigator.clipboard.writeText(href),
  });

  return (
    <>
      <button
        className="plate"
        type="button"
        onClick={(): void => {
          copy.mutate(globalThis.location.href);
        }}
      >
        {t("bi.copyLink")}
      </button>
      {copy.isSuccess ? (
        <span className="note" role="status">
          {t("bi.linkCopied")}
        </span>
      ) : null}
      {copy.isError ? (
        <span className="note" role="status">
          {t("bi.copyBlocked")}
        </span>
      ) : null}
    </>
  );
}
