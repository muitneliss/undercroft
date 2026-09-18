/**
 * Run and request identifiers.
 *
 * A run id is generated fresh per run, never cached in the environment. A long-lived
 * worker that reused one id across tenants was a real multi-tenancy defect in the
 * predecessor -- one tenant's run log could overwrite another's. `newRunId` is called at
 * the start of each run, so no two runs share an id.
 */

// biome-ignore-all lint/style/noMagicNumbers: What is left after the domain constants were named (see the WCAG block in acetate.ts) is structural: string slice offsets, the radix argument to parseInt, padStart widths, rounding factors. A name like SLICE_START_OF_GREEN_CHANNEL does not tell a reader anything the expression did not. The rule has no allow-list option, so it is per file or not at all.

// biome-ignore-all lint/correctness/noNodejsModules: This is server code running on Bun. `node:` builtins are the platform here, not a portability hazard -- the rule exists for code that must also run in a browser.

import { randomUUID } from "node:crypto";

export function newRunId(): string {
  return `run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

export function newRequestId(): string {
  return randomUUID();
}
