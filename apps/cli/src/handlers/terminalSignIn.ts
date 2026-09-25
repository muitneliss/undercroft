/**
 * Signing in at a terminal: one run, one step at a time, on Clack's rail.
 *
 * Agent mode signs in with two invocations (`handlers/local.ts`, `authLogin`), because the
 * code arrives in a person's mailbox and agent mode never waits on stdin. A person at a
 * terminal is asked for each thing in turn instead, and a rejected code does not end the run:
 * they are offered a fresh code, another address, or quitting. A mistyped digit is the usual
 * cause, and sending someone back to the shell to start over is the worst answer to it.
 *
 * Each step names the next explicitly (`Step`), so the loop has one owner of where it stands.
 * Every line it says is on the rail, so what it answers is `drawn`.
 *
 * The code-sent line keeps the server's neutrality -- "if ... has access" -- because the
 * server answers the same whether or not the address may sign in, and the CLI must not undo
 * that.
 */

import { saveCredential } from "../services/credentials.ts";
import { failure, fromFailure, type Refusal, success } from "../services/output.ts";
import type { Context } from "./context.ts";
import { drawn, type Noted } from "./noted.ts";
import {
  askChoice,
  askCode,
  askText,
  CANCELLED,
  railCancelled,
  railEnd,
  railErratum,
  railIntro,
  railNote,
  railOutro,
  whileWaiting,
} from "./prompts.ts";
import { type Connection, requestCode, signIn } from "./remote.ts";

export interface SignedAtTerminal {
  readonly noted: Noted;
  /** The address now signed in, or `null` when the person did not get in. */
  readonly email: string | null;
}

type Step =
  | { readonly kind: "email" }
  | { readonly kind: "request"; readonly email: string }
  | { readonly kind: "code"; readonly email: string }
  | { readonly kind: "done"; readonly result: SignedAtTerminal };

function done(noted: Noted, email: string | null = null): Step {
  return { kind: "done", result: { noted, email } };
}

function cancelled(ctx: Context): Step {
  railCancelled(ctx);
  return done(drawn(failure("CANCELLED", ctx.t("error.CANCELLED"))));
}

function refused(ctx: Context, refusal: Refusal): Step {
  railErratum(ctx, refusal.error);
  railEnd(ctx);
  return done(drawn(refusal));
}

async function askEmail(ctx: Context): Promise<Step> {
  const answer = await askText(ctx, ctx.t("prompt.email"));
  return answer === CANCELLED ? cancelled(ctx) : { kind: "request", email: answer.trim() };
}

async function sendCode(ctx: Context, connection: Connection, email: string): Promise<Step> {
  const requested = await requestCode(ctx.t, connection, email);
  if (!requested.ok) {
    return refused(ctx, requested);
  }
  railNote(ctx, ctx.t("login.codeSent", { email }));
  return { kind: "code", email };
}

/** After a rejected code: the person chooses what happens next. */
async function afterRejection(ctx: Context, email: string, rejection: Refusal): Promise<Step> {
  const { t } = ctx;
  railErratum(ctx, rejection.error);
  const next = await askChoice(ctx, t("login.next"), [
    { value: "resend", label: t("login.resend", { email }) },
    { value: "email", label: t("login.otherEmail") },
    { value: "quit", label: t("login.quit") },
  ]);
  if (next === CANCELLED) {
    return cancelled(ctx);
  }
  if (next === "quit") {
    railEnd(ctx);
    return done(drawn(rejection));
  }
  return next === "resend" ? { kind: "request", email } : { kind: "email" };
}

async function tryCode(ctx: Context, connection: Connection, email: string): Promise<Step> {
  const { t } = ctx;
  const code = await askCode(ctx);
  if (code === CANCELLED) {
    return cancelled(ctx);
  }
  const signed = await whileWaiting(ctx, t("login.checking"), signIn(t, connection, email, code));
  if (!signed.ok) {
    return signed.error.code === "AUTHENTICATION_REQUIRED"
      ? await afterRejection(ctx, email, signed)
      : refused(ctx, signed);
  }
  const saved = saveCredential(t, ctx.home, connection.origin, { email, cookie: signed.cookie });
  if (saved !== null) {
    return refused(ctx, fromFailure(saved));
  }
  railOutro(ctx, t("note.signedIn", { origin: connection.origin, email }));
  return done(drawn(success({ origin: connection.origin, email, signedIn: true })), email);
}

function advance(ctx: Context, connection: Connection, step: Step): Promise<Step> {
  switch (step.kind) {
    case "email":
      return askEmail(ctx);
    case "request":
      return sendCode(ctx, connection, step.email);
    case "code":
      return tryCode(ctx, connection, step.email);
    default:
      return Promise.resolve(step);
  }
}

/** Sign in, starting from the address when `--email` gave one. */
export async function signInAtTerminal(
  ctx: Context,
  connection: Connection,
  given: string | undefined,
): Promise<SignedAtTerminal> {
  railIntro(ctx, ctx.t("login.intro", { origin: connection.origin }));
  let step: Step = given === undefined ? { kind: "email" } : { kind: "request", email: given };
  while (step.kind !== "done") {
    step = await advance(ctx, connection, step);
  }
  return step.result;
}
