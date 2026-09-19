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
 * until a customer is chosen. They render face-down rather than being hidden,
 * because a division that vanishes teaches nobody that it exists.
 */

// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.

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
}

/** Ring order: the way a customer's data actually moves through the product. */
export const DIVISIONS: readonly Division[] = [
  { id: "customers", labelKey: "nav.customers", hue: "#b24b1a", extent: 2, scoped: false },
  { id: "sources", labelKey: "nav.sources", hue: "#eda600", extent: 4, scoped: true },
  { id: "journal", labelKey: "nav.journal", hue: "#3e782b", extent: 3, scoped: true },
  { id: "lake", labelKey: "nav.lake", hue: "#0f7673", extent: 3, scoped: true },
  { id: "models", labelKey: "nav.models", hue: "#634cb0", extent: 3, scoped: true },
  { id: "reports", labelKey: "nav.reports", hue: "#7f4023", extent: 4, scoped: true },
  { id: "people", labelKey: "nav.people", hue: "#234c9e", extent: 2, scoped: true },
] as const;

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
