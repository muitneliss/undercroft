---
name: layered-architecture
description: How backend code is organised in Undercroft - one direction, handler → service → repo, with SQL confined to repos and every dependency injected. Use this skill whenever you are about to add or change anything under apps/*/src or packages/db/src - a tRPC procedure, an HTTP route, a SQL statement, a new table, a worker verb, a Better Auth hook - or whenever you are deciding where a piece of code belongs, or a `layer-*` ast-grep rule failed in `bun run lint:rules` or `bun run verify`. Reach for it even when the change looks too small to need architecture, because the rules are a hard gate and a misplaced query fails the build rather than the review.
---

# One direction: handler → service → repo

Undercroft's backend has three layers, and **a file's directory is its layer**. The arrows
point one way and nothing skips a step:

```
apps/*/src/
  main.ts | server.ts   composition root: reads env, builds the pool/store, wires it up
  handlers/     ──→     HTTP, tRPC, status codes
  services/     ──→     the decisions
  repos/        ──→     every SQL statement

packages/db/src/        the seam: SqlExecutor, pool, migrate  (+ its own repos/, services/)
packages/{core,contracts,crypto,lake,connector-runtime}/       below every layer
```

Seven ast-grep rules enforce this in `bun run lint:rules`, inside `bun run verify` and CI.
They are not style preferences — a `SELECT` in a handler fails the build. The normative text
is `.claude/rules/layering.md`; the reasoning is `docs/adr/0011-layers-handler-service-repo.md`.

## Deciding where code goes

Ask what the code _is_, not what it is near:

| The code…                                                     | belongs in            |
| ------------------------------------------------------------- | --------------------- |
| parses a request, picks a status code, builds a cookie        | `handlers/`           |
| decides, orders steps, enforces a policy, combines repo calls | `services/`           |
| runs a statement against a table                              | `repos/`              |
| reads `process.env`, constructs a pool/store/client           | the entrypoint        |
| is useful to another app and knows nothing about ours         | a `packages/` library |

Two habits carry most of the weight:

- **A service returns values, never `TRPCError`.** `null` for "not there",
  `{ ok: false, reason: "already-member" }` for a refusal with detail. The handler alone
  decides that `null` is a 404 and `already-member` is a 409. This is what makes a decision
  reusable from a job, a CLI or a backfill instead of only from HTTP — and it keeps the
  status-code choices in one file where they can be compared.
- **A repo answers, it does not judge.** `roleFor` returns a role or `null`. It does not know
  that an absent membership must be reported as NOT_FOUND rather than FORBIDDEN — that
  argument lives once, in `apps/control-plane/src/handlers/trpc.ts`, and is the reason the
  tenant list cannot be enumerated.

## Adding an endpoint

Work bottom-up. Each step is small, and the next step has somewhere obvious to go.

**1. Repo — the statement.** One module per table group, named for the tables
(`invitation.ts`, `membership.ts`, `rawRecords.ts`). First argument is `SqlExecutor`.

```ts
// apps/control-plane/src/repos/tenant.ts
export async function findTenant(exec: SqlExecutor, tenantId: string): Promise<Tenant | null> {
  const { rows } = await exec.query<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM ops.tenant WHERE id = $1",
    [tenantId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: row.id, displayName: row.display_name };
}
```

Map snake_case to camelCase here, so nothing above this line knows the column names.

**2. Service — the decision.** Even a pass-through earns its place: it is where the next
rule, derived field or extra check will go without the handler growing a decision.

```ts
// apps/control-plane/src/services/tenants.ts
export function get(exec: SqlExecutor, tenantId: string): Promise<Tenant | null> {
  return findTenant(exec, tenantId);
}
```

Anything the decision needs to _do_ — send mail, notify an invitee, spawn a process — arrives
as a function argument (`notify`, `spawn`), so the decision is testable without the thing it
drives.

**3. Handler — the transport.** Validate with zod, call one service, map the result.

```ts
// apps/control-plane/src/handlers/tenantsRouter.ts
get: tenantProcedure.query(async ({ ctx, input }) => {
  const tenant = await tenants.get(ctx.exec, input.tenantId);
  if (tenant === null) throw new TRPCError({ code: "NOT_FOUND" });
  return { ...tenant, role: ctx.role };
}),
```

**4. Test through the public seam.** PGlite plus the real router, as
`handlers/authz.test.ts` and `handlers/people.test.ts` do. Tests are exempt from the layer
rules — a test is a composition root, so seed rows however is cheapest. Test the promise
(“a non-member is told the tenant is not there”), not the repo function's signature.

## When a rule fires

`bun run lint:rules` names the rule and the line. Each failure has one intended fix:

| Rule                      | What it saw                                            | The fix                                                                 |
| ------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `layer-sql-in-repos`      | SQL, or `exec.query`, outside `repos/`                 | move the statement into a repo function; call it from the service       |
| `layer-handler-no-repo`   | a handler importing `repos/` or `@undercroft/db/repos` | go through a service                                                    |
| `layer-service-no-upward` | `hono`/`@trpc/server`/a handler in a service           | return a value or a tagged result; let the handler pick the status code |
| `layer-repo-no-upward`    | a service or transport import in a repo                | the repo needs an argument, not a caller                                |
| `layer-injected-deps`     | `process.env` or `createPool`/`new LakeStore`          | read config in `main.ts`/`server.ts`, pass it in as `deps`              |
| `layer-no-driver-import`  | `pg` or `@electric-sql/pglite`                         | import `SqlExecutor` from `@undercroft/db`                              |
| `layer-shared-no-layer`   | a `packages/` library importing a layer                | the app-specific part belongs in the app                                |

Do not add an `ignores:` entry to make a rule quiet. The three exemptions that exist
(`migrate.ts`, `pool.ts`, `testing.ts`) are seams with their reasons written into the rule;
a fourth one needs the same justification, in the rule file, and usually means the code is in
the wrong directory instead.

`scripts/layering.test.ts` pins every guard from both sides. If you change a rule, that test
is the specification — update it deliberately and say why in the commit.

## Worked examples

`references/recipes.md` has the longer cases, worth reading when one applies:

- a query that spans two tables, and which repo owns it
- a new worker verb (handler allowlist → service → repo)
- a guard that must hold under concurrency, and why it goes in SQL
- splitting an existing file that mixes layers
- reaching a repo in another package (`@undercroft/db/repos` and why the subpath exists)
