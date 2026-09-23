/**
 * Who is on the other end of this process: a person at a terminal, or an agent.
 *
 * The one owner of that decision. Every behaviour that differs between the two -- prompting,
 * colour, the JSON envelope, what `allowWrites` may be changed by -- asks `resolveRuntimeMode`
 * and never re-derives it from a TTY check of its own, because two checks that disagree are
 * how an agent ends up blocked on a prompt nobody will answer.
 *
 * Explicit beats inferred: `--agent` or `--json` settle it. Without them, a stdin or stdout
 * that is not a terminal means agent -- an agent's harness pipes both, and a prompt written
 * into a pipe waits forever.
 */

import { DEFAULT_LOCALE, type Locale, parseLocale } from "@undercroft/core/locale";

export type Mode = "agent" | "human";

export interface ModeFlags {
  readonly agent: boolean;
  readonly json: boolean;
  readonly noInput: boolean;
  readonly noColor: boolean;
  readonly quiet: boolean;
}

export interface Terminal {
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
}

export interface RuntimeMode {
  readonly mode: Mode;
  /** Whether a prompt may be shown. Never in agent mode; not with `--no-input` either. */
  readonly prompts: boolean;
  readonly color: boolean;
  readonly quiet: boolean;
}

export function resolveRuntimeMode(flags: ModeFlags, terminal: Terminal): RuntimeMode {
  if (flags.agent || flags.json || !terminal.stdinIsTTY || !terminal.stdoutIsTTY) {
    // `--agent` implies the other three, and so does being inferred as one.
    return { mode: "agent", prompts: false, color: false, quiet: true };
  }
  return { mode: "human", prompts: !flags.noInput, color: !flags.noColor, quiet: flags.quiet };
}

/** The arguments before `--`, which is where oclif stops reading flags too. */
function flagArgs(argv: readonly string[]): readonly string[] {
  const end = argv.indexOf("--");
  return end === -1 ? argv : argv.slice(0, end);
}

/**
 * The mode flags, read off argv before oclif parses it.
 *
 * Read early because the mode has to be known by things that run before or instead of a
 * command -- the renderer of a parse error, the unknown-command hook -- and a second reading
 * of the same flags after parsing would be a second owner of the decision. They are
 * presence-only booleans in oclif as well (no `--agent=false`), so presence is what oclif
 * would have parsed.
 */
export function modeFlagsFromArgv(
  argv: readonly string[],
): ModeFlags & { readonly verbose: boolean } {
  const args = new Set(flagArgs(argv));
  return {
    agent: args.has("--agent"),
    json: args.has("--json"),
    noInput: args.has("--no-input"),
    noColor: args.has("--no-color"),
    quiet: args.has("--quiet"),
    verbose: args.has("--verbose"),
  };
}

/**
 * The language asked for with `--lang`, read before oclif parses anything.
 *
 * Early because `--help` is written by oclif from each command's static description, and
 * those are worded when the command classes are built -- before any flag is parsed. oclif
 * still declares and validates `--lang` itself; an unknown value falls back here to the
 * default and is then refused there, so a typo is reported rather than silently obeyed.
 */
export function localeFromArgv(argv: readonly string[]): Locale {
  const args = flagArgs(argv);
  for (const [index, arg] of args.entries()) {
    if (arg.startsWith("--lang=")) {
      return parseLocale(arg.slice("--lang=".length)) ?? DEFAULT_LOCALE;
    }
    if (arg === "--lang") {
      return parseLocale(args[index + 1]) ?? DEFAULT_LOCALE;
    }
  }
  return DEFAULT_LOCALE;
}
