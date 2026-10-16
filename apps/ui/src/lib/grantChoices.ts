/**
 * How the grant form's two selects spell what they offer (ADR 0141, ADR 0142): whom a grant is
 * for, and what it gives. Read by the form, which sends it, and by the "sees" summary, which asks
 * about the same subject -- one spelling, so the two can never name different people.
 */

import { isPermission, type Permission, parseReachObject } from "@undercroft/contracts/access";

/**
 * How the subject select spells its two kinds of option. A role key never holds a colon
 * (`ROLE_KEY`), and neither prefix is an address, so the first colon always splits it.
 */
export const ROLE_OPTION = "role:";
export const PERSON_OPTION = "email:";

/** How the grant select spells a permission; an object option is the object itself. */
export const PERMISSION_OPTION = "perm:";

/** Whom the subject select names, as a request names them; `null` for nothing it offered. */
export function subjectOf(value: string): { role: string } | { email: string } | null {
  if (value.startsWith(ROLE_OPTION)) {
    return { role: value.slice(ROLE_OPTION.length) };
  }
  if (value.startsWith(PERSON_OPTION)) {
    return { email: value.slice(PERSON_OPTION.length) };
  }
  return null;
}

/** What the grant select chose: a permission, or reading an object -- or nothing it offered. */
export function grantOf(value: string): { permission: Permission } | { object: string } | null {
  if (value.startsWith(PERMISSION_OPTION)) {
    const permission = value.slice(PERMISSION_OPTION.length);
    return isPermission(permission) ? { permission } : null;
  }
  return parseReachObject(value) === null ? null : { object: value };
}

/** The one model or reference table the grant select chose, or `null`: only one may carry a rule. */
export function oneModelOf(value: string): string | null {
  const read = parseReachObject(value);
  return read?.domain === "model" ? read.name : null;
}
