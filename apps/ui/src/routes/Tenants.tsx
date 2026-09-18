/**
 * The customers division: the book's table of contents.
 *
 * One line per member company, the reference in mono where an operator's eye already looks
 * for it, and the role as a word. The list comes from `trpc.tenants.list`, whose query IS
 * the visibility boundary -- it returns only tenants the caller is a member of.
 *
 * Every name here is a CASE-ID. `.claude/rules/pii.md` -- real client names live only in
 * restricted storage, never in a tracked file, a fixture or a screenshot.
 *
 * Adding a customer has no endpoint yet (the control-plane router exposes no create), so the
 * "Add" affordance is a plain note rather than a form that would post nowhere.
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { Errata } from "@/components/Errata";
import { Skeleton } from "@/components/Skeleton";
import { trpc } from "@/trpc";

export function Tenants() {
  const { t } = useTranslation();
  const tenants = trpc.tenants.list.useQuery();

  if (tenants.isPending) return <Skeleton rows={4} />;

  if (tenants.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live>
        {t("tenants.notLoaded")}
      </Errata>
    );
  }

  const list = tenants.data;

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.customers")}</div>
      <div className="body stack">
        <h1>{t("tenants.title")}</h1>
        <p className="prose prose--lead">{t("tenants.lead")}</p>

        {list.length === 0 ? (
          <EmptyState title={t("tenants.emptyTitle")} body={t("tenants.emptyBody")} />
        ) : (
          <table className="table">
            {/* The noun agrees with the count through i18next's plural forms, not through a
                ternary: "1 customer" and "4 customers" is an English rule, and hard-coding
                it here would have produced "1 khách hàngs" the moment a second language
                arrived. */}
            <caption>{t("tenants.caption", { count: list.length })}</caption>
            <thead>
              <tr>
                <th scope="col">{t("tenants.colCustomer")}</th>
                <th scope="col">{t("tenants.colReference")}</th>
                <th scope="col">{t("tenants.colRole")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((tenant) => (
                <tr key={tenant.id}>
                  <td>
                    <Link to={`/tenants/${tenant.id}`}>{tenant.displayName || tenant.id}</Link>
                  </td>
                  <td className="datum datum--quiet">{tenant.id}</td>
                  <td>{tenant.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="band-rule" />

      <div className="head">{t("tenants.addHead")}</div>
      <div className="body">
        <p className="note">{t("tenants.addNote")}</p>
      </div>
    </div>
  );
}
