/**
 * The commands that are about the CLI rather than a procedure: signing in and out, the
 * environment profiles, and `describe`.
 *
 * `auth logout` and `auth status` are `session.signOut` and `session.me` with the local half
 * added -- forgetting the stored session, reporting which server it belongs to. Both
 * procedures also exist as `session sign-out` and `session me`, because the command surface
 * mirrors the router one to one; these are the names a person looks for first.
 */

import type { Effect, JsonSchema } from "../manifest.ts";
import { forgetCredential, saveCredential } from "../services/credentials.ts";
import { failure, fromFailure, isFailure, success } from "../services/output.ts";
import { planProfileChange, resolveTarget, writeConfig } from "../services/profiles.ts";
import { type Context, connect, loadConfig, type ParsedFlags, stringFlag } from "./context.ts";
import { type Noted, noted } from "./noted.ts";
import { askText, CANCELLED } from "./prompts.ts";
import { callProcedure, requestCode, signIn } from "./remote.ts";
import { signInAtTerminal } from "./terminalSignIn.ts";

function missing(ctx: Context, names: string): Noted {
  return noted(
    failure("MISSING_REQUIRED_ARGUMENT", ctx.t("error.MISSING_REQUIRED_ARGUMENT", { names }), {
      missing: names.split(", "),
    }),
  );
}

async function valueOrAsk(
  ctx: Context,
  given: string | undefined,
  question: string,
): Promise<string | typeof CANCELLED | null> {
  if (given !== undefined) {
    return given;
  }
  return ctx.mode.prompts ? await askText(ctx, question) : null;
}

/**
 * Sign in with an emailed code: ask for one, then exchange it for a session.
 *
 * Two invocations in agent mode -- `--email` asks, `--email --code` signs in -- because the
 * code arrives in a person's mailbox, and waiting on stdin for it is what agent mode never
 * does. A person at a terminal is asked for each in turn instead, in `signInAtTerminal`.
 */
export async function authLogin(ctx: Context, flags: ParsedFlags): Promise<Noted> {
  const connected = connect(ctx, flags);
  if ("ok" in connected) {
    return noted(connected);
  }
  const { connection } = connected;
  const code = stringFlag(flags, "code");
  if (code === undefined && ctx.mode.prompts) {
    return (await signInAtTerminal(ctx, connection, stringFlag(flags, "email"))).noted;
  }
  const email = await valueOrAsk(ctx, stringFlag(flags, "email"), ctx.t("prompt.email"));
  if (email === CANCELLED) {
    return noted(failure("CANCELLED", ctx.t("error.CANCELLED")));
  }
  if (email === null) {
    return missing(ctx, "--email");
  }
  if (code === undefined) {
    const requested = await requestCode(ctx.t, connection, email);
    return noted(
      requested.ok ? success({ origin: connection.origin, email, codeRequested: true }) : requested,
      ctx.t("note.codeRequested", { email }),
    );
  }
  const signed = await signIn(ctx.t, connection, email, code.trim());
  if (!signed.ok) {
    return noted(signed);
  }
  const saved = saveCredential(ctx.t, ctx.home, connection.origin, {
    email,
    cookie: signed.cookie,
  });
  if (saved !== null) {
    return noted(fromFailure(saved));
  }
  return noted(
    success({ origin: connection.origin, email, signedIn: true }),
    ctx.t("note.signedIn", { origin: connection.origin, email }),
  );
}

/**
 * End the session on the server, then forget it here.
 *
 * In that order, and the local copy is kept if the server could not be reached: a session
 * forgotten here but alive there is one nobody can revoke from this machine any more. A
 * server that answers UNAUTHORIZED has already ended it, which is the outcome wanted.
 */
export async function authLogout(ctx: Context, flags: ParsedFlags): Promise<Noted> {
  const connected = connect(ctx, flags);
  if ("ok" in connected) {
    return noted(connected);
  }
  const { connection, credential } = connected;
  const note = ctx.t("note.signedOut", { origin: connection.origin });
  if (credential === null) {
    return noted(success({ origin: connection.origin, signedOut: false }), note);
  }
  const ended = await callProcedure(
    ctx.t,
    connection,
    { path: "session.signOut", type: "mutation" },
    undefined,
  );
  if (!ended.ok && ended.error.code !== "AUTHENTICATION_REQUIRED") {
    return noted(ended);
  }
  const forgotten = forgetCredential(ctx.t, ctx.home, connection.origin);
  if (forgotten !== null) {
    return noted(fromFailure(forgotten));
  }
  return noted(success({ origin: connection.origin, signedOut: true }), note);
}

/** Who the server says you are, or AUTHENTICATION_REQUIRED -- a probe an agent can branch on. */
export async function authStatus(ctx: Context, flags: ParsedFlags): Promise<Noted> {
  const connected = connect(ctx, flags);
  if ("ok" in connected) {
    return noted(connected);
  }
  const { connection, credential, target } = connected;
  if (credential === null) {
    return noted(
      failure(
        "AUTHENTICATION_REQUIRED",
        ctx.t("error.AUTHENTICATION_REQUIRED", { origin: connection.origin }),
      ),
    );
  }
  const me = await callProcedure(
    ctx.t,
    connection,
    { path: "session.me", type: "query" },
    undefined,
  );
  if (!me.ok) {
    return noted(me);
  }
  const session = typeof me.data === "object" && me.data !== null ? me.data : {};
  return noted(success({ origin: connection.origin, profile: target.profile, ...session }));
}

/** The effective environment and where each part of it came from. Never the session itself. */
export function configShow(ctx: Context, flags: ParsedFlags): Noted {
  const connected = connect(ctx, flags);
  if ("ok" in connected) {
    return noted(connected);
  }
  const { target, credential } = connected;
  return noted(
    success({
      home: ctx.home,
      profile: target.profile,
      profileSource: target.profileSource,
      projectFile: target.projectFile,
      url: target.url,
      urlSource: target.urlSource,
      origin: target.origin,
      allowWrites: target.allowWrites,
      signedIn: credential !== null,
      email: credential?.email ?? null,
    }),
  );
}

/** `--allow-writes`, `--no-allow-writes`, or neither -- three answers, not two. */
function triState(flags: ParsedFlags, name: string): boolean | undefined {
  const value = flags[name];
  return typeof value === "boolean" ? value : undefined;
}

export function configSetProfile(ctx: Context, flags: ParsedFlags, name: string): Noted {
  const config = loadConfig(ctx);
  if ("ok" in config) {
    return noted(config);
  }
  const planned = planProfileChange(ctx.t, {
    config,
    name,
    change: { url: stringFlag(flags, "url"), allowWrites: triState(flags, "allow-writes") },
    mode: ctx.mode.mode,
  });
  if (isFailure(planned)) {
    return noted(fromFailure(planned));
  }
  writeConfig(ctx.home, planned);
  const written = planned.profiles[name];
  return noted(
    success({
      profile: name,
      url: written?.url ?? null,
      allowWrites: written?.allowWrites ?? false,
      default: planned.defaultProfile === name,
    }),
  );
}

export function configUse(ctx: Context, name: string): Noted {
  const config = loadConfig(ctx);
  if ("ok" in config) {
    return noted(config);
  }
  if (config.profiles[name] === undefined) {
    return noted(failure("CONFIG_REQUIRED", ctx.t("error.unknownProfile", { profile: name })));
  }
  writeConfig(ctx.home, { ...config, defaultProfile: name });
  const target = resolveTarget(ctx.t, { flags: { profile: name }, env: {}, cwd: ctx.cwd, config });
  return noted(success({ defaultProfile: name, url: isFailure(target) ? null : target.url }));
}

/** One line of `describe`: a command, the procedure behind it, and what it does. */
export interface Described {
  readonly command: string;
  readonly procedure: string | null;
  readonly type: "query" | "mutation" | "local";
  readonly effect: Effect | "local";
  readonly description: string;
  readonly flags: readonly string[];
  readonly input: JsonSchema | null;
}

function matches(entry: Described, asked: string): boolean {
  return (
    entry.procedure === asked ||
    entry.command === asked ||
    entry.command === asked.replaceAll(":", " ")
  );
}

/**
 * Every command, or one in full.
 *
 * The list omits the schemas so it stays readable at a glance; one command's entry carries
 * its input's JSON Schema -- the router's own, extracted at build time -- which is what an
 * agent should read before it calls something unfamiliar.
 */
export function describeCommands(
  ctx: Context,
  catalogue: readonly Described[],
  words: readonly string[],
): Noted {
  if (words.length === 0) {
    return noted(
      success(
        catalogue.map(({ command, procedure, type, effect, description }) => ({
          command,
          procedure,
          type,
          effect,
          description,
        })),
      ),
    );
  }
  const asked = words.join(" ");
  const entry = catalogue.find((candidate) => matches(candidate, asked));
  return noted(
    entry === undefined
      ? failure("UNKNOWN_COMMAND", ctx.t("error.UNKNOWN_COMMAND", { command: asked }))
      : success(entry),
  );
}
