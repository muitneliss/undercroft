/**
 * The questions the wizard asks, through Clack, and nowhere else.
 *
 * Each answers with a value, or throws `Cancelled` when the person presses Ctrl-C or Escape.
 * A wizard is a dozen questions in a row, and threading "or cancelled" through every one of
 * them would bury the sequence it exists to show; `dispatch.ts` catches it once and ends the
 * run with a sentence rather than a stack trace.
 */

import { confirm, isCancel, multiselect, password, select, text } from "@clack/prompts";
import type { Context } from "./context.ts";

export class Cancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "Cancelled";
  }
}

function refuse(): never {
  throw new Cancelled();
}

export interface Option<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

/**
 * Clack's option type is conditional on its value type, which a generic `T` leaves unresolved,
 * so the question is asked over plain strings and the answer found again among the options --
 * which also means the value handed back is always one that was offered.
 */
function clackOptions(
  options: readonly Option<string>[],
): { value: string; label: string; hint?: string }[] {
  return options.map(({ value, label, hint }) =>
    hint === undefined ? { value, label } : { value, label, hint },
  );
}

function offered<T extends string>(options: readonly Option<T>[], value: string): T {
  return options.find((option) => option.value === value)?.value ?? refuse();
}

export async function choose<T extends string>(
  message: string,
  options: readonly Option<T>[],
  initialValue?: T,
): Promise<T> {
  const value = await select<string>({
    message,
    options: clackOptions(options),
    ...(initialValue === undefined ? {} : { initialValue }),
  });
  return isCancel(value) ? refuse() : offered(options, value);
}

export async function chooseMany<T extends string>(
  message: string,
  options: readonly Option<T>[],
  initialValues: readonly T[],
): Promise<T[]> {
  const values = await multiselect<string>({
    message,
    options: clackOptions(options),
    initialValues: [...initialValues],
    required: false,
  });
  return isCancel(values) ? refuse() : values.map((value) => offered(options, value));
}

/** A yes-or-no question. `initialValue` is what Enter answers: `false` before anything destructive. */
export async function yes(message: string, initialValue = true): Promise<boolean> {
  const value = await confirm({ message, initialValue });
  return isCancel(value) ? refuse() : value;
}

/** A required line of text, offered with what the install already has. */
export async function ask(ctx: Context, message: string, initialValue: string): Promise<string> {
  const value = await text({
    message,
    initialValue,
    validate: (typed) => ((typed ?? "").trim() === "" ? ctx.t("settings.required") : undefined),
  });
  return isCancel(value) ? refuse() : value.trim();
}

/**
 * A secret, masked. When the install already holds one, an empty answer keeps it -- a person
 * changing their port should not have to find their Xero secret again.
 */
export async function askSecret(ctx: Context, message: string, current: string): Promise<string> {
  const value = await password({
    message: current === "" ? message : `${message} ${ctx.t("settings.keep")}`,
    validate: (typed) =>
      current === "" && (typed ?? "").trim() === "" ? ctx.t("settings.required") : undefined,
  });
  if (isCancel(value)) {
    return refuse();
  }
  return value.trim() === "" ? current : value.trim();
}
