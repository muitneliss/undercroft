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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { App } from "@/App.tsx";
// For its side effect as much as for `translatorFor`: `useTranslation` resolves against the
// module-level i18next singleton, and without it every key renders as itself. See `@/i18n`.
import { translatorFor } from "@/i18n/index.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const SIGNED_IN_AS = "ops@example.test";

afterEach(() => {
  cleanup();
  useUiStore.getState().setTenantSearch("");
});

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

function renderAt(
  url: string,
  answers: Readonly<Record<string, Response>> = { "session.me": answerSessionMe() },
): void {
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
          return Promise.resolve(
            answers[path.slice(path.lastIndexOf("/") + 1)]?.clone() ?? refuse(path),
          );
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

describe("the public and signed-in home", () => {
  it("is given the book, with the running head naming them", async () => {
    renderAt("/");

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

  it("finds a customer's record with an unaccented name and restores the list when cleared", async () => {
    // Public promise: search follows the displayed names, including Vietnamese diacritics.
    // A filter of IDs alone, or one that forgets Đ, would hide the requested record.
    renderAt("/tenants", {
      "session.me": answerSessionMe(),
      "tenants.list": Response.json({
        result: {
          data: [
            { id: "CASE-0042", displayName: "Hồ sơ Đỏ", role: "admin" },
            { id: "CASE-0108", displayName: "Hồ sơ Xanh", role: "viewer" },
          ],
        },
      }),
    });
    const search = await screen.findByRole("searchbox");
    fireEvent.change(search, { target: { value: "  HO SO DO  " } });
    expect(screen.getByRole("link", { name: "Hồ sơ Đỏ" }).getAttribute("href")).toBe(
      "/tenants/CASE-0042",
    );
    expect(screen.queryByRole("link", { name: "Hồ sơ Xanh" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: translatorFor("vi")("tenants.clearSearch") }),
    );
    expect(screen.getByRole("link", { name: "Hồ sơ Xanh" }).getAttribute("href")).toBe(
      "/tenants/CASE-0108",
    );
  });

  it("takes a public visitor from the introduction to the sign-in form", async () => {
    // Public content must remain usable when session.me cannot answer with a session.
    renderAt("/", {});
    const t = translatorFor("vi");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      `${t("landing.title")}${t("landing.titleEnd")}`,
    );
    fireEvent.click(screen.getByRole("link", { name: t("landing.openWorkspace") }));
    expect((await screen.findByLabelText(t("signIn.emailLabel"))).getAttribute("type")).toBe(
      "email",
    );
  });

  it("shows an authentication refusal instead of the public introduction", async () => {
    // A root-only landing check would swallow the existing Google refusal callback.
    renderAt("/?reason=denied", {});
    expect((await screen.findByRole("alert")).textContent).toContain(
      translatorFor("vi")("signIn.denied"),
    );
  });

  it("keeps a signed authorization request on the sign-in path", async () => {
    // A public root must not consume a connector's in-progress authorization request.
    renderAt("/?sig=synthetic-signature", {});
    expect(
      (await screen.findByLabelText(translatorFor("vi")("signIn.emailLabel"))).getAttribute("type"),
    ).toBe("email");
  });
});
