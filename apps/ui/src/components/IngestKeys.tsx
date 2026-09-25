/**
 * Ingest keys, on the Sources leaf beneath the grants: the credential a script or an
 * orchestrator presents to land data as this customer.
 *
 * A key is shown ONCE. The server returns the token from `keys.mint` and from nothing else,
 * so this band is the only place a person ever sees it -- which is why the minted token
 * is shown by `OneTimeSecret`, which a personal access token shares. Done clears the mutation,
 * and with it the token.
 *
 * No `useState`, per `state.md`. The form is uncontrolled and read as `FormData` on submit;
 * whether a key is being minted, was minted, or could not be, is read off the mutation.
 */

import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { type IngestKey, isSource, SOURCE_LABEL, SOURCES } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { OneTimeSecret } from "@/components/OneTimeSecret.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
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
        <KeyTable
          keys={keys.data}
          revoking={revoke.isPending ? revoke.variables.id : null}
          onRevoke={(id): void => {
            revoke.mutate({ tenantId, id });
          }}
        />
      )}

      {revoke.isError ? (
        <Errata heading={t("keys.notRevoked")} live={true} error={revoke.error} />
      ) : null}

      {mint.isSuccess ? (
        <OneTimeSecret
          token={mint.data.token}
          head={t("keys.mintedHead")}
          note={t("keys.mintedNote")}
          onDone={(): void => {
            mint.reset();
          }}
        />
      ) : (
        <MintForm tenantId={tenantId} mint={mint} formRef={mintFormRef} />
      )}
    </div>
  );
}

/** The keys that exist, and the one button that acts on each: revoke. */
function KeyTable({
  keys,
  revoking,
  onRevoke,
}: {
  keys: readonly IngestKey[];
  /** The key a revoke is in flight for; every plate waits, and only that row says so. */
  revoking: string | null;
  onRevoke: (id: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);

  return (
    <Table>
      <TableCaption>{t("keys.caption", { count: keys.length })}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t("keys.colLabel")}</TableHead>
          <TableHead scope="col">{t("keys.colSources")}</TableHead>
          <TableHead scope="col">{t("keys.colCreated")}</TableHead>
          <TableHead scope="col">{t("keys.colLastUsed")}</TableHead>
          <TableHead scope="col">{t("keys.colExpires")}</TableHead>
          <TableHead scope="col">{t("keys.colRevoke")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((key) => (
          <TableRow key={key.id}>
            <TableCell>
              <span className="datum">{key.label}</span>
              <span className="datum datum--quiet journal__trigger">{key.id}</span>
            </TableCell>
            <TableCell className="datum datum--quiet">
              {key.allowedSources.length === 0
                ? t("keys.allSources")
                : key.allowedSources
                    .map((source) => (isSource(source) ? SOURCE_LABEL[source] : source))
                    .join(", ")}
            </TableCell>
            <TableCell className="datum datum--quiet">
              {formatDate(key.createdAt, locale)}
            </TableCell>
            <TableCell className="datum datum--quiet">
              {lastUsedNote(t, locale, key.lastUsedAt)}
            </TableCell>
            <TableCell className="datum datum--quiet">
              {key.expiresAt === null ? t("keys.noExpiry") : formatDate(key.expiresAt, locale)}
            </TableCell>
            <TableCell>
              {key.revokedAt === null ? (
                <button
                  className="plate plate--small"
                  type="button"
                  disabled={revoking !== null}
                  onClick={(): void => {
                    onRevoke(key.id);
                  }}
                >
                  {revoking === key.id ? t("keys.revoking") : t("keys.revoke")}
                </button>
              ) : (
                <span className="datum datum--quiet">{t("keys.revoked")}</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * What a new key is asked for: a label, which sources it may write, and how long it lives.
 *
 * Uncontrolled: the fields are read from the submitted `FormData` rather than mirrored into
 * a store nothing else reads. The ref belongs to the parent because the mint's own
 * `onSuccess` is what clears the form, and that lives with the mutation.
 */
function MintForm({
  tenantId,
  mint,
  formRef,
}: {
  tenantId: string;
  mint: ReturnType<typeof trpc.keys.mint.useMutation>;
  formRef: React.RefObject<HTMLFormElement | null>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const keyExpiresId = useId();
  const keyLabelId = useId();

  return (
    <form
      className="stack stack--tight"
      ref={formRef}
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
        <Errata heading={t("keys.notMinted")} live={true} error={mint.error} />
      ) : null}

      <div className="row">
        <button className="plate plate--primary" disabled={mint.isPending} type="submit">
          {mint.isPending ? t("keys.minting") : t("keys.mint")}
        </button>
      </div>
    </form>
  );
}
