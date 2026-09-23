/**
 * The questions human mode asks, through Clack, and nowhere else.
 *
 * Every function here answers with a value or with `CANCELLED` -- a person pressing Ctrl-C --
 * which the caller turns into a clean exit rather than a stack trace. None of them is ever
 * reached in agent mode: `RuntimeMode.prompts` is false there, and the handlers check it
 * before asking, because a prompt written into an agent's pipe is a process that never ends.
 */

import { confirm, isCancel, select, text } from "@clack/prompts";
import type { FlagSpec } from "../services/input.ts";
import type { Context } from "./context.ts";

export const CANCELLED: unique symbol = Symbol("cancelled");

export type Answer<T> = T | typeof CANCELLED;

function streams(ctx: Context): { input: Context["stdin"]; output: Context["stdout"] } {
  return { input: ctx.stdin, output: ctx.stdout };
}

export async function askText(ctx: Context, message: string): Promise<Answer<string>> {
  const answer = await text({ ...streams(ctx), message });
  return isCancel(answer) ? CANCELLED : answer;
}

export async function askConfirm(ctx: Context, message: string): Promise<Answer<boolean>> {
  const answer = await confirm({ ...streams(ctx), message, initialValue: false });
  return isCancel(answer) ? CANCELLED : answer;
}

export async function askChoice(
  ctx: Context,
  message: string,
  options: readonly { readonly value: string; readonly label: string }[],
): Promise<Answer<string>> {
  const answer = await select({ ...streams(ctx), message, options: [...options] });
  return isCancel(answer) ? CANCELLED : answer;
}

const INTEGER = /^-?\d+$/u;

/** One scalar input property, asked in the form its flag would take. */
export async function askValue(ctx: Context, spec: FlagSpec): Promise<Answer<unknown>> {
  const message = ctx.t("prompt.value", { name: `--${spec.flag}` });
  switch (spec.kind) {
    case "enum":
      return await askChoice(
        ctx,
        message,
        spec.options.map((value) => ({ value, label: value })),
      );
    case "boolean":
      return await askConfirm(ctx, message);
    case "integer": {
      const answer = await text({
        ...streams(ctx),
        message,
        validate: (value) => (INTEGER.test(value ?? "") ? undefined : message),
      });
      // An integer index, not an amount: `Number.parseInt` is the sanctioned spelling.
      return isCancel(answer) ? CANCELLED : Number.parseInt(answer, 10);
    }
    default:
      return await askText(ctx, message);
  }
}
