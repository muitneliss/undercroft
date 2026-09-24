/**
 * What a Drive pick does to what is already chosen: it adds, and each pick comes off alone.
 *
 * Google's Picker opens with nothing ticked, so a session that replaced the list turned two
 * folders picked in two sessions into one (#197). These pin the add, the one-entry-per-id rule
 * and the per-pick remove control, which is now the only way a pick leaves the list.
 *
 * No mocks: the real component, the real store, the real catalogues and the real tRPC client,
 * over a fetch that answers `config.google` with "no picker configured" and refuses anything
 * else. Google's dialog cannot run offline, so a session's picks are handed to `addScopeFiles`
 * directly -- which is all the component's Picker callback does with them.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DriveChoice } from "@/components/DriveChoice.tsx";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { type ChosenFile, type ScopeDraft, useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const SOURCE = "drive-ops@example.test";
const INVOICES: ChosenFile = { id: "f-invoices", name: "Invoices", kind: "folder" };
const CONTRACTS: ChosenFile = { id: "f-contracts", name: "Contracts", kind: "folder" };

/** What `mount` subscribed to the store, stopped after each test. */
const subscriptions: (() => void)[] = [];

afterEach(() => {
  for (const stop of subscriptions.splice(0)) {
    stop();
  }
  cleanup();
  // The store is the real module-level one, so a draft left behind would be the next test's.
  useUiStore.setState({ scopeDraft: null });
});

/** The choice as `ScopePicker` renders it: handed the draft the store holds for this source. */
function choice(): React.JSX.Element {
  const draft = useUiStore.getState().scopeDraft;
  return (
    <DriveChoice
      source={SOURCE}
      account=""
      chosen={draft?.source === SOURCE ? draft : emptyDraft()}
    />
  );
}

function emptyDraft(): ScopeDraft {
  return {
    source: SOURCE,
    labels: [],
    files: [],
    organisation: null,
    entities: [],
    fileTypes: [],
    recurse: false,
  };
}

/** Mount it, and hand it the draft again on every store change, as `ScopePicker`'s hook would. */
function mount(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({
    links: [
      httpLink({
        url: "/trpc",
        fetch: (input): Promise<Response> => {
          const path = new URL(String(input), "http://localhost").pathname;
          return Promise.resolve(
            path.endsWith("/config.google")
              ? Response.json({ result: { data: null } })
              : Response.json(
                  { error: { message: `unmodelled request: ${path}`, code: -32_600 } },
                  { status: 400 },
                ),
          );
        },
      }),
    ],
  });
  function tree(): React.JSX.Element {
    return (
      <trpc.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>{choice()}</QueryClientProvider>
      </trpc.Provider>
    );
  }

  const view = render(tree());
  subscriptions.push(
    useUiStore.subscribe(() => {
      view.rerender(tree());
    }),
  );
}

/** A Picker session handing back what the admin ticked in it. */
function pick(...picked: ChosenFile[]): void {
  useUiStore.getState().addScopeFiles(SOURCE, picked);
}

function listed(): string[] {
  return screen
    .getAllByRole("listitem")
    .map((item) => item.querySelector("span")?.textContent ?? "");
}

describe("a Drive pick", () => {
  it("a second session adds its folder to the first rather than replacing it", () => {
    mount();

    pick(INVOICES);
    pick(CONTRACTS);

    expect(listed()).toEqual(["Invoices", "Contracts"]);
  });

  it("a folder picked again is listed once, where it already was", () => {
    mount();

    pick(INVOICES, CONTRACTS);
    pick(CONTRACTS, INVOICES);

    expect(listed()).toEqual(["Invoices", "Contracts"]);
  });

  it("adding keeps the file types and the sub-folder switch already chosen", () => {
    useUiStore
      .getState()
      .setScopeDraft({ ...emptyDraft(), fileTypes: ["application/pdf"], recurse: true });
    mount();

    pick(INVOICES);

    expect(useUiStore.getState().scopeDraft?.fileTypes).toEqual(["application/pdf"]);
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: "Đọc cả thư mục con" }).checked,
    ).toBe(true);
  });
});

describe("removing a pick", () => {
  it("takes only the one it names off the list", () => {
    mount();
    pick(INVOICES, CONTRACTS);

    fireEvent.click(screen.getByRole("button", { name: "Bỏ Invoices khỏi lựa chọn" }));

    expect(listed()).toEqual(["Contracts"]);
    expect(useUiStore.getState().scopeDraft?.files).toEqual([CONTRACTS]);
  });
});
