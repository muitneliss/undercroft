/**
 * The book's divisions.
 *
 * One entry per tabbed section, in the order they are bound. `extent` is how
 * much of the book each division occupies, and it drives the width of its tab
 * on the strip -- so the strip is a picture of the book as well as a control,
 * the way a real tab strip is. It is a property of the division, not a
 * measurement of the current customer's data: a tab that resized itself as rows
 * arrived would move the navigation under the operator's cursor.
 *
 * The seven hues of the wheel are all spoken for, in the wheel's own order: the
 * Journal took grass, Models violet and Reports sienna when the ring closed
 * (ADR 0019). Hue means "which division" and nothing else, which is why a new
 * section takes the next hue rather than choosing one -- and why an eighth
 * section is a decision about the wheel before it is a route.
 *
 * `scoped` divisions are sections of one customer's book and cannot be opened
 * until a customer is chosen. A division that `requires` a permission opens only
 * for a reader who holds it in that customer -- ADR 0119 closed People to anyone
 * but an admin, ADR 0139 restated that as the permission its procedures need, and
 * ADR 0146 gave Sources, the Journal, the Lake and Models one each, so a reader of
 * Reports alone opens Customers and Reports. Either way they render face-down
 * rather than being hidden, because a division that vanishes teaches nobody that
 * it exists. `closedTo` is the one place both rules are read.
 */

import { can, type Permission } from "@/lib/permissions.ts";

export type DivisionId =
  | "customers"
  | "sources"
  | "journal"
  | "lake"
  | "models"
  | "reports"
  | "people";

export interface Division {
  id: DivisionId;
  /**
   * The catalogue key for this division's name, not the name itself.
   *
   * A tab label is drawn in more than one place -- the strip, and a running head or a
   * division list that comes later -- and a table that held English would make each of
   * those its own translation. See `@/i18n`.
   */
  labelKey: `nav.${DivisionId}`;
  /** Wheel hue, as a literal so `@/lib/acetate` can solve against it. */
  hue: string;
  /** Relative width on the strip. */
  extent: number;
  /** Whether this division belongs to a single customer's book. */
  scoped: boolean;
  /**
   * The permission a reader must hold to open it, or `null` for any member: every procedure the
   * division reads needs it on the server, so for anyone else it could print nothing but
   * refusals. The server's gate is the control; this only says so before it is asked.
   */
  requires: Permission | null;
}

/** Ring order: the way a customer's data actually moves through the product. */
export const DIVISIONS: readonly Division[] = [
  {
    id: "customers",
    labelKey: "nav.customers",
    hue: "#b24b1a",
    extent: 2,
    scoped: false,
    requires: null,
  },
  {
    id: "sources",
    labelKey: "nav.sources",
    hue: "#eda600",
    extent: 4,
    scoped: true,
    requires: "sources:read",
  },
  {
    id: "journal",
    labelKey: "nav.journal",
    hue: "#3e782b",
    extent: 3,
    scoped: true,
    requires: "runs:read",
  },
  {
    id: "lake",
    labelKey: "nav.lake",
    hue: "#0f7673",
    extent: 3,
    scoped: true,
    requires: "lake:read",
  },
  {
    id: "models",
    labelKey: "nav.models",
    hue: "#634cb0",
    extent: 3,
    scoped: true,
    requires: "models:read",
  },
  {
    id: "reports",
    labelKey: "nav.reports",
    hue: "#7f4023",
    extent: 4,
    scoped: true,
    requires: null,
  },
  {
    id: "people",
    labelKey: "nav.people",
    hue: "#234c9e",
    extent: 2,
    scoped: true,
    requires: "people:manage",
  },
] as const;

/** Why a division will not open for a reader. */
export type Closed = "no-customer" | "not-permitted";

/**
 * What a face-down division says, by why it is closed: a `title` for a pointer, and a `hint`
 * read to a screen reader after the division's own name. Catalogue keys, as `labelKey` is,
 * so the tab strip and the customer's directory print one reason in the same words.
 */
export const CLOSED_WORDS = {
  "no-customer": { title: "nav.lockedTitle", hint: "nav.lockedHint" },
  "not-permitted": { title: "nav.notPermittedTitle", hint: "nav.notPermittedHint" },
} as const satisfies Record<Closed, { title: `nav.${string}`; hint: `nav.${string}` }>;

/**
 * Why a division will not open for this reader, or `null` when it will.
 *
 * `no-customer`: it belongs to a book and none is open. `not-permitted`: the reader's
 * permissions in the open book are known and do not include the one the division requires -- a
 * platform superadmin holds every permission in every customer (ADR 0013), so they are never
 * closed out.
 *
 * Permissions that are NOT known -- `tenants.get` still on its way, or refused -- close nothing.
 * A guess either way would be wrong for somebody: closing would show an admin a division turned
 * face-down that is theirs, and the server refuses a reader without the permission whatever the
 * browser drew, so the worst an open guess costs is a refusal the division prints itself.
 */
export function closedTo(
  div: Division,
  reader: {
    readonly tenantId: string | undefined;
    readonly permissions: readonly Permission[] | undefined;
  },
): Closed | null {
  if (div.scoped && !reader.tenantId) {
    return "no-customer";
  }
  if (
    div.requires !== null &&
    reader.permissions !== undefined &&
    !can(reader.permissions, div.requires)
  ) {
    return "not-permitted";
  }
  return null;
}

export function division(id: DivisionId): Division {
  const found = DIVISIONS.find((d) => d.id === id);
  // Unreachable while DivisionId and DIVISIONS agree, and a loud failure rather
  // than a silently unstyled page if they ever stop agreeing.
  if (!found) {
    throw new Error(`unknown division ${id}`);
  }
  return found;
}

/** Where a division opens for a given customer. */
export function divisionPath(id: DivisionId, tenantId: string | undefined): string {
  if (id === "customers") {
    return "/tenants";
  }
  if (!tenantId) {
    return "/tenants";
  }
  return id === "sources" ? `/tenants/${tenantId}` : `/tenants/${tenantId}/${id}`;
}

/**
 * Where "Open" opens a customer's book for this reader: the first division in ring order that is
 * open to them. That is Sources, where `/tenants/:tenantId` has always opened a book, for every
 * reader who may read it; a reader of Reports alone (ADR 0146) opens at Reports instead of onto a
 * notice. Permissions not yet known open at Sources, for the reason `closedTo` gives.
 */
export function bookPath(tenantId: string, permissions: readonly Permission[] | undefined): string {
  const reader = { tenantId, permissions };
  const first = DIVISIONS.find((div) => div.scoped && closedTo(div, reader) === null);
  return divisionPath(first?.id ?? "sources", tenantId);
}

/**
 * One customer's own page, in the Customers division: its facts and a door to each division.
 *
 * Beside `/tenants/:tenantId` rather than at it, because that address has always opened the
 * book at Sources and every link already printed to it must keep landing there.
 */
export function customerPagePath(tenantId: string): string {
  return `/tenants/${encodeURIComponent(tenantId)}/about`;
}
