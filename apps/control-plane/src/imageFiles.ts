/**
 * What the control plane reads from the files its image carries beside the code, once, at boot.
 *
 * Three things, and they fail the same way. `/mcp`'s widgets are built from `apps/mcp-widgets`
 * (ADR 0061), its skills are read from `skills/` (ADR 0067), and the card's per-list scopes come
 * from `specs/connectors` (ADR 0074). Each one that fails is logged and left out, and the process
 * serves without it rather than refusing to start. Gathered here so `main.ts` wires one thing, and
 * so the next artefact the image carries has an obvious home.
 */

import type { Logger } from "@undercroft/core";
import type { ServerDeps } from "./handlers/context.ts";
import { loadSkills } from "./skills.ts";
import { loadSpecReads } from "./specs.ts";
import { buildWidgets } from "./widgets.ts";

export async function readImageFiles(
  log: Logger,
): Promise<Required<Pick<ServerDeps, "widgets" | "skills" | "specReads">>> {
  return {
    widgets: await buildWidgets(log),
    skills: loadSkills(log),
    specReads: loadSpecReads(log),
  };
}
