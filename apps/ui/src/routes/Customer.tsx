/**
 * One customer's own page: what the book is, and a door to each of its divisions.
 *
 * In the Customers division, at `/tenants/:tenantId/about`, and reached from the customer
 * list by the customer's name; `Open` beside the name still opens the book at Sources, which
 * is what `/tenants/:tenantId` has always done.
 *
 * It prints only what `tenants.get` answers -- the name, the ID and the reader's role. The
 * customer's creation date is in the database but not in that answer, and a page that printed
 * it would need a server field first, not a guess here.
 *
 * The display name is corrected in exactly one place, `DisplayNameForm` at the foot of
 * Sources, and this page links there rather than holding a second copy: two forms for one
 * value are two sets of cache invalidations to keep in step, and they drift. The link is for
 * an admin only, as the form is; the server's `requireRole("admin")` refuses regardless.
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { DIVISIONS, type DivisionId, divisionPath } from "@/lib/divisions.ts";
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

/** One fact about the customer: a caption over a datum, as a run's facts are printed. */
function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <span className="stack stack--tight">
      <span className="label">{label}</span>
      <span className="datum">{value}</span>
    </span>
  );
}

/** Each division of the book, in ring order, with the question it answers. */
function Directory({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <dl className="access" aria-label={t("tenants.insideLabel", { tenantId })}>
      {DIVISIONS.flatMap((div) =>
        div.id === "customers"
          ? []
          : [
              <dt key={`${div.id}-name`}>
                <Link to={divisionPath(div.id, tenantId)}>{t(div.labelKey)}</Link>
              </dt>,
              <dd key={`${div.id}-answers`}>{t(ANSWERS[div.id])}</dd>,
            ],
      )}
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

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.customers")}</div>
      <div className="body stack">
        <h1>{name}</h1>
        <p className="prose prose--lead">{t("tenants.aboutLead")}</p>
        <div className="row">
          <Fact label={t("tenants.colCustomer")} value={name} />
          <Fact label={t("tenants.colReference")} value={tenantId} />
          <Fact label={t("tenants.colRole")} value={tenant.data.role} />
        </div>
        <div className="row">
          <Link className="plate plate--primary" to={sources}>
            {t("tenants.openSources")}
          </Link>
          {tenant.data.role === "admin" ? (
            <Link className="plate" to={sources}>
              {t("tenants.renameOnSources")}
            </Link>
          ) : null}
        </div>
      </div>

      <div className="band-rule" />

      <div className="head">{t("tenants.insideHead")}</div>
      <div className="body">
        <Directory tenantId={tenantId} />
      </div>
    </div>
  );
}
