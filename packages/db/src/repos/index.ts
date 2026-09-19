/**
 * The repo layer of `@undercroft/db`, reached as `@undercroft/db/repos`.
 *
 * A subpath rather than part of the root export, so an import statement says which layer it
 * belongs to. Behind one barrel a handler importing a repo and a handler importing the
 * `SqlExecutor` seam look identical, and `layer-handler-no-repo` cannot tell them apart.
 * See docs/adr/0011.
 */

export {
  type Connection,
  type ConnectionDetail,
  ConnectionRegistryError,
  type Credential,
  deleteCredential,
  type ConnectionView,
  getConnection,
  listConnections,
  listConnectionViews,
  readConnectionDetail,
  readCredential,
  setStatus,
  upsertConnection,
  writeConnectionDetail,
  writeCredential,
} from "./connections.ts";
export { tenantExists } from "./tenants.ts";
