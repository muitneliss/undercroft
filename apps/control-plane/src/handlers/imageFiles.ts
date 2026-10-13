/**
 * What the image carries beside the code, as the server receives it: read once at boot by the
 * composition root's `readImageFiles` (`../imageFiles.ts`) and handed to `createServer` inside
 * `ServerDeps`.
 *
 * Every field is optional and fails the same way: a file that could not be read is logged at
 * boot and left out, and the route it feeds answers without it rather than the process refusing
 * to start. One interface, so the reader and the server cannot disagree about what the image
 * carries, and so the next artefact it carries has an obvious home.
 */

import type { SpecReads } from "../services/connections.ts";
import type { Skill } from "./mcpSkills.ts";
import type { Widgets } from "./mcpWidgets.ts";

export interface ImageFiles {
  /**
   * The model-context door's widgets, built once at boot (`widgets.ts`). Absent -- a build that
   * failed, or a suite that does not draw -- and `/mcp` answers exactly as before, text and
   * structured content, which every host shows. ADR 0061.
   */
  readonly widgets?: Widgets;
  /**
   * The repository's skills, read once at boot (`skills.ts`), which `/mcp` serves through the
   * MCP Skills extension. Absent or empty -- a tree that failed to read -- and the extension
   * is not declared; every tool is served exactly as before. ADR 0067.
   */
  readonly skills?: readonly Skill[];
  /**
   * The lists each connector spec the image carries reads, read once at boot (`specs.ts`), by
   * which the card judges whether a grant still reads any of them (ADR 0073). Absent -- a suite
   * that lists no cards, or a tree that failed to read -- and every grant is judged whole.
   */
  readonly specReads?: SpecReads;
  /**
   * The CLI tarball packed from this image's own sources (`cliTarball.ts`), which
   * `/cli/undercroft-cli.tgz` serves. Absent -- a process started from a checkout, or a file
   * that failed to read -- and that route answers 404, never the app shell. ADR 0135.
   */
  readonly cliTarball?: Uint8Array<ArrayBuffer>;
}
