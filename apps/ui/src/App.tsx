/**
 * The app shell and routing.
 *
 * Auth is resolved once, at the top, through the tRPC session hook: an error routes to the
 * title page rather than letting every panel render its own. Server state lives in the
 * React Query cache behind that hook, never in component state -- see .claude/rules/state.md.
 *
 * Every signed-in route renders inside `Book`, which supplies the section board, the
 * fore-edge tab rail and the running head. The route decides which division is open; the
 * division decides the board hue; the board hue decides the acetate's solved alpha.
 */

import { lazy, type ReactNode, Suspense } from "react";
import { Navigate, Route, Routes, useParams, useSearchParams } from "react-router-dom";

import { isSource } from "@/api/types.ts";
import { Book } from "@/components/Book.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import type { DivisionId } from "@/lib/divisions.ts";
import { People } from "@/routes/People.tsx";
import { ScopePicker } from "@/routes/ScopePicker.tsx";
import { SignIn } from "@/routes/SignIn.tsx";
import { TenantOverview } from "@/routes/TenantOverview.tsx";
import { Tenants } from "@/routes/Tenants.tsx";
import { trpc } from "@/trpc.ts";

/**
 * The three divisions that closed the ring load on demand.
 *
 * Each is its own chunk, so the models editor and the charts -- the two heaviest things
 * the interface will ever carry -- never ride in the bundle an operator downloads to read
 * a schedule of grants. The Suspense boundary sits INSIDE the book, below the keyed leaf,
 * so the page turn still fires once for the division rather than once for the chunk.
 */
const Journal = lazy(() =>
  import("@/routes/Journal.tsx").then((module) => ({ default: module.Journal })),
);
const Lake = lazy(() => import("@/routes/Lake.tsx").then((module) => ({ default: module.Lake })));
const Models = lazy(() =>
  import("@/routes/Models.tsx").then((module) => ({ default: module.Models })),
);
const ModelEditor = lazy(() =>
  import("@/routes/ModelEditor.tsx").then((module) => ({ default: module.ModelEditor })),
);
const Reports = lazy(() =>
  import("@/routes/Reports.tsx").then((module) => ({ default: module.Reports })),
);
const Question = lazy(() =>
  import("@/routes/Question.tsx").then((module) => ({ default: module.Question })),
);
const Dashboard = lazy(() =>
  import("@/routes/Dashboard.tsx").then((module) => ({ default: module.Dashboard })),
);

/**
 * A signed-in page: the book opened at one division.
 *
 * `tenantId` comes from the route rather than from state, so a link, a reload and the back
 * button all land in the same place.
 */
function Opened({
  division,
  signedInAs,
  children,
}: {
  division: DivisionId;
  signedInAs: string;
  children: (tenantId: string) => ReactNode;
}): React.JSX.Element {
  const params = useParams();
  const { tenantId } = params;

  if (!tenantId) {
    return <Navigate to="/tenants" replace={true} />;
  }

  return (
    <Book tenantId={tenantId} current={division} signedInAs={signedInAs}>
      {children(tenantId)}
    </Book>
  );
}

function ScopeRoute({ signedInAs }: { signedInAs: string }): React.JSX.Element {
  const params = useParams();
  const { tenantId, source } = params;

  if (!tenantId) {
    return <Navigate to="/tenants" replace={true} />;
  }
  if (!isSource(source)) {
    return <Navigate to={`/tenants/${tenantId}`} replace={true} />;
  }

  return (
    <Book tenantId={tenantId} current="sources" signedInAs={signedInAs}>
      <ScopePicker tenantId={tenantId} source={source} />
    </Book>
  );
}

export function App(): React.JSX.Element {
  // The one auth read. `session.me` is an authed procedure, so with no session cookie it
  // errors and the app sits on the title page.
  const session = trpc.session.me.useQuery(undefined, { retry: false });
  const [params] = useSearchParams();

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
    // The reason comes from the URL, because the only thing that knows why a sign-in failed
    // is the flow that failed -- Better Auth sends a refused Google sign-in back to
    // `?reason=denied`. Absent, no reason is passed: inventing "expired" for someone who
    // simply has not signed in yet would report a failure that did not happen.
    const reason = params.get("reason");
    return <SignIn {...(reason === "denied" || reason === "expired" ? { reason } : {})} />;
  }

  const signedInAs = session.data.email;

  return (
    <Routes>
      <Route
        path="/tenants/:tenantId/connect/:source/scope"
        element={<ScopeRoute signedInAs={signedInAs} />}
      />
      <Route
        path="/tenants/:tenantId/journal/:runId?"
        element={
          <Opened division="journal" signedInAs={signedInAs}>
            {(tenantId): React.JSX.Element => (
              <Suspense fallback={<Skeleton rows={6} />}>
                <Journal tenantId={tenantId} />
              </Suspense>
            )}
          </Opened>
        }
      />
      <Route
        path="/tenants/:tenantId/lake"
        element={
          <Opened division="lake" signedInAs={signedInAs}>
            {(tenantId): React.JSX.Element => (
              <Suspense fallback={<Skeleton rows={5} />}>
                <Lake tenantId={tenantId} />
              </Suspense>
            )}
          </Opened>
        }
      />
      <Route
        path="/tenants/:tenantId/models"
        element={
          <Opened division="models" signedInAs={signedInAs}>
            {(tenantId): React.JSX.Element => (
              <Suspense fallback={<Skeleton rows={4} />}>
                <Models tenantId={tenantId} />
              </Suspense>
            )}
          </Opened>
        }
      />
      <Route
        path="/tenants/:tenantId/models/:name"
        element={
          <Opened division="models" signedInAs={signedInAs}>
            {(tenantId): React.JSX.Element => (
              <Suspense fallback={<Skeleton rows={6} />}>
                <ModelEditor tenantId={tenantId} />
              </Suspense>
            )}
          </Opened>
        }
      />
      <Route
        path="/tenants/:tenantId/reports"
        element={
          <Opened division="reports" signedInAs={signedInAs}>
            {(tenantId): React.JSX.Element => (
              <Suspense fallback={<Skeleton rows={4} />}>
                <Reports tenantId={tenantId} />
              </Suspense>
            )}
          </Opened>
        }
      />
      <Route
        path="/tenants/:tenantId/reports/questions/:id"
        element={
          <Opened division="reports" signedInAs={signedInAs}>
            {(tenantId): React.JSX.Element => (
              <Suspense fallback={<Skeleton rows={6} />}>
                <Question tenantId={tenantId} />
              </Suspense>
            )}
          </Opened>
        }
      />
      <Route
        path="/tenants/:tenantId/reports/dashboards/:id"
        element={
          <Opened division="reports" signedInAs={signedInAs}>
            {(tenantId): React.JSX.Element => (
              <Suspense fallback={<Skeleton rows={6} />}>
                <Dashboard tenantId={tenantId} />
              </Suspense>
            )}
          </Opened>
        }
      />
      <Route
        path="/tenants/:tenantId/people"
        element={
          <Opened division="people" signedInAs={signedInAs}>
            {(tenantId): React.JSX.Element => <People tenantId={tenantId} />}
          </Opened>
        }
      />
      <Route
        path="/tenants/:tenantId"
        element={
          <Opened division="sources" signedInAs={signedInAs}>
            {(tenantId): React.JSX.Element => <TenantOverview tenantId={tenantId} />}
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
      <Route path="*" element={<Navigate to="/tenants" replace={true} />} />
    </Routes>
  );
}
