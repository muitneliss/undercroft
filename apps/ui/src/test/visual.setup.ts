/**
 * What every visual test needs before it renders, loaded by `vitest.config.ts`'s `setupFiles`.
 *
 * The real stylesheet (and through it the bundled fonts in `public/fonts`), the i18next
 * singleton, and a page clock stopped at `VISUAL_NOW` -- so "3 hours ago" reads the same on
 * every run. The clock is checked after it is set: a clock that silently failed to stop would
 * produce baselines that drift by the minute, and would say nothing about why.
 *
 * The browser-side twin of `setup.ts`, which `bun test` preloads and this tier never loads.
 */

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { commands } from "vitest/browser";

import "@/index.css";
import "@/i18n/index.ts";
import { VISUAL_NOW } from "@/test/visual.tsx";

declare module "vitest/browser" {
  interface BrowserCommands {
    /** Defined in `vitest.config.ts`: stop the page's clock through Playwright. */
    freezeClock: (iso: string) => Promise<void>;
  }
}

beforeEach(async () => {
  await commands.freezeClock(VISUAL_NOW);
  if (Date.now() !== Date.parse(VISUAL_NOW)) {
    throw new Error(`the page clock did not stop at ${VISUAL_NOW}`);
  }
});

afterEach(cleanup);
