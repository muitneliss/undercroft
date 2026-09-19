/**
 * The one promise the colophon makes: the build names itself, and names itself as a TAG.
 *
 * Every link in that is silent when it breaks. Drop the `define` from `vite.config.ts` and
 * the constant becomes the literal text `__UNDERCROFT_RELEASE__`; strip the `v` and the
 * string stops being the thing an operator pastes into `IMAGE_TAG`; point the stamp at
 * `apps/ui/package.json`, which nothing bumps, and it freezes at `0.1.0` and stays there
 * through every release. All three render a line that looks perfectly fine on the page.
 *
 * The shape is asserted rather than the value, because the value is bumped by
 * release-please on the way into main -- pinning `v1.4.0` here would fail the very commit
 * that made it true.
 *
 * No mocks: the real component, the real i18next instance and the real catalogues, and the
 * same stamp a Vite build writes (`src/test/setup.ts` reads the version the build reads).
 */

import { afterEach, expect, test as it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

import { Colophon } from "@/components/Colophon.tsx";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";

/**
 * happy-dom's document is global to the whole `bun test` process, so a render left standing
 * is inherited by the next FILE and surfaces there as "found multiple elements" -- in a test
 * that has nothing to do with the one that leaked.
 *
 * Testing Library registers this itself, but only in whichever file imports it FIRST, so
 * relying on it makes the result depend on filename order: this file sorts ahead of
 * `i18n/i18n.test.tsx` and silently took the registration away from it. Every UI file that
 * renders says so for itself instead.
 */
afterEach(cleanup);

it("prints the release as the tag that rolls the stack back to it", () => {
  render(<Colophon />);

  expect(screen.getByText(/^v\d+\.\d+\.\d+$/u)).toBeDefined();
});

it("labels the tag, so a version number is not read out attached to nothing", () => {
  render(<Colophon />);

  // Vietnamese is what a reader who has chosen nothing gets. The label is also the stamp's
  // accessible name: a bare "v1.4.0" at the foot of a page names nothing.
  expect(screen.getByText("Phiên bản")).toBeDefined();
});
