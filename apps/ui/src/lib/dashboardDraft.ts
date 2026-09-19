/**
 * The dashboard an author is editing, as the store holds it, and the decisions asked of it.
 *
 * The same idiom as the question draft: a snapshot of what the server holds rides along so
 * "unsaved" is a comparison and not a flag, and a dashboard never saved is unsaved by
 * definition. The layout's moves live in `lib/dashboardLayout.ts`; this only holds.
 */

import type { DashboardFilter, DashboardLayout } from "@undercroft/contracts/bi";

import type { DashboardView } from "@/api/types.ts";

export interface DashboardDraft {
  readonly tenantId: string;
  /** Null until the first save. */
  readonly id: string | null;
  readonly name: string;
  readonly layout: DashboardLayout;
  readonly filters: DashboardFilter[];
  readonly saved: {
    readonly name: string;
    readonly layout: DashboardLayout;
    readonly filters: DashboardFilter[];
  } | null;
}

export function newDashboardDraft(tenantId: string): DashboardDraft {
  return { tenantId, id: null, name: "", layout: { tiles: [] }, filters: [], saved: null };
}

export function draftFromDashboard(tenantId: string, dashboard: DashboardView): DashboardDraft {
  const held = { name: dashboard.name, layout: dashboard.layout, filters: dashboard.filters };
  return { tenantId, id: dashboard.id, ...held, saved: held };
}

/** Whether the draft differs from what the server holds. Never saved is always unsaved. */
export function isDashboardDirty(draft: DashboardDraft): boolean {
  if (draft.saved === null) {
    return true;
  }
  return (
    JSON.stringify({ n: draft.name, l: draft.layout, f: draft.filters }) !==
    JSON.stringify({ n: draft.saved.name, l: draft.saved.layout, f: draft.saved.filters })
  );
}
