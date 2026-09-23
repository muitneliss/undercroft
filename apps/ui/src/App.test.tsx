/**
 * What the shell promises a signed-in reader: a page.
 *
 * This is the path nothing else in the gate reaches. `App` renders the title page whenever
 * the session query fails, which is what it does with no cookie -- so typecheck, lint, the
 * Rollup build and every component suite all stayed green while the ONE render that follows
 * a successful sign-in threw `is not a <Route> component` for every operator. It had to be
 * seen in a browser to be seen at all. A session answered here is the cheapest way to make
 * that render happen offline.
 *
 * No mocks: the real `App`, the real router, the real tRPC client over a fetch that answers
 * `session.me` and REFUSES everything else. Refusing is the point -- a fetch that answered
 * every call would prove the page renders against data the server never promised, and the
 * panels below the shell have to survive a failed query anyway.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { App } from "@/App.tsx";
// For its side effect as much as for `translatorFor`: `useTranslation` resolves against the
// module-level i18next singleton, and without it every key renders as itself. See `@/i18n`.
import { translatorFor } from "@/i18n/index.ts";
import { trpc } from "@/trpc.ts";

const SIGNED_IN_AS = "ops@example.test";

afterEach(cleanup);

/** The one procedure this suite models, in the envelope tRPC reads. */
function answerSessionMe(): Response {
  return Response.json({
    result: { data: { userId: "user-1", email: SIGNED_IN_AS, superadmin: false } },
  });
}

/** Anything else: a refusal the caller sees as a failed query, never invented data. */
function refuse(path: string): Response {
  return Response.json(
    {
      error: {
        message: `unmodelled request: ${path}`,
        code: -32_603,
        data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
      },
    },
    { status: 500 },
  );
}

function renderAt(url: string): void {
  const queryClient = new QueryClient({
    // No retries: a refusal is an answer here, and waiting for three of them is only slower.
    defaultOptions: { queries: { retry: false } },
  });
  const client = trpc.createClient({
    links: [
      httpLink({
        url: "/trpc",
        fetch: (input): Promise<Response> => {
          const path = new URL(String(input), "http://localhost").pathname;
          return Promise.resolve(path.endsWith("/session.me") ? answerSessionMe() : refuse(path));
        },
      }),
    ],
  });

  render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[url]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

describe("a reader with a session", () => {
  it("is given the book, with the running head naming them", async () => {
    renderAt("/tenants");

    expect(await screen.findByText(SIGNED_IN_AS)).toBeDefined();
  });

  it("is given the book opened at a scoped division, not the title page", async () => {
    renderAt("/tenants/CASE-0042/lake");

    // The running head names the reader on every page, so it cannot tell this route from
    // `/tenants`. The lake's own leaf can: its queries are refused here, so it prints its
    // not-loaded slip, naming the customer the URL scoped it to. The default locale is `vi`.
    expect(
      await screen.findByText(translatorFor("vi")("lake.notLoaded", { tenantId: "CASE-0042" })),
    ).toBeDefined();
  });
});
