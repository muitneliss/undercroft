/**
 * What a press promises when the buffer held more than one statement.
 *
 * Two of these are promises a reader can see broken: two questions must produce two answers
 * rather than one, and a statement Postgres refuses must not take the statements after it
 * down with it. The third cannot be seen and is the reason the code is shaped the way it is
 * -- the statements run ONE AT A TIME, because the worker mints one password per tenant role
 * and two overlapping queries leave the first connection holding a dead one. Nothing about
 * that is visible on screen, so without this suite the queue is the first thing a reader of
 * the code would simplify away.
 *
 * No mocks: the real components, the real tRPC client, the real react-query, over a fetch
 * that answers `lake.query` per statement and REFUSES every other path.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

import { ResultPanels } from "@/components/LakeAnswers.tsx";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import type { LakeRun } from "@/lib/statements.ts";
import { trpc } from "@/trpc.ts";

const DOCUMENTS = "SELECT d.text FROM document_text AS d LIMIT 1";
const RECORDS = "SELECT r.payload FROM records AS r LIMIT 1";

afterEach(cleanup);

/** One statement's rows, in the envelope tRPC reads. */
function answer(value: string): Response {
  return Response.json({
    result: {
      data: { columns: [{ name: "cell", type: "text" }], rows: [[value]], truncated: false },
    },
  });
}

/** Postgres's own sentence, as the procedure passes it on. */
function refuse(message: string): Response {
  return Response.json(
    { error: { message, code: -32_600, data: { code: "BAD_REQUEST", httpStatus: 400 } } },
    { status: 400 },
  );
}

/**
 * A promise the test opens by hand, so it can stop the first query mid-flight and look at
 * what the second pane has done while it was held.
 */
function held(): { wait: Promise<void>; open: () => void } {
  const opens: (() => void)[] = [];
  const wait = new Promise<void>((resolve) => {
    opens.push(resolve);
  });
  return {
    wait,
    open: (): void => {
      opens[0]?.();
    },
  };
}

function run(...statements: string[]): LakeRun {
  return {
    nth: 1,
    statements: statements.map((sql, index) => ({ id: `1:${String(index)}`, sql })),
    skipped: 0,
    fromSelection: false,
  };
}

/**
 * Render the panes over a fetch the test controls.
 *
 * `asked` is the record of what reached the server, in order, which is how the sequencing
 * case tells "has not been asked yet" from "has been asked and has not answered".
 */
function mount(
  lakeRun: LakeRun,
  answering: (sql: string) => Promise<Response>,
): { asked: string[] } {
  const asked: string[] = [];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const client = trpc.createClient({
    links: [
      httpLink({
        url: "/trpc",
        fetch: (input, init): Promise<Response> => {
          const path = new URL(String(input), "http://localhost").pathname;
          if (!path.endsWith("/lake.query")) {
            return Promise.resolve(refuse(`unmodelled request: ${path}`));
          }
          const sql = String(JSON.parse(String(init?.body)).sql);
          asked.push(sql);
          return answering(sql);
        },
      }),
    ],
  });

  render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ResultPanels tenantId="CASE-0042" locale="vi" run={lakeRun} />
      </QueryClientProvider>
    </trpc.Provider>,
  );

  return { asked };
}

describe("the answers to one press", () => {
  it("two statements are answered in two panes, each holding its own rows", async () => {
    mount(run(DOCUMENTS, RECORDS), (sql) =>
      Promise.resolve(answer(sql === DOCUMENTS ? "hợp đồng" : "{ id: 991 }")),
    );

    expect(await screen.findByText("hợp đồng")).toBeDefined();
    expect(await screen.findByText("{ id: 991 }")).toBeDefined();
    expect(screen.getAllByRole("table")).toHaveLength(2);
  });

  it("a statement is not asked until the one before it has answered", async () => {
    const gate = held();
    const state = mount(run(DOCUMENTS, RECORDS), async (sql) => {
      if (sql === DOCUMENTS) {
        await gate.wait;
      }
      return answer(sql);
    });

    await screen.findByText("Đang chờ…");
    expect(state.asked).toEqual([DOCUMENTS]);

    gate.open();

    expect(await screen.findByText(RECORDS, { selector: ".cell" })).toBeDefined();
    expect(state.asked).toEqual([DOCUMENTS, RECORDS]);
  });

  it("a statement Postgres refuses does not take the statement after it with it", async () => {
    mount(run(DOCUMENTS, RECORDS), (sql) =>
      Promise.resolve(
        sql === DOCUMENTS ? refuse('relation "document_text" does not exist') : answer("payload"),
      ),
    );

    expect(await screen.findByText('relation "document_text" does not exist')).toBeDefined();
    expect(await screen.findByText("payload")).toBeDefined();
  });
});
