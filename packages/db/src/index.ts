/**
 * The seam, and only the seam.
 *
 * `@undercroft/db` exports what every layer may depend on: the `SqlExecutor` interface, the
 * pool that implements it, and the migration runner. The registry itself is one layer down,
 * behind `@undercroft/db/repos`, and credential refresh behind `@undercroft/db/services` --
 * so an import statement names the layer it reaches for and the ast-grep rules can see it.
 * See `.claude/rules/layering.md` and docs/adr/0011.
 */

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
