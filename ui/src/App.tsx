/**
 * The app shell and routing.
 *
 * Auth is resolved once, at the top: a 401 from the session endpoint routes to
 * sign-in rather than letting every panel render its own error. A client with
 * exactly one tenant is sent straight into it, because a list of one is not a
 * decision.
 *
 * Every signed-in route renders inside `Book`, which supplies the section board,
 * the fore-edge tab rail and the running head. The route decides which division
 * is open; the division decides the board hue; the board hue decides the
 * acetate's solved alpha. Nothing downstream has to know any of that.
 */

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";

import { api, ApiError } from "@/api/client";
import type { Source } from "@/api/types";
import { SOURCES } from "@/api/types";
import { Book } from "@/components/Book";
import { Skeleton } from "@/components/Skeleton";
import type { DivisionId } from "@/lib/divisions";
import { Lake } from "@/routes/Lake";
import { People } from "@/routes/People";
import { SignIn } from "@/routes/SignIn";
import { TenantOverview } from "@/routes/TenantOverview";
import { Tenants } from "@/routes/Tenants";

function isSource(value: string | undefined): value is Source {
  return SOURCES.includes(value as Source);
}

/**
 * A signed-in page: the book opened at one division.
 *
 * `tenantId` comes from the route rather than from state, so a link, a reload
 * and the back button all land in the same place.
 */
function Opened({
  division,
  signedInAs,
  children,
}: {
  division: DivisionId;
  signedInAs: string;
  children: (tenantId: string) => ReactNode;
}) {
  const params = useParams();
  const tenantId = params["tenantId"];

  if (!tenantId) return <Navigate to="/tenants" replace />;

  return (
    <Book tenantId={tenantId} current={division} signedInAs={signedInAs}>
      {children(tenantId)}
    </Book>
  );
}

function ScopeRoute({ signedInAs }: { signedInAs: string }) {
  const params = useParams();
  const tenantId = params["tenantId"];
  const source = params["source"];

  if (!tenantId) return <Navigate to="/tenants" replace />;
  if (!isSource(source)) return <Navigate to={`/tenants/${tenantId}`} replace />;

  return (
    <Book tenantId={tenantId} current="sources" signedInAs={signedInAs}>
      <TenantOverview tenantId={tenantId} scopeFor={source} />
    </Book>
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
      <main className="titlepage">
        <div className="titlepage__leaf">
          <Skeleton rows={3} />
        </div>
      </main>
    );
  }

  if (session.isError) {
    const unauthenticated = session.error instanceof ApiError && session.error.isUnauthenticated;
    return <SignIn reason={unauthenticated ? "expired" : "denied"} />;
  }

  const signedInAs = session.data.email;
  const isStaff = session.data.is_staff;

  return (
    <Routes>
      <Route
        path="/tenants/:tenantId/connect/:source/scope"
        element={<ScopeRoute signedInAs={signedInAs} />}
      />
      <Route
        path="/tenants/:tenantId/lake"
        element={
          <Opened division="lake" signedInAs={signedInAs}>
            {(tenantId) => <Lake tenantId={tenantId} />}
          </Opened>
        }
      />
      <Route
        path="/tenants/:tenantId/people"
        element={
          <Opened division="people" signedInAs={signedInAs}>
            {(tenantId) => <People tenantId={tenantId} isStaff={isStaff} />}
          </Opened>
        }
      />
      <Route
        path="/tenants/:tenantId"
        element={
          <Opened division="sources" signedInAs={signedInAs}>
            {(tenantId) => <TenantOverview tenantId={tenantId} />}
          </Opened>
        }
      />
      <Route
        path="/tenants"
        element={
          <Book tenantId={undefined} current="customers" signedInAs={signedInAs}>
            <Tenants />
          </Book>
        }
      />
      <Route path="*" element={<Navigate to="/tenants" replace />} />
    </Routes>
  );
}
