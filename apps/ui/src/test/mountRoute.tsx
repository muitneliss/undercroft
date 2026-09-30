/**
 * One route mounted the way the app mounts it -- the real router, store, tRPC client and
 * react-query -- over a fetch that answers the procedures a suite names and REFUSES every
 * other one, as `routes/Models.test.tsx` does inline.
 *
 * Not a mock: nothing here records that a function was called. It is an in-memory server
 * with a ledger of the requests it received, which is what a suite reads to say that a page
 * asked for an answer, or never did, or saved a particular layout. A request for a procedure
 * the suite did not serve answers a 500, so a page that reaches for something unexpected
 * fails visibly rather than being answered by a fake that always says yes.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { httpLink } from "@trpc/client";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { trpc } from "@/trpc.ts";

/** What a served procedure answers, given the input it was sent. */
export type Answer = (input: unknown) => unknown;

/** One request the server received: the procedure's dotted path and its input. */
export interface Received {
  readonly path: string;
  readonly input: unknown;
}

function inputOf(url: URL, body: unknown): unknown {
  const text = typeof body === "string" ? body : url.searchParams.get("input");
  if (text === null) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

export function mountRoute(route: {
  readonly pattern: string;
  readonly url: string;
  readonly element: ReactElement;
  readonly answers: Readonly<Record<string, Answer>>;
}): { router: ReturnType<typeof createMemoryRouter>; received: Received[] } {
  const received: Received[] = [];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({
    links: [
      httpLink({
        url: "/trpc",
        fetch: (input, init): Promise<Response> => {
          const url = new URL(String(input), "http://localhost");
          const path = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
          const answer = route.answers[path];
          const sent = inputOf(url, init?.body);
          received.push({ path, input: sent });
          if (answer === undefined) {
            return Promise.resolve(Response.json({ error: { message: path } }, { status: 500 }));
          }
          return Promise.resolve(Response.json({ result: { data: answer(sent) } }));
        },
      }),
    ],
  });
  const router = createMemoryRouter([{ path: route.pattern, element: route.element }], {
    initialEntries: [route.url],
  });
  render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>,
  );
  return { router, received };
}
