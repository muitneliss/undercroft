/**
 * The three roles a person holds in a customer, as the browser needs to know them.
 *
 * The values are the ones the API takes and the words every surface prints: `i18n.md` keeps
 * `viewer`, `member` and `admin` untranslated in both catalogues, so the roster, the
 * invitation form and the customer index's filter all offer these strings as they are, in
 * this order, which is the order of authority (`ROLE_RANK` in the control plane).
 *
 * Wordless on purpose, as `connectionFacts` is beside `presentConnection`: what a role grants
 * is a sentence, and sentences live in the catalogues, one entry per role.
 */

export const ROLES = ["viewer", "member", "admin"] as const;
export type Role = (typeof ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);

export function isRole(value: string): value is Role {
  return ROLE_SET.has(value);
}

/**
 * The one member who holds `admin`, when exactly one does; otherwise `null`.
 *
 * This is what the server's last-admin guard refuses to demote or remove
 * (`changeRole` / `removeMember` in `repos/membership.ts`), stated in advance so the roster
 * can decline to offer what would be refused. It counts the same rows the guard counts --
 * membership rows only -- because a platform superadmin holds `admin` without one and is
 * never in the roster, so the guard does not count them either. The server's refusal stays
 * the control: two admins demoting each other at once is settled there, not here.
 */
export function soleAdmin<M extends { readonly role: string }>(members: readonly M[]): M | null {
  const admins = members.filter((member) => member.role === "admin");
  return admins.length === 1 ? (admins[0] ?? null) : null;
}
