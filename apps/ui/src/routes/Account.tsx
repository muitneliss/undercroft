/**
 * The account page: what belongs to the person signed in rather than to any one customer.
 *
 * Outside every customer's book, like the customer list, and reached from the address in the
 * running head -- the one place that already names who is signed in. It holds the person's
 * personal access tokens (ADR 0060) and the apps they let in by signing in and consenting
 * (ADR 0061); anything else that is theirs rather than a customer's belongs here too.
 */

import { useTranslation } from "react-i18next";

import { ConnectedApps } from "@/components/ConnectedApps.tsx";
import { PersonalTokens } from "@/components/PersonalTokens.tsx";

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
    </div>
  );
}
