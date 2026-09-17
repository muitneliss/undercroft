/**
 * The in-memory platform the tests run against.
 *
 * `.claude/rules/tests.md`: *prefer a real in-memory implementation over a mock*,
 * and *never assert that a mock was called* — a suite that asserts a mock was
 * called is green whether or not the code works. So this is a working, mutable
 * model of the control plane's state, and the request handlers in `server.ts`
 * read and write it exactly as the real API reads and writes Postgres. Tests
 * then assert on what the user sees.
 *
 * `.claude/rules/pii.md`: every name here is invented and every tenant is a
 * CASE-ID. Nothing is anonymised from a real record — anonymising leaves the
 * shape, the amounts and the dates, and those re-identify.
 */

import type { Connection, Member, SessionUser, Source, Tenant } from "@/api/types";

export type Store = {
  user: SessionUser | null;
  tenants: Tenant[];
  members: Record<string, Member[]>;
  connections: Record<string, Connection[]>;
  /** Tenants the signed-in user may see. Others must be indistinguishable from absent. */
  visible: Set<string>;
};

export const CASE_A = "CASE-A1B2C3";
export const CASE_B = "CASE-D4E5F6";

export function connection(source: Source, over: Partial<Connection> = {}): Connection {
  return {
    source,
    status: "disconnected",
    external_account_id: "",
    external_account_label: "",
    scopes: [],
    config: {},
    schedule_cron: "",
    last_run_id: "",
    expires_at: null,
    ...over,
  };
}

export function freshStore(): Store {
  return {
    user: {
      id: "user-1",
      email: "operator@vietcham.example",
      display_name: "Operator",
      is_staff: true,
    },
    tenants: [
      { id: CASE_A, display_name: "CASE-A1B2C3", status: "active", created_at: "2026-09-01T00:00:00Z" },
    ],
    members: { [CASE_A]: [] },
    connections: {
      [CASE_A]: [
        connection("hubspot"),
        connection("xero"),
        connection("gmail"),
        connection("drive"),
      ],
    },
    visible: new Set([CASE_A]),
  };
}

export const store: Store = freshStore();

export function resetStore(): void {
  Object.assign(store, freshStore());
}
