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

// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { trpc } from "@/trpc.ts";

export function Tenants(): React.JSX.Element {
  const { t } = useTranslation();
  const tenants = trpc.tenants.list.useQuery();

  if (tenants.isPending) {
    return <Skeleton rows={4} />;
  }

  if (tenants.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
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
