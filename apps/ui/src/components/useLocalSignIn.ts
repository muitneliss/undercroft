import { trpc } from "@/trpc.ts";

/**
 * How the sign-in page offers the local method (`POST /api/auth/sign-in/dev`, the one that
 * proves nothing):
 *
 * - `automatic` -- it is the ONLY way in, which is a desktop install: one person, on the machine
 *   the server runs on, with no mailbox or Google account configured to prove (ADR 0094). There
 *   is nothing to ask them, so the page signs them in without a click.
 * - `button` -- it is offered beside a method that proves something, which somebody chose to
 *   configure; the local method stays one click among the others.
 * - `absent` -- not offered, or not known yet, or the server could not say. A page that cannot
 *   tell asks rather than acts, so every doubt lands here.
 *
 * The server decides, never the bundle: the same production build runs on a server and on a
 * laptop, and only the server knows which it is.
 */
export type LocalSignIn = "automatic" | "button" | "absent";

export function useLocalSignIn(): LocalSignIn {
  // Configuration, not data a person changes: it holds for the tab's life. `App.tsx` asks in the
  // same batch as `session.me`, so the answer is in the cache by the time a missing session puts
  // the sign-in page up, and the page does not flash forms it is about to replace.
  const offered = trpc.config.signIn.useQuery(undefined, {
    staleTime: Number.POSITIVE_INFINITY,
  });
  const methods = offered.data?.methods ?? [];
  if (!methods.includes("dev")) {
    return "absent";
  }
  return methods.length === 1 ? "automatic" : "button";
}
