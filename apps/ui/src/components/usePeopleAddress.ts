/**
 * Which of the People division's views is open, and what the reader searched for: both the page's
 * address, read and written here.
 */

import { useSearchParams } from "react-router-dom";

/**
 * The four views of the division, in the order the plates print. Activity is the customer's audit
 * log (ADR 0112), which only its admin may read: `audit.tenant` refuses anybody else, so for them
 * the plate is not printed and an address naming it opens Members.
 */
export const VIEWS = ["members", "invites", "roles", "activity"] as const;
export type PeopleView = (typeof VIEWS)[number];

/**
 * Which view is open and what the reader searched for, both read from the address.
 *
 * The address and not the store, as the customer list's filters are: a view is a page a reader
 * links, reloads and comes Back to. A view the address names that is not one of these
 * opens Members rather than guessing. The search is replaced rather than pushed, because a
 * keystroke is not a page; a view is pushed, because it is one. Both keep the other, so a
 * search carries from Members to the invitations it may also match.
 */
export interface PeopleAddress {
  readonly view: PeopleView;
  readonly search: string;
  readonly setSearch: (search: string) => void;
  readonly viewSearch: (view: PeopleView) => string;
}

export function usePeopleAddress(): PeopleAddress {
  const [params, setParams] = useSearchParams();
  const asked = params.get("view");
  return {
    view: VIEWS.find((view) => view === asked) ?? "members",
    search: params.get("q") ?? "",
    setSearch: (search): void => {
      const next = new URLSearchParams(params);
      if (search === "") {
        next.delete("q");
      } else {
        next.set("q", search);
      }
      setParams(next, { replace: true });
    },
    viewSearch: (view): string => {
      const next = new URLSearchParams(params);
      if (view === "members") {
        next.delete("view");
      } else {
        next.set("view", view);
      }
      const written = next.toString();
      return written === "" ? "" : `?${written}`;
    },
  };
}
