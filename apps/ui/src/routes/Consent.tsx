/**
 * The consent page: a model-context client -- a claude.ai connector, Claude Desktop, Claude
 * Code -- is asking to act as the person signed in, and this is where they say how far
 * (ADR 0061).
 *
 * Better Auth's authorize step sends the person here, signed in, with the client's request and
 * a signature in the URL; `answerConsent` posts the answer back with that signed query (see
 * `@/auth.ts`), and the browser goes where the server says -- to the client, with a code or a
 * refusal.
 *
 * Three things on the page are decisions:
 *
 * - **Read only is the default**, and the one to reach for: an agent acting on text somebody
 *   else wrote can do no harm with it. Read and write is offered only when the client asked
 *   for it, and its hint says what it hands over. Narrowing is the person's; widening past the
 *   request is impossible -- the server refuses a scope the client did not ask for.
 * - **The client's name is beside its redirect host.** The name is what the client said about
 *   itself when it registered, which anybody can say; where it sends the code back to is the
 *   fact that identifies it.
 * - **A request for neither scope is only refusable.** Such a client could be let in and do
 *   nothing, which is a grant nobody meant to make.
 *
 * Like `SignIn`, the page holds no state: the choice is an uncontrolled radio read from the
 * submitted form, and pending and failure are the mutation's own.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import type { READ_SCOPE, WRITE_SCOPE } from "@undercroft/control-plane/surface";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { answerConsent, requestingClient } from "@/auth.ts";
import { Colophon } from "@/components/Colophon.tsx";
import { Errata } from "@/components/Errata.tsx";
import { Mark } from "@/components/Mark.tsx";
import { MISSING } from "@/lib/money.ts";

/** The server's scope names, spelled against its own constants (`surface.ts`). */
const READ: typeof READ_SCOPE = "undercroft:read";
const WRITE: typeof WRITE_SCOPE = "undercroft:write";

/** The host a client sends its person back to, or `null` for one that does not parse. */
function hostOf(uri: string | null): string | null {
  if (uri === null) {
    return null;
  }
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
}

/** What the person agreed to: everything asked for, less write when they chose read. */
function scopeFor(requested: readonly string[], choice: FormDataEntryValue | null): string {
  // Anything but an explicit `write` is the narrower grant, never the wider.
  return (choice === "write" ? requested : requested.filter((scope) => scope !== WRITE)).join(" ");
}

/**
 * Who is asking: the client's own name where it gave one, beside the host it returns to. The
 * name is read from Better Auth; until it arrives, and if it cannot be, the host alone.
 */
function Requester({
  clientId,
  redirectHost,
  signedInAs,
}: {
  clientId: string;
  redirectHost: string;
  signedInAs: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const client = useQuery({
    queryKey: ["oauth-client", clientId],
    queryFn: () => requestingClient(clientId),
    enabled: clientId !== "",
    retry: false,
  });
  const name = client.data?.name ?? null;
  return (
    <div className="stack stack--tight">
      <h1>{t("consent.title")}</h1>
      <p className="prose prose--lead">
        {name === null
          ? t("consent.leadUnnamed", { host: redirectHost })
          : t("consent.lead", { name, host: redirectHost })}
      </p>
      <p className="note">{t("consent.signedInAs", { email: signedInAs })}</p>
    </div>
  );
}

/** One grant to choose, as a punched radio with its hint. */
function GrantOption({
  value,
  checked,
  disabled,
  label,
  hint,
}: {
  value: "read" | "write";
  checked: boolean;
  disabled: boolean;
  label: string;
  hint: string;
}): React.JSX.Element {
  return (
    <label className="punch">
      <input type="radio" name="grant" value={value} defaultChecked={checked} disabled={disabled} />
      <span className="punch__box" />
      <span className="stack stack--tight">
        <span>{label}</span>
        <span className="field__hint">{hint}</span>
      </span>
    </label>
  );
}

/** The grants the client asked for, read first; or, for a client that asked for none, why not. */
function GrantChoice({
  offersRead,
  offersWrite,
  disabled,
}: {
  offersRead: boolean;
  offersWrite: boolean;
  disabled: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (!(offersRead || offersWrite)) {
    return <p className="note">{t("consent.nothingAsked")}</p>;
  }
  return (
    <fieldset className="field">
      <legend className="label">{t("consent.grantLabel")}</legend>
      {offersRead ? (
        <GrantOption
          value="read"
          checked={true}
          disabled={disabled}
          label={t("tokens.grantRead")}
          hint={t("consent.readHint")}
        />
      ) : null}
      {offersWrite ? (
        <GrantOption
          value="write"
          checked={!offersRead}
          disabled={disabled}
          label={t("tokens.grantWrite")}
          hint={t("tokens.grantWriteHint")}
        />
      ) : null}
    </fieldset>
  );
}

export function Consent({ signedInAs }: { signedInAs: string }): React.JSX.Element {
  const { t } = useTranslation();
  const params = new URLSearchParams(useLocation().search);
  const requested = (params.get("scope") ?? "").split(" ").filter((scope) => scope !== "");
  const offersRead = requested.includes(READ);
  const offersWrite = requested.includes(WRITE);

  const answer = useMutation({
    mutationFn: answerConsent,
    onSuccess: (destination) => {
      // Back to the client, carrying the code or the refusal. Not a route: it is not ours.
      globalThis.location.assign(destination);
    },
  });
  const leaving = answer.isPending || answer.isSuccess;

  return (
    <main className="titlepage">
      <div className="titlepage__leaf stack">
        <div className="imprint">
          <Mark size={26} />
          <span className="imprint__name">{t("app.name")}</span>
        </div>

        <Requester
          clientId={params.get("client_id") ?? ""}
          redirectHost={hostOf(params.get("redirect_uri")) ?? MISSING}
          signedInAs={signedInAs}
        />

        <form
          className="stack stack--tight"
          onSubmit={(event): void => {
            event.preventDefault();
            const choice = new FormData(event.currentTarget).get("grant");
            answer.mutate(scopeFor(requested, choice));
          }}
        >
          <GrantChoice offersRead={offersRead} offersWrite={offersWrite} disabled={leaving} />

          {answer.isError ? (
            <Errata heading={t("consent.notAnswered")} live={true}>
              {answer.error.message}
            </Errata>
          ) : null}

          <div className="row">
            {offersRead || offersWrite ? (
              <button className="plate plate--primary" type="submit" disabled={leaving}>
                {leaving ? t("consent.answering") : t("consent.allow")}
              </button>
            ) : null}
            <button
              className="plate"
              type="button"
              disabled={leaving}
              onClick={(): void => {
                answer.mutate(null);
              }}
            >
              {t("consent.deny")}
            </button>
          </div>
        </form>

        <Colophon />
      </div>
    </main>
  );
}
