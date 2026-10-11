# Models workspace — review starts here

This branch supplies the original, runnable React/TypeScript prototype as ordinary Git files. Review this implementation before proposing a replacement. Screenshots illustrate it; they are not the implementation specification.

This is a design-review contribution, not a production integration or a claim that production loading is fixed. Reading this document does not authorize implementation, publication or deployment. Follow the maintainer's actual request and the repository rules.

Previous handoff: #349 contained the design contract, while readable prototype source and a ZIP lived on the unrelated-history `review/ui-r5b` branch. Its PR body explicitly called for rebuilding accepted behavior in the existing application. This contribution instead puts the runnable source in the review PR itself. The previous source was not absent; the boundary between reviewing a harness and reviewing an implementation was different.

## Open and run the exact source

1. Check out the submitted PR head. Record `git rev-parse HEAD` and whether the working tree is clean. The PR must include commit-pinned source links; do not use a moving branch as the only visual reference.
2. Read `CLAUDE.md`, `CONTRIBUTING.md`, `apps/ui/AGENTS.md`, applicable `.claude/rules/`, and `apps/ui/DESIGN.md`.
3. Read the source map below and every contributed code/config/test file in [SOURCE-INVENTORY.md](SOURCE-INVENTORY.md), including files GitHub collapses. Follow imports into shared application code as needed. Record any files or checks not inspected; do not claim complete review from this summary alone.
4. Install with the checkout's pinned Bun/Task toolchain and run from the repository root:

```text
task dev:install
task dev:models-prototype
```

Open `http://127.0.0.1:5174/tenants/CASE-0042/models`. This local URL works only after running the branch. Do not build a substitute demo to perform this review. If startup fails, report the command and error, then diagnose the original source.

## Source map

Paths below are relative to the repository root. The inventory provides clickable links for individual files and their local snapshot hashes.

| Read in this order | Files | What to verify |
| --- | --- | --- |
| Entry and isolation | `apps/ui/prototype/index.html`, `apps/ui/vite.prototype.config.ts`, `apps/ui/src/prototype/main.tsx`, `Prototype.tsx` | Existing Book shell, separate entry, synthetic transport, API isolation |
| Evidence behind the demo | `apps/ui/src/prototype/fixtures.ts`, `details.ts`, `engineering.ts` | 250/1,000 models, declared relationships, authored detail examples, explicit unknowns |
| Data and navigation contract | `apps/ui/src/features/models-workspace/types.ts`, `profileSource.ts`, `catalog.ts`, `scope.ts`, `hooks.ts` | Identity, classification, bounded traversal, URL scope, loading ownership |
| Discovery and profile | `ModelsWorkspace.tsx`, `ModelList.tsx`, `ModelProfile.tsx`, `ProfileDetails.tsx`, `ProfileEvidence.tsx`, `ProfileConfiguration.tsx`, `ProfileOperations.tsx` in that feature directory | Grouped/paged discovery, four profile tabs, demand-loaded samples and truthful evidence |
| Dependency exploration | `ModelLineage.tsx`, `ModelChooser.tsx`, `Expand.tsx`, `ModelGraph.tsx`, `layout.ts`, `shared.tsx` in that feature directory | Selection across pages, focus/expansion, table fallback, layout worker and accessibility |
| Appearance and state | Feature `workspace.css`, `details.css`; `apps/ui/src/store.ts`, `apps/ui/src/i18n/vi.ts`, `en.ts` | Scoped styles, existing state ownership, both languages |
| Tooling and verification | Root/UI `package.json`, `.taskfiles/{dev,ci,artifacts}/Taskfile.yml`, `biome.jsonc`, feature `catalog.test.ts` and `workspace.test.tsx` | Reproducibility, intended assertions, new lint exceptions and their scope |
| Product and implementation evidence | [SPEC](SPEC-models-ux.md), [PLAN](PLAN-models-ux.md), [HANDOFF](PROTOTYPE-HANDOFF.md), [STATUS](IMPLEMENTATION-STATUS-models-ux.md) | Target behavior versus actual implementation and outstanding acceptance cases |

Shared source is in this same checkout, not a hidden dependency: `apps/ui/src/components/Book.tsx`, `TabRail.tsx`, `LineageCanvas.tsx`, `apps/ui/src/index.css`, `routes/Models.tsx`, `routeTable.tsx`, existing query clients and formatters. `bun.lock` and tool-version files pin external dependencies. Read these dependencies where the contribution connects to them; the inventory also lists the principal reference files.

## Required compatibility decisions

- **Business meaning is conditional.** [ADR 0112](../../adr/0112-a-model-carries-no-business-context.md) removed the previous business-context feature. Purpose/grain/owner/classification examples do not establish production support. SPEC §4.7 already distinguishes current capabilities from proposals. Do not revive `models.setContext`, mandatory context forms or tenant-wide lineage reads on each model request. New metadata support requires an explicit source, owner, permission/cost model and a separate architectural decision.
- **Known UI deviation:** `ModelChooser.tsx` currently uses `dialog.showModal()`, contrary to the no-modal rule in `apps/ui/DESIGN.md`. SPEC §10.3 now requires inline expansion. Fix and verify this discrepancy before ready-for-review status; do not report full design-rule compliance while it remains.
- **Lineage:** apply current ADRs, including [0117](../../adr/0117-the-village-is-an-overview-and-replaces-no-drawing.md), rather than only the original no-library decision in 0092. React Flow/ELK are present upstream. Review this prototype's worker implementation separately.
- **Verification remains incomplete.** Full repository gate, visual tier, production adapters and measured production latency are not established by the fixture demo. See HANDOFF/STATUS; rerun on the actual submission commit.

## Preserve the reviewed behavior during integration

The original source remains available at the review commit even if maintainers choose not to merge the isolated demo into main. No ZIP or compressed/minified replacement is acceptable for source review. Include the complete authored source, fixtures, tests, styles, translations, configuration and documentation in Git; shared upstream code remains in the same checkout.

When integration is explicitly requested, prefer reusing compatible components and logic. A rewrite can be necessary, but it must identify the original file/symbol, the repository constraint, the replacement, and the comparison test or browser evidence. Do not infer a new layout from screenshots, silently omit interactions, or treat visual resemblance as behavioral equivalence.

Review these concrete paths in the original and, later, in the integrated version:

1. Find a model outside page one in both the 250 and 1,000 model fixtures; change grouping and return with Back.
2. Open `int_demo_011` and `int_invoice_balance`; inspect all four profile tabs, unknown evidence, test warning, failed-run detail and on-demand sample rows.
3. Explore lineage, select a page and all results, exclude an item, change search/page, cancel, apply a large set and use the table. Reload and verify the applied scope.
4. Compare VI/EN, desktop/narrow layouts, keyboard focus, zoom, reduced motion and the existing header/rail. No new Models AI button.
5. Report graph/loading measurements separately from backend/warehouse performance; the synthetic transport cannot prove production latency or permission enforcement.

## Review report to return

Use a report rather than a blanket “reviewed” statement:

| Evidence | Required response |
| --- | --- |
| Revision | Head SHA, base SHA, clean/dirty tree and environment |
| Source coverage | Files actually read, files not read and why; trace discovery → profile → lineage using actual symbols |
| Original run | Exact commands, URL and startup result; no replacement implementation |
| Behavior and appearance | Screenshot/artifact paths with commit and viewport; pass/fail/not-run for the five walkthroughs above |
| Validation | Commands, exits, failures, baseline comparison; distinguish focused checks from full gate |
| Adaptation | Original file/symbol → reuse/adapter/rewrite → reason → regression evidence |
| Backend support | Current endpoint/artifact for each capability, or explicit unsupported/proposed status |
| Decision | Blocking findings, design questions and recommended next increment; no automatic production changes |

Before publishing, regenerate the inventory from staged Git blobs after the final edit, commit the complete contribution, verify the remote tree matches that commit, and add permanent tree/blob links to the PR. Hashes describe Git file bytes rather than Windows checkout line endings. The inventory itself is not proof of upload; use the PR's pinned commit and remote tree. A review prompt cannot guarantee that an AI reads every line; this evidence makes omissions visible.
