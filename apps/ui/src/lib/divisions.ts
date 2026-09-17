/**
 * The book's divisions.
 *
 * One entry per tabbed section, in the order they are bound. `extent` is how
 * much of the book each division occupies, and it drives the height of its tab
 * on the fore-edge rail -- so the rail is a picture of the book as well as a
 * control, the way a real tab rail is. It is a property of the division, not a
 * measurement of the current customer's data: a tab that resized itself as rows
 * arrived would move the navigation under the operator's cursor.
 *
 * Three hues of the seven-hue wheel are deliberately unspoken for. The wheel is
 * a system with room in it, not a list that happens to have four items, and the
 * next division takes the next hue rather than inventing one.
 *
 * `scoped` divisions are sections of one customer's book and cannot be opened
 * until a customer is chosen. They render face-down rather than being hidden,
 * because a division that vanishes teaches nobody that it exists.
 */

export type DivisionId = "customers" | "sources" | "lake" | "people";

export type Division = {
  id: DivisionId;
  label: string;
  /** Wheel hue, as a literal so `@/lib/acetate` can solve against it. */
  hue: string;
  /** Relative height on the fore-edge rail. */
  extent: number;
  /** Whether this division belongs to a single customer's book. */
  scoped: boolean;
};

export const DIVISIONS: readonly Division[] = [
  { id: "customers", label: "Customers", hue: "#b24b1a", extent: 2, scoped: false },
  { id: "sources", label: "Sources", hue: "#eda600", extent: 4, scoped: true },
  { id: "lake", label: "Raw lake", hue: "#0f7673", extent: 3, scoped: true },
  { id: "people", label: "People", hue: "#234c9e", extent: 2, scoped: true },
] as const;

export function division(id: DivisionId): Division {
  const found = DIVISIONS.find((d) => d.id === id);
  // Unreachable while DivisionId and DIVISIONS agree, and a loud failure rather
  // than a silently unstyled page if they ever stop agreeing.
  if (!found) throw new Error(`unknown division ${id}`);
  return found;
}

/** Where a division opens for a given customer. */
export function divisionPath(id: DivisionId, tenantId: string | undefined): string {
  if (id === "customers") return "/tenants";
  if (!tenantId) return "/tenants";
  return id === "sources" ? `/tenants/${tenantId}` : `/tenants/${tenantId}/${id}`;
}
