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

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for this rule makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off globally.

import type { ReactNode } from "react";
import { Navigate, Route, Routes, useParams, useSearchParams } from "react-router-dom";

import type { Source } from "@/api/types.ts";
import { SOURCES } from "@/api/types.ts";
import { Book } from "@/components/Book.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import type { DivisionId } from "@/lib/divisions.ts";
import { Lake } from "@/routes/Lake.tsx";
import { People } from "@/routes/People.tsx";
import { SignIn } from "@/routes/SignIn.tsx";
import { TenantOverview } from "@/routes/TenantOverview.tsx";
import { Tenants } from "@/routes/Tenants.tsx";
import { trpc } from "@/trpc.ts";

function isSource(value: string | undefined): value is Source {
  return SOURCES.includes(value as Source);
}

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
}) {
  const params = useParams();
  const tenantId = params["tenantId"];

  if (!tenantId) {
    return <Navigate to="/tenants" replace={true} />;
  }

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

  if (!tenantId) {
    return <Navigate to="/tenants" replace={true} />;
  }
  if (!isSource(source)) {
    return <Navigate to={`/tenants/${tenantId}`} replace={true} />;
  }

  return (
    <Book tenantId={tenantId} current="sources" signedInAs={signedInAs}>
      <TenantOverview tenantId={tenantId} scopeFor={source} />
    </Book>
  );
}

export function App() {
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
            {(tenantId) => <People tenantId={tenantId} />}
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
      <Route path="*" element={<Navigate to="/tenants" replace={true} />} />
    </Routes>
  );
}
