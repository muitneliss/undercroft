/**
 * The setup wizard's composition root, and the only module that touches the process.
 *
 * It alone reads argv, the environment and the platform, takes the global `fetch` and a real
 * clock, builds the one `Installation` every command drives, and calls `process.exit` once
 * (`layering.md`). Everything below receives those as a `Context`.
 *
 * It ships as one binary per platform (`scripts/build.ts`, `bun build --compile`), so a person
 * needs neither Bun nor Node: double-clicking it on Windows opens a console with the wizard in
 * it, and `deploy/install/install.sh` downloads and runs it on macOS and Linux. ADR 0095.
 */

import { homedir } from "node:os";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { systemClock } from "@undercroft/core";
import { DEFAULT_LOCALE, type Locale } from "@undercroft/core/locale";
import {
  type Arch,
  defaultInstallDir,
  installation,
  type Platform,
  processRunner,
} from "@undercroft/setup";
import pkg from "../package.json" with { type: "json" };
import type { Context, Exit } from "./handlers/context.ts";
import { dispatch } from "./handlers/dispatch.ts";
import { messages } from "./i18n/index.ts";
import { type Invocation, parseInvocation } from "./services/options.ts";

const release = `v${pkg.version}`;
const argv = process.argv.slice(2);
const parsed = parseInvocation(argv);

function localeOf(lang: string | undefined): Locale {
  return lang === "en" || lang === "vi" ? lang : DEFAULT_LOCALE;
}

const platform: Platform =
  process.platform === "win32" || process.platform === "darwin" ? process.platform : "linux";
const arch: Arch = process.arch === "arm64" ? "arm64" : "x64";

/**
 * Where an install lives when `--dir` does not say. The setup package decides, so the desktop
 * app finds the same install this wizard wrote (ADR 0097).
 */
function defaultDir(): string {
  return defaultInstallDir(platform, {
    home: homedir(),
    localAppData: process.env.LOCALAPPDATA,
  });
}

/** The context for this run, worded in `locale`; `relocale` builds the next one. */
function contextFor(invocation: Invocation, dir: string, locale: Locale): Context {
  return {
    t: messages(locale),
    locale,
    interactive:
      !invocation.flags.yes && process.stdin.isTTY === true && process.stdout.isTTY === true,
    invocation,
    install: installation({ dir, run: processRunner, fetch: globalThis.fetch, clock: systemClock }),
    dir,
    run: processRunner,
    clock: systemClock,
    platform,
    arch,
    release,
    relocale: (chosen) => contextFor(invocation, dir, chosen),
  };
}

async function main(): Promise<Exit> {
  if (!parsed.ok) {
    process.stderr.write(
      `${messages(DEFAULT_LOCALE)("badInvocation", { detail: parsed.detail })}\n`,
    );
    return 1;
  }
  const { flags } = parsed.invocation;
  const locale = localeOf(flags.lang);
  if (flags.version) {
    process.stdout.write(`${release}\n`);
    return 0;
  }
  if (flags.help) {
    process.stdout.write(`${messages(locale)("help")}\n`);
    return 0;
  }
  const ctx = contextFor(parsed.invocation, flags.dir ?? defaultDir(), locale);
  const exit = await dispatch(ctx);
  if (platform === "win32" && argv.length === 0 && ctx.interactive) {
    await holdWindow(ctx);
  }
  return exit;
}

/**
 * Double-clicked on Windows, the installer runs in a console window that closes the moment the
 * process exits -- taking the URL, or the reason it failed, with it. So it waits for Enter.
 */
async function holdWindow(ctx: Context): Promise<void> {
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  await reader.question(`${ctx.t("pressEnter")}\n`);
  reader.close();
}

process.exit(await main());
