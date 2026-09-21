/**
 * The guards that can only be decided once a whole entity has been read.
 *
 * Separate from `reader.ts` because nothing in a read calls them: `run.ts` does, after the
 * stream has finished and only when `maxRecords` did not truncate it on purpose. They are the
 * questions asked about a read that is over, and `maxRecords` -- the one guard that acts
 * DURING a read -- deliberately stays beside the loop it stops.
 *
 * Both of these exist because a source can lose data without saying so. An empty answer and a
 * page that stops exactly on a cap are the two shapes silent loss takes over a REST API, and
 * neither arrives as an error.
 */

import { ConnectorError } from "@undercroft/core";
import type { Reader } from "./reader.ts";

export function checkGuards(reader: Reader): void {
  const { spec, entity, guards, seen, since } = reader;
  // Relaxed only when a watermark was actually SENT, never merely because the entity declares
  // an incremental read. An incremental read that finds nothing new is the steady state and
  // must not fail the run; a FIRST read that finds nothing is the case `failOnEmpty` exists
  // for, since "failed after 0" is what a credential or permission problem looks like
  // (`.claude/rules/connectors.md`). Keying on the spec instead of on the cursor would throw
  // that away for every entity that ever grows an `incremental` block.
  if (guards.failOnEmpty && seen === 0 && since === null) {
    throw new ConnectorError(spec.id, entity.name, 0, "source returned no records (failOnEmpty)");
  }
  if (guards.failOnExactCount !== undefined && seen === guards.failOnExactCount) {
    // The HubSpot 10,000 cap: landing exactly on it is almost certainly truncation, and
    // the source does not say so. Applied on an incremental read exactly as on a full one --
    // truncation is truncation, whatever was asked for. `seen` counts what the SOURCE handed
    // over, including what a client filter then dropped, so filtering cannot talk a truncated
    // read out of being reported as one.
    throw new ConnectorError(
      spec.id,
      entity.name,
      seen,
      `read exactly ${seen} records, the configured truncation ceiling -- this is probably silent data loss`,
    );
  }
}
