/**
 * The customers the server lets this reader see, narrowed by what they type and by the role
 * they hold in each.
 *
 * Both filters live in the address (`?q=` and `?role=`), not in the store: a narrowed list is
 * a page a reader can link, reload or come Back to, and one home for both means "clear" is one
 * write and the count can never describe a list other than the one on screen. The query cache
 * still owns every row; this only chooses which of them to show.
 *
 * A `role` the address names that is not one of the three is ignored rather than guessed at,
 * and the select shows "any role" so the reader can see that nothing is narrowing the list.
 */
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { customerPagePath } from "@/lib/divisions.ts";
import { foldForSearch } from "@/lib/labelIndex.ts";
import { isRole, ROLES } from "@/lib/roles.ts";

interface Customer {
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
}

/** The two filters, read from the address, and the one way to write them back. */
function useCustomerFilters(): {
  search: string;
  role: string;
  setFilters: (values: { readonly q?: string; readonly role?: string }) => void;
} {
  const [params, setParams] = useSearchParams();
  const asked = params.get("role") ?? "";
  return {
    search: params.get("q") ?? "",
    role: isRole(asked) ? asked : "",
    // Written, or removed when empty: `?q=` alone is a link nobody meant. Replaced rather
    // than pushed, because a keystroke is not a page and Back should leave the list.
    setFilters: (values): void => {
      const next = new URLSearchParams(params);
      for (const [name, value] of Object.entries(values)) {
        if (value === "") {
          next.delete(name);
        } else {
          next.set(name, value);
        }
      }
      setParams(next, { replace: true });
    },
  };
}

/** The search box, the role filter and -- while either narrows the list -- one clear. */
function CustomerFilters(): React.JSX.Element {
  const { t } = useTranslation();
  const searchId = useId();
  const roleId = useId();
  const { search, role, setFilters } = useCustomerFilters();
  return (
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
            setFilters({ q: event.target.value });
          }}
        />
      </div>
      <div className="field customer-index__role">
        <label className="label" htmlFor={roleId}>
          {t("tenants.roleLabel")}
        </label>
        <select
          className="input input--select"
          id={roleId}
          value={role}
          onChange={(event): void => {
            setFilters({ role: event.target.value });
          }}
        >
          <option value="">{t("tenants.roleAny")}</option>
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      {search === "" && role === "" ? null : (
        <button
          className="plate"
          type="button"
          onClick={(): void => {
            setFilters({ q: "", role: "" });
          }}
        >
          {t("tenants.clearFilters")}
        </button>
      )}
    </div>
  );
}

function CustomerTable({ visible }: { visible: readonly Customer[] }): React.JSX.Element {
  const { t } = useTranslation();
  return (
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
                {/* The name opens the customer's own page; Open, beside it, opens the book. */}
                <Link to={customerPagePath(customer.id)}>
                  {customer.displayName || customer.id}
                </Link>
                <span className="customer-index__mobile-id datum datum--quiet">{customer.id}</span>
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
  );
}

export function CustomerIndex({
  customers,
}: {
  customers: readonly Customer[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const { search, role } = useCustomerFilters();
  const query = foldForSearch(search.trim());
  // One list, and the count below is its length: the count can only describe the rows shown.
  const visible = customers.filter(
    (customer) =>
      (role === "" || customer.role === role) &&
      (foldForSearch(customer.id).includes(query) ||
        foldForSearch(customer.displayName).includes(query)),
  );
  // While a filter narrows the list the count says so, against every customer the reader has:
  // "2" alone reads as all there is. The same condition that offers Clear.
  const filtered = search !== "" || role !== "";
  return (
    <div className="customer-index stack">
      <CustomerFilters />
      <p className="note" role="status">
        {filtered
          ? t("tenants.captionFiltered", { shown: visible.length, count: customers.length })
          : t("tenants.caption", { count: visible.length })}
      </p>
      {visible.length === 0 ? (
        <p className="prose">{t("tenants.noMatches")}</p>
      ) : (
        <CustomerTable visible={visible} />
      )}
    </div>
  );
}
