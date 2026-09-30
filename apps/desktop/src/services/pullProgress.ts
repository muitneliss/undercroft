/**
 * `docker compose pull`'s lines, read into one state per image for the install step's list.
 *
 * Compose prints an image's start and end on lines of their own, and those are the only lines
 * read here. Compose v5 names the image; v2 named the service:
 *
 *    Image postgres:17.6 Pulling          (v5)
 *    Image postgres:17.6 Pulled
 *    postgres Pulling                     (v2)
 *    postgres Error pull access denied ...
 *
 * Every other line is a layer's progress (`821d9dafb26d Downloading 1.049MB`, `... Pulling fs
 * layer`), which a person does not need one row per layer of. A line this module does not
 * recognise is `null`, never a guess: the list shows fewer rows, and the step's outcome still
 * comes from compose's exit code, not from this reading of its output.
 */

import type { ImageState } from "../rpc.ts";

export interface ImageLine {
  readonly image: string;
  readonly state: ImageState;
}

/** A name, then the state, and nothing after it but an error's message. */
const IMAGE_LINE =
  /^(?:Image\s+)?(?<image>\S+)\s+(?<state>Pulling|Pulled|Skipped|Error)(?<rest>.*)$/u;
/** A layer is a short hex digest; its `Pulling fs layer` must not read as an image. */
const LAYER = /^[0-9a-f]{12}$/u;

export function imageLine(line: string): ImageLine | null {
  const groups = IMAGE_LINE.exec(line.trim())?.groups;
  const image = groups?.image;
  const state = groups?.state;
  const rest = groups?.rest ?? "";
  if (image === undefined || state === undefined || LAYER.test(image)) {
    return null;
  }
  switch (state) {
    case "Pulling":
      return rest.trim() === "" ? { image, state: "pulling" } : null;
    case "Pulled":
      return { image, state: "pulled" };
    // "Skipped - Image is already being pulled by <service>": another service pulls the same
    // image, and that one's `Pulled` will follow.
    case "Skipped":
      return { image, state: "pulling" };
    case "Error":
      return { image, state: "failed" };
    default:
      return null;
  }
}
