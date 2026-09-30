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

/**
 * What a procedure answers: its output; a `Response` for a refusal the test means to show; or a
 * function of the input the page sent, for a procedure one screen asks more than once (each
 * dashboard tile reads its own answer). A tRPC output is JSON and is never a function, so the
 * three cannot be confused. A function that answers `undefined` has not modelled that input,
 * and the request is refused like an unnamed procedure.
 */
export type Answers = Readonly<Record<string, unknown>>;

/**
 * What the shell asks on every page, answered unless a test says otherwise: the reader of the
 * design references, signed in on a hosted install that offers mail sign-in.
 */
const SHELL: Answers = {
  "session.me": { userId: "user-1", email: "operator@example.test", superadmin: false },
  "config.signIn": { methods: ["email-otp"] },
};

/** How long a screen may take to settle: well inside the test's own 15 s, far past a chunk load. */
const SETTLE_MS = 10_000;

/** A mounted screen, and the one thing a visual test does with it. */
export interface Screen {
  matches: (name: string, width: number) => Promise<void>;
}

/** Mount the real app at `url`, in `locale`, answering tRPC from `answers`. */
export function open(url: string, locale: Locale, answers: Answers): Screen {
  // A screen opens on a fresh store, as a page load would: a draft an earlier test in the same
  // file seeded would otherwise be the draft this one draws.
  useUiStore.setState(useUiStore.getInitialState(), true);
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
    const url = new URL(String(input), location.href);
    const procedure = url.pathname.split("/").at(-1) ?? "";
    const given = answers[procedure];
    const answer = typeof given === "function" ? given(inputOf(url)) : given;
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

/** Two animation frames: long enough for a resize to be laid out and painted. */
async function frames(): Promise<void> {
  for (const _ of [1, 2]) {
    await new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
  }
}

/** How many times the viewport is refitted before the page is taken as it stands. */
const FIT_TRIES = 8;

/**
 * Make the viewport exactly as tall as the page, and keep making it so until the page stops
 * changing height. One read was not enough: the page narrowed from the previous test's width
 * was once measured before it had grown, and a lineage at 390 px was captured 323 px short,
 * cut off above its paths.
 */
async function fitToPage(width: number): Promise<void> {
  for (let tries = 0; tries < FIT_TRIES; tries += 1) {
    const height = document.documentElement.scrollHeight;
    await page.viewport(width, height);
    await frames();
    if (document.documentElement.scrollHeight === height) {
      return;
    }
  }
}

/** A query's input, which tRPC sends in the address; this tier answers queries, not mutations. */
function inputOf(url: URL): unknown {
  const sent = url.searchParams.get("input");
  if (sent === null) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(sent);
  return parsed;
}

/**
 * Match the whole page at `width`, with the viewport as tall as the page, the way the design
 * references were captured -- so a strip that sticks to the foot of a narrow screen is drawn
 * at the foot of the page rather than across the middle of it.
 *
 * Settled means no query in flight and nothing `aria-busy`, which is how every skeleton and
 * every lazy division's fallback here announces itself. Motion needs no wait: `visual.css`
 * takes it out. The window is put back at its top before the picture, so a page something
 * scrolled on arrival is still drawn from its first line.
 *
 * The wait for settling is long on purpose. The first screen of a file to draw a chart or an
 * editor fetches that lazy chunk, and inside the emulated container that took over the poll's
 * default second -- the test then failed with the skeleton still busy, on a busy machine and
 * not on an idle one. A picture of a skeleton is never what a test means; waiting costs
 * nothing when the page settles sooner.
 */
async function matches(
  name: string,
  width: number,
  client: QueryClient,
  refused: string[],
): Promise<void> {
  await page.viewport(width, 900);
  await frames();
  await expect
    .poll(() => client.isFetching() + document.querySelectorAll("[aria-busy='true']").length, {
      timeout: SETTLE_MS,
    })
    .toBe(0);
  await document.fonts.ready;
  expect(refused, "procedures the fixtures do not answer").toEqual([]);
  await fitToPage(width);
  globalThis.scrollTo(0, 0);
  await expect(page).toMatchScreenshot(name, { screenshotOptions: { animations: "disabled" } });
}
