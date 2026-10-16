/**
 * The roles a person can hold in a customer, as the browser needs to know them: the four
 * built-ins every customer has, and -- from `roles.list` -- the ones a customer defined (ADR 0141).
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
  type Permission,
} from "@undercroft/contracts/access";
import { foldForSearch } from "@/lib/labelIndex.ts";

export const ROLES = BUILT_IN_ROLES;
export type Role = BuiltInRole;

/** One role as `roles.list` answers it, as far as the browser reads one. */
export interface ListedRole {
  readonly key: string;
  readonly builtin: boolean;
  /** The customer's name for its own role, never translated; `null` for a built-in. */
  readonly label: string | null;
  readonly description: string;
  readonly permissions: readonly Permission[];
  readonly members: number;
  readonly invitations: number;
}

/** A role as a picker offers it: its key, and the customer's label when it has one. */
export type RoleOption = Pick<ListedRole, "key" | "label">;

/**
 * The roles a picker offers: the customer's whole list once `roles.list` has answered, and until
 * then the four built-ins. Not a guess: every customer has exactly those four
 * (`600_custom_roles.sql`), so the fallback is a list the server would also give, short of the
 * customer's own.
 */
export function roleOptions(listed: readonly RoleOption[] | undefined): readonly RoleOption[] {
  return listed ?? ROLES.map((key) => ({ key, label: null }));
}

/**
 * How a role is named on screen: a built-in by its key, untranslated (`i18n.md`); a customer's own
 * by the label it chose, with the key beside it, since the key is what the CLI and an agent type.
 */
export function roleName(role: RoleOption): string {
  return role.label === null ? role.key : `${role.label} (${role.key})`;
}

/** A role's name by key from the customer's list; the key itself while the list is not here. */
export function roleNamed(key: string, listed: readonly RoleOption[] | undefined): string {
  const found = listed?.find((role) => role.key === key);
  return found === undefined ? key : roleName(found);
}

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

/** Whether a string is one of the built-ins: the customer index's filter offers only those. */
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
