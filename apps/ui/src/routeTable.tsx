/**
 * Which URL opens which division.
 *
 * A route table is DATA, and this module keeps it that way. Written as JSX children of
 * `<Routes>` it reads like a component tree and is not one: React Router collects those
 * children with `createRoutesFromChildren`, which accepts a `<Route>` or a fragment and
 * nothing else. So the obvious way to shorten a table that has grown too long -- lift half
 * of it into a `<DivisionRoutes />` component -- typechecks, bundles, passes the gate, and
 * then throws `is not a <Route> component` in the browser at the first render after a
 * successful sign-in, which is the one path no offline test reaches. It shipped once.
 * As objects the halves compose by spreading an array, and that cannot be wrong.
 *
 * Split in three because a function may not exceed 50 lines (`noExcessiveLinesPerFunction`),
 * which is the pressure that produced the components in the first place. ORDER is preserved
 * from that table: `path: "*"` stays last, with the half it has always lived in.
 *
 * The frames the routes render into -- `Opened` and `ScopeRoute` -- are components and so
 * live with the components, which is also what keeps this module exporting data alone.
 */

import { lazy, Suspense } from "react";
import { Navigate, type RouteObject } from "react-router-dom";

import { Book } from "@/components/Book.tsx";
import { Opened } from "@/components/Opened.tsx";
import { ScopeRoute } from "@/components/ScopeRoute.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { People } from "@/routes/People.tsx";
import { TenantOverview } from "@/routes/TenantOverview.tsx";
import { Tenants } from "@/routes/Tenants.tsx";

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
const LakeQuery = lazy(() =>
  import("@/routes/LakeQuery.tsx").then((module) => ({ default: module.LakeQuery })),
);
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

/** The routes reached from the tab rail, and the one that stands outside it. */
function divisionRoutes(signedInAs: string): RouteObject[] {
  return [
    {
      path: "/tenants/:tenantId/connect/:source/scope",
      element: <ScopeRoute signedInAs={signedInAs} />,
    },
    {
      path: "/tenants/:tenantId/journal/:runId?",
      element: (
        <Opened division="journal" signedInAs={signedInAs}>
          {(tenantId): React.JSX.Element => (
            <Suspense fallback={<Skeleton rows={6} />}>
              <Journal tenantId={tenantId} />
            </Suspense>
          )}
        </Opened>
      ),
    },
    {
      path: "/tenants/:tenantId/lake",
      element: (
        <Opened division="lake" signedInAs={signedInAs}>
          {(tenantId): React.JSX.Element => (
            <Suspense fallback={<Skeleton rows={5} />}>
              <Lake tenantId={tenantId} />
            </Suspense>
          )}
        </Opened>
      ),
    },
    {
      // The one page in the book bound to the window rather than to its own content: a
      // console divides a screenful, and it can only divide a height it knows. See `Book`.
      path: "/tenants/:tenantId/lake/console",
      element: (
        <Opened division="lake" signedInAs={signedInAs} fill={true}>
          {(tenantId): React.JSX.Element => (
            <Suspense fallback={<Skeleton rows={6} />}>
              <LakeQuery tenantId={tenantId} />
            </Suspense>
          )}
        </Opened>
      ),
    },
  ];
}

/** The models division: the list, and the editor a model name opens. */
function modelRoutes(signedInAs: string): RouteObject[] {
  return [
    {
      path: "/tenants/:tenantId/models",
      element: (
        <Opened division="models" signedInAs={signedInAs}>
          {(tenantId): React.JSX.Element => (
            <Suspense fallback={<Skeleton rows={4} />}>
              <Models tenantId={tenantId} />
            </Suspense>
          )}
        </Opened>
      ),
    },
    {
      path: "/tenants/:tenantId/models/:name",
      element: (
        <Opened division="models" signedInAs={signedInAs}>
          {(tenantId): React.JSX.Element => (
            <Suspense fallback={<Skeleton rows={6} />}>
              <ModelEditor tenantId={tenantId} />
            </Suspense>
          )}
        </Opened>
      ),
    },
  ];
}

/** The reports division, the two pages outside the rail, and the catch-all. */
function tenantRoutes(signedInAs: string): RouteObject[] {
  return [
    {
      path: "/tenants/:tenantId/reports",
      element: (
        <Opened division="reports" signedInAs={signedInAs}>
          {(tenantId): React.JSX.Element => (
            <Suspense fallback={<Skeleton rows={4} />}>
              <Reports tenantId={tenantId} />
            </Suspense>
          )}
        </Opened>
      ),
    },
    {
      path: "/tenants/:tenantId/reports/questions/:id",
      element: (
        <Opened division="reports" signedInAs={signedInAs}>
          {(tenantId): React.JSX.Element => (
            <Suspense fallback={<Skeleton rows={6} />}>
              <Question tenantId={tenantId} />
            </Suspense>
          )}
        </Opened>
      ),
    },
    {
      path: "/tenants/:tenantId/reports/dashboards/:id",
      element: (
        <Opened division="reports" signedInAs={signedInAs}>
          {(tenantId): React.JSX.Element => (
            <Suspense fallback={<Skeleton rows={6} />}>
              <Dashboard tenantId={tenantId} />
            </Suspense>
          )}
        </Opened>
      ),
    },
    {
      path: "/tenants/:tenantId/people",
      element: (
        <Opened division="people" signedInAs={signedInAs}>
          {(tenantId): React.JSX.Element => <People tenantId={tenantId} />}
        </Opened>
      ),
    },
    {
      path: "/tenants/:tenantId",
      element: (
        <Opened division="sources" signedInAs={signedInAs}>
          {(tenantId): React.JSX.Element => <TenantOverview tenantId={tenantId} />}
        </Opened>
      ),
    },
    {
      path: "/tenants",
      element: (
        <Book tenantId={undefined} current="customers" signedInAs={signedInAs}>
          <Tenants />
        </Book>
      ),
    },
    { path: "*", element: <Navigate to="/tenants" replace={true} /> },
  ];
}

/**
 * The whole table, in the order it has always been in.
 *
 * `signedInAs` is threaded through rather than read from anywhere ambient: it comes from the
 * one session query in `App`, and the running head shows it on every leaf.
 */
export function appRoutes(signedInAs: string): RouteObject[] {
  return [...divisionRoutes(signedInAs), ...modelRoutes(signedInAs), ...tenantRoutes(signedInAs)];
}
