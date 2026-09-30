/**
 * The compose file an install runs, embedded at build time.
 *
 * Imported as text from `deploy/compose/docker-compose.install.yml`, so there is one copy of it
 * in the repository and `bun build --compile` bakes that copy into the installer binary. The
 * installer of release vX.Y.Z therefore writes the compose file of vX.Y.Z next to the images of
 * vX.Y.Z; the two never come from different releases.
 */

import text from "../../../deploy/compose/docker-compose.install.yml" with { type: "text" };

export const COMPOSE_FILE: string = text;

/** The project name the file declares, and so the prefix of every volume it creates. */
export const PROJECT = "undercroft-install";
