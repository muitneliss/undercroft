/**
 * The one showing of a secret the server returns once and never again: an ingest key, a
 * personal access token.
 *
 * Its own component because the act is the same whichever secret it is, and it has one way to
 * go wrong that matters: a clipboard call that fails silently destroys the only copy. So the
 * token stands in the `.token` face used for a one-time value -- selectable, boxed, readable
 * aloud -- and the copy plate reports what actually happened rather than assuming it. The copy
 * is a mutation because it is the one thing that knows whether it succeeded, and it lives here
 * so that dismissing the panel takes its state with it. No `useState`, per `state.md`.
 */

import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";

export function OneTimeSecret({
  token,
  head,
  note,
  onDone,
}: {
  token: string;
  /** What was minted, e.g. "New key". */
  head: string;
  /** Why it must be copied now, and what to do if it is lost. */
  note: string;
  onDone: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const copy = useMutation({
    mutationFn: (text: string) => navigator.clipboard.writeText(text),
  });

  return (
    <div className="hinge stack">
      <span className="hinge__punch hinge__punch--a" aria-hidden="true" />
      <span className="hinge__punch hinge__punch--b" aria-hidden="true" />
      <span className="label">{head}</span>
      {/* Selectable, boxed, and read aloud without squinting: this is the only copy. */}
      <p className="token">{token}</p>
      <p className="note">{note}</p>
      <div className="row">
        <button
          className="plate"
          type="button"
          onClick={(): void => {
            copy.mutate(token);
          }}
        >
          {t("secret.copy")}
        </button>
        <button className="plate" type="button" onClick={onDone}>
          {t("secret.done")}
        </button>
      </div>
      {copy.isSuccess ? (
        <p className="note" role="status">
          {t("secret.copied")}
        </p>
      ) : null}
      {copy.isError ? (
        <Errata heading={t("secret.notCopied")} live={true} error={copy.error} />
      ) : null}
    </div>
  );
}
