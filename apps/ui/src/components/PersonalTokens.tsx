/**
 * Personal access tokens, on the account page: the credential a person gives an agent so it can
 * reach Undercroft over MCP on their behalf (ADR 0059).
 *
 * Modelled on `IngestKeys`, and different from it in the two ways the credential is: a token is
 * the PERSON's, not a customer's, so this band sits on the account page rather than on a
 * customer's leaf and needs no role; and it carries a GRANT the person chooses. `read` is the
 * default, and the one a person should reach for -- an agent acting on text somebody else wrote
 * can do no harm with it. `write` says, in its hint, exactly what it hands over.
 *
 * A token is shown ONCE, by `OneTimeSecret`. Expiry is required and a year at most, because
 * the server refuses anything else; the select offers only what it accepts.
 *
 * No `useState`, per `state.md`. The form is uncontrolled and read as `FormData` on submit, and
 * whether a token is being minted, was minted, or could not be, is read off the mutation.
 */

import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { PersonalToken } from "@/api/types.ts";
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

/** How long a token may live, as the select offers it. The server accepts 1 to 365 days. */
const EXPIRIES = [
  { value: "30", key: "tokens.expires30" },
  { value: "90", key: "tokens.expires90" },
  { value: "365", key: "tokens.expires365" },
] as const;

const GRANTS = [
  { value: "read", key: "tokens.grantRead", hint: "tokens.grantReadHint" },
  { value: "write", key: "tokens.grantWrite", hint: "tokens.grantWriteHint" },
] as const;

function grantOf(value: FormDataEntryValue | null): "read" | "write" {
  // Anything but an explicit `write` is the narrower grant, never the wider.
  return value === "write" ? "write" : "read";
}

export function PersonalTokens(): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const mintFormRef = useRef<HTMLFormElement>(null);

  const tokens = trpc.account.tokens.list.useQuery();
  const mint = trpc.account.tokens.mint.useMutation({
    onSuccess: async () => {
      mintFormRef.current?.reset();
      await utils.account.tokens.list.invalidate();
    },
  });
  const revoke = trpc.account.tokens.revoke.useMutation({
    onSuccess: async () => {
      await utils.account.tokens.list.invalidate();
    },
  });

  if (tokens.isPending) {
    return <Skeleton rows={3} />;
  }
  if (tokens.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("tokens.notLoaded")}
      </Errata>
    );
  }

  return (
    <div className="stack">
      <p className="prose">{t("tokens.lead")}</p>

      {tokens.data.length === 0 ? (
        <p className="note">{t("tokens.none")}</p>
      ) : (
        <TokenTable
          tokens={tokens.data}
          revoking={revoke.isPending ? revoke.variables.id : null}
          onRevoke={(id): void => {
            revoke.mutate({ id });
          }}
        />
      )}

      {revoke.isError ? (
        <Errata heading={t("tokens.notRevoked")} live={true} error={revoke.error} />
      ) : null}

      {mint.isSuccess ? (
        <OneTimeSecret
          token={mint.data.token}
          head={t("tokens.mintedHead")}
          note={t("tokens.mintedNote")}
          onDone={(): void => {
            mint.reset();
          }}
        />
      ) : (
        <MintForm mint={mint} formRef={mintFormRef} />
      )}
    </div>
  );
}

/** The tokens that exist, and the one button that acts on each: revoke. */
function TokenTable({
  tokens,
  revoking,
  onRevoke,
}: {
  tokens: readonly PersonalToken[];
  /** The token a revoke is in flight for; every plate waits, and only that row says so. */
  revoking: string | null;
  onRevoke: (id: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);

  return (
    <Table>
      <TableCaption>{t("tokens.caption", { count: tokens.length })}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t("tokens.colLabel")}</TableHead>
          <TableHead scope="col">{t("tokens.colGrant")}</TableHead>
          <TableHead scope="col">{t("tokens.colCreated")}</TableHead>
          <TableHead scope="col">{t("tokens.colLastUsed")}</TableHead>
          <TableHead scope="col">{t("tokens.colExpires")}</TableHead>
          <TableHead scope="col">{t("tokens.colRevoke")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tokens.map((token) => (
          <TableRow key={token.id}>
            <TableCell>
              <span className="datum">{token.label}</span>
              <span className="datum datum--quiet journal__trigger">{token.id}</span>
            </TableCell>
            <TableCell className="datum datum--quiet">
              {token.grant === "write" ? t("tokens.grantWrite") : t("tokens.grantRead")}
            </TableCell>
            <TableCell className="datum datum--quiet">
              {formatDate(token.createdAt, locale)}
            </TableCell>
            <TableCell className="datum datum--quiet">
              {lastUsedNote(t, locale, token.lastUsedAt)}
            </TableCell>
            <TableCell className="datum datum--quiet">
              {formatDate(token.expiresAt, locale)}
            </TableCell>
            <TableCell>
              {token.revokedAt === null ? (
                <button
                  className="plate plate--small"
                  type="button"
                  disabled={revoking !== null}
                  onClick={(): void => {
                    onRevoke(token.id);
                  }}
                >
                  {revoking === token.id ? t("tokens.revoking") : t("tokens.revoke")}
                </button>
              ) : (
                <span className="datum datum--quiet">{t("tokens.revoked")}</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * What a new token is asked for: a label, a grant, and how long it lives.
 *
 * Uncontrolled: the fields are read from the submitted `FormData`. The ref belongs to the
 * parent because the mint's own `onSuccess` is what clears the form.
 */
function MintForm({
  mint,
  formRef,
}: {
  mint: ReturnType<typeof trpc.account.tokens.mint.useMutation>;
  formRef: React.RefObject<HTMLFormElement | null>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const labelId = useId();
  const expiresId = useId();

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
        mint.mutate({
          label,
          grant: grantOf(data.get("grant")),
          // parseInt, not Number(): a day count, not an amount.
          expiresInDays: Number.parseInt(String(data.get("expires") ?? "90"), 10),
        });
      }}
    >
      <span className="label">{t("tokens.mintHead")}</span>

      <div className="field">
        <label className="label" htmlFor={labelId}>
          {t("tokens.labelLabel")}
        </label>
        <input
          autoComplete="off"
          className="input"
          disabled={mint.isPending}
          id={labelId}
          maxLength={80}
          name="label"
          placeholder={t("tokens.labelPlaceholder")}
          required={true}
          type="text"
        />
      </div>

      <fieldset className="field">
        <legend className="label">{t("tokens.grantLabel")}</legend>
        {GRANTS.map((grant) => (
          <label key={grant.value} className="punch">
            <input
              type="radio"
              name="grant"
              value={grant.value}
              defaultChecked={grant.value === "read"}
              disabled={mint.isPending}
            />
            <span className="punch__box" />
            <span className="stack stack--tight">
              <span>{t(grant.key)}</span>
              <span className="field__hint">{t(grant.hint)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label className="label" htmlFor={expiresId}>
          {t("tokens.expiresLabel")}
        </label>
        <select
          className="input input--select"
          defaultValue="90"
          disabled={mint.isPending}
          id={expiresId}
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
        <Errata heading={t("tokens.notMinted")} live={true} error={mint.error} />
      ) : null}

      <div className="row">
        <button className="plate plate--primary" disabled={mint.isPending} type="submit">
          {mint.isPending ? t("tokens.minting") : t("tokens.mint")}
        </button>
      </div>
    </form>
  );
}
