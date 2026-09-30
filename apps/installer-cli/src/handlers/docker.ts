/**
 * Getting Docker ready, with a person's consent at each step that changes their machine.
 *
 * Installing Docker needs an administrator and a licence agreement, so it is offered, shown
 * as the exact command, and run in the person's own terminal; nothing is installed under
 * `--yes`. Each state `detectDocker` can report has its own next step, and a state no command
 * of ours can fix -- a Linux user outside the `docker` group, a missing Compose plugin -- ends
 * the run with the fix in words rather than an attempt.
 */

import { log } from "@clack/prompts";
import {
  type DockerState,
  detectDocker,
  dockerInstallPlan,
  hasBrew,
  installDocker,
} from "@undercroft/setup";
import type { Context } from "./context.ts";
import { progress } from "./progress.ts";
import { yes } from "./prompts.ts";

const POLL_MS = 3000;
/** Docker Desktop's first start, which unpacks its VM, takes a minute or two. */
const START_TIMEOUT_MS = 300_000;

async function checked(ctx: Context): Promise<DockerState> {
  const shown = progress(ctx);
  shown.start(ctx.t("docker.checking"));
  const state = await detectDocker(ctx.run);
  shown.clear();
  return state;
}

/** Wait for a daemon that was just installed or opened to answer. */
async function started(ctx: Context): Promise<DockerState> {
  const shown = progress(ctx);
  shown.start(ctx.t("docker.waiting"));
  const deadline = ctx.clock.now().getTime() + START_TIMEOUT_MS;
  let state = await detectDocker(ctx.run);
  while (state.state === "stopped" && ctx.clock.now().getTime() < deadline) {
    await ctx.clock.sleep(POLL_MS);
    state = await detectDocker(ctx.run);
  }
  shown.clear();
  return state;
}

async function plan(ctx: Context): Promise<ReturnType<typeof dockerInstallPlan>> {
  return dockerInstallPlan(ctx.platform, ctx.arch, {
    hasBrew: ctx.platform === "darwin" && (await hasBrew(ctx.run)),
  });
}

/** Offer to install Docker. The state afterwards, which is still the judge. */
async function offerInstall(ctx: Context): Promise<DockerState | null> {
  const chosen = await plan(ctx);
  log.warn(ctx.t("docker.missing"));
  if (ctx.platform !== "linux") {
    log.info(ctx.t("docker.licence"));
  }
  const command =
    chosen.install === null ? null : [chosen.install.command, ...chosen.install.args].join(" ");
  if (
    command !== null &&
    (await yes(ctx.t("docker.offerInstall", { command }))) &&
    (await installDocker(ctx.run, chosen))
  ) {
    return await started(ctx);
  }
  log.info(ctx.t("docker.installManual", { url: chosen.manualUrl }));
  return null;
}

async function offerStart(ctx: Context): Promise<DockerState | null> {
  const chosen = await plan(ctx);
  log.warn(ctx.t("docker.stopped"));
  if (chosen.start === null || !(await yes(ctx.t("docker.offerStart")))) {
    log.info(ctx.t("docker.startManual"));
    return null;
  }
  await ctx.run(chosen.start.command, chosen.start.args);
  return await started(ctx);
}

/** Whether Docker is ready to run the stack, having helped a person make it so. */
export async function ensureDocker(ctx: Context): Promise<boolean> {
  let state: DockerState | null = await checked(ctx);
  if (ctx.interactive && state.state === "missing") {
    state = await offerInstall(ctx);
  } else if (ctx.interactive && state.state === "stopped") {
    state = await offerStart(ctx);
  }
  switch (state?.state) {
    case "ready":
      log.success(ctx.t("docker.ready", { version: state.composeVersion }));
      return true;
    case "no-permission":
      log.error(ctx.t("docker.noPermission"));
      return false;
    case "no-compose":
      log.error(ctx.t("docker.noCompose"));
      return false;
    case "missing":
    case "stopped":
      log.error(ctx.t(ctx.interactive ? "docker.startManual" : "docker.notReady"));
      return false;
    default:
      // A plan a person declined or that failed; it has already said what to do instead.
      return false;
  }
}
