/**
 * The account page: what belongs to the person signed in rather than to any one customer.
 *
 * Outside every customer's book, like the customer list, and reached from the address in the
 * running head -- the one place that already names who is signed in. It holds the person's
 * personal access tokens (ADR 0060), the apps they let in by signing in and consenting
 * (ADR 0061), and the log of what they have done (ADR 0113); anything else that is theirs rather
 * than a customer's belongs here too.
 */

import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { ActivityLog } from "@/components/ActivityLog.tsx";
import { CallLog } from "@/components/CallLog.tsx";
import { ConnectedApps } from "@/components/ConnectedApps.tsx";
import { PersonalTokens } from "@/components/PersonalTokens.tsx";
import { trpc } from "@/trpc.ts";

export function Account({ signedInAs }: { signedInAs: string }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="sheet">
      <div className="head head--division" aria-hidden="true">
        {t("account.title")}
      </div>
      <div className="body stack">
        <h1>{t("account.title")}</h1>
        <p className="prose prose--lead">{t("account.lead", { email: signedInAs })}</p>
      </div>

      <div className="band-rule" />
      <h2 className="head">{t("tokens.head")}</h2>
      <div className="body stack">
        <PersonalTokens />
      </div>

      <div className="band-rule" />
      <h2 className="head">{t("apps.head")}</h2>
      <div className="body stack">
        <ConnectedApps />
      </div>

      <div className="band-rule" />
      <h2 className="head">{t("activity.head")}</h2>
      <div className="body stack">
        <AccountActivity />
      </div>
    </div>
  );
}

/** Which log the band shows: the person's own, the whole platform's, or agents' calls. */
type LogView = "mine" | "all" | "calls";

/** The three views as the address names them, in the order the switch offers them. */
const LOG_VIEWS: readonly { readonly view: LogView; readonly search: string }[] = [
  { view: "mine", search: "" },
  { view: "all", search: "?log=all" },
  { view: "calls", search: "?log=calls" },
];

/**
 * The person's own log, which a platform superadmin may turn to the whole platform's, or to the
 * calls agents made, kept whole (ADR 0151).
 *
 * Which one is open is the page's address (`?log=all`, `?log=calls`), as the People division's
 * views are: a page a reader links and reloads. The switch is offered only to a superadmin, as
 * courtesy -- `audit.all` and `audit.calls.*` refuse anybody else whatever the address says, so
 * an address asking for either is read as the person's own log for everyone else rather than as
 * an error.
 */
function AccountActivity(): React.JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const session = trpc.session.me.useQuery();
  const superadmin = session.data?.superadmin === true;
  const asked = params.get("log");
  const view: LogView = superadmin && (asked === "all" || asked === "calls") ? asked : "mine";

  return (
    <>
      <p className="prose">{t(`activity.lead.${view}`)}</p>
      {superadmin ? (
        <nav aria-label={t("activity.scopeLabel")} className="langset">
          {LOG_VIEWS.map((each) => (
            <Link
              className="plate plate--small"
              key={each.view}
              to={{ search: each.search }}
              {...(each.view === view ? { "aria-current": "page" as const } : {})}
            >
              {t(`activity.scope.${each.view}`)}
            </Link>
          ))}
        </nav>
      ) : null}
      {view === "calls" ? (
        <CallLog />
      ) : (
        <ActivityLog scope={view === "all" ? { kind: "all" } : { kind: "mine" }} />
      )}
    </>
  );
}
