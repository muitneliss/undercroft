/**
 * The flags every command accepts, declared once.
 *
 * Two readers depend on this being the only declaration. The commands take it as oclif's
 * `baseFlags`. The build (`scripts/build.ts`) reads `RESERVED_FLAGS` and refuses a router
 * input property whose kebab-case name would collide with one: a procedure that grew a
 * `profile` field would otherwise have its input silently swallowed by `--profile`.
 *
 * The mode flags are parsed here only so oclif accepts and documents them. Their meaning is
 * decided once, from argv, by `services/mode.ts` -- see `modeFlagsFromArgv`.
 */

import { Flags, type Interfaces } from "@oclif/core";
import { LOCALES } from "@undercroft/core/locale";
import type { Translate } from "./i18n/index.ts";

/** oclif's own type for a command's `static flags`. */
export type FlagMap = Interfaces.FlagInput;

export function globalFlags(t: Translate): FlagMap {
  return {
    agent: Flags.boolean({ description: t("flag.agent") }),
    json: Flags.boolean({ description: t("flag.json") }),
    "no-input": Flags.boolean({ description: t("flag.noInput") }),
    "no-color": Flags.boolean({ description: t("flag.noColor") }),
    quiet: Flags.boolean({ description: t("flag.quiet") }),
    verbose: Flags.boolean({ description: t("flag.verbose") }),
    yes: Flags.boolean({ description: t("flag.yes") }),
    "dry-run": Flags.boolean({ description: t("flag.dryRun") }),
    profile: Flags.string({ description: t("flag.profile") }),
    url: Flags.string({ description: t("flag.url") }),
    lang: Flags.string({ description: t("flag.lang"), options: [...LOCALES] }),
  };
}

/** A procedure's JSON input, beside its typed flags. */
export function inputFlags(t: Translate): FlagMap {
  return {
    input: Flags.string({ description: t("flag.input") }),
    "input-json": Flags.string({ description: t("flag.inputJson") }),
  };
}

/** Every name a procedure's own flag may not take. `help` and `version` are oclif's. */
export function reservedFlags(t: Translate): ReadonlySet<string> {
  return new Set([
    ...Object.keys(globalFlags(t)),
    ...Object.keys(inputFlags(t)),
    "help",
    "version",
  ]);
}
