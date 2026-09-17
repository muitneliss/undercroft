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

  return (
    <main className="shell">
      <h1 className="brand">
        <span className="brand__mark" aria-hidden="true" />
        Undercroft
      </h1>
      <p className="tagline">Control plane</p>

      {error !== null ? (
        <p className="state" role="status">
          Sign in to continue.
        </p>
      ) : tenants === null ? (
        <p className="state state--busy" aria-busy="true">
          Loading…
        </p>
      ) : (
        <ul className="tenants" aria-label="tenants">
          {tenants.map((t) => (
            <li key={t.id} className="tenant">
              <span className="tenant__name">{t.displayName || t.id}</span>
              <span className="tenant__role">{t.role}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
