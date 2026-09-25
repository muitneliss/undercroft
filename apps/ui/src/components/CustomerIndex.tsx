/** Search only the server's visible customers. The query cache still owns every row. */
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { foldForSearch } from "@/lib/labelIndex.ts";
import { useUiStore } from "@/store.ts";

export function CustomerIndex({
  customers,
}: {
  customers: readonly { id: string; displayName: string; role: string }[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const searchId = useId();
  const search = useUiStore((state) => state.tenantSearch);
  const setSearch = useUiStore((state) => state.setTenantSearch);
  const query = foldForSearch(search.trim());
  const visible = customers.filter(
    (customer) =>
      foldForSearch(customer.id).includes(query) ||
      foldForSearch(customer.displayName).includes(query),
  );
  return (
    <div className="customer-index stack">
      <div className="row row--field">
        <div className="field">
          <label className="label" htmlFor={searchId}>
            {t("tenants.searchLabel")}
          </label>
          <input
            className="input"
            id={searchId}
            type="search"
            value={search}
            placeholder={t("tenants.searchPlaceholder")}
            onChange={(event): void => {
              setSearch(event.target.value);
            }}
          />
        </div>
        {search === "" ? null : (
          <button
            className="plate"
            type="button"
            onClick={(): void => {
              setSearch("");
            }}
          >
            {t("tenants.clearSearch")}
          </button>
        )}
      </div>
      <p className="note" role="status">
        {t("tenants.caption", { count: visible.length })}
      </p>
      {visible.length === 0 ? (
        <p className="prose">{t("tenants.noMatches")}</p>
      ) : (
        <div className="customer-index__scroll">
          <table className="customer-index__table table">
            <caption className="visually-hidden">{t("tenants.title")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("tenants.colCustomer")}</th>
                <th className="customer-index__reference" scope="col">
                  {t("tenants.colReference")}
                </th>
                <th scope="col">{t("tenants.colRole")}</th>
                <th scope="col">{t("tenants.colAction")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((customer) => (
                <tr key={customer.id}>
                  <th scope="row">
                    <Link to={`/tenants/${encodeURIComponent(customer.id)}`}>
                      {customer.displayName || customer.id}
                    </Link>
                    <span className="customer-index__mobile-id datum datum--quiet">
                      {customer.id}
                    </span>
                  </th>
                  <td className="customer-index__reference datum datum--quiet">{customer.id}</td>
                  <td className="datum">{customer.role}</td>
                  <td>
                    <Link
                      className="plate plate--small"
                      to={`/tenants/${encodeURIComponent(customer.id)}`}
                      aria-label={t("tenants.openNamed", {
                        name: customer.displayName || customer.id,
                      })}
                    >
                      {t("tenants.open")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
