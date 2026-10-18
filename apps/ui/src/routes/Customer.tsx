/**
 * One customer's own page: what the book is, and a door to each of its divisions.
 *
 * In the Customers division, at `/tenants/:tenantId/about`, and reached from the customer
 * list by the customer's name; `Open` beside the name opens the book at Sources, which is what
 * `/tenants/:tenantId` has always done -- or, for a reader Sources is closed to, at the first
 * division open to them (`bookPath`, ADR 0147).
 *
 * It prints only what `tenants.get` answers -- the name, the ID and the reader's role. The
 * customer's creation date is in the database but not in that answer, and a page that printed
 * it would need a server field first, not a guess here.
 *
 * The display name is corrected in exactly one place, `DisplayNameForm` at the foot of
 * Sources, and this page links there rather than holding a second copy: two forms for one
 * value are two sets of cache invalidations to keep in step, and they drift. The link is for
 * a holder of `tenant:manage` only, as the form is; the server's `requirePermission` refuses
 * regardless. Both doors to Sources are offered only to a reader Sources is open to: one that
 * opened on a notice would be no door.
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Errata } from "@/components/Errata.tsx";
import { Fact, Facts } from "@/components/Facts.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import {
  CLOSED_WORDS,
  closedTo,
  DIVISIONS,
  type DivisionId,
  division,
  divisionPath,
} from "@/lib/divisions.ts";
import { can, type Permission } from "@/lib/permissions.ts";
import { trpc } from "@/trpc.ts";

/**
 * The question each division of a book answers, keyed by the division so an eighth division
 * is a type error here until it has been worded. Customers is not in a book; it holds them.
 */
const ANSWERS = {
  sources: "tenants.insideSources",
  journal: "tenants.insideJournal",
  lake: "tenants.insideLake",
  models: "tenants.insideModels",
  reports: "tenants.insideReports",
  people: "tenants.insidePeople",
} as const satisfies Record<Exclude<DivisionId, "customers">, string>;

/**
 * Each division of the book, in ring order, with the question it answers.
 *
 * A division closed to this reader (ADR 0119) keeps its entry, unlinked, with the reason in its
 * name, as its tab on the strip does: the directory says what the book holds, and a door that
 * opens on a notice is not a door.
 */
function Directory({
  tenantId,
  permissions,
}: {
  tenantId: string;
  permissions: readonly Permission[];
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <dl className="access" aria-label={t("tenants.insideLabel", { tenantId })}>
      {DIVISIONS.flatMap((div) => {
        if (div.id === "customers") {
          return [];
        }
        const closed = closedTo(div, { tenantId, permissions });
        return [
          <dt key={`${div.id}-name`}>
            {closed === null ? (
              <Link to={divisionPath(div.id, tenantId)}>{t(div.labelKey)}</Link>
            ) : (
              <span aria-disabled="true" title={t(CLOSED_WORDS[closed].title)}>
                {t(div.labelKey)}
                <span className="visually-hidden">{t(CLOSED_WORDS[closed].hint)}</span>
              </span>
            )}
          </dt>,
          <dd key={`${div.id}-answers`}>{t(ANSWERS[div.id])}</dd>,
        ];
      })}
    </dl>
  );
}

export function Customer({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const tenant = trpc.tenants.get.useQuery({ tenantId }, { retry: false });

  if (tenant.isPending) {
    return <Skeleton rows={4} />;
  }
  if (tenant.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("tenants.aboutNotLoaded", { tenantId })}
      </Errata>
    );
  }

  const name = tenant.data.displayName || tenantId;
  const sources = divisionPath("sources", tenantId);
  const { permissions } = tenant.data;
  const readsSources = closedTo(division("sources"), { tenantId, permissions }) === null;

  return (
    <div className="sheet">
      <div className="head head--division" aria-hidden="true">
        {t("nav.customers")}
      </div>
      <div className="body stack">
        <h1>{name}</h1>
        <p className="prose prose--lead">{t("tenants.aboutLead")}</p>
        <Facts>
          <Fact label={t("tenants.colCustomer")}>{name}</Fact>
          <Fact label={t("tenants.colReference")}>{tenantId}</Fact>
          <Fact label={t("tenants.colRole")}>{tenant.data.role}</Fact>
        </Facts>
        {readsSources ? (
          <div className="row">
            <Link className="plate plate--primary" to={sources}>
              {t("tenants.openSources")}
            </Link>
            {can(permissions, "tenant:manage") ? (
              <Link className="plate" to={sources}>
                {t("tenants.renameOnSources")}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="band-rule" />

      <h2 className="head">{t("tenants.insideHead")}</h2>
      <div className="body">
        <Directory tenantId={tenantId} permissions={permissions} />
      </div>
    </div>
  );
}
