/**
 * What a division only an admin may open shows anybody else, in its place (ADR 0119).
 *
 * In place of, not above, for the reason `DeactivatedNotice` is: every procedure such a division
 * reads is `requireRole("admin")`, so mounting it for a member would send requests the server
 * refuses and fill the leaf with the refusals. `Book` prints this instead and the division is
 * never mounted, so it asks nothing.
 *
 * It points the reader at what IS theirs: their own actions, in this customer and every other,
 * are on their account page (`audit.mine`, ADR 0113). That is the question a member who opens
 * People usually has -- "what did I do here" -- and it is answered there for everyone.
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { type DivisionId, division } from "@/lib/divisions.ts";
import type { Role } from "@/lib/roles.ts";

export function AdminOnlyNotice({
  tenantId,
  current,
  role,
}: {
  tenantId: string;
  current: DivisionId;
  /** The reader's role in this customer, which is what closed the division to them. */
  role: Role;
}): React.JSX.Element {
  const { t } = useTranslation();
  const name = t(division(current).labelKey);

  return (
    <div className="sheet">
      <div className="head head--division" aria-hidden="true">
        {name}
      </div>
      <div className="body stack">
        <h1>{t("nav.adminOnlyHead", { division: name })}</h1>
        <p className="prose prose--lead">{t("nav.adminOnlyLead", { tenantId, role })}</p>
        <p className="prose">{t("nav.adminOnlyOwn")}</p>
        <div className="row">
          <Link className="plate" to="/account">
            {t("nav.adminOnlyOwnLink")}
          </Link>
        </div>
      </div>
    </div>
  );
}
