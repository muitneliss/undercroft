/**
 * The CLI's composition root, and the only module that touches the process.
 *
 * It alone reads argv, the environment and the standard streams, takes the global `fetch`,
 * and calls `process.exit` -- once, after the one outcome of this invocation has been written
 * (`layering.md`). Everything below it receives those as a `Context`.
 *
 * ## One file, and oclif loads it twice
 *
 * The CLI ships as a single bundled ES module (`scripts/build.ts`), and oclif's explicit
 * discovery strategy finds its commands by importing a TARGET file and reading an export.
 * The target here is this bundle itself: `COMMANDS` and `commandNotFound` are exported from
 * it, and oclif's `import()` of the file it is already running resolves to this same,
 * already-evaluated module. That only works because nothing here awaits at the top level --
 * a top-level `await` would leave the module mid-evaluation when oclif imports it, and the
 * import would wait on itself forever. So `main()` is started, not awaited.
 *
 * oclif's documentation says it does not support bundling into one file, because it expects
 * a `package.json` and a `bin/run` on disk. It is handed the package description in memory
 * instead (`pjson`, a supported load option), which is why the bundle runs from any
 * directory -- including the temporary one `cli.test.ts` builds it into.
 */

import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { run, settings } from "@oclif/core";
import pkg from "../package.json" with { type: "json" };
import { buildCommands } from "./commands.ts";
import type { Context } from "./handlers/context.ts";
import type { Noted } from "./handlers/local.ts";
import { messages, topicSentence } from "./i18n/index.ts";
import { spoken, topicsOf } from "./manifest.ts";
import { localeFromArgv, modeFlagsFromArgv, resolveRuntimeMode } from "./services/mode.ts";
import { envelope, exitCodeFor, failure, humanText } from "./services/output.ts";
import { cliHome } from "./services/profiles.ts";

const argv = process.argv.slice(2);
const locale = localeFromArgv(argv);
const t = messages(locale);
const modeFlags = modeFlagsFromArgv(argv);
const mode = resolveRuntimeMode(modeFlags, {
  stdinIsTTY: process.stdin.isTTY === true,
  stdoutIsTTY: process.stdout.isTTY === true,
});
if (!mode.color) {
  // Clack colours through `node:util`'s `styleText`, which reads this on every call.
  process.env.NO_COLOR = "1";
}

const ctx: Context = {
  t,
  locale,
  mode,
  env: process.env,
  cwd: process.cwd(),
  home: cliHome(process.env, homedir()),
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  fetch: globalThis.fetch,
  trace: modeFlags.verbose
    ? (line: string): void => {
        process.stderr.write(`${line}\n`);
      }
    : (): void => undefined,
};

/** Every command, for oclif's explicit strategy. See the module docstring. */
export const COMMANDS = buildCommands(ctx);

/**
 * oclif's `command_not_found` hook: an unknown command is an outcome like any other, so an
 * agent that mistyped one still gets an envelope and exit code 2 rather than oclif's prose.
 */
export function commandNotFound(options: { readonly id: string }): Noted {
  return {
    outcome: failure(
      "UNKNOWN_COMMAND",
      t("error.UNKNOWN_COMMAND", { command: spoken(options.id) }),
    ),
  };
}

function isNoted(value: unknown): value is Noted {
  return typeof value === "object" && value !== null && "outcome" in value;
}

/** Write the one answer, then exit once it has reached the stream. */
function finish(result: unknown): void {
  if (!isNoted(result)) {
    // oclif printed help or the version itself; there is no outcome to render.
    process.exit(0);
  }
  const { outcome, note } = result;
  const code = exitCodeFor(outcome);
  let text: string;
  let stream: NodeJS.WriteStream = process.stdout;
  if (mode.mode === "agent") {
    text = JSON.stringify(envelope(outcome));
  } else if (outcome.ok) {
    text = note ?? humanText(t, outcome.data);
  } else {
    stream = process.stderr;
    const { details } = outcome.error;
    text = `${outcome.error.code}: ${outcome.error.message}${
      details === undefined ? "" : `\n${JSON.stringify(details, null, 2)}`
    }`;
  }
  // Exiting inside the write callback, not after it: a pipe is written asynchronously, and
  // exiting with the envelope still buffered would hand an agent half a JSON document.
  stream.write(`${text}\n`, () => process.exit(code));
}

async function main(): Promise<void> {
  // A bundle is compiled source; there is nothing for oclif to transpile. Off, oclif never
  // looks for a tsconfig or `require`s TypeScript -- which the build therefore leaves out of
  // the bundle, and which would otherwise print a "could not find typescript" warning into
  // the stderr an agent expects to be empty.
  settings.enableAutoTranspile = false;
  const bundle = fileURLToPath(import.meta.url);
  const self = `./${basename(bundle)}`;
  let result: unknown;
  try {
    result = await run(argv, {
      root: dirname(bundle),
      pjson: {
        name: "undercroft",
        version: pkg.version,
        type: "module",
        oclif: {
          bin: "undercroft",
          topicSeparator: " ",
          commands: { strategy: "explicit", target: self, identifier: "COMMANDS" },
          // Without these oclif labels a topic with the first sentence it finds in it, so
          // `bi` would read as "answer a question definition".
          topics: Object.fromEntries(
            topicsOf(Object.keys(COMMANDS)).map((topic) => [
              topic,
              { description: topicSentence(locale, topic) ?? "" },
            ]),
          ),
          hooks: { command_not_found: { target: self, identifier: "commandNotFound" } },
        },
      },
      userPlugins: false,
      devPlugins: false,
      jitPlugins: false,
    });
  } catch (error) {
    ctx.trace(error instanceof Error ? (error.stack ?? error.message) : String(error));
    result = { outcome: failure("INTERNAL_ERROR", t("error.INTERNAL_ERROR")) };
  }
  finish(result);
}

void main();
