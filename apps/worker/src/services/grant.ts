/**
 * Whether a recorded grant can read what it is about to be asked to, decided BEFORE asking.
 *
 * Google does not always refuse a grant that is too narrow. Gmail without `gmail.readonly`
 * answers 403, which already raises. Drive under `drive.file` answers a folder listing with
 * 200 and an empty page, because to `drive.file` a picked folder's existing contents are
 * simply not there -- so the collector recorded "no matching files in folder" and the run
 * closed green having landed nothing, which is issue 178 and the shape rule 2 forbids. Every
 * Drive connection made before ADR 0047 holds exactly that grant.
 *
 * So the recorded grant is read first, and a grant without the source's read scope raises
 * with the remedy in its message. For Google, one guard, two callers: the collector before it
 * harvests, and the browse before it lists, so neither can present a grant's blindness as an
 * empty drive. The scope each Google source needs is `@undercroft/contracts`'
 * `GOOGLE_READ_SCOPES`, the same table the consent asks from.
 *
 * A spec source consenting through OAuth -- Xero -- reads each list under its own scope, which
 * the spec names per entity (`readScope`). Xero refuses a missing scope with a 401, but only on
 * the request for that list, part-way through a run that has already landed the lists before it
 * (issues 271 and 276). And a consent that gains a scope leaves every grant recorded before it
 * without that scope, still able to read everything else. So the grant is not judged as a whole:
 * `partitionByGrant` splits a run's lists into the ones it reaches and the ones it does not,
 * before the first request, and the run reads the first and names each of the second with the
 * scope a reconnect would add. ADR 0073, superseding ADR 0069's refusal of the whole run. That
 * rule lives in `@undercroft/contracts` (`specGrant.ts`) rather than here, because the card asks
 * it too: a connection whose grant still reads some of its lists is runnable, and one that reads
 * none of them is not.
 */

import { missingReadScope } from "@undercroft/contracts";
import { UndercroftError } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { getConnection } from "@undercroft/db/repos";

/** The recorded grant lacks the scope this source reads with. A reconnect is the repair. */
export class GrantTooNarrow extends UndercroftError {
  constructor(source: string, tenantId: string, missing: string) {
    super(
      `${source} for tenant ${JSON.stringify(tenantId)} was granted without ${missing}, ` +
        "which reading it needs, so nothing it holds is visible to this connection; " +
        "reconnect the source to grant read access",
    );
  }
}

/**
 * Raise {@link GrantTooNarrow} when the recorded grant cannot read this source.
 *
 * Quiet for a connection with no row, or with nothing recorded as granted: neither is
 * evidence of a narrow grant, and the token resolution after this refuses an absent
 * connection in its own words.
 */
export async function requireReadGrant(
  exec: SqlExecutor,
  input: { tenantId: string; source: string },
): Promise<void> {
  const connection = await getConnection(exec, input.tenantId, input.source);
  const missing = connection === null ? null : missingReadScope(input.source, connection.scope);
  if (missing !== null) {
    throw new GrantTooNarrow(input.source, input.tenantId, missing);
  }
}
