# 99. Screens are compared as pictures by Vitest, and nothing else uses it

- Status: Accepted
- Date: 2026-09-30
- Related: [ADR 0003](0003-typescript-monorepo-on-bun-with-trpc.md) (Bun is the test runner;
  this is its one scoped exception), [ADR 0023](0023-task-is-the-mandatory-command-entrypoint.md)
  (every operation is a task), [ADR 0027](0027-a-control-sits-on-its-fields-line.md) (the one
  layout defect a linter can see), [ADR 0012](0012-biome-replaces-eslint-and-prettier.md),
  [ADR 0017](0017-tests-are-a-category-in-the-lint-config.md),
  [ADR 0018](0018-lint-decisions-live-in-the-config.md),
  [ADR 0022](0022-a-test-file-is-not-an-exception.md) (where a lint decision goes).

## Context

Nothing in the gate can see what a screen looks like. The UI suites run in happy-dom, which
builds a DOM and never lays it out or paints it: a control drawn half a caption above its
field, a heading that wraps at 390 px, a tab strip that lands across the middle of a narrow
page, all pass every suite. ADR 0027 caught one such defect with an ast-grep rule because that
one has a syntactic shape; most do not.

The question became urgent when several branches set out, in parallel, to bring the screens of
`apps/ui` in line with a design review: synthetic HTML captured as PNGs at 1440 px and 390 px.
Once they merge, nothing would notice the next change undoing their work.

Seeing a page takes a browser. Vitest's browser mode renders the component tree in real
Chromium through Playwright and has a screenshot matcher (`toMatchScreenshot`) with a
pixel comparator, reference files per browser and platform, diffs on failure and an update
flag. ADR 0003 says Bun is the only test runner, and Bun has none of this.

## Decision

**Vitest 5 runs the visual-regression tier and nothing else.** Every other suite in the
repository stays on `bun test`; ADR 0003 holds everywhere this ADR does not name.

- **Scope.** Files named `*.vrt.test.tsx` under `apps/ui/src`, the harness beside them
  (`src/test/visual.tsx`, `src/test/visual.setup.ts`) and `apps/ui/vitest.config.ts`. The
  config includes that pattern only, and `bunfig.toml` ignores it
  (`pathIgnorePatterns`), so no file is claimed by both runners. The name keeps `.test.tsx`
  so everything that treats a suite as a suite -- the Biome test override, `tests.md`,
  `pii.md` -- keeps applying to it.
- **Nothing else may use Vitest.** Not for unit tests, not for a component suite that would
  "be easier in a browser", not for coverage. A second runner for the same kind of test is the
  two definitions of green ADR 0003 exists to prevent. `import { vi } from "vitest"` is banned
  in `biome.jsonc` beside the `bun:test` mock ban: `vi` is Vitest's whole mocking surface.
- **Outside the gate.** `task ci:visual` compares; `task ci:visual-update` retakes the
  baselines. Both need Docker, and the first run needs the network, so neither is in
  `task ci:verify`, which must pass with neither -- the same line `task ci:itest` sits behind.
  CI runs `task ci:visual` in `.github/workflows/visual.yml` on pull requests that touch the
  UI, and uploads the captures and diffs when it fails.
- **One machine for every baseline.** Both tasks run `scripts/visual.ts`, which builds
  `apps/ui/visual.Dockerfile` -- Microsoft's Playwright image at exactly the Playwright
  version `apps/ui` pins, with Bun copied in at `.bun-version` -- and runs the tier inside it,
  always as `linux/amd64`, which is what CI runs. macOS and Linux rasterise the same font
  differently, and Chromium's arm64 and amd64 builds are not promised to agree either, so a
  baseline taken anywhere else is a picture of that machine. Inside the container the tier
  runs on a copy of the checkout with its own install from `bun.lock`: the host's
  `node_modules` hold the host's native binaries. The checkout is written in two places only:
  the `__screenshots__` directories on an update, and `apps/ui/.vitest-attachments`
  (git-ignored) for the diffs.
- **The references are the app's own pictures, reviewed by a person.** A visual test renders a
  real route -- `App`, its router, react-query and the tRPC client -- from fixtures that mirror
  the design's synthetic data, at 1440 and 390 px, in English or Vietnamese. The first capture
  is compared by eye with the design's PNG, and the reviewed capture is committed as the
  baseline that fails on later drift.
- **Determinism is set in the harness, not hoped for.** Data comes through the network seam
  every route suite already uses, a fetch that answers tRPC by procedure path; a procedure the
  fixtures do not answer fails the test rather than photographing an error slip. The page's
  clock is stopped at a fixed instant through Playwright's clock (a `freezeClock` browser
  command), not `vi.useFakeTimers`. The release stamp is a constant. One device pixel per CSS
  pixel, reduced motion, animations stopped at capture, fonts awaited, Chromium's font hinting
  off so glyphs sit on the font's own metrics. The page is captured with the viewport as tall
  as the page, the way the design's references were, so a strip that sticks to the foot of a
  narrow screen is drawn at the foot.
- **Tolerance.** Pixelmatch at threshold 0.1 with anti-aliasing discounted, and at most 0.01%
  of a page's pixels different. Two runs in the image were byte-identical; a dropped full stop
  is 4 pixels and passes. The tier guards layout, which moves thousands; words are the Bun
  suites' to pin.

## Consequences

- `apps/ui` carries `vitest`, `@vitest/browser-playwright` and `playwright` as exact-pinned dev
  dependencies. Vitest 5's peer range is `vite ^6.4`, so the UI's Vite moved from 6.0.3 to
  6.4.3 within its major; the build the gate runs is the evidence that nothing else moved.
- Bumping the `playwright` pin moves the image with it, and new Chromium paints differently:
  that bump is a baseline update in the same change, reviewed like any other.
- Baselines are PNGs in git. They are small (tens of kilobytes each), and a screen gets one per
  width and language it is tested in, not one per state a route suite covers.
- A baseline that is missing fails `task ci:visual`, and is not written by it: the capture goes
  to the attachments for review. Until a screen's first baseline is reviewed and committed, its
  test is red, which is the honest state of an unreviewed picture.
- The first run on a machine downloads the Playwright image (about 2 GB) and fills a named
  Docker volume with the workspace's packages (about a minute on an Apple-silicon Mac, where the
  container is emulated); later runs of the one example screen took 12 seconds there.

## Options rejected

- **Bun, Playwright and pixelmatch, wired by hand.** Keeps one runner in name only: it means
  writing and maintaining the part Vitest already is -- serving the app's modules to a browser
  with the same Vite plugins as the build, mounting a component per test, stable-screenshot
  retries, reference naming per platform, diff output, an update mode. The runner would be ours,
  and the rule behind ADR 0003 is about not having two definitions of a test, not about the
  name on the binary.
- **Playwright Test against the running app.** A second runner as well, and it needs the whole
  stack -- control plane, database -- up to render one screen, or a fake server beside it. The
  route suites already feed a screen through the tRPC seam; Vitest's browser mode keeps that
  seam, so the visual tier and the Bun suites share one way of supplying data.
- **Comparing directly with the design's PNGs.** It could never pass. The design renders its own
  data (a "REVIEW R5" banner, a prototype's controls, different counts) and records deliberate
  differences the code keeps ("Keep code" in its matching notes). A reference that fails by
  construction teaches everyone to ignore the tier. The design's PNGs are for the human review
  of the first capture, and are not committed.
- **Running the tier natively on each machine.** Every baseline would carry its author's font
  rasteriser, and CI would fail every one taken on a Mac. Vitest's platform suffix would keep
  the files apart, which only means two sets of baselines, one unreviewed.
- **Taking the baselines in CI and committing them from there.** It moves the review off the
  developer's screen and needs a job with write access to push pictures; running the same image
  locally gives the same bytes without either.
- **Inside `task ci:verify`.** It would need Docker and the network in the gate, which must pass
  with neither.
