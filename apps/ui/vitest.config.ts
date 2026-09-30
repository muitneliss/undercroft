/**
 * The visual-regression tier, and the ONLY thing in this repository Vitest may run (ADR 0099).
 *
 * Every other suite is `bun test` (ADR 0003). This one is not, because what it asserts is a
 * picture: happy-dom builds a DOM but never lays it out or paints it, so no Bun suite can see a
 * control drawn half a caption above its field or a heading that wraps at 390 px. Vitest's
 * browser mode renders the real app in real Chromium and compares the pixels.
 *
 * The two runners never share a file. This config includes `*.vrt.test.tsx` and nothing else,
 * and `bunfig.toml` ignores that same pattern; a file named for one is invisible to the other.
 *
 * Built on `vite.config.ts` rather than beside it, so a screen here is compiled by the same
 * plugins (React, Tailwind) and the same `@/` alias as the bundle that ships -- a second copy
 * of the build would be a second definition of what the app looks like.
 *
 * Run it through `task ci:visual` / `task ci:visual-update`, which run it inside the Playwright
 * image. A baseline is only meaningful on the platform it was taken on (fonts rasterise
 * differently on macOS), and CI is Linux; see `docs/runbook/visual-regression.md`.
 */

import { fileURLToPath, URL } from "node:url";

import { playwright } from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config.ts";

/**
 * Stop the page's clock at `iso`, through Playwright rather than through Vitest's fake timers.
 *
 * `vi.useFakeTimers` is the `vi` surface `.claude/rules/tests.md` bans, and it would only fake
 * the clock inside the test's module graph. Playwright's clock is the BROWSER's: `Date` reads
 * the same instant everywhere on the page, the way `TestClock` stands in for time in a Bun
 * suite, while timers keep running so react-query still settles.
 */
const freezeClock: BrowserCommand<[iso: string]> = async (context, iso) => {
  if (context.provider.name !== "playwright") {
    throw new Error("freezeClock needs the playwright provider");
  }
  await context.context.clock.setFixedTime(iso);
};

export default mergeConfig(
  viteConfig,
  defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
    define: {
      // The colophon prints the release. A baseline that changed with every release-please
      // bump would fail every PR after one, so the picture carries a stamp that never moves.
      __UNDERCROFT_RELEASE__: JSON.stringify("v0.0.0-visual"),
    },
    test: {
      include: ["src/**/*.vrt.test.tsx"],
      setupFiles: ["src/test/visual.setup.ts"],
      // Diffs and the actual capture of a failed or missing baseline land here; CI uploads it.
      attachmentsDir: ".vitest-attachments",
      browser: {
        enabled: true,
        headless: true,
        ui: false,
        screenshotFailures: false,
        provider: playwright({
          launchOptions: {
            // Linux Chromium hints glyphs to whole pixels by default, which spaced the tracked
            // capitals unevenly ("CUST OMERS") and ate the space in "3 customers" -- a picture
            // of the rasteriser, not of the page. Without hinting the glyphs sit where the
            // font's own metrics put them.
            //
            // LCD (subpixel) antialiasing is off for the same reason: Chromium grants it to a
            // layer or withdraws it by compositing state, so the customer index's select drew
            // "Any role" with coloured fringes on one run and in grey on the next -- the same
            // glyphs, a different picture. Greyscale is the one it can always give.
            args: ["--font-render-hinting=none", "--disable-lcd-text"],
          },
          contextOptions: {
            // One device pixel per CSS pixel, so a 1440 px capture is 1440 px wide, like the
            // design references it is reviewed against.
            deviceScaleFactor: 1,
            reducedMotion: "reduce",
            colorScheme: "light",
            locale: "en-SG",
            timezoneId: "Asia/Singapore",
          },
        }),
        instances: [{ browser: "chromium" }],
        commands: { freezeClock },
        expect: {
          toMatchScreenshot: {
            comparatorName: "pixelmatch",
            comparatorOptions: {
              // What this tier guards is layout: a moved rule, a wrapped line, a control off its
              // field, a changed colour -- each thousands of pixels. Two runs in the image were
              // byte-identical, so the ratio only absorbs a rasteriser that differs by a few
              // pixels between CPUs. The cost, measured: a dropped full stop is 4 pixels and
              // passes. Words are the Bun suites' to pin; a hundredth of a percent is not.
              threshold: 0.1,
              allowedMismatchedPixelRatio: 0.0001,
            },
          },
        },
      },
    },
  }),
);
