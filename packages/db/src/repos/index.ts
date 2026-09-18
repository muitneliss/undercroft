/**
 * The repo layer of `@undercroft/db`, reached as `@undercroft/db/repos`.
 *
 * A subpath rather than part of the root export, so an import statement says which layer it
 * belongs to. Behind one barrel a handler importing a repo and a handler importing the
 * `SqlExecutor` seam look identical, and `layer-handler-no-repo` cannot tell them apart.
 * See docs/adr/0011.
 */

// biome-ignore-all lint/performance/noBarrelFile: `index.ts` is each package's public entry point, which is the seam `.claude/rules/layering.md` is built on and what `.claude/rules/tests.md` means by testing through the public API. The re-export cost the rule is about applies to a bundle; these are workspace packages consumed by name.

export {
  type Connection,
  ConnectionRegistryError,
  type Credential,
  getConnection,
  listConnections,
  readCredential,
  setStatus,
  upsertConnection,
  writeCredential,
} from "./connections.ts";
