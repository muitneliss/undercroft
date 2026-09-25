/**
 * The command surface: one oclif command per router procedure, plus the local few.
 *
 * Nothing here is written per procedure. The manifest (`virtual:surface`) lists every
 * procedure the router has, and each becomes a command by the same rule -- the dotted path
 * is the command (`bi.questions.save` is `undercroft bi questions save`), each top-level
 * scalar of the input is a flag, and the description and the effect are the ones the control
 * plane records beside the router (`handlers/surface.ts`). The UI's feature list IS the router, so this is the UI's feature list, one to
 * one; `cli.test.ts` fails the gate the day the two disagree.
 *
 * oclif's EXPLICIT discovery strategy reads the table this returns, which is what lets the
 * whole CLI be one bundled file with no `commands/` directory to glob and no default exports.
 */

import { stripVTControlCharacters } from "node:util";
import { Args, Command, Flags, type Interfaces } from "@oclif/core";
import { PROCEDURES } from "virtual:surface";
import { type FlagMap, globalFlags, inputFlags } from "./flags.ts";
import type { Context, ParsedFlags } from "./handlers/context.ts";
import {
  authLogin,
  authLogout,
  authStatus,
  configSetProfile,
  configShow,
  configUse,
  type Described,
  describeCommands,
  type Noted,
} from "./handlers/local.ts";
import { runProcedure } from "./handlers/run.ts";
import type { MessageKey } from "./i18n/index.ts";
import { commandId, type ProcedureSpec, spoken } from "./manifest.ts";
import { flagSpecs } from "./services/input.ts";
import { failure } from "./services/output.ts";

type ArgMap = Interfaces.ArgInput;

interface Definition {
  readonly description: string;
  readonly flags: FlagMap;
  readonly args: ArgMap;
  /** `false` only for `describe`, whose argument may be several words. */
  readonly strict: boolean;
  readonly run: (parsed: {
    readonly flags: ParsedFlags;
    readonly argv: readonly string[];
  }) => Promise<Noted>;
}

/** Why oclif refused the arguments, without the colour oclif may have put in it. */
function reasonOf(error: unknown): string {
  return stripVTControlCharacters(error instanceof Error ? error.message : String(error));
}

/**
 * An oclif command class around one definition.
 *
 * `run` never throws. A parse error becomes INVALID_ARGUMENT and anything unexpected becomes
 * INTERNAL_ERROR, both as outcomes, so `main.ts` -- the one renderer and the one caller of
 * `process.exit` -- sees every ending the same way and an agent always gets its envelope.
 */
function commandClass(ctx: Context, id: string, definition: Definition): Command.Class {
  return class extends Command {
    static override id = id;
    static override description = definition.description;
    static override baseFlags = globalFlags(ctx.t);
    static override flags = definition.flags;
    static override args = definition.args;
    static override strict = definition.strict;

    override async run(): Promise<Noted> {
      let parsed: { flags: ParsedFlags; argv: readonly unknown[] };
      try {
        parsed = await this.parse();
      } catch (error) {
        return {
          outcome: failure(
            "INVALID_ARGUMENT",
            ctx.t("error.INVALID_ARGUMENT", { command: spoken(id) }),
            {
              reason: reasonOf(error),
            },
          ),
        };
      }
      try {
        return await definition.run({
          flags: parsed.flags,
          argv: parsed.argv.filter((word) => typeof word === "string"),
        });
      } catch (error) {
        ctx.trace(error instanceof Error ? (error.stack ?? error.message) : String(error));
        return { outcome: failure("INTERNAL_ERROR", ctx.t("error.INTERNAL_ERROR")) };
      }
    }
  };
}

function procedureFlags(ctx: Context, spec: ProcedureSpec): FlagMap {
  const flags: FlagMap = { ...inputFlags(ctx.t) };
  for (const flag of flagSpecs(spec.input)) {
    const description = ctx.t("flag.field", { name: flag.property });
    switch (flag.kind) {
      case "boolean":
        flags[flag.flag] = Flags.boolean({ description, allowNo: true });
        break;
      case "integer":
        flags[flag.flag] = Flags.integer({ description });
        break;
      case "enum":
        flags[flag.flag] = Flags.string({ description, options: [...flag.options] });
        break;
      default:
        flags[flag.flag] = Flags.string({ description });
    }
  }
  return flags;
}

/** A command that is about the CLI, not a procedure. Flags and args default to none. */
interface LocalCommand {
  readonly id: string;
  readonly description: MessageKey;
  readonly flags?: FlagMap;
  readonly args?: ArgMap;
  readonly strict?: boolean;
  readonly run: Definition["run"];
}

function localCommands(ctx: Context, catalogue: () => readonly Described[]): LocalCommand[] {
  const { t } = ctx;
  const name = { name: Args.string({ description: t("flag.profileName"), required: true }) };
  return [
    {
      id: "auth:login",
      description: "command.authLogin",
      flags: {
        email: Flags.string({ description: t("flag.email") }),
        code: Flags.string({ description: t("flag.code") }),
      },
      run: ({ flags }) => authLogin(ctx, flags),
    },
    {
      id: "auth:logout",
      description: "command.authLogout",
      run: ({ flags }) => authLogout(ctx, flags),
    },
    {
      id: "auth:status",
      description: "command.authStatus",
      run: ({ flags }) => authStatus(ctx, flags),
    },
    {
      id: "config:show",
      description: "command.configShow",
      run: ({ flags }) => Promise.resolve(configShow(ctx, flags)),
    },
    {
      id: "config:set-profile",
      description: "command.configSetProfile",
      // `--url` here is the PROFILE's url, and shadows the global one-off `--url` on purpose:
      // this command addresses no server, so the global meaning has nothing to apply to.
      flags: {
        url: Flags.string({ description: t("flag.profileUrl") }),
        "allow-writes": Flags.boolean({ description: t("flag.allowWrites"), allowNo: true }),
      },
      args: name,
      run: ({ flags, argv }) => Promise.resolve(configSetProfile(ctx, flags, argv[0] ?? "")),
    },
    {
      id: "config:use",
      description: "command.configUse",
      args: name,
      run: ({ argv }) => Promise.resolve(configUse(ctx, argv[0] ?? "")),
    },
    {
      id: "describe",
      description: "command.describe",
      args: { command: Args.string({ description: t("flag.commandName") }) },
      // The command to describe may be several words: `describe runs trigger`.
      strict: false,
      run: ({ argv }) => Promise.resolve(describeCommands(ctx, catalogue(), argv)),
    },
  ];
}

/** Every command, keyed by oclif id, for the explicit discovery strategy. */
export function buildCommands(ctx: Context): Record<string, Command.Class> {
  const catalogue: Described[] = [];
  const commands: Record<string, Command.Class> = {};

  for (const spec of PROCEDURES) {
    const id = commandId(spec.path);
    const description = spec.description[ctx.locale];
    const flags = procedureFlags(ctx, spec);
    commands[id] = commandClass(ctx, id, {
      description,
      flags,
      args: {},
      strict: true,
      run: async ({ flags: parsed }) => ({
        outcome: await runProcedure(ctx, { spec, spoken: spoken(id) }, parsed),
      }),
    });
    catalogue.push({
      command: spoken(id),
      procedure: spec.path,
      type: spec.type,
      effect: spec.effect,
      description,
      flags: Object.keys(flags).map((flag) => `--${flag}`),
      input: spec.input,
    });
  }

  for (const local of localCommands(ctx, () => catalogue)) {
    const description = ctx.t(local.description);
    const flags = local.flags ?? {};
    commands[local.id] = commandClass(ctx, local.id, {
      description,
      flags,
      args: local.args ?? {},
      strict: local.strict ?? true,
      run: local.run,
    });
    catalogue.push({
      command: spoken(local.id),
      procedure: null,
      type: "local",
      effect: "local",
      description,
      flags: Object.keys(flags).map((flag) => `--${flag}`),
      input: null,
    });
  }
  return commands;
}
