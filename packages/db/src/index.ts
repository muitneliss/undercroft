/**
 * The seam, and only the seam.
 *
 * `@undercroft/db` exports what every layer may depend on: the `SqlExecutor` interface, the
 * pool that implements it, and the migration runner. The registry itself is one layer down,
 * behind `@undercroft/db/repos`, and credential refresh behind `@undercroft/db/services` --
 * so an import statement names the layer it reaches for and the ast-grep rules can see it.
 * See `.claude/rules/layering.md` and docs/adr/0011.
 */

// biome-ignore-all lint/performance/noBarrelFile: `index.ts` is each package's public entry point, which is the seam `.claude/rules/layering.md` is built on and what `.claude/rules/tests.md` means by testing through the public API. The re-export cost the rule is about applies to a bundle; these are workspace packages consumed by name.

export type { QueryField, QueryResult, SqlExecutor } from "./executor.ts";
export { loadMigrations, type MigrateResult, type Migration, migrate } from "./migrate.ts";
export {
  asExecutor,
  connectionOf,
  createPool,
  createRolePool,
  type DatabaseAddress,
  type Pool,
  type PoolClient,
  pinTypeParsers,
  type RoleLogin,
  withTransaction,
} from "./pool.ts";
