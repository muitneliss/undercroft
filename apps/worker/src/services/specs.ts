/**
 * A connector's spec, read from the directory this worker was handed.
 *
 * One reader for the three places that need a spec -- opening a run, refusing a run that has no
 * usable connection, and listing what a HubSpot scope may choose -- so where a spec lives and
 * how it is validated is said once. The source's KIND grammar (`@undercroft/contracts/sources`)
 * is what keeps a `/` or `..` out of the file name.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ConnectorSpec, parseSpec } from "@undercroft/contracts";

export function readSpec(specsDir: string, source: string): ConnectorSpec {
  return parseSpec(readFileSync(join(specsDir, `${source}.yaml`), "utf8"));
}
