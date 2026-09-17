/**
 * The control-plane shell. Minimal on purpose in v0.1: a sign-in prompt and, once signed
 * in, the tenant list. The data path (connectors, runs, model preview) hangs off a tenant.
 */

import { useEffect, useState } from "react";
import { trpc } from "./trpc.ts";

interface TenantRow {
  id: string;
  displayName: string;
  role: string;
}

export function App(): React.ReactElement {
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.tenants.list.query().then(setTenants, (e: unknown) => {
      setError(e instanceof Error ? e.message : "failed to load");
    });
  }, []);

  if (error !== null) {
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
      {tenants === null ? (
        <p aria-busy="true">Loading…</p>
      ) : (
        <ul aria-label="tenants">
          {tenants.map((t) => (
            <li key={t.id}>
              {t.displayName || t.id} — {t.role}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
