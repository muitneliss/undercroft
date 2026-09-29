/**
 * The connector specs this image carries, read once per process, for the card to judge a grant.
 *
 * A spec names the scope each of its lists is read under (`readScope`), and the worker reads a
 * list only when the recorded grant holds that scope (ADR 0073). The card has to answer the same
 * question -- can this connection still run, and which lists would a reconnect add -- and an
 * answer from a copy of the spec is an answer that drifts from it. So the control plane reads the
 * same files the worker does (`COPY specs` in both Dockerfiles), and nothing else: the entities,
 * which is what `presentStatus` asks of them (ADR 0074), and how many whole-read requests a day
 * the spec allows, which is what a re-sync's "takes N days" is measured against (ADR 0081).
 *
 * Here beside `main.ts`, like `skills.ts`, because reading the disk is the composition root's to
 * do. A spec that fails to read is logged and left out, and its source's grant is then judged
 * whole, as it was before ADR 0073: a card that asks for a reconnect it did not need is the
 * failure that is seen and repaired, where a crashed control plane serves nobody.
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { parseSpec } from "@undercroft/contracts";
import { describeError, type Logger } from "@undercroft/core";
import type { SpecRead, SpecReads } from "./services/connections.ts";

/** `specs/connectors` at the repository root: where the image carries it, and a checkout has it. */
export const SPECS_ROOT = join(import.meta.dir, "..", "..", "..", "specs", "connectors");

/** What the card reads of each spec, by the name the worker reads it under, `<source>.yaml`. */
export function loadSpecReads(log?: Logger, root = SPECS_ROOT): SpecReads {
  const reads = new Map<string, SpecRead>();
  let files: string[];
  try {
    files = readdirSync(root).filter((file) => extname(file) === ".yaml");
  } catch (error) {
    log?.error("connector_specs_unloaded", describeError(error));
    return reads;
  }
  for (const file of files.toSorted()) {
    try {
      const spec = parseSpec(readFileSync(join(root, file), "utf8"));
      reads.set(basename(file, ".yaml"), {
        entities: spec.entities,
        wholeReadsPerDay: spec.defaults.wholeReadBudget?.requestsPerDay ?? null,
      });
    } catch (error) {
      log?.error("connector_spec_unloaded", { file, ...describeError(error) });
    }
  }
  log?.info("connector_specs_loaded", { specs: [...reads.keys()].join(",") });
  return reads;
}
