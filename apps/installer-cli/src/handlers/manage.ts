/**
 * The commands that act on an existing install: `down`, `status`, `logs`, `update`, `uninstall`.
 * Each refuses with the same sentence when the folder holds no install, rather than letting
 * Docker say something about a compose file it cannot find.
 */

import { log } from "@clack/prompts";
import type { Answers } from "@undercroft/setup";
import type { Context, Exit } from "./context.ts";
import { ensureDocker } from "./docker.ts";
import { restart } from "./launch.ts";
import { yes } from "./prompts.ts";

async function existing(ctx: Context): Promise<Answers | null> {
  const answers = await ctx.install.read();
  if (answers === null) {
    log.error(ctx.t("noInstall", { dir: ctx.dir }));
  }
  return answers;
}

function stepped(
  ctx: Context,
  result: { readonly ok: boolean; readonly tail?: string },
  done: string,
): Exit {
  if (result.ok) {
    log.success(done);
    return 0;
  }
  log.error(ctx.t("stepFailed"));
  log.message(result.tail ?? "");
  return 1;
}

export async function down(ctx: Context): Promise<Exit> {
  if ((await existing(ctx)) === null) {
    return 1;
  }
  return stepped(ctx, await ctx.install.down(), ctx.t("down.done"));
}

export async function status(ctx: Context): Promise<Exit> {
  if ((await existing(ctx)) === null) {
    return 1;
  }
  const services = await ctx.install.status();
  if (services === null) {
    log.error(ctx.t("status.unknown"));
    return 1;
  }
  if (services.length === 0) {
    log.info(ctx.t("status.none"));
    return 0;
  }
  log.message(
    services.map((service) =>
      ctx.t("status.row", {
        service: service.service,
        state: service.health === "" ? service.state : `${service.state} (${service.health})`,
      }),
    ),
  );
  return 0;
}

export async function logs(ctx: Context): Promise<Exit> {
  if ((await existing(ctx)) === null) {
    return 1;
  }
  const result = await ctx.install.logs(ctx.invocation.operands[0] ?? null);
  return result.ok ? 0 : 1;
}

/** Move the install to this installer's release, or to `--tag`, and start it there. */
export async function update(ctx: Context): Promise<Exit> {
  const answers = await existing(ctx);
  if (answers === null || !(await ensureDocker(ctx))) {
    return 1;
  }
  return await restart(ctx, answers, ctx.invocation.flags.tag ?? ctx.release);
}

/**
 * Also the way out of `orphaned-data`: with no install here, it removes the volumes an earlier
 * one left behind, which is what the refusal tells a person to run.
 */
export async function uninstall(ctx: Context): Promise<Exit> {
  const keepData = ctx.invocation.flags["keep-data"];
  if (keepData && (await existing(ctx)) === null) {
    return 1;
  }
  if (ctx.interactive) {
    if (!(await yes(ctx.t(keepData ? "uninstall.confirmKeep" : "uninstall.confirmAll"), false))) {
      return 1;
    }
  } else if (!ctx.invocation.flags.yes) {
    log.error(ctx.t("uninstall.needsYes"));
    return 1;
  }
  const result = await ctx.install.uninstall({ keepData });
  return stepped(
    ctx,
    result,
    keepData ? ctx.t("uninstall.doneKeep", { dir: ctx.dir }) : ctx.t("uninstall.doneAll"),
  );
}
