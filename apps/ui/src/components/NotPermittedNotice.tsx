/**
 * What a division the reader may not open shows them, in its place (ADR 0119, ADR 0139).
 *
 * In place of, not above, for the reason `DeactivatedNotice` is: every procedure such a division
 * reads needs the permission it `requires`, so mounting it for a reader without it would send
 * requests the server refuses and fill the leaf with the refusals. `Book` prints this instead and
 * the division is never mounted, so it asks nothing.
 *
 * It names what is missing -- the permission, in words and by key -- and who can change that,
 * rather than a role: several roles may hold a permission, and naming one would send a builder to
 * ask to be made admin. Then it points the reader at what IS theirs: their own actions, in this
 * customer and every other, are on their account page (`audit.mine`, ADR 0113). That is the
 * question a member who opens People usually has -- "what did I do here" -- and it is answered
 * there for everyone.
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { type DivisionId, division } from "@/lib/divisions.ts";
import { PERMISSION_LABELS, type Permission } from "@/lib/permissions.ts";

export function NotPermittedNotice({
  tenantId,
  current,
  role,
  permission,
}: {
  tenantId: string;
  current: DivisionId;
  /** The reader's role in this customer, for them to read; it is not what closed the door. */
  role: string;
  /** The permission the division requires and the reader lacks. */
  permission: Permission;
}): React.JSX.Element {
  const { t } = useTranslation();
  const name = t(division(current).labelKey);

  return (
    <div className="sheet">
      <div className="head head--division" aria-hidden="true">
        {name}
      </div>
      <div className="body stack">
        <h1>{t("nav.notPermittedHead", { division: name })}</h1>
        <p className="prose prose--lead">
          {t("nav.notPermittedLead", {
            tenantId,
            role,
            permission,
            label: t(PERMISSION_LABELS[permission]),
          })}
        </p>
        <p className="prose">{t("nav.notPermittedOwn")}</p>
        <div className="row">
          <Link className="plate" to="/account">
            {t("nav.notPermittedOwnLink")}
          </Link>
        </div>
      </div>
    </div>
  );
}
