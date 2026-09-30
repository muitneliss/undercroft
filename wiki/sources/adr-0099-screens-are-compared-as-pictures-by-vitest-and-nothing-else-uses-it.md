---
title: 'ADR 0099: Screens are compared as pictures by Vitest, and nothing else uses it'
type: source
date: 2026-09-30
tags: []
source: >-
  docs/adr/0099-screens-are-compared-as-pictures-by-vitest-and-nothing-else-uses-it.md
source_path: >-
  docs/adr/0099-screens-are-compared-as-pictures-by-vitest-and-nothing-else-uses-it.md
source_hash: 1953c5f144836bb1cfbc53e23375442feac795f25c69c92803ff67bb0b7943b0
ingested: 2026-09-30
---

# ADR 0099: Screens are compared as pictures by Vitest, and nothing else uses it

Vitest 5's browser mode runs the visual-regression tier of `apps/ui` and nothing else; every other suite stays on `bun test`, the one scoped exception to [[ADR 0003 TypeScript Monorepo on Bun with tRPC]]. happy-dom builds a DOM but never lays it out or paints it, so no Bun suite can see a control off its field, a heading that wraps at 390 px or a strip drawn across a narrow page; [[ADR 0027 A Control Sits on Its Field's Line]] caught the one such defect with a syntactic shape.

Decision. Scope is `*.vrt.test.tsx` under `apps/ui/src`, the harness (`src/test/visual.tsx`, `src/test/visual.setup.ts`) and `apps/ui/vitest.config.ts`; the config includes only that pattern and `bunfig.toml` ignores it (`pathIgnorePatterns`), so no file belongs to both runners, and the `.test.tsx` suffix keeps the Biome test override, `tests.md` and `pii.md` applying. Nothing else may use Vitest, and `import { vi } from "vitest"` is banned in `biome.jsonc` beside the `bun:test` mock ban. The tier is outside `task ci:verify` (Docker, network on first run): `task ci:visual` compares, `task ci:visual-update` retakes baselines, per [[ADR 0023 Task Is the Mandatory Command Entrypoint]]; `.github/workflows/visual.yml` runs `task ci:visual` on pull requests touching the UI and uploads captures and diffs on failure. Both tasks run `scripts/visual.ts`, which builds `apps/ui/visual.Dockerfile` (the Playwright image at the exact pinned Playwright version, Bun copied in at `.bun-version`) and runs the tier as `linux/amd64` on a copy of the checkout with its own install from `bun.lock`, writing back only `__screenshots__` (on update) and the git-ignored `apps/ui/.vitest-attachments`. References are the app's own pictures: a real route (`App`, router, react-query, tRPC client) rendered from fixtures mirroring the design review's synthetic data at 1440 and 390 px, the first capture reviewed by eye against the design PNG, then committed. Determinism is set in the harness: tRPC answered by procedure path with any unanswered procedure failing the test, the page clock stopped through Playwright's clock (a `freezeClock` browser command, not `vi.useFakeTimers`), a constant release stamp, one device pixel per CSS pixel, reduced motion, animations stopped, fonts awaited, font hinting off, and the viewport as tall as the page. Tolerance is pixelmatch threshold 0.1 with anti-aliasing discounted and at most 0.01% of pixels; two runs were byte-identical and a dropped full stop (4 pixels) passes, because the tier guards layout.

Consequences: exact-pinned `vitest`, `@vitest/browser-playwright` and `playwright` in `apps/ui`, and Vite 6.0.3 to 6.4.3 for Vitest 5's peer range; a Playwright bump is a baseline update; baselines are PNGs in git; a missing baseline fails `task ci:visual` without being written; first run pulls about 2 GB. Rejected: Bun with Playwright and pixelmatch wired by hand (rebuilding Vitest's browser runner), Playwright Test against the running app (a second runner needing the stack), comparing with the design's PNGs (its data and deliberate differences mean it can never pass), running natively per machine, taking baselines in CI, and putting the tier inside `task ci:verify`. How to run and review it is [[Runbook: Visual regression tests]].
