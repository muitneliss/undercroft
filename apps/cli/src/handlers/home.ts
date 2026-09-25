/**
 * `undercroft` on its own, at a terminal: the title page, or the contents page.
 *
 * Signed out, the title page is drawn and the sign-in form follows on it -- the home page and
 * the login are one screen -- and the contents page follows a successful sign-in. Signed in,
 * the contents page is all there is. With no server named at all, the title page lists the two
 * steps that come first, and asks nothing. `services/titlePage.ts` and `services/contentsPage.ts` draw; this decides which.
 *
 * Human mode only. `main.ts` routes a bare `undercroft` here only for a person at a terminal,
 * so an agent's run is untouched; an agent that names `home` itself gets UNKNOWN_COMMAND, as
 * for any command that is not on its surface, because this is not one.
 *
 * A session file is not evidence of a session. The server may have ended it -- a sign-out
 * elsewhere, an expiry -- so the contents page is drawn only after `session.me` answers, and
 * a session the server no longer knows is treated as what it is: signed out.
 */

import { topicSentence } from "../i18n/index.ts";
import { failure, success } from "../services/output.ts";
import { contentsPage } from "../services/contentsPage.ts";
import { CUT, type TitleFacts, titlePage } from "../services/titlePage.ts";
import type { PageStyle } from "../services/typeset.ts";
import { namesNoServer, type Target } from "../services/profiles.ts";
import { type Context, connect, loadConfig, type ParsedFlags, stringFlag } from "./context.ts";
import { drawn, type Noted, noted } from "./noted.ts";
import { callProcedure } from "./remote.ts";
import { signInAtTerminal } from "./terminalSignIn.ts";

/** How long each frame of the cut stays on screen. Stepped, never eased (ADR 0014). */
const FRAME_MS = 80;

function styleOf(ctx: Context): PageStyle {
  return { columns: ctx.columns, color: ctx.mode.color };
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The title page, cut into place frame by frame the first time a person meets it.
 *
 * Not under `--quiet` or on a CI runner, and not when the page is too narrow to carry the
 * mark -- the frames would then be identical, and redrawing them would only flicker.
 */
async function drawTitle(ctx: Context, facts: TitleFacts): Promise<void> {
  const style = styleOf(ctx);
  const still = titlePage(ctx.t, facts, style);
  const frames = CUT.map((_, frame) => titlePage(ctx.t, facts, style, frame));
  const cut =
    !ctx.mode.quiet && (ctx.env.CI ?? "") === "" && frames[0]?.join("\n") !== still.join("\n");
  if (!cut) {
    ctx.stdout.write(`${still.join("\n")}\n`);
    return;
  }
  for (const [index, lines] of frames.entries()) {
    if (index > 0) {
      await pause(FRAME_MS);
      // Back to the page's first line, then each line rewritten and cleared to its end.
      ctx.stdout.write(`\u001b[${lines.length}F`);
    }
    ctx.stdout.write(`${lines.map((line) => `${line}\u001b[K`).join("\n")}\n`);
  }
}

function drawContents(
  ctx: Context,
  target: Target,
  email: string,
  commands: readonly string[],
): void {
  const lines = contentsPage(
    ctx.t,
    {
      version: ctx.version,
      origin: target.origin,
      profile: target.profile,
      email,
      allowWrites: target.allowWrites,
      commands,
      sentence: (topic) => topicSentence(ctx.locale, topic),
    },
    styleOf(ctx),
  );
  ctx.stdout.write(`${lines.join("\n")}\n`);
}

function emailOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const email: unknown = Reflect.get(data, "email");
  return typeof email === "string" ? email : null;
}

export async function home(
  ctx: Context,
  flags: ParsedFlags,
  commands: () => readonly string[],
): Promise<Noted> {
  const { t } = ctx;
  if (ctx.mode.mode === "agent") {
    return noted(failure("UNKNOWN_COMMAND", t("error.UNKNOWN_COMMAND", { command: "home" })));
  }
  const facts = { version: ctx.version, locale: ctx.locale };
  const connected = connect(ctx, flags);
  if ("ok" in connected) {
    const config = loadConfig(ctx);
    const none =
      !("ok" in config) &&
      namesNoServer(t, {
        flags: { url: stringFlag(flags, "url"), profile: stringFlag(flags, "profile") },
        env: ctx.env,
        cwd: ctx.cwd,
        config,
      });
    if (!none) {
      return noted(connected);
    }
    await drawTitle(ctx, { ...facts, server: null, formFollows: false });
    return drawn(success({ signedIn: false, server: null }));
  }

  const { connection, credential, target } = connected;
  if (credential !== null) {
    const me = await callProcedure(t, connection, { path: "session.me", type: "query" }, undefined);
    if (me.ok) {
      drawContents(ctx, target, emailOf(me.data) ?? credential.email, commands());
      return drawn(success({ origin: target.origin, signedIn: true }));
    }
    if (me.error.code !== "AUTHENTICATION_REQUIRED") {
      return noted(me);
    }
  }

  const server = { origin: target.origin, profile: target.profile };
  await drawTitle(ctx, { ...facts, server, formFollows: ctx.mode.prompts });
  if (!ctx.mode.prompts) {
    return drawn(success({ origin: target.origin, signedIn: false }));
  }
  const signed = await signInAtTerminal(ctx, connection, undefined);
  if (signed.email !== null) {
    drawContents(ctx, target, signed.email, commands());
  }
  return signed.noted;
}
