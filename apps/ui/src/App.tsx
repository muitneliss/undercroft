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

  // A failed tenants query means "not signed in" (or no access), not a page to red-box.
  if (tenants.isError) {
    return (
      <main>
        <h1>Undercroft</h1>
        <p role="alert">Sign in to continue.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Undercroft</h1>
      {tenants.isPending ? (
        <p aria-busy="true">Loading…</p>
      ) : (
        <ul aria-label="tenants">
          {tenants.data.map((t) => {
            const selected = t.id === selectedTenantId;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  aria-current={selected}
                  onClick={() => {
                    selectTenant(t.id);
                  }}
                >
                  {t.displayName || t.id} — {t.role}
                  {selected ? " (selected)" : ""}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
