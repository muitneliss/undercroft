/**
 * The customer's connections, as a page outside Sources reads them: to name which mailbox of two
 * a run or a stream came from, and to say when the first run comes.
 *
 * `connections.list` needs `sources:read` (ADR 0146), while the Journal and the Lake open on
 * `runs:read` and `lake:read`, so a reader of a customer's own role may hold one and not the
 * other. For that reader this asks nothing and answers empty -- which is exactly what each page
 * draws before the list arrives: an account named by its source id, no schedule to quote --
 * rather than a refusal in the middle of a page that is theirs to read. What the reader holds is
 * `tenants.get`'s answer, asked through `can`, never a role (ADR 0139).
 *
 * The same cached query the Sources leaf makes, so for a reader who holds both it costs no
 * request.
 */

import type { Connection } from "@/api/types.ts";
import { can } from "@/lib/permissions.ts";
import { trpc } from "@/trpc.ts";

const NONE: readonly Connection[] = [];

/** The customer's connections, or none for a reader who may not read its sources. */
export function useAccounts(tenantId: string): readonly Connection[] {
  const tenant = trpc.tenants.get.useQuery({ tenantId });
  const readsSources = can(tenant.data?.permissions, "sources:read");
  return trpc.connections.list.useQuery({ tenantId }, { enabled: readsSources }).data ?? NONE;
}
