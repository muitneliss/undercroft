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

import type {
  Connection,
  LakeManifest,
  LakeObject,
  Member,
  SessionUser,
  Source,
  Tenant,
} from "@/api/types";

export type Store = {
  user: SessionUser | null;
  tenants: Tenant[];
  members: Record<string, Member[]>;
  connections: Record<string, Connection[]>;
  /** Objects in the raw lake, per tenant. */
  lake: Record<string, LakeObject[]>;
  /** Observations per object key, oldest first, create-only as the real lake is. */
  manifests: Record<string, LakeManifest[]>;
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
    lake: { [CASE_A]: [] },
    manifests: {},
    visible: new Set([CASE_A]),
  };
}

/**
 * Put an object in the lake, with one observation per stamp.
 *
 * Observations are appended, never replaced: the real store refuses to overwrite
 * an existing observation, and a fixture helper that quietly overwrote one would
 * model a lake this platform does not have.
 */
export function storeObject(
  tenantId: string,
  key: string,
  observations: Omit<LakeManifest, "stamp">[],
): void {
  const versions = observations.map((observation, i) => ({
    stamp: `2026-09-${String(10 + i).padStart(2, "0")}T02:00:00Z`,
    source_key: key,
    ...observation,
  }));

  const newest = versions[versions.length - 1];
  const existing = store.lake[tenantId] ?? [];

  store.manifests[key] = versions;
  store.lake[tenantId] = [
    ...existing.filter((o) => o.key !== key),
    {
      key,
      versions: versions.length,
      newest_sha256: newest?.sha256 ?? null,
      bytes: newest?.bytes ?? null,
    },
  ];
}

export const store: Store = freshStore();

export function resetStore(): void {
  Object.assign(store, freshStore());
}
