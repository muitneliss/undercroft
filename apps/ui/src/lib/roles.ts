/**
 * The built-in roles a person can hold in a customer, as the browser needs to know them.
 *
 * The values are the ones the API takes and the words every surface prints: `i18n.md` keeps
 * `viewer`, `member`, `builder` and `admin` untranslated in both catalogues, so the roster, the
 * invitation form and the customer index's filter all offer these strings as they are, in the
 * order `@undercroft/contracts/access` gives them -- defined there once, for the router's zod
 * enum and this list alike.
 *
 * Nothing here says what a role may DO. That is the server's answer, `permissions`, read through
 * `can` in `@/lib/permissions.ts` (ADR 0139); a role is only ever shown or offered.
 *
 * Wordless on purpose, as `connectionFacts` is beside `presentConnection`: what a role grants
 * is a sentence, and sentences live in the catalogues, one entry per role. `ROLE_RIGHTS` names
 * which entry, and nothing more.
 */

import {
  ADMIN_ROLE,
  BUILT_IN_ROLES,
  type BuiltInRole,
  isBuiltInRole,
} from "@undercroft/contracts/access";
import { foldForSearch } from "@/lib/labelIndex.ts";

export const ROLES = BUILT_IN_ROLES;
export type Role = BuiltInRole;

/**
 * Each role's catalogue sentence saying what it may do, keyed by the role so a fourth role is a
 * type error until worded.
 *
 * Two readers, one description: `RoleRights` beside the invitation form, and `GrantReach` beside
 * a token's or a connector's grant. The sentences mirror the router's role gates (the reasoning,
 * and what a moved gate obliges, is on `RoleRights`); a second description of a role would be a
 * second thing to keep true. Here rather than in either component because a component module may
 * export only components (Fast Refresh).
 */
export const ROLE_RIGHTS = {
  viewer: "people.rightsViewer",
  member: "people.rightsMember",
  builder: "people.rightsBuilder",
  admin: "people.rightsAdmin",
} as const satisfies Record<Role, string>;

export function isRole(value: string): value is Role {
  return isBuiltInRole(value);
}

/**
 * The one member who holds `admin`, when exactly one does; otherwise `null`.
 *
 * The one place the browser names a role to decide something, and it is not a permission
 * check: the last-admin guard is written on the role key itself, because a customer must keep
 * somebody holding the role that manages everything. `ADMIN_ROLE` rather than the literal, so
 * `no-role-literal-gate` stays the rule it is everywhere else.
 *
 * This is what the server's last-admin guard refuses to demote or remove
 * (`changeRole` / `removeMember` in `repos/membership.ts`), stated in advance so the roster
 * can decline to offer what would be refused. It counts the same rows the guard counts --
 * membership rows only -- because a platform superadmin holds `admin` without one and is
 * never in the roster, so the guard does not count them either. The server's refusal stays
 * the control: two admins demoting each other at once is settled there, not here.
 */
export function soleAdmin<M extends { readonly role: string }>(members: readonly M[]): M | null {
  const admins = members.filter((member) => member.role === ADMIN_ROLE);
  return admins.length === 1 ? (admins[0] ?? null) : null;
}

/**
 * The rows of a roster or of the open invitations whose address holds what the reader typed,
 * accents and case ignored as the customer search ignores them (`foldForSearch`). An empty
 * search keeps every row.
 *
 * It narrows what is SHOWN and nothing else. `soleAdmin` is asked of the whole roster, never
 * of these rows: a search that happens to show one of two admins has not made them the last.
 */
export function byAddress<R extends { readonly email: string }>(
  rows: readonly R[],
  search: string,
): readonly R[] {
  const needle = foldForSearch(search.trim());
  return needle === "" ? rows : rows.filter((row) => foldForSearch(row.email).includes(needle));
}
