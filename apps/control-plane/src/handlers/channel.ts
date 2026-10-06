/**
 * The door a caller came through, as the audit log names it (ADR 0113).
 *
 * For reading, never for authority -- like `via` on the context. A bearer is the model-context
 * door; a cookie is the browser unless the CLI says it is the CLI, which is the CLI's own word.
 * The assistant marks its own caller (`assistantTools.ts`), since it reuses the browser's context.
 */

import type { Channel } from "../services/audit.ts";
import type { Door } from "./context.ts";

/** The header the CLI names itself with. The CLI spells it as `typeof CLI_HEADER`, so the two cannot drift. */
export const CLI_HEADER = { name: "x-undercroft-client", value: "cli" } as const;

export function channelOf(door: Door, headers: Headers | undefined): Channel {
  if (door === "bearer") {
    return "mcp";
  }
  return headers?.get(CLI_HEADER.name) === CLI_HEADER.value ? "cli" : "web";
}
