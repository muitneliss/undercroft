/**
 * Ingest keys, on the Sources leaf beneath the grants: the credential a script or an
 * orchestrator presents to land data as this customer.
 *
 * A key is shown ONCE. The server returns the token from `keys.mint` and from nothing else,
 * so this band is the only place a person ever sees it -- which is why the minted token
 * stands in the `.token` face used for a one-time value, selectable, with the copy plate
 * reporting what actually happened rather than assuming it: a clipboard call that fails
 * silently would destroy the only copy. Done clears the mutation, and with it the token.
 *
 * No `useState`, per `state.md`. The form is uncontrolled and read as `FormData` on submit;
 * whether a key is being minted, was minted, or could not be, is read off the mutation, and
 * the copy is a mutation of its own for the same reason -- it is the one thing that knows
 * whether it succeeded.
 */

import { useMutation } from "@tanstack/react-query";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { isSource, SOURCE_LABEL, SOURCES } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { formatDate, lastUsedNote } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** How long a key may live, as the select offers it. Empty is a key that does not expire. */
const EXPIRIES = [
  { value: "", key: "keys.expiresNever" },
  { value: "30", key: "keys.expires30" },
  { value: "90", key: "keys.expires90" },
  { value: "365", key: "keys.expires365" },
] as const;

export function IngestKeys({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const keyExpiresId = useId();
  const keyLabelId = useId();
  const locale = useUiStore((state) => state.locale);
  const utils = trpc.useUtils();
  const mintFormRef = useRef<HTMLFormElement>(null);

  const keys = trpc.keys.list.useQuery({ tenantId });
  const mint = trpc.keys.mint.useMutation({
    onSuccess: async () => {
      mintFormRef.current?.reset();
      await utils.keys.list.invalidate({ tenantId });
    },
  });
  const revoke = trpc.keys.revoke.useMutation({
    onSuccess: async () => {
      await utils.keys.list.invalidate({ tenantId });
    },
  });
  // The clipboard, as a mutation: it is the one thing that knows whether the copy happened.
  const copy = useMutation({
    mutationFn: (text: string) => navigator.clipboard.writeText(text),
  });

  if (keys.isPending) {
    return <Skeleton rows={3} />;
  }
  if (keys.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("keys.notLoaded")}
      </Errata>
    );
  }

  return (
    <div className="stack">
      <p className="prose">{t("keys.lead", { tenantId })}</p>

      {keys.data.length === 0 ? (
        <p className="note">{t("keys.none")}</p>
      ) : (
        <table className="table">
          <caption>{t("keys.caption", { count: keys.data.length })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("keys.colLabel")}</th>
              <th scope="col">{t("keys.colSources")}</th>
              <th scope="col">{t("keys.colCreated")}</th>
              <th scope="col">{t("keys.colLastUsed")}</th>
              <th scope="col">{t("keys.colExpires")}</th>
              <th scope="col">{t("keys.colRevoke")}</th>
            </tr>
          </thead>
          <tbody>
            {keys.data.map((key) => (
              <tr key={key.id}>
                <td>
                  <span className="datum">{key.label}</span>
                  <span className="datum datum--quiet journal__trigger">{key.id}</span>
                </td>
                <td className="datum datum--quiet">
                  {key.allowedSources.length === 0
                    ? t("keys.allSources")
                    : key.allowedSources
                        .map((source) => (isSource(source) ? SOURCE_LABEL[source] : source))
                        .join(", ")}
                </td>
                <td className="datum datum--quiet">{formatDate(key.createdAt, locale)}</td>
                <td className="datum datum--quiet">{lastUsedNote(t, locale, key.lastUsedAt)}</td>
                <td className="datum datum--quiet">
                  {key.expiresAt === null ? t("keys.noExpiry") : formatDate(key.expiresAt, locale)}
                </td>
                <td>
                  {key.revokedAt === null ? (
                    <button
                      className="plate plate--small"
                      type="button"
                      disabled={revoke.isPending}
                      onClick={(): void => {
                        revoke.mutate({ tenantId, id: key.id });
                      }}
                    >
                      {t("keys.revoke")}
                    </button>
                  ) : (
                    <span className="datum datum--quiet">{t("keys.revoked")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {revoke.isError ? (
        <Errata heading={t("keys.notRevoked")} live={true}>
          {revoke.error.message}
        </Errata>
      ) : null}

      {mint.isSuccess ? (
        <div className="hinge stack">
          <span className="hinge__punch hinge__punch--a" aria-hidden="true" />
          <span className="hinge__punch hinge__punch--b" aria-hidden="true" />
          <span className="label">{t("keys.mintedHead")}</span>
          {/* Selectable, boxed, and read aloud without squinting: this is the only copy. */}
          <p className="token">{mint.data.token}</p>
          <p className="note">{t("keys.mintedNote")}</p>
          <div className="row">
            <button
              className="plate"
              type="button"
              onClick={(): void => {
                copy.mutate(mint.data.token);
              }}
            >
              {t("keys.copy")}
            </button>
            <button
              className="plate"
              type="button"
              onClick={(): void => {
                copy.reset();
                mint.reset();
              }}
            >
              {t("keys.done")}
            </button>
          </div>
          {copy.isSuccess ? (
            <p className="note" role="status">
              {t("keys.copied")}
            </p>
          ) : null}
          {copy.isError ? (
            <Errata heading={t("keys.notCopied")} live={true}>
              {copy.error.message}
            </Errata>
          ) : null}
        </div>
      ) : (
        <form
          className="stack stack--tight"
          ref={mintFormRef}
          onSubmit={(event): void => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const label = String(data.get("label") ?? "").trim();
            if (label === "") {
              return;
            }
            const allowedSources = data.getAll("source").map(String).filter(isSource);
            const expires = String(data.get("expires") ?? "");
            mint.mutate({
              tenantId,
              label,
              allowedSources,
              // parseInt, not Number(): a day count, not an amount.
              ...(expires === "" ? {} : { expiresInDays: Number.parseInt(expires, 10) }),
            });
          }}
        >
          <span className="label">{t("keys.mintHead")}</span>

          <div className="field">
            <label className="label" htmlFor={keyLabelId}>
              {t("keys.labelLabel")}
            </label>
            <input
              autoComplete="off"
              className="input"
              disabled={mint.isPending}
              id={keyLabelId}
              name="label"
              placeholder={t("keys.labelPlaceholder")}
              required={true}
              type="text"
            />
          </div>

          <fieldset className="field">
            <legend className="label">{t("keys.sourcesLabel")}</legend>
            <div className="row">
              {SOURCES.map((source) => (
                <label key={source} className="punch">
                  <input type="checkbox" name="source" value={source} disabled={mint.isPending} />
                  <span className="punch__box" />
                  <span>{SOURCE_LABEL[source]}</span>
                </label>
              ))}
            </div>
            <p className="field__hint">{t("keys.sourcesHint")}</p>
          </fieldset>

          <div className="field">
            <label className="label" htmlFor={keyExpiresId}>
              {t("keys.expiresLabel")}
            </label>
            <select
              className="input input--select"
              defaultValue="90"
              disabled={mint.isPending}
              id={keyExpiresId}
              name="expires"
            >
              {EXPIRIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.key)}
                </option>
              ))}
            </select>
          </div>

          {mint.isError ? (
            <Errata heading={t("keys.notMinted")} live={true}>
              {mint.error.message}
            </Errata>
          ) : null}

          <div className="row">
            <button className="plate plate--primary" disabled={mint.isPending} type="submit">
              {mint.isPending ? t("keys.minting") : t("keys.mint")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
