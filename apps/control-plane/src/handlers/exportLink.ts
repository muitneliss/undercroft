/**
 * Where an export is downloaded (ADR 0111): one route, spelled once.
 *
 * Its own module because two places need it and neither may own it: `biRouter.ts` hands the
 * link out, and `exports.ts` serves it -- and `exports.ts` reaches the router, so the router
 * importing it would be a cycle. Under `/api/` so the SPA's catch-all can never answer it with
 * the app shell.
 */

/** The route, in Hono's pattern. */
export const EXPORT_ROUTE = "/api/exports/:tenantId/:id";

/** The path of one export. Both parts are percent-encoded: a tenant id is the customer's. */
export function exportPath(tenantId: string, id: string): string {
  return `/api/exports/${encodeURIComponent(tenantId)}/${encodeURIComponent(id)}`;
}

/** The link a caller is given: whole at the public origin when one is configured, else the path. */
export function exportUrl(publicUrl: string | null, path: string): string {
  return publicUrl === null ? path : new URL(path, publicUrl).toString();
}
