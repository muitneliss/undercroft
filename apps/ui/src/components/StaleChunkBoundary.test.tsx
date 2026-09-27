/**
 * The boundary's promise: a page whose chunk a deploy took away is answered on the leaf, with
 * the Reload that fixes it, instead of the whole application unmounting into a blank page --
 * and no other failure is dressed up as a stale release. ADR 0070.
 *
 * The failing chunk is a real `React.lazy` whose import rejects, reported through the real
 * `recoverStaleChunk` exactly as Vite's `vite:preloadError` reports it. No mocks.
 */

import { afterEach, expect, test as it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { lazy, Suspense } from "react";

import { StaleChunkBoundary } from "@/components/StaleChunkBoundary.tsx";
import { recoverStaleChunk } from "@/lib/staleChunk.ts";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";

afterEach(cleanup);

/** A page whose chunk is gone, reported by a tab that holds unsaved work and so keeps. */
function goneChunk(): React.LazyExoticComponent<() => React.JSX.Element> {
  const failure = new TypeError("Failed to fetch dynamically imported module: /assets/Old.js");
  recoverStaleChunk(failure, {
    hasUnsavedWork: () => true,
    storage: { getItem: () => null, setItem: () => undefined },
    now: () => 0,
    reload: () => undefined,
  });
  return lazy(() => Promise.reject(failure));
}

/** A page that fails for any other reason, as it renders. */
function brokenPage(): React.LazyExoticComponent<() => React.JSX.Element> {
  return lazy(() => {
    throw new Error("a page that threw while rendering");
  });
}

const PAGE = "schedule of grants";

it("answers a chunk a deploy took away with the reload that fetches the new one", async () => {
  const Gone = goneChunk();

  render(
    <StaleChunkBoundary>
      <Suspense fallback={null}>
        <Gone />
      </Suspense>
    </StaleChunkBoundary>,
  );

  expect((await screen.findByRole("alert")).textContent).toContain(
    "Trang này thuộc một phiên bản mới hơn",
  );
  expect(screen.getByRole("button", { name: "Tải lại" })).toBeDefined();
});

it("renders the page itself when nothing failed", () => {
  render(
    <StaleChunkBoundary>
      <p>{PAGE}</p>
    </StaleChunkBoundary>,
  );

  expect(screen.getByText(PAGE)).toBeDefined();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("throws any other failure on, unchanged, rather than dress it as a stale release", () => {
  const Broken = brokenPage();

  expect(() =>
    render(
      <StaleChunkBoundary>
        <Suspense fallback={null}>
          <Broken />
        </Suspense>
      </StaleChunkBoundary>,
    ),
  ).toThrow("a page that threw while rendering");
  expect(screen.queryByRole("alert")).toBeNull();
});
