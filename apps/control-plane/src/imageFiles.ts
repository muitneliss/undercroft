/**
 * What the control plane reads from the files its image carries beside the code, once, at boot.
 *
 * Four things, and they fail the same way. `/mcp`'s widgets are built from `apps/mcp-widgets`
 * (ADR 0061), its skills are read from `skills/` (ADR 0067), the card's per-list scopes come
 * from `specs/connectors` (ADR 0074), and the CLI tarball `/cli/` serves is the file the image
 * names in `UNDERCROFT_CLI_TARBALL` (ADR 0135). Each one that fails is logged and left out, and
 * the process serves without it rather than refusing to start. Gathered here so `main.ts` wires
 * one thing; what the server receives is `ImageFiles` (`handlers/imageFiles.ts`), so the next
 * artefact the image carries has an obvious home on both sides.
 */

import type { Logger } from "@undercroft/core";
import { loadCliTarball } from "./cliTarball.ts";
import type { ImageFiles } from "./handlers/imageFiles.ts";
import { loadSkills } from "./skills.ts";
import { loadSpecReads } from "./specs.ts";
import { buildWidgets } from "./widgets.ts";

/** Where the image put what it carries, when that is configuration rather than a fixed path. */
export interface ImagePaths {
  /** `UNDERCROFT_CLI_TARBALL`; absent on a process started from a checkout. */
  readonly cliTarball?: string;
}

export async function readImageFiles(log: Logger, paths: ImagePaths): Promise<ImageFiles> {
  const cliTarball = loadCliTarball(log, paths.cliTarball);
  return {
    widgets: await buildWidgets(log),
    skills: loadSkills(log),
    specReads: loadSpecReads(log),
    ...(cliTarball === undefined ? {} : { cliTarball }),
  };
}
