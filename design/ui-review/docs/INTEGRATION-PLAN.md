# Integration plan — align with Undercroft, do not replace it

Baseline: [`116a41e`](https://github.com/muitneliss/undercroft/tree/116a41e) (release 1.53.0), inspected 2026-09-29. This document is a proposed implementation plan. The repository is unchanged and its CI has not been run for a production patch.

This plan covers the four divisions of the operator data path. The route and contract mapping for Customers, Reports and People is in [THREE-DIVISIONS.md](THREE-DIVISIONS.md) and [REPORTS-RESEARCH.md](REPORTS-RESEARCH.md).

## 1. Preserve the architecture

- React Router keeps ownership of application routes. The hash router is only a portable review convenience.
- Server state stays in **tRPC React Query**, with generated hooks and targeted invalidation after mutations.
- Client drafts, selected state and open panels use the existing **Zustand** store. No new `useState` ownership, copied server cache or parallel global store.
- URL-addressable state is parsed/canonicalized at the route boundary. Agree how route state and store state synchronize; do not maintain two independent authoritative filters.
- Production labels go into existing **i18next** dictionaries, not the harness's inline `t(vi,en)` helper.
- Reuse Book, Opened, ScopeRoute, StatusMark, Errata, Skeleton, ScheduleControl, AccountSwitcher and existing editor/form primitives. Keep lazy-loaded route chunks and the Book's leaf-turn boundary.
- Keep page-wide mutation locking. Do not allow concurrent Save/Build/Delete against a moving draft.
- The app already has `@xyflow/react` for RunFlow. Evaluate reuse before adding a graph dependency, but do not treat run-flow events as a model-lineage contract.

Do **not** merge `assets/app.js` or `assets/review.css` directly into `apps/ui`. Their job is portable visual/interaction review. Extract accepted behavior into small typed components and existing application state instead.

## 2. Source map

Paths below are repository-relative at the baseline commit.

| Area             | Existing implementation to extend                                                                                               | Scope of review proposal                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Shell/navigation | `apps/ui/src/routeTable.tsx`, `components/Book.tsx`, `components/Opened.tsx`                                                    | Preserve shell and motion; route/filter continuity                               |
| Sources          | `routes/TenantOverview.tsx`, `components/AccountSwitcher.tsx`                                                                   | Account identity, readable scope summary, contextual links                       |
| Scope            | `routes/ScopePicker.tsx`, `components/ScopeRoute.tsx`, provider-specific choices                                                | Connector-specific edit/review; draft retention                                  |
| Schedule         | `components/ScheduleControl.tsx`                                                                                                | Keep independent semantics, custom cron and server-derived next-run              |
| Journal          | `routes/Journal.tsx`, `components/RunFlow.tsx`                                                                                  | Run-target navigation; separately agree global filter contract                   |
| Lake             | `routes/Lake.tsx`, `routes/LakeQuery.tsx`, `components/LakeSummary.tsx`, `LakeBrowser.tsx`, `LakeSearch.tsx`, `LakeConsole.tsx` | Stream identity, payload/provenance clarity, preserve original specialized views |
| Models           | `routes/Models.tsx`, `routes/ModelEditor.tsx`, `components/ModelPanels.tsx`, `lib/modelDraft.ts`                                | List summaries; existing save/build/test semantics; agreed lineage view          |
| Contracts        | `packages/contracts/src/connectionScope.ts`, `models.ts`, `sourceInstance.ts`                                                   | Preserve exact request shapes and source-instance identity                       |
| API              | `apps/control-plane/src/handlers/modelsRouter.ts`, `lakeRouter.ts`, `connectionsRouter.ts`, `router.ts`                         | Existing role guards and endpoint inputs                                         |
| Domain/data      | `apps/control-plane/src/services/models.ts`, `services/connections.ts` and db repositories                                      | Only add data fields after semantics are agreed                                  |
| Visual language  | `apps/ui/DESIGN.md`, `apps/ui/src/index.css`, `apps/ui/public/fonts/`                                                           | Reuse tokens, font subsets and primitives, not duplicated CSS                    |

## 3. Route mapping

| Harness hash                       | Existing production route / recommended mapping                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `#sources`                         | `/tenants/:tenantId` — do not invent `/sources` as a replacement                                                       |
| `#source/:connectionId`            | Selected account/source context on TenantOverview; a standalone detail route is a proposal, not current API fact       |
| `#scope/:connectionId?step=review` | `/tenants/:tenantId/connect/:source/scope`; review state must preserve the selected instance                           |
| `#schedule/:connectionId`          | Existing ScheduleControl under the selected source; separate harness page does not require a new production route      |
| `#journal/:runId`                  | `/tenants/:tenantId/journal/:runId?`                                                                                   |
| `#lake?source=...&entity=...`      | `/tenants/:tenantId/lake` with the app's existing stream/search query scheme; do not copy harness keys without mapping |
| `#lake/REC-001`                    | Selected raw record in LakeBrowser; no assumption that `REC-001` is a real production record ID                        |
| `#lake/console`                    | `/tenants/:tenantId/lake/console`                                                                                      |
| `#models?view=list` / `view=graph` | `/tenants/:tenantId/models`; graph view/query selection is proposed                                                    |
| `#model/:name`                     | `/tenants/:tenantId/models/:name`                                                                                      |
| `#model-new`                       | Existing model-creation UI; use its create/save semantics                                                              |

The harness URL `role` is only a debug switch. Never use a query string to authorize a production action. Obtain role from authenticated server state and keep server guards authoritative.

## 4. Data contract matrix

| Display / action               | Baseline capability                                                            | Implementation rule                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Model name, updated time/actor | `models.list` returns `name`, `updatedAt`, `updatedBy`                         | Direct mapping; localized timestamps must identify timezone                                                              |
| Last build                     | `lastBuild` is nullable and includes run ID, result, end time and column names | Use existing build-mark helpers; null is not running                                                                     |
| Column count                   | `lastBuild.columns` is a string array                                          | Derive length; no fictional row count                                                                                    |
| Active build                   | Needs explicit active-run context                                              | Do not infer from missing lastBuild or a spinner left in local state                                                     |
| Last successful build          | Not an independent list field                                                  | Proposed nullable field or carefully defined history query                                                               |
| Recovered                      | Not a first-class list status                                                  | Proposed annotation based on consecutive ordered completed outcomes                                                      |
| Model version                  | No per-model revision/semver field                                             | Do not relabel updatedAt or platform version as model version                                                            |
| Model preview                  | Build response has columns/rows/truncated                                      | Label truncation; preview length does not imply total rows                                                               |
| Model lineage                  | No tenant-wide source/model graph contract identified in this review           | Agree authority, stable IDs, revision, unknowns and edge kinds first                                                     |
| Journal history                | `runs.list` accepts limit/cursor                                               | Full-history source/status/search filters and totals need extension; fixture filtering is not proof that API supports it |
| Lake stream                    | Source-instance identity plus entity                                           | Two Gmail connections must remain different streams                                                                      |
| Raw payload                    | Original server text                                                           | Escape into text, do not parse/re-stringify; preserve bigint/decimal lexemes                                             |
| Scope                          | Discriminated `ConnectionScope`                                                | Use existing contract and provider controls; retain scope names beside IDs                                               |
| Schedule                       | Existing cadence/resync mechanisms                                             | Independent operations; do not imply scope save atomically writes schedules                                              |

The fixture normalizes columns to a count and uses short stable CASE/REC identifiers. These are presentation fixtures, not a JSON response schema. There is no request adapter in the package.

## 5. Scope semantics — safety-critical wording

| Connector | Exact shape to retain                                          | Meaning of an empty selection                                                                       |
| --------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Gmail     | `{kind:'gmail', labels:[{id,name}], fileTypes:[...]}`          | Recorded `labels:[]` means whole mailbox. Missing saved scope is different                          |
| Drive     | `{kind:'drive', files:[{id,name,kind:'folder'                  | 'file'}], recurse, fileTypes}`                                                                      | `files:[]` means no selected files/folders. Not whole Drive |
| Xero      | `{kind:'xero', organisation:{id,name}, entities:[...]}`        | `entities:[]` means all entities in the connector spec, not none                                    |
| HubSpot   | `{kind:'hubspot', properties:{entity:[internalPropertyName]}}` | Empty extras or absent scope means spec-defined floor only. Never remove the spec's cursor property |

For Gmail/Drive, recorded `fileTypes:[]` means every file type; absent fileTypes defaults to PDF for backwards compatibility. Drive `recurse` defaults false. Preserve the original Google Picker/browse behavior; the harness's three example items are not a replacement.

Scope save changes future read selection and keeps landed history. Do not universally promise a new watermark/reset/full reread. Verify the connector behavior for the specific change. Do not replace a full connection-instance ID with its kind when checking or saving scope.

## 6. Inner-screen invariants

### Models

- Keep the SQL editor, supported reference/macros and query-to-report pathways already present. The harness does not supplant them.
- Save stores SQL and typed tests; it does not run dbt.
- Build uses saved definition, with a dirty-draft guard. Preserve both valid and refused paths in tests.
- Tests remain `ModelTests = {columns: {columnName: ('not_null'|'unique')[]}}`, not arbitrary YAML.
- Keep the server's delete semantics (ADR 0077). A model that `ref`s a deleted one keeps the ref, and lineage shows it as a missing dependency. Fixture delete only demonstrates the UX; it is not the production deletion algorithm.
- Preserve admin-only mutation guards. Members/viewers may read permitted model details; query/preview authority is not implied by seeing a model name.

### Lake and journal

- Lake summary is tenant-readable; raw records/documents/search/SQL are admin-guarded in the reviewed router.
- Existing document previews, search answers, query limits and schema assistance must remain when integrating. The seven-record fixture is not feature-equivalent to the entire lake subsystem.
- Error, skipped and rejected-record states are different. Do not invent rejected rows to populate a panel after an authorization failure.
- A link to a run/record must preserve tenant, full source instance and entity; never guess a target by display name.
- SQL console remains a real server-controlled operation with original boundaries. The harness allows one sample SELECT; its string comparison is not a security solution.

## 7. Visual and accessibility acceptance

- Preserve original board/leaf hierarchy, 9.5rem annotation column, content widths and structural breakpoints. Do not recreate the whole shell from screenshots.
- Keep Archivo for headings/controls, EB Garamond for explanations and Spline Sans Mono for machine identifiers. Vietnamese prose must not rely on an ASCII-only mono subset.
- Keep original small radii, status glyphs, plate hierarchy and stepped hinge/turn transitions; honor reduced motion with settled frames.
- Graph and tables need independent small-screen strategies: readable paths for graph, labelled horizontal-scroll region for tables. Avoid shrinking all type until it fits.
- All important actions must work with keyboard and have visible focus. Errors use live announcements. Inline confirmations restore focus and retain context; there is no modal.
- Selected graph paths must remain readable without color; missing-dependency and upstream-not-declared marks need text, not only colour or a dashed line.
- Test at 390px, 760px, 1100px and desktop widths, 200% zoom, keyboard-only and a real screen reader before production approval. The harness QA file states the subset actually checked.

## 8. Proposed small implementation slices

1. **List/navigation:** shared list-derived summaries, never-built status, URL filter/view state, contextual links and tests. No new schema assumed.
2. **Source clarity:** instance-aware summary and explicit scope review; preserve provider picker and ScheduleControl. No new OAuth implementation.
3. **Inner-screen polish:** consistent draft/error/busy treatment around existing model/lake/journal components, preserving specialized features.
4. **Lineage:** inside Models, drawn only from declarations the server reads (model → model, raw lake table → model), with "upstream not declared" and missing-dependency marks. No edges from source accounts or to reports.
5. **Optional signals:** latest-success/recovery/version only after deciding semantics and cost.

For each slice: read matching `.claude/rules` and AGENTS instructions → implement in the existing architecture → add behavior tests using real in-memory implementations/PGlite as required → run `task ci:verify` and relevant extra gates → manually verify route/role/error/locale/motion/responsive behavior → request review.

No schema migration, new library, branch push, issue, PR or production deployment is authorized by this plan. The offline Node tests are **not** the repository gate.
