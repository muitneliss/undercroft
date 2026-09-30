/**
 * The visual tier's harness: open the real app at a URL with fixtures, and match its picture.
 *
 * Data reaches the page the way every route suite here gets it (`App.test.tsx`,
 * `TenantOverview.test.tsx`): the real `App`, router, react-query and tRPC client, over a
 * fetch that answers the procedures the fixtures name. Nothing is mocked; the only fake is the
 * network, and it answers by procedure path in tRPC's own envelope.
 *
 * It REFUSES any procedure the fixtures do not name, and a picture taken after a refusal fails
 * instead of becoming a baseline. A route suite can let a side panel's query fail and assert
 * around it; a screenshot cannot, because the error slip is IN the picture, and a reviewer
 * comparing it with a design would be approving an error state nobody asked for. A test that
 * wants a refusal on screen models it: answer the procedure with a `Response` carrying it.
 *
 * Which role the reader has is fixture data, exactly as on the server: `tenants.list` names it
 * per customer, `tenants.get` for the open book, `session.me` whether they are a superadmin.
 *
 * Only for `*.vrt.test.tsx`, which Vitest runs in Chromium (ADR 0099). `bun test` never loads
 * this file.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { render } from "@testing-library/react";
import type { Locale } from "@undercroft/core/locale";
import { MemoryRouter } from "react-router-dom";
import { expect } from "vitest";
import { page } from "vitest/browser";

import { App } from "@/App.tsx";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** The instant every visual test is taken at; write fixture times relative to it. */
export const VISUAL_NOW = "2026-09-29T09:30:00Z";

/** What a procedure answers: its output, or a `Response` for a refusal the test means to show. */
export type Answers = Readonly<Record<string, unknown>>;

/**
 * What the shell asks on every page, answered unless a test says otherwise: the reader of the
 * design references, signed in on a hosted install that offers mail sign-in.
 */
const SHELL: Answers = {
  "session.me": { userId: "user-1", email: "operator@example.test", superadmin: false },
  "config.signIn": { methods: ["email-otp"] },
};

/** A mounted screen, and the one thing a visual test does with it. */
export interface Screen {
  matches: (name: string, width: number) => Promise<void>;
}

/** Mount the real app at `url`, in `locale`, answering tRPC from `answers`. */
export function open(url: string, locale: Locale, answers: Answers): Screen {
  useUiStore.getState().setLocale(locale);
  const refused: string[] = [];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fetch = network({ ...SHELL, ...answers }, refused);
  const client = trpc.createClient({ links: [httpLink({ url: "/trpc", fetch })] });
  render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[url]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </trpc.Provider>,
  );
  return { matches: (name, width) => matches(name, width, queryClient, refused) };
}

/** tRPC's network, answered by procedure path; a procedure with no answer is refused and noted. */
function network(
  answers: Answers,
  refused: string[],
): (input: RequestInfo | URL) => Promise<Response> {
  return (input) => {
    const procedure = new URL(String(input), location.href).pathname.split("/").at(-1) ?? "";
    const answer = answers[procedure];
    if (answer === undefined) {
      refused.push(procedure);
      const refusal = { error: { message: `unmodelled request: ${procedure}` } };
      return Promise.resolve(Response.json(refusal, { status: 500 }));
    }
    return Promise.resolve(
      answer instanceof Response ? answer.clone() : Response.json({ result: { data: answer } }),
    );
  };
}

/**
 * Match the whole page at `width`, with the viewport as tall as the page, the way the design
 * references were captured -- so a strip that sticks to the foot of a narrow screen is drawn
 * at the foot of the page rather than across the middle of it.
 *
 * Settled means no query in flight and nothing `aria-busy`, which is how every skeleton and
 * every lazy division's fallback here announces itself.
 */
async function matches(
  name: string,
  width: number,
  client: QueryClient,
  refused: string[],
): Promise<void> {
  await page.viewport(width, 900);
  await expect
    .poll(() => client.isFetching() + document.querySelectorAll("[aria-busy='true']").length)
    .toBe(0);
  await document.fonts.ready;
  expect(refused, "procedures the fixtures do not answer").toEqual([]);
  await page.viewport(width, document.documentElement.scrollHeight);
  await expect(page).toMatchScreenshot(name, { screenshotOptions: { animations: "disabled" } });
}
