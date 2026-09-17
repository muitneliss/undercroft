/**
 * The app shell and routing.
 *
 * Auth is resolved once, at the top: a 401 from the session endpoint routes to
 * sign-in rather than letting every panel render its own error. A client with
 * exactly one tenant is sent straight into it, because a list of one is not a
 * decision.
 */

import { useQuery } from "@tanstack/react-query";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useParams,
} from "react-router-dom";

import { api, ApiError } from "@/api/client";
import type { Source } from "@/api/types";
import { SOURCES } from "@/api/types";
import { Skeleton } from "@/components/Skeleton";
import { ScopePanel } from "@/routes/ScopePanel";
import { SignIn } from "@/routes/SignIn";
import { TenantOverview } from "@/routes/TenantOverview";
import { Tenants } from "@/routes/Tenants";

function isSource(value: string | undefined): value is Source {
  return SOURCES.includes(value as Source);
}

function TenantRoute({ view }: { view: "overview" | "scope" }) {
  const params = useParams();
  const tenantId = params["tenantId"];
  const source = params["source"];

  if (!tenantId) return <Navigate to="/" replace />;

  if (view === "scope") {
    if (!isSource(source)) return <Navigate to={`/tenants/${tenantId}`} replace />;
    return <ScopePanel tenantId={tenantId} source={source} />;
  }
  return <TenantOverview tenantId={tenantId} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const tenantId = params["tenantId"];

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="sidebar__brand">VietCham data</div>
        <div className="sidebar__nav">
          <NavLink className="sidebar__link" to="/tenants" end>
            Customers
          </NavLink>
          {tenantId ? (
            <>
              <NavLink className="sidebar__link" to={`/tenants/${tenantId}`} end>
                Setup
              </NavLink>
            </>
          ) : null}
        </div>
        <div className="sidebar__footer">
          <form method="post" action="/api/auth/logout">
            <button className="btn" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}

export function App() {
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api.session(),
    retry: false,
  });

  if (session.isPending) {
    return (
      <main className="main">
        <Skeleton rows={3} />
      </main>
    );
  }

  if (session.isError) {
    const unauthenticated = session.error instanceof ApiError && session.error.isUnauthenticated;
    return <SignIn reason={unauthenticated ? "expired" : "denied"} />;
  }

  return (
    <Routes>
      <Route
        path="/tenants/:tenantId/connect/:source/scope"
        element={
          <Shell>
            <TenantRoute view="scope" />
          </Shell>
        }
      />
      <Route
        path="/tenants/:tenantId"
        element={
          <Shell>
            <TenantRoute view="overview" />
          </Shell>
        }
      />
      <Route
        path="/tenants"
        element={
          <Shell>
            <Tenants />
          </Shell>
        }
      />
      <Route path="*" element={<Navigate to="/tenants" replace />} />
    </Routes>
  );
}
