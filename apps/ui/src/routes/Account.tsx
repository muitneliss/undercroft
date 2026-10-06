/**
 * The account page: what belongs to the person signed in rather than to any one customer.
 *
 * Outside every customer's book, like the customer list, and reached from the address in the
 * running head -- the one place that already names who is signed in. It holds the person's
 * personal access tokens (ADR 0060), the apps they let in by signing in and consenting
 * (ADR 0061), and the log of what they have done (ADR 0112); anything else that is theirs rather
 * than a customer's belongs here too.
 */

import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { ActivityLog } from "@/components/ActivityLog.tsx";
import { ConnectedApps } from "@/components/ConnectedApps.tsx";
import { PersonalTokens } from "@/components/PersonalTokens.tsx";
import { trpc } from "@/trpc.ts";

export function Account({ signedInAs }: { signedInAs: string }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="sheet">
      <div className="head head--division">{t("account.title")}</div>
      <div className="body stack">
        <h1>{t("account.title")}</h1>
        <p className="prose prose--lead">{t("account.lead", { email: signedInAs })}</p>
      </div>

      <div className="band-rule" />
      <div className="head">{t("tokens.head")}</div>
      <div className="body stack">
        <PersonalTokens />
      </div>

      <div className="band-rule" />
      <div className="head">{t("apps.head")}</div>
      <div className="body stack">
        <ConnectedApps />
      </div>

      <div className="band-rule" />
      <div className="head">{t("activity.head")}</div>
      <div className="body stack">
        <AccountActivity />
      </div>
    </div>
  );
}

/**
 * The person's own log, which a platform superadmin may turn to the whole platform's.
 *
 * Which one is open is the page's address (`?log=all`), as the People division's views are: a
 * page a reader links and reloads. The switch is offered only to a superadmin, as courtesy --
 * `audit.all` refuses anybody else whatever the address says, so an address asking for it is
 * read as the person's own log for everyone else rather than as an error.
 */
function AccountActivity(): React.JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const session = trpc.session.me.useQuery();
  const superadmin = session.data?.superadmin === true;
  const all = superadmin && params.get("log") === "all";

  return (
    <>
      <p className="prose">{all ? t("activity.leadAll") : t("activity.leadMine")}</p>
      {superadmin ? (
        <nav aria-label={t("activity.scopeLabel")} className="langset">
          <Link
            className="plate plate--small"
            to={{ search: "" }}
            {...(all ? {} : { "aria-current": "page" as const })}
          >
            {t("activity.scopeMine")}
          </Link>
          <Link
            className="plate plate--small"
            to={{ search: "?log=all" }}
            {...(all ? { "aria-current": "page" as const } : {})}
          >
            {t("activity.scopeAll")}
          </Link>
        </nav>
      ) : null}
      <ActivityLog scope={all ? { kind: "all" } : { kind: "mine" }} />
    </>
  );
}
