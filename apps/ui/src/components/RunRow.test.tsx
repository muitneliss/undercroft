/**
 * What one line of the journal promises: a run in progress prints no figure, a finished
 * one prints its figures in the reader's language, and a count of failed tests is worded
 * in that language's grammar rather than in English's.
 *
 * No mocks: the real row, the real i18next instance, the real catalogues, and the store
 * that owns the language.
 */

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { DEFAULT_LOCALE } from "@undercroft/core/locale";
import { MemoryRouter } from "react-router-dom";

import { RunRow } from "@/components/RunRow.tsx";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { useUiStore } from "@/store.ts";
import { run } from "@/test/fixtures.ts";

afterEach(() => {
  cleanup();
  useUiStore.setState({ locale: DEFAULT_LOCALE });
});

function row(over: Parameters<typeof run>[0] = {}): React.JSX.Element {
  const { locale } = useUiStore.getState();
  return (
    <MemoryRouter>
      <table>
        <tbody>
          <RunRow run={run(over)} locale={locale} open={false} href="/x" />
        </tbody>
      </table>
    </MemoryRouter>
  );
}

describe("the figures", () => {
  it("a finished run prints what it saw, grouped the way the reader groups", () => {
    render(row());

    expect(screen.getByText("1.234")).toBeDefined();
    expect(screen.getByText("HubSpot · deals")).toBeDefined();
    expect(screen.getByText("Thành công")).toBeDefined();
  });

  it("a run in progress prints no figure at all", () => {
    // A number still changing is not a number; four dashes say "not yet", four zeroes
    // would say "nothing".
    render(row({ status: "running", counts: null, endedAt: null }));

    expect(screen.getAllByText("—")).toHaveLength(5);
    expect(screen.queryByText("0")).toBeNull();
  });
});

describe("failed tests", () => {
  it("English pluralises, Vietnamese does not", () => {
    render(row({ kind: "transform", source: null, entities: [], testsFailed: 2 }));
    expect(screen.getByText("2 kiểm tra không đạt")).toBeDefined();
    cleanup();

    useUiStore.setState({ locale: "en" });
    render(row({ kind: "transform", source: null, entities: [], testsFailed: 2 }));
    expect(screen.getByText("2 tests failed")).toBeDefined();
    cleanup();

    render(row({ kind: "transform", source: null, entities: [], testsFailed: 1 }));
    expect(screen.getByText("1 test failed")).toBeDefined();
  });
});
