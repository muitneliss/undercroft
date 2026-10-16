/**
 * Where the model and the router meet, and the only place they do.
 *
 * `services/assistant/catalogue.ts` declares what a tool IS -- its description, its arguments,
 * its tier. This binds each declaration to the real tRPC procedure through
 * `appRouter.createCaller(ctx)`, which is what makes the assistant incapable of being a weaker
 * door into the same house:
 *
 * A bound tool runs the procedure's own middleware. `tenantProcedure` resolves authority and
 * answers NOT_FOUND rather than FORBIDDEN for a non-member, so the assistant cannot be used to
 * discover which customers exist. `requirePermission` refuses a reader lacking the verb's
 * permission, in their own language, with the same sentence the button would have produced and
 * the permission named. None of that is re-implemented here -- so none of it can drift from the
 * copy that ships.
 *
 * What each tool needs is told to the model the same way: the permission the procedure's guard
 * declares (`permissionFor`) is added to the tool's description here, so the catalogue never
 * states a gate of its own that could fall out of step with the router's.
 *
 * The tool therefore REFUSES ITSELF. What comes back to the model on a refusal is the
 * procedure's message, which is deliberate: the model needs to be able to tell the reader "you
 * do not have permission for that" rather than silently trying something else.
 *
 * WHY A DOTTED PATH RATHER THAN A FUNCTION REFERENCE. The catalogue is a service and may not
 * import `@trpc/*` (`layer-service-no-upward`), so it names its procedure as a string and this
 * file resolves it through `procedures.ts`, the walk every caller outside the browser shares.
 * That is a real risk -- a renamed procedure would become a runtime failure at somebody's first
 * question -- so `assistantTools.test.ts` asserts every path in the catalogue resolves, which
 * turns it back into a gate failure.
 */

import { TRPCError } from "@trpc/server";
import { tool, type ToolSet } from "ai";
import { TOOLS } from "../services/assistant/catalogue.ts";
import type { Tier } from "../services/assistant/toolSpec.ts";
import { needsFor, PROCEDURE_PATHS, resolveProcedure } from "./procedures.ts";
import { appRouter } from "./router.ts";
import type { Context } from "./trpc.ts";

/** Every path the catalogue names that the router does not have. Empty is the only pass. */
export function unresolvedProcedures(): readonly string[] {
  return Object.values(TOOLS)
    .map((spec) => spec.procedure)
    .filter((path): path is string => path !== undefined)
    .filter((path) => !PROCEDURE_PATHS.has(path));
}

/**
 * A refusal the model can act on, rather than a stack trace.
 *
 * A `TRPCError` carries the procedure's own worded message in the caller's locale, and that is
 * what the model is told: it has to be able to say "you do not have permission" to the reader
 * instead of quietly trying a different tool. Anything else is re-raised untouched -- an
 * unexpected failure must not be flattened into something that reads like a permission problem.
 */
function refusal(error: unknown): never {
  if (error instanceof TRPCError) {
    throw new Error(`${error.code}: ${error.message || "refused"}`);
  }
  throw error;
}

/**
 * A tool's description as the model reads it: the catalogue's words, then what its procedure's
 * gates need -- the permission, and the whole reach where it runs as the build login. English, as
 * every description is -- the model reads it, no person does.
 */
function describedFor(description: string, path: string): string {
  const needs = needsFor(path, "en");
  return needs === "" ? description : `${description} ${needs}`;
}

export interface BindOptions {
  /**
   * Which tiers may be bound at all.
   *
   * The handler passes the tiers this turn is allowed to reach, so a question never has a
   * mutation on the table. A tool that is not bound cannot be called by any prompt, which is a
   * stronger guarantee than a tool that is bound and then refused.
   */
  readonly tiers: readonly Tier[];
}

/**
 * The tool set for one request, bound to one caller.
 *
 * Built per request and never cached: the caller IS the authority, so a tool set outliving its
 * context would be a set of verbs bound to whoever asked first.
 */
export function bindTools(ctx: Context, options: BindOptions): ToolSet {
  // The browser's own context, named for what is acting: the audit log says an action the
  // assistant took was the assistant's, on this person's authority (ADR 0113).
  const caller = appRouter.createCaller({ ...ctx, channel: "assistant" });
  const tools: ToolSet = {};

  for (const [name, spec] of Object.entries(TOOLS)) {
    if (!options.tiers.includes(spec.tier)) {
      continue;
    }
    // A navigate tool is declared with NO `execute`, which is how the SDK knows to hand it to
    // the browser. Declaring it here rather than omitting it is the point: the model can only
    // call a tool it was told about, and this is the tier that reaches the reader's screen
    // without reaching their data.
    if (spec.procedure === undefined) {
      tools[name] = tool({ description: spec.description, inputSchema: spec.inputSchema });
      continue;
    }

    const procedure = resolveProcedure(caller, spec.procedure);
    if (procedure === null) {
      // Refusing to build is deliberate. A tool set missing one verb would answer most
      // questions and fail one, which is the hardest kind of breakage to notice.
      throw new Error(
        `assistant catalogue names a procedure that does not exist: ${spec.procedure}`,
      );
    }

    tools[name] = tool({
      description: describedFor(spec.description, spec.procedure),
      inputSchema: spec.inputSchema,
      // `.catch(refusal)` rather than try/await/catch: `refusal` returns `never`, so this says
      // the same thing in one clause and leaves no `await` for a reader to wonder about.
      execute: (input: unknown) => procedure(input).catch(refusal),
    });
  }

  return tools;
}
