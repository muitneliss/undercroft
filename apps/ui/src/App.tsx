/**
 * The control-plane shell. Minimal on purpose in v0.1: a sign-in prompt and, once signed
 * in, the tenant list. The data path (connectors, runs, model preview) hangs off a tenant.
 *
 * Server data comes from the tRPC React Query hook, so this component holds no `useState`:
 * the fetch state (`isPending`/`isError`/`data`) belongs to the query cache, and the one
 * piece of client state -- which tenant is selected -- belongs to the Zustand store. See
 * `.claude/rules/state.md`.
 */

import { useUiStore } from "./store.ts";
import { trpc } from "./trpc.ts";

export function App(): React.ReactElement {
  const tenants = trpc.tenants.list.useQuery();
  const selectedTenantId = useUiStore((state) => state.selectedTenantId);
  const selectTenant = useUiStore((state) => state.selectTenant);

  return (
    <main className="shell">
      <h1 className="brand">
        <span className="brand__mark" aria-hidden="true" />
        Undercroft
      </h1>
      <p className="tagline">Control plane</p>

      {/* A failed tenants query means "not signed in" (or no access) -- a normal state, not
          a red error, so it uses `.state` and role="status". */}
      {tenants.isError ? (
        <p className="state" role="status">
          Sign in to continue.
        </p>
      ) : tenants.isPending ? (
        <p className="state state--busy" aria-busy="true">
          Loading…
        </p>
      ) : (
        <ul className="tenants" aria-label="tenants">
          {tenants.data.map((t) => {
            const selected = t.id === selectedTenantId;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className={selected ? "tenant tenant--selected" : "tenant"}
                  aria-current={selected}
                  onClick={() => {
                    selectTenant(t.id);
                  }}
                >
                  <span className="tenant__name">{t.displayName || t.id}</span>
                  <span className="tenant__role">{t.role}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
