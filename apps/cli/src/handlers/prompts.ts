/**
 * The questions human mode asks, through Clack, and nowhere else.
 *
 * Every function here answers with a value or with `CANCELLED` -- a person pressing Ctrl-C --
 * which the caller turns into a clean exit rather than a stack trace. None of them is ever
 * reached in agent mode: `RuntimeMode.prompts` is false there, and the handlers check it
 * before asking, because a prompt written into an agent's pipe is a process that never ends.
 *
 * The lines written onto Clack's rail between the questions -- the intro, a note, an erratum,
 * the end -- are here too, so the rail has one author and its symbols stay Clack's own.
 */

import { styleText } from "node:util";
import { TextPrompt } from "@clack/core";
import {
  confirm,
  intro,
  isCancel,
  log,
  outro,
  S_BAR,
  S_BAR_END,
  S_ERROR,
  S_STEP_CANCEL,
  select,
  spinner,
  symbol,
  text,
} from "@clack/prompts";
import type { FlagSpec } from "../services/input.ts";
import type { Failure } from "../services/output.ts";
import { toned } from "../services/typeset.ts";
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

const CODE_LENGTH = 6;
/** What a mail client or a person puts between the digits: spaces and dashes. */
const CODE_SEPARATORS = /[\s-]/gu;
const NOT_A_DIGIT = /\D/gu;
const WHOLE_CODE = /^\d{6}$/u;

function codeOf(typed: string): string {
  return typed.replace(CODE_SEPARATORS, "");
}

/** The six cells, in ASCII like the rest of the page, the next one to fill marked `_`. */
function codeCells(digits: string): string[] {
  const edge = `+${"---+".repeat(CODE_LENGTH)}`;
  const faces = Array.from({ length: CODE_LENGTH }, (_, index) => {
    const digit = digits.charAt(index);
    if (digit !== "") {
      return ` ${digit} `;
    }
    return index === digits.length ? " _ " : "   ";
  });
  return [edge, `|${faces.join("|")}|`, edge];
}

/**
 * The emailed code, one digit to a cell.
 *
 * A pasted code fills every cell at once, with any spaces or dashes in it dropped. Enter only
 * submits six digits; anything else is refused in place, so a person fixes it without the
 * code being spent on a request the server would reject. Once submitted it is masked, so the
 * code does not stay readable in the terminal's scrollback.
 */
export async function askCode(ctx: Context): Promise<Answer<string>> {
  const { t } = ctx;
  const prompt: TextPrompt = new TextPrompt({
    ...streams(ctx),
    validate: (value) => (WHOLE_CODE.test(codeOf(value ?? "")) ? undefined : t("login.codeShape")),
    render: (): string => codeFrame(ctx, prompt),
  });
  const answer = await prompt.prompt();
  return isCancel(answer) || answer === undefined ? CANCELLED : codeOf(answer);
}

function railed(bar: string, rows: readonly string[]): string {
  return rows.map((row) => `${bar}  ${row}`).join("\n");
}

/** One frame of the code prompt, drawn the way Clack draws its own text prompt. */
function codeFrame(
  ctx: Context,
  prompt: Pick<TextPrompt, "state" | "userInput" | "error">,
): string {
  const title = `${styleText("gray", S_BAR)}\n${symbol(prompt.state)}  ${ctx.t("prompt.code")}\n`;
  const digits = prompt.userInput.replace(NOT_A_DIGIT, "").slice(0, CODE_LENGTH);
  switch (prompt.state) {
    case "submit":
      return `${title}${styleText("gray", S_BAR)}  ${styleText("dim", "*".repeat(CODE_LENGTH))}`;
    case "cancel":
      return `${title}${styleText("gray", S_BAR)}`;
    case "error":
      return `${title}${railed(styleText("yellow", S_BAR), codeCells(digits))}\n${styleText("yellow", S_BAR_END)}  ${styleText("yellow", prompt.error)}\n`;
    default:
      return `${title}${railed(styleText("cyan", S_BAR), [...codeCells(digits), styleText("dim", ctx.t("login.pasteHint"))])}\n${styleText("cyan", S_BAR_END)}\n`;
  }
}

/** The rail's first line. */
export function railIntro(ctx: Context, title: string): void {
  intro(title, { output: ctx.stdout });
}

/** A line of news between two questions. */
export function railNote(ctx: Context, message: string): void {
  log.info(message, { output: ctx.stdout });
}

/** A failure on the rail: the erratum's label in red, the code beside it, its sentence under. */
export function railErratum(ctx: Context, error: Failure): void {
  const { color } = ctx.mode;
  log.message([`${toned(ctx.t("page.erratum"), "red", color)}  ${error.code}`, error.message], {
    symbol: toned(S_ERROR, "red", color),
    output: ctx.stdout,
  });
}

/** The rail's last line, with a sentence. */
export function railOutro(ctx: Context, message: string): void {
  outro(message, { output: ctx.stdout });
}

/** The rail's last line, when there is nothing more to say. */
export function railEnd(ctx: Context): void {
  ctx.stdout.write(`${styleText("gray", S_BAR_END)}\n`);
}

/** The rail's last line after Ctrl-C: dim, not red, because the person chose it. */
export function railCancelled(ctx: Context): void {
  const { color } = ctx.mode;
  ctx.stdout.write(
    `${toned(S_STEP_CANCEL, "dim", color)}  ${toned(ctx.t("error.CANCELLED"), "dim", color)}\n`,
  );
}

/** `work`, with a spinner on the rail until it settles; the spinner leaves no line behind. */
export async function whileWaiting<T>(ctx: Context, message: string, work: Promise<T>): Promise<T> {
  // No guide: Clack would draw a bar above the spinner that `clear` leaves behind.
  const indicator = spinner({ output: ctx.stdout, withGuide: false });
  indicator.start(message);
  try {
    return await work;
  } finally {
    indicator.clear();
  }
}
