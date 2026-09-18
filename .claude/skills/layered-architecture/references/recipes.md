# Worked cases

Read the one that applies. Every example is code that exists in the repo, so the shape is
checkable against the real file rather than an invention.

## Contents

- [A query that spans two tables](#a-query-that-spans-two-tables)
- [A new worker verb](#a-new-worker-verb)
- [A guard that must hold under concurrency](#a-guard-that-must-hold-under-concurrency)
- [Splitting a file that mixes layers](#splitting-a-file-that-mixes-layers)
- [Reaching a repo in another package](#reaching-a-repo-in-another-package)
- [What the layers do NOT solve](#what-the-layers-do-not-solve)

## A query that spans two tables

"One repo per table group" leaves a real question: a `JOIN` belongs to which one?

Name the repo after **the table that filters**, and the function after the question:

```ts
// apps/control-plane/src/repos/membership.ts — joins ops.tenant, but membership is the filter
export async function listForUser(exec: SqlExecutor, userId: string): Promise<MemberTenant[]>;
```

The caller wants "tenants this user may see". `app.tenant_member` is what makes that list
short; `ops.tenant` only supplies display names. Putting it in `tenant.ts` would suggest the
tenant table decides who sees what, which is exactly the misreading to avoid — this query
_is_ the visibility boundary.

When no table dominates, name the function after the question and keep it in the repo whose
table answers most of it:

```ts
// apps/control-plane/src/repos/invitation.ts
/** Whether an address is known here or holds a live invitation. One statement, one round trip. */
export async function isKnownOrInvited(exec: SqlExecutor, email: string): Promise<boolean>;
```

Do not split one statement into two round trips just to keep a repo "pure" about its table.
A `UNION ALL` that answers a sign-in gate in one query is better than two reads the service
has to combine, and the sign-in path runs on every request.

## A new worker verb

The worker's HTTP surface is an allowlist, and that is a privilege boundary: a compromised
scheduler can start exactly these verbs. So the allowlist stays in the handler, visible in one
file.

1. `apps/worker/src/repos/<tables>.ts` — statements, if the verb touches the database.
2. `apps/worker/src/services/<verb>.ts` — the work. Takes a `deps` object
   (`RunDeps`-style): `lake`, `exec`, `specsDir`, an optional injected `fetcher`/`spawn` so
   tests drive it with no network and no subprocess.
3. `apps/worker/src/handlers/lake.ts` — one `app.post("/v1/runs/<verb>")`: check the bearer
   token, validate the body, call the service, map the result to a status.
4. `apps/worker/src/index.ts` — export the verb from the barrel. Nothing from `repos/` is
   exported: a caller outside the app gets the verb, not the tables.

An outbound adapter that is not a database — dbt, an HTTP provider — is _injected into_ the
service rather than made a repo. `services/transform.ts` takes `TransformDeps.spawn` and
defaults to `Bun.spawn`; that is how the dbt path is tested without dbt installed.

## A guard that must hold under concurrency

If two processes running at once could break an invariant, the guard belongs in the SQL, not
in the loader that calls it.

`repos/rawRecords.ts` enforces both of the lake projection's promises in statements:

- an unchanged payload writes no new row version — `content_sha256 IS DISTINCT FROM`;
- a late-arriving older observation never overwrites a newer row — `observed_at <=`.

A check in `services/loadToRaw.ts` would bind only that loop. Two loaders are exactly the
case the guarantee is for, so the database has to be the one enforcing it. The same reasoning
puts the credential `FOR UPDATE` lock read in `packages/db/src/repos/connections.ts` while
the refresh _policy_ (`needsRefresh`, `accessToken`) sits in `services/credentials.ts`.

State the reason in the repo's docstring. A constraint with no recorded reason gets
"simplified" away by the next reader.

## Splitting a file that mixes layers

This is the common refactor, and it has an order that keeps each step reviewable:

1. `git mv` the file into the layer where **most** of it belongs, and commit that alone. A
   pure rename is readable in a diff; a rename plus edits is not.
2. Cut the SQL into a new repo module, carrying its docstring with it. The reasoning belongs
   beside the statement it justifies, not beside the caller.
3. Leave the orchestration behind and have it call the repo. The service's docstring says
   what it decides and points at the repo for how it is stored.
4. Split the test the same way, along the same seam. Duplicating a `beforeEach` fixture into
   both halves is fine and cheaper than one test that reaches across layers.

Worked example in this repo: `packages/db/src/connections.ts` → `repos/connections.ts`
(two tables, the sealed credential, the lock read) plus `services/credentials.ts`
(`needsRefresh`, `accessToken`), with `connections.test.ts` split the same way.

## Reaching a repo in another package

`@undercroft/db` exports three surfaces, and the subpath is the point:

```ts
import type { SqlExecutor } from "@undercroft/db"; // the seam — any layer
import { getConnection } from "@undercroft/db/repos"; // a repo — services only
import { accessToken } from "@undercroft/db/services"; // a service — any caller
```

Behind one barrel, a handler importing a repo and a handler importing the executor type are
the same import statement, and `layer-handler-no-repo` cannot tell them apart. If you add a
repo or a service to a package, export it through the matching subpath barrel
(`src/repos/index.ts`, `src/services/index.ts`) rather than the root.

## What the layers do NOT solve

Knowing the limits stops the pattern being applied where it costs more than it gives:

- **The UI has no layers.** `apps/ui` is React: server data lives in the tRPC query cache,
  client data in the Zustand store, and `useState` is banned. See `.claude/rules/state.md`.
- **Same-layer imports are fine.** A service may call another service; a handler may compose
  another handler. Only _upward_ and _skipping_ are refused.
- **Three layers, not three files per feature.** If a service would be a one-line
  pass-through and you are certain nothing will ever be decided there, it is still where the
  next decision goes — but do not invent a repo for a table that does not exist yet.
- **The rules cannot see intent.** They catch a `SELECT` in a handler; they cannot catch a
  repo that quietly decides an authorization question, or a service that returns an HTTP
  status code as a number. Those stay a reading matter, which is why the docstrings say why.
