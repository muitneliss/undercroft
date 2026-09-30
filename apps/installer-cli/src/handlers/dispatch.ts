/**
 * One invocation, routed to its command. The one place `Cancelled` is caught: a person who
 * pressed Ctrl-C at any question gets a sentence and exit 1, never a stack trace.
 */

import { cancel } from "@clack/prompts";
import type { CommandName } from "../services/options.ts";
import type { Context, Exit } from "./context.ts";
import { down, logs, status, uninstall, update } from "./manage.ts";
import { Cancelled } from "./prompts.ts";
import { up } from "./up.ts";

const COMMANDS: Readonly<Record<CommandName, (ctx: Context) => Promise<Exit>>> = {
  up,
  down,
  status,
  logs,
  update,
  uninstall,
};

export async function dispatch(ctx: Context): Promise<Exit> {
  try {
    return await COMMANDS[ctx.invocation.command](ctx);
  } catch (error) {
    if (error instanceof Cancelled) {
      cancel(ctx.t("cancelled"));
      return 1;
    }
    throw error;
  }
}
