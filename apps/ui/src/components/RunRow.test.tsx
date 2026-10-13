/**
 * What one line of the journal promises: a run in progress prints no figure, a finished
 * one prints its figures in the reader's language, and a run whose verdict is tests failing
 * says so beside its status, in that language's grammar rather than in English's.
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

describe("a run whose tests fail", () => {
  const build = { kind: "transform" as const, source: null, entities: [] };

  it("reads as tests failing beside its status, pluralised in English and not in Vietnamese", () => {
    // `ok` with failing tests is the `tests-failing` verdict (ADR 0129): its tables are served,
    // and "succeeded" alone would read as clean.
    render(row({ ...build, testsFailed: 2 }));
    expect(screen.getByText("Thành công")).toBeDefined();
    expect(screen.getByText("2 kiểm thử không đạt")).toBeDefined();
    cleanup();

    useUiStore.setState({ locale: "en" });
    render(row({ ...build, testsFailed: 2 }));
    expect(screen.getByText("2 tests failing")).toBeDefined();
    cleanup();

    render(row({ ...build, testsFailed: 1 }));
    expect(screen.getByText("1 test failing")).toBeDefined();
  });

  it("says nothing more when the verdict is the status: clean, or the run itself failed", () => {
    render(row({ ...build, testsFailed: 0 }));
    expect(screen.queryByText(/kiểm thử không đạt/u)).toBeNull();
    cleanup();

    // A failed run's own word already says it; a count beside it would read as the cause.
    render(row({ ...build, status: "failed", testsFailed: 2 }));
    expect(screen.getByText("Thất bại")).toBeDefined();
    expect(screen.queryByText(/kiểm thử không đạt/u)).toBeNull();
  });
});
