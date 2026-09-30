---
title: 'Runbook: Visual regression tests'
type: source
date: 2026-09-30
tags: []
source: docs/runbook/visual-regression.md
source_path: docs/runbook/visual-regression.md
source_hash: e40e595db5c5be80dadc6a0a7cea6e9292ebb4afc4e867957aa874476f2bcc8f
ingested: 2026-09-30
---

# Runbook: Visual regression tests

How to run, write and review the visual-regression tier of `apps/ui`; why it exists and why on Vitest is [[ADR 0099: Screens are compared as pictures by Vitest, and nothing else uses it]].

Needs Docker, and the network on the first run (the Playwright image and a workspace install cached in a Docker volume). `task ci:visual` compares every screen with its committed baseline; `task ci:visual -- Tenants` narrows by path; `task ci:visual-update` retakes baselines. Both run inside the Playwright image as `linux/amd64`, the platform CI runs, so a Mac's baseline equals CI's; running Vitest outside the container would write `-darwin.png` files CI never reads. `task ci:visual` never writes a baseline: a moved or missing picture fails and its capture and red-marked diff go to the git-ignored `apps/ui/.vitest-attachments/`, which the `visual` workflow uploads as the `visual-diffs` artifact.

Writing a test: a `*.vrt.test.tsx` file under `apps/ui/src` (the name keeps it out of `bun test` and in Vitest); `apps/ui/src/routes/Tenants.vrt.test.tsx` is the example. `open(url, locale, answers)` mounts the real app (shell, router, react-query, tRPC client, `index.css`, bundled fonts) in `en` or `vi`, answering each procedure path from `answers`, with `session.me` (<operator@example.test>, not a superadmin) and `config.signIn` answered by default; the role is fixture data. An unanswered procedure fails the test by name; a deliberate refusal is a `Response`. `.matches(name, width)` waits for no query in flight and nothing `aria-busy`, awaits fonts, grows the viewport to the page height and compares the whole page, at 1440 and 390. The clock is stopped at `VISUAL_NOW`; `vi` is banned. Fixtures are synthetic (`CASE-nnnn`, `example.test`).

Reviewing: run the update for the file, open each `__screenshots__/<file>/<name>-chromium-linux.png` beside the design's picture (they differ by the design's own data and its deliberate "Keep code" differences), check only the intended change moved, and commit the PNGs with the change. A Playwright pin bump retakes baselines in the same change. Troubleshooting covers a missing reference, unanswered procedures, a clock that did not stop, a dependency bump moving every screen, and Docker not running.
