/**
 * The notice's promise: once the store holds a release that replaced this tab's, the reader
 * sees which one and has the button that loads it; until then there is nothing on the page.
 *
 * The store is written through its own action, the one `@/lib/releaseWatch` calls -- no
 * mocks, the real component, the real store and the real catalogues.
 */

import { afterEach, expect, test as it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

import { ReleaseNotice } from "@/components/ReleaseNotice.tsx";
import { useUiStore } from "@/store.ts";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";

// happy-dom's document is shared by the whole process; see `Colophon.test.tsx`. The store is
// a module singleton too, so the release this file noticed is taken back with the render.
afterEach(() => {
  cleanup();
  useUiStore.setState({ liveRelease: null });
});

it("names the live release and offers the reload that loads it", () => {
  useUiStore.getState().noticeRelease("v9.9.9");

  render(<ReleaseNotice />);

  expect(screen.getByRole("status").textContent).toContain("v9.9.9");
  expect(screen.getByRole("button", { name: "Tải lại" })).toBeDefined();
});

it("puts nothing on the page while no release has replaced this tab's", () => {
  render(<ReleaseNotice />);

  expect(screen.queryByRole("status")).toBeNull();
});
