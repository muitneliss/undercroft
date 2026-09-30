/**
 * `up`, the default command: install, or start what is installed.
 *
 * With a person at the terminal it is the wizard -- language, then an existing install's
 * choice, then mode, Docker, settings, connectors, and a confirmation before anything is
 * written. Under `--yes`, or with no terminal, the flags are the answers, laid over the existing
 * install's, and nothing is asked (`answersFromFlags`).
 *
 * Either way the questions only gather answers; `launch` is the one path that acts on them.
 */

import { intro, log, outro } from "@clack/prompts";
import type { Locale } from "@undercroft/core/locale";
import {
  type Answers,
  type Connectors,
  installUrl,
  type OAuthClient,
  type SignIn,
  validateAnswers,
} from "@undercroft/setup";
import { answersFromFlags, portOf } from "../services/options.ts";
import type { Context, Exit } from "./context.ts";
import { ensureDocker } from "./docker.ts";
import { launch, reportProblems, restart, summarise } from "./launch.ts";
import { ask, askSecret, choose, chooseMany, yes } from "./prompts.ts";

async function askLanguage(ctx: Context): Promise<Context> {
  const locale = await choose<Locale>(
    ctx.t("language.question"),
    [
      { value: "vi", label: "Tiếng Việt" },
      { value: "en", label: "English" },
    ],
    ctx.locale,
  );
  return ctx.relocale(locale);
}

async function askClient(
  ctx: Context,
  name: string,
  current: OAuthClient | null,
): Promise<OAuthClient> {
  return {
    clientId: await ask(ctx, ctx.t("connectors.clientId", { name }), current?.clientId ?? ""),
    clientSecret: await askSecret(
      ctx,
      ctx.t("connectors.clientSecret", { name }),
      current?.clientSecret ?? "",
    ),
  };
}

async function askConnectors(ctx: Context, current: Connectors): Promise<Connectors> {
  type Source = "googleIngest" | "xero";
  const chosen = await chooseMany<Source>(
    ctx.t("connectors.question"),
    [
      {
        value: "googleIngest",
        label: ctx.t("connectors.googleIngest"),
        hint: ctx.t("connectors.hint"),
      },
      { value: "xero", label: ctx.t("connectors.xero") },
    ],
    (["googleIngest", "xero"] as const).filter((source) => current[source] !== null),
  );
  return {
    googleIngest: chosen.includes("googleIngest")
      ? await askClient(ctx, ctx.t("connectors.googleIngest"), current.googleIngest)
      : null,
    xero: chosen.includes("xero")
      ? await askClient(ctx, ctx.t("connectors.xero"), current.xero)
      : null,
  };
}

async function askSignIn(ctx: Context, current: SignIn): Promise<SignIn> {
  const kind = await choose<SignIn["kind"]>(
    ctx.t("settings.signIn"),
    [
      { value: "email", label: ctx.t("settings.signInEmail") },
      { value: "google", label: ctx.t("settings.signInGoogle") },
    ],
    current.kind,
  );
  if (kind === "email") {
    const email = current.kind === "email" ? current : null;
    return {
      kind,
      apiKey: await askSecret(ctx, ctx.t("settings.emailApiKey"), email?.apiKey ?? ""),
      from: await ask(ctx, ctx.t("settings.emailFrom"), email?.from ?? ""),
    };
  }
  const google = current.kind === "google" ? current : null;
  return {
    kind,
    clientId: await ask(ctx, ctx.t("settings.googleClientId"), google?.clientId ?? ""),
    clientSecret: await askSecret(
      ctx,
      ctx.t("settings.googleClientSecret"),
      google?.clientSecret ?? "",
    ),
  };
}

/** Every answer, asked with `seed`'s value offered, so a re-run changes only what it must. */
async function askAnswers(ctx: Context, seed: Answers): Promise<Answers> {
  const port = portOf(await ask(ctx, ctx.t("settings.port"), String(seed.port)));
  if (seed.mode === "desktop") {
    return { ...seed, port, connectors: await askConnectors(ctx, seed.connectors) };
  }
  const publicUrl = await ask(ctx, ctx.t("settings.publicUrl"), seed.publicUrl);
  const adminEmail = await ask(ctx, ctx.t("settings.adminEmail"), seed.adminEmail);
  const signIn = await askSignIn(ctx, seed.signIn);
  const bind = await ask(ctx, ctx.t("settings.bind"), seed.bind);
  const connectors = await askConnectors(ctx, seed.connectors);
  return { ...seed, port, publicUrl, adminEmail, signIn, bind, connectors };
}

/** The answers the flags and the existing install give, for the mode a person picks. */
function seeded(ctx: Context, existing: Answers | null, mode: Answers["mode"]): Answers {
  const { flags } = ctx.invocation;
  return answersFromFlags({ ...flags, mode }, existing, ctx.release).answers;
}

async function wizard(start: Context): Promise<Exit> {
  intro(start.t("intro", { version: start.release }));
  const ctx = start.invocation.flags.lang === undefined ? await askLanguage(start) : start;
  const existing = await ctx.install.read();
  if (existing !== null) {
    log.info(ctx.t("existing.found", { dir: ctx.dir, url: installUrl(existing) }));
    const action = await choose(ctx.t("existing.question"), [
      { value: "start", label: ctx.t("existing.start") },
      { value: "reconfigure", label: ctx.t("existing.reconfigure") },
    ]);
    if (action === "start") {
      return (await ensureDocker(ctx)) ? finish(ctx, await restart(ctx, existing, ctx.release)) : 1;
    }
  }
  const mode = await choose<Answers["mode"]>(
    ctx.t("mode.question"),
    [
      { value: "desktop", label: ctx.t("mode.desktop"), hint: ctx.t("mode.desktopHint") },
      { value: "server", label: ctx.t("mode.server"), hint: ctx.t("mode.serverHint") },
    ],
    existing?.mode ?? (ctx.invocation.flags.mode === "server" ? "server" : "desktop"),
  );
  if (!(await ensureDocker(ctx))) {
    return 1;
  }
  const answers = await askUntilValid(ctx, seeded(ctx, existing, mode));
  log.info(summarise(ctx, answers));
  if (ctx.invocation.flags["dry-run"]) {
    log.info(ctx.t("install.dryRun"));
    return 0;
  }
  if (!(await yes(ctx.t("install.confirm")))) {
    return 1;
  }
  return finish(ctx, await launch(ctx, answers, { pull: true }));
}

function finish(ctx: Context, exit: Exit): Exit {
  if (exit === 0) {
    outro(ctx.t("outro"));
  }
  return exit;
}

/** Ask until the answers can run, saying what is wrong each time round. */
async function askUntilValid(ctx: Context, seed: Answers): Promise<Answers> {
  let answers = await askAnswers(ctx, seed);
  let problems = validateAnswers(answers);
  while (problems.length > 0) {
    reportProblems(ctx, problems);
    answers = await askAnswers(ctx, answers);
    problems = validateAnswers(answers);
  }
  return answers;
}

async function unattended(ctx: Context): Promise<Exit> {
  const existing = await ctx.install.read();
  const { answers, problems } = answersFromFlags(ctx.invocation.flags, existing, ctx.release);
  if (problems.length > 0) {
    reportProblems(ctx, problems);
    return 1;
  }
  log.info(summarise(ctx, answers));
  if (ctx.invocation.flags["dry-run"]) {
    log.info(ctx.t("install.dryRun"));
    return 0;
  }
  if (!(await ensureDocker(ctx))) {
    return 1;
  }
  return await launch(ctx, answers, {
    pull: existing === null || existing.imageTag !== answers.imageTag,
  });
}

export async function up(ctx: Context): Promise<Exit> {
  return ctx.interactive ? await wizard(ctx) : await unattended(ctx);
}
