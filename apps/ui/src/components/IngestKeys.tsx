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

// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Same functions as noExcessiveLinesPerFunction: one sequential procedure each, whose branches are the states the thing being driven can actually be in.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/correctness/useUniqueElementIds: Static ids on a single-instance form: the band renders once per Sources leaf, and the ids are what its <label>s point at.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as the routes: what remains are contextually-typed callbacks whose inferred type is a React or tRPC shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- React's event handlers, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/nursery/useReactNamingConvention: Fires on the `mintForm` handle, which it wants suffixed `Ref`. It is named for what it holds, which is how the band reads, and the convention this follows is DisplayNameForm's beside it.
// biome-ignore-all lint/performance/noJsxPropsBind: Inline handlers on one form and one plate per row of a short table. The re-render the rule is about matters under a memoised list of hundreds.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
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
  const locale = useUiStore((state) => state.locale);
  const utils = trpc.useUtils();
  const mintForm = useRef<HTMLFormElement>(null);

  const keys = trpc.keys.list.useQuery({ tenantId });
  const mint = trpc.keys.mint.useMutation({
    onSuccess: async () => {
      mintForm.current?.reset();
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
                      onClick={() => {
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
              onClick={() => {
                copy.mutate(mint.data.token);
              }}
            >
              {t("keys.copy")}
            </button>
            <button
              className="plate"
              type="button"
              onClick={() => {
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
          ref={mintForm}
          onSubmit={(event) => {
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
            <label className="label" htmlFor="key-label">
              {t("keys.labelLabel")}
            </label>
            <input
              autoComplete="off"
              className="input"
              disabled={mint.isPending}
              id="key-label"
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
            <label className="label" htmlFor="key-expires">
              {t("keys.expiresLabel")}
            </label>
            <select
              className="input input--select"
              defaultValue="90"
              disabled={mint.isPending}
              id="key-expires"
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
