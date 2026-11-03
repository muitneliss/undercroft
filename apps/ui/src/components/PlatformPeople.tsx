/**
 * Everyone on the platform, and deactivating or reactivating one of them (ADR 0152) -- for a
 * platform superadmin, on the customer index beside the form that adds a customer.
 *
 * Shown only to a superadmin, and that is courtesy, not the control: `users.*` are
 * `superadminProcedure`s and refuse whatever the browser rendered. Deactivating reaches every
 * customer the person belongs to, which no customer's admin can see, so it lives here rather
 * than beside a customer's own Remove (`Roster.tsx`).
 *
 * DEACTIVATE TAKES A SECOND PRESS, behind a fold that says what it ends, what cannot be undone
 * -- the credentials it revokes -- and what it keeps, the way Remove and a customer's own
 * Deactivate do. Reactivate is one press: it gives back only what deactivating kept. The
 * reader's own row has no control, since the server refuses a superadmin deactivating
 * themselves; an address the deployment names a superadmin is refused too, in the server's own
 * words, because the browser is never told who is on that list.
 *
 * No `useState`, per `state.md`: the list is the query cache's, what each press did is its
 * mutation's, and `<details>` holds whether a fold is open.
 */

import { useTranslation } from "react-i18next";

import { Address } from "@/components/Address.tsx";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { StatusLine } from "@/components/StatusLine.tsx";
import { formatDate, formatDateTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

type Deactivate = ReturnType<typeof trpc.users.deactivate.useMutation>;
type Reactivate = ReturnType<typeof trpc.users.reactivate.useMutation>;

/** One person's control: the two-step Deactivate, or Reactivate for one already deactivated. */
function StateControl({
  email,
  deactivatedAt,
  deactivate,
  reactivate,
}: {
  email: string;
  deactivatedAt: string | null;
  deactivate: Deactivate;
  reactivate: Reactivate;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (deactivatedAt !== null) {
    return (
      <button
        className="plate plate--small"
        type="button"
        disabled={reactivate.isPending}
        onClick={(): void => {
          reactivate.mutate({ email });
        }}
      >
        {reactivate.isPending ? t("platformPeople.reactivating") : t("platformPeople.reactivate")}
      </button>
    );
  }
  return (
    <details className="tokenform">
      <summary className="plate plate--small">{t("platformPeople.deactivate")}</summary>
      <div className="hinge stack stack--tight">
        {/* Before the plate, so what the second press ends -- and what it keeps -- is read
            before it is pressed. */}
        <p className="note">{t("platformPeople.deactivateLead")}</p>
        <button
          className="plate plate--small plate--primary"
          type="button"
          disabled={deactivate.isPending}
          onClick={(): void => {
            deactivate.mutate({ email });
          }}
        >
          {deactivate.isPending
            ? t("platformPeople.deactivating")
            : t("platformPeople.deactivateConfirm", { email })}
        </button>
      </div>
    </details>
  );
}

/**
 * What the last press did. The server's own words on a refusal: it alone knows why -- above all
 * that the address is a superadmin by the deployment's configuration.
 */
function Outcome({
  deactivate,
  reactivate,
}: {
  deactivate: Deactivate;
  reactivate: Reactivate;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      {deactivate.isError ? (
        <Errata heading={t("platformPeople.notDeactivated")} live={true} error={deactivate.error} />
      ) : null}
      <StatusLine
        className="note"
        text={
          deactivate.isSuccess
            ? t("platformPeople.deactivated", {
                email: deactivate.data.email,
                tokens: deactivate.data.revoked.tokens,
                sessions: deactivate.data.revoked.sessions,
                apps: deactivate.data.revoked.consents,
              })
            : null
        }
      />
      {reactivate.isError ? (
        <Errata heading={t("platformPeople.notReactivated")} live={true} error={reactivate.error} />
      ) : null}
      <StatusLine
        className="note"
        text={
          reactivate.isSuccess
            ? t("platformPeople.reactivated", { email: reactivate.data.email })
            : null
        }
      />
    </>
  );
}

export function PlatformPeople({ signedInAs }: { signedInAs: string }): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const utils = trpc.useUtils();
  const people = trpc.users.list.useQuery();
  async function refresh(): Promise<void> {
    await utils.users.list.invalidate();
  }
  const deactivate = trpc.users.deactivate.useMutation({ onSuccess: refresh });
  const reactivate = trpc.users.reactivate.useMutation({ onSuccess: refresh });

  if (people.isPending) {
    return <Skeleton rows={3} />;
  }
  if (people.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("platformPeople.notLoaded")}
      </Errata>
    );
  }

  const reader = signedInAs.toLowerCase();
  return (
    <>
      <p className="prose">{t("platformPeople.lead")}</p>
      <div className="table-scroll">
        <table className="table">
          <caption>{t("platformPeople.caption", { count: people.data.length })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("platformPeople.colAddress")}</th>
              <th scope="col">{t("platformPeople.colJoined")}</th>
              <th scope="col">{t("platformPeople.colCustomers")}</th>
              <th scope="col">{t("platformPeople.colState")}</th>
              <th scope="col">{t("platformPeople.colAction")}</th>
            </tr>
          </thead>
          <tbody>
            {people.data.map((person) => (
              <tr key={person.userId}>
                <td className="datum datum--quiet">
                  {person.email === reader ? (
                    <span className="stack stack--tight">
                      <Address email={person.email} />
                      <span className="label">{t("people.you")}</span>
                    </span>
                  ) : (
                    <Address email={person.email} />
                  )}
                </td>
                <td>{formatDate(person.createdAt, locale)}</td>
                <td>{t("platformPeople.memberships", { count: person.memberships })}</td>
                <td>
                  {person.deactivatedAt === null
                    ? t("platformPeople.active")
                    : t("platformPeople.deactivatedSince", {
                        when: formatDateTime(person.deactivatedAt, locale),
                      })}
                </td>
                <td>
                  {person.email === reader ? null : (
                    <StateControl
                      email={person.email}
                      deactivatedAt={person.deactivatedAt}
                      deactivate={deactivate}
                      reactivate={reactivate}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Outcome deactivate={deactivate} reactivate={reactivate} />
    </>
  );
}
