/**
 * The door a caller came through, as the audit log names it (ADR 0113).
 *
 * For reading, never for authority -- like `via` on the context. Whatever its credential, a caller
 * the CLI says is the CLI is `cli`, which is the CLI's own word: its session cookie, or the
 * personal token it signs in with unattended (ADR 0134). Otherwise a bearer is the model-context
 * door and a cookie the browser. The assistant marks its own caller (`assistantTools.ts`), since
 * it reuses the browser's context.
 */

import type { Channel } from "../services/audit.ts";
import type { Door } from "./identity.ts";

/** The header the CLI names itself with. The CLI spells it as `typeof CLI_HEADER`, so the two cannot drift. */
export const CLI_HEADER = { name: "x-undercroft-client", value: "cli" } as const;

export function channelOf(door: Door, headers: Headers | undefined): Channel {
  if (headers?.get(CLI_HEADER.name) === CLI_HEADER.value) {
    return "cli";
  }
  return door === "bearer" ? "mcp" : "web";
}
