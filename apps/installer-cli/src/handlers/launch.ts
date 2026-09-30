/**
 * From answers to a running Undercroft: write the folder, pull, start, wait, and say where it
 * is. Shared by the wizard, `--yes`, `update`, and starting an existing install, which differ
 * only in how they arrived at the answers.
 */

import { join } from "node:path";
import { log, note } from "@clack/prompts";
import { type Answers, ENV_FILE, installUrl, type StepResult } from "@undercroft/setup";
import type { CliProblem } from "../services/options.ts";
import type { Context, Exit } from "./context.ts";
import { progress } from "./progress.ts";

/** How long a first start may take before the wizard stops waiting and points at the log. */
const HEALTH_TIMEOUT_MS = 600_000;
const MS_PER_MINUTE = 60_000;
/** Wide enough for a pull's progress line, narrow enough not to wrap Clack's spinner. */
const PROGRESS_WIDTH = 70;

export function reportProblems(ctx: Context, problems: readonly CliProblem[]): void {
  for (const problem of problems) {
    log.error(ctx.t(`problem.${problem.code}`, { field: ctx.t(`field.${problem.field}`) }));
  }
}

export function summarise(ctx: Context, answers: Answers): string {
  return ctx.t("install.summary", {
    mode: ctx.t(`mode.name.${answers.mode}`),
    dir: ctx.dir,
    url: installUrl(answers),
    tag: answers.imageTag,
  });
}

/** Run one compose step behind a progress line that shows the latest line Docker printed. */
async function withProgress(
  ctx: Context,
  labels: {
    readonly doing: "install.pulling" | "install.starting";
    readonly done: "install.pulled" | "install.started";
  },
  work: (onLine: (line: string) => void) => Promise<StepResult>,
): Promise<boolean> {
  const shown = progress(ctx);
  shown.start(ctx.t(labels.doing));
  const result = await work((line) => {
    const trimmed = line.trim();
    if (trimmed !== "") {
      shown.message(`${ctx.t(labels.doing)} ${trimmed.slice(0, PROGRESS_WIDTH)}`);
    }
  });
  if (result.ok) {
    shown.stop(ctx.t(labels.done));
    return true;
  }
  shown.error(ctx.t("stepFailed"));
  log.message(result.tail);
  return false;
}

function redirects(ctx: Context, answers: Answers, url: string): string[] {
  return [
    ...(answers.mode === "server" && answers.signIn.kind === "google"
      ? [ctx.t("redirect.googleSignIn", { uri: `${url}/api/auth/callback/google` })]
      : []),
    ...(answers.connectors.googleIngest === null
      ? []
      : [ctx.t("redirect.googleIngest", { uri: `${url}/oauth/google/callback` })]),
    ...(answers.connectors.xero === null
      ? []
      : [ctx.t("redirect.xero", { uri: `${url}/oauth/xero/callback` })]),
  ];
}

async function announce(ctx: Context, answers: Answers, url: string): Promise<void> {
  if (answers.mode === "desktop") {
    log.success(ctx.t("done.desktop", { url }));
    // The CLI signs in on this machine too, at this exact origin (ADR 0096).
    log.info(ctx.t("done.cli", { url }));
    if (ctx.invocation.flags.open) {
      await openBrowser(ctx, url);
    }
  } else {
    const port = String(answers.port);
    log.success(ctx.t("done.server", { bind: answers.bind, port }));
    log.info(ctx.t("done.proxy", { bind: answers.bind, port, url }));
    log.info(ctx.t("done.admin", { email: answers.adminEmail, url }));
  }
  const uris = redirects(ctx, answers, url);
  if (uris.length > 0) {
    note(uris.join("\n"), ctx.t("done.redirects"));
  }
  log.warn(ctx.t("done.backup", { env: join(ctx.dir, ENV_FILE) }));
}

/**
 * Open the install in the person's browser, at exactly the public URL: Better Auth trusts that
 * origin alone, so opening `127.0.0.1` against a `localhost` install would refuse the owner's
 * sign-in (ADR 0094). A browser that does not open is not a failure; the URL is printed above.
 */
async function openBrowser(ctx: Context, url: string): Promise<void> {
  switch (ctx.platform) {
    case "darwin":
      await ctx.run("open", [url]);
      return;
    case "win32":
      await ctx.run("cmd", ["/c", "start", "", url]);
      return;
    default:
      await ctx.run("xdg-open", [url]);
  }
}

/** Write, pull when asked, start, wait until the control plane answers, and say where it is. */
export async function launch(
  ctx: Context,
  answers: Answers,
  options: { readonly pull: boolean },
): Promise<Exit> {
  const written = await ctx.install.write(answers);
  if (!written.ok) {
    if (written.reason === "invalid") {
      reportProblems(ctx, written.problems);
    } else {
      log.error(ctx.t("install.orphaned", { volume: written.volume, dir: ctx.dir }));
    }
    return 1;
  }
  log.step(ctx.t("install.written", { dir: ctx.dir }));
  const pulling = { doing: "install.pulling", done: "install.pulled" } as const;
  if (options.pull && !(await withProgress(ctx, pulling, (onLine) => ctx.install.pull(onLine)))) {
    return 1;
  }
  const starting = { doing: "install.starting", done: "install.started" } as const;
  if (!(await withProgress(ctx, starting, (onLine) => ctx.install.up(onLine)))) {
    return 1;
  }
  const waiting = progress(ctx);
  waiting.start(ctx.t("install.waiting"));
  const health = await ctx.install.waitHealthy(HEALTH_TIMEOUT_MS);
  if (!health.ok) {
    waiting.error(
      ctx.t("install.unhealthy", {
        minutes: String(HEALTH_TIMEOUT_MS / MS_PER_MINUTE),
        error: health.lastError,
      }),
    );
    return 1;
  }
  waiting.clear();
  await announce(ctx, answers, written.url);
  return 0;
}

/**
 * Start an existing install at `imageTag`. Every write lays down THIS installer's compose file,
 * so an install is moved to the release the images and the file share; a start that kept an
 * older tag would run old images under a newer file. The move is said out loud when it happens.
 */
export async function restart(ctx: Context, existing: Answers, imageTag: string): Promise<Exit> {
  const moving = existing.imageTag !== imageTag;
  if (moving) {
    log.info(ctx.t("update.summary", { dir: ctx.dir, from: existing.imageTag, to: imageTag }));
  }
  return await launch(ctx, { ...existing, imageTag }, { pull: moving });
}
