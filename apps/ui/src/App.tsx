/**
 * The app shell: is there a session, and if so, the book.
 *
 * Auth is resolved once through the tRPC session hook. The public root can render without
 * a session; protected URLs and auth callbacks show sign-in when it fails. Server state lives in the
 * React Query cache behind that hook, never in component state -- see .claude/rules/state.md.
 *
 * Which URL opens which division is `@/routeTable`, and it is data rather than JSX for the
 * reason recorded there. Every signed-in route renders inside `Book`, which supplies the
 * section board, the fore-edge tab rail and the running head. The route decides which
 * division is open; the division decides the board hue; the board hue decides the acetate's
 * solved alpha.
 */

import { useLocation, useRoutes, useSearchParams } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton.tsx";
import { useLocalSignIn } from "@/components/useLocalSignIn.ts";
import { appRoutes } from "@/routeTable.tsx";
import { Landing } from "@/routes/Landing.tsx";
import { SignIn } from "@/routes/SignIn.tsx";
import { trpc } from "@/trpc.ts";

/**
 * The book, opened at whichever division the URL names.
 *
 * Its own component because `useRoutes` is a hook and the session below is resolved with
 * early returns: a hook may not be called after one.
 */
function SignedIn({ signedInAs }: { signedInAs: string }): React.ReactElement | null {
  return useRoutes(appRoutes(signedInAs));
}

export function App(): React.JSX.Element {
  // The one auth read. `session.me` is an authed procedure, so with no session cookie it
  // errors and the app sits on the title page.
  const session = trpc.session.me.useQuery(undefined, { retry: false });
  // Asked here, beside `session.me` and in the same batch, rather than first by the sign-in
  // page: the answer decides whether the root is the introduction at all.
  const localSignIn = useLocalSignIn();
  const [params] = useSearchParams();
  const { pathname } = useLocation();

  // The public introduction needs no server data. Auth callbacks still reach sign-in,
  // and a known session opens the customer index through the existing route table. A desktop
  // install has no public to introduce: its root goes straight to the sign-in that needs no
  // click (ADR 0094), so the one person it is for lands in the book.
  if (
    pathname === "/" &&
    !params.has("reason") &&
    !params.has("sig") &&
    !session.isSuccess &&
    localSignIn !== "automatic"
  ) {
    return <Landing />;
  }

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

  return <SignedIn signedInAs={session.data.email} />;
}
