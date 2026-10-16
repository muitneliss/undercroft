/**
 * The control that switches the People division's views (`?view=`), and what the open view
 * needs first under it. Its own module beside `routes/People.tsx`, which lists what the open
 * view shows; this is how a reader chooses it.
 */

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { type PeopleAddress, type PeopleView, VIEWS } from "@/components/usePeopleAddress.ts";

/**
 * The views as one control, the Models division's plate pair with more plates, and under it
 * what the open view needs first (`ViewLead`). Each count is the whole list's, not the search's:
 * it says what a view holds before it is opened. Activity is printed only for a holder of
 * `audit:read`.
 */
export function ViewHead({
  address,
  members,
  invitations,
  tenantId,
  showsActivity,
}: {
  address: PeopleAddress;
  members: number;
  invitations: number;
  tenantId: string;
  showsActivity: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const labels: Record<PeopleView, string> = {
    members: t("people.viewMembers", { count: members }),
    invites: t("people.viewInvites", { count: invitations }),
    roles: t("people.viewRoles"),
    access: t("people.viewAccess"),
    activity: t("people.viewActivity"),
  };
  return (
    <>
      <nav aria-label={t("people.viewsLabel")} className="langset">
        {VIEWS.filter((each) => showsActivity || each !== "activity").map((each) => (
          <Link
            key={each}
            className="plate plate--small"
            to={{ search: address.viewSearch(each) }}
            {...(each === address.view ? { "aria-current": "page" as const } : {})}
          >
            {labels[each]}
          </Link>
        ))}
      </nav>
      <ViewLead address={address} tenantId={tenantId} />
    </>
  );
}

/** What the open view needs first: what roles and grants are, the log's scope, or the search. */
function ViewLead({
  address,
  tenantId,
}: {
  address: PeopleAddress;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (address.view === "roles") {
    return <p className="prose">{t("roleEditor.lead", { tenantId })}</p>;
  }
  if (address.view === "access") {
    return <p className="prose">{t("accessGrants.lead")}</p>;
  }
  if (address.view === "activity") {
    return <p className="prose">{t("activity.leadTenant", { tenantId })}</p>;
  }
  return <AddressSearch search={address.search} setSearch={address.setSearch} />;
}

/** The search over addresses, on the two views that list them, and one clear while it narrows. */
function AddressSearch({
  search,
  setSearch,
}: {
  search: string;
  setSearch: (search: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const searchId = useId();
  return (
    <div className="row row--field">
      <div className="field">
        <label className="label" htmlFor={searchId}>
          {t("people.searchLabel")}
        </label>
        <input
          className="input"
          id={searchId}
          type="search"
          autoComplete="off"
          value={search}
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
          {t("people.clearSearch")}
        </button>
      )}
    </div>
  );
}
