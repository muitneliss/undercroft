/**
 * One procedure command, from argv to the server's answer.
 *
 * The order is load-bearing:
 *
 * 1. Assemble the input (typed flags over `--input` over `--input-json`).
 * 2. Where nobody can be asked, a missing required argument is refused NOW -- before any
 *    server is chosen -- so an agent that forgot a flag learns that, and not something about
 *    its configuration.
 * 3. Choose the server and the session (`connect`).
 * 4. In human mode, ask for what is missing: the tenant from the tenants the caller can see,
 *    an enum from its values, anything else as text.
 * 5. The safety decision (`services/safety.ts`), which may stop at a dry run.
 * 6. The call.
 */

import { readFileSync } from "node:fs";
import type { Readable } from "node:stream";
import type { ProcedureSpec } from "../manifest.ts";
import type { Effect } from "../procedures.ts";
import {
  checkShape,
  type FlagSpec,
  flagSpecs,
  mergeInput,
  missingRequired,
} from "../services/input.ts";
import { failure, type Outcome, type Refusal, success } from "../services/output.ts";
import { decide } from "../services/safety.ts";
import {
  booleanFlag,
  type Connected,
  type Context,
  connect,
  type ParsedFlags,
  stringFlag,
} from "./context.ts";
import { type Answer, askChoice, askConfirm, askValue, CANCELLED } from "./prompts.ts";
import { callProcedure } from "./remote.ts";

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The `--input` document: stdin for `-`, a file otherwise. Stdin is read only when asked. */
async function inputDocument(
  ctx: Context,
  flags: ParsedFlags,
): Promise<{ readonly source: string; readonly text: string } | null | Refusal> {
  const source = stringFlag(flags, "input");
  if (source === undefined) {
    return null;
  }
  try {
    const text = source === "-" ? await readAll(ctx.stdin) : readFileSync(source, "utf8");
    return { source: source === "-" ? "stdin" : source, text };
  } catch {
    return failure("INVALID_ARGUMENT", ctx.t("error.inputUnreadable", { source }));
  }
}

function typedInput(specs: readonly FlagSpec[], flags: ParsedFlags): Record<string, unknown> {
  const typed: Record<string, unknown> = {};
  for (const spec of specs) {
    const value = flags[spec.flag];
    if (value !== undefined) {
      typed[spec.property] = value;
    }
  }
  return typed;
}

function missingArguments(
  ctx: Context,
  specs: readonly FlagSpec[],
  missing: readonly string[],
): Refusal {
  const byProperty = new Map(specs.map((spec) => [spec.property, `--${spec.flag}`]));
  const names = missing.map((property) => byProperty.get(property) ?? `--input (${property})`);
  return failure(
    "MISSING_REQUIRED_ARGUMENT",
    ctx.t("error.MISSING_REQUIRED_ARGUMENT", { names: names.join(", ") }),
    { missing: names },
  );
}

/** The tenants the caller can see, as choices, or the refusal that stopped the listing. */
async function askTenant(
  ctx: Context,
  connected: Connected,
): Promise<{ readonly ok: true; readonly value: Answer<string> } | Refusal> {
  const listed = await callProcedure(
    ctx.t,
    connected.connection,
    { path: "tenants.list", type: "query" },
    undefined,
  );
  if (!listed.ok) {
    return listed;
  }
  const rows = Array.isArray(listed.data) ? listed.data : [];
  const options = rows.flatMap((row: unknown) => {
    if (typeof row !== "object" || row === null || !("id" in row) || typeof row.id !== "string") {
      return [];
    }
    const label =
      "displayName" in row && typeof row.displayName === "string"
        ? `${row.id} -- ${row.displayName}`
        : row.id;
    return [{ value: row.id, label }];
  });
  return { ok: true, value: await askChoice(ctx, ctx.t("prompt.tenant"), options) };
}

/**
 * Ask a person for each missing property, or answer with why it cannot be asked.
 *
 * Only scalars are asked. A missing nested value (a dashboard, a scope selection) is refused
 * with a pointer to `--input`, because a JSON document typed into a prompt is not a thing
 * anyone should be asked to do.
 */
async function askMissing(
  ctx: Context,
  input: {
    readonly spec: ProcedureSpec;
    readonly specs: readonly FlagSpec[];
    readonly missing: readonly string[];
    readonly connected: Connected;
  },
): Promise<{ readonly ok: true; readonly answers: Record<string, unknown> } | Refusal> {
  const answers: Record<string, unknown> = {};
  for (const property of input.missing) {
    const flag = input.specs.find((spec) => spec.property === property);
    if (flag === undefined) {
      return missingArguments(ctx, input.specs, input.missing);
    }
    const answer =
      property === "tenantId" && input.spec.tenantScoped
        ? await askTenant(ctx, input.connected)
        : { ok: true as const, value: await askValue(ctx, flag) };
    if (!answer.ok) {
      return answer;
    }
    if (answer.value === CANCELLED) {
      return failure("CANCELLED", ctx.t("error.CANCELLED"));
    }
    answers[property] = answer.value;
  }
  return { ok: true, answers };
}

interface Assembled {
  readonly ok: true;
  readonly specs: readonly FlagSpec[];
  readonly value: Readonly<Record<string, unknown>>;
  readonly missing: readonly string[];
}

/** Steps 1 and 2: the input as typed, and what it still lacks. */
async function assemble(
  ctx: Context,
  spec: ProcedureSpec,
  flags: ParsedFlags,
): Promise<Assembled | Refusal> {
  const specs = flagSpecs(spec.input);
  const document = await inputDocument(ctx, flags);
  if (document !== null && "ok" in document) {
    return document;
  }
  const merged = mergeInput({
    typed: typedInput(specs, flags),
    document,
    inline: stringFlag(flags, "input-json") ?? null,
  });
  if (!merged.ok) {
    return failure("INVALID_ARGUMENT", ctx.t("error.inputNotObject"), { source: merged.source });
  }
  const missing = missingRequired(spec.input, merged.value);
  if (missing.length > 0 && !ctx.mode.prompts) {
    return missingArguments(ctx, specs, missing);
  }
  return { ok: true, specs, value: merged.value, missing };
}

export interface ProcedureCommand {
  readonly spec: ProcedureSpec;
  readonly effect: Effect;
  /** How a person types it, for the sentences that name it: `keys revoke`. */
  readonly spoken: string;
}

/** Step 5: the safety decision, as the outcome that ends here -- or `null` to go on and call. */
async function settle(
  ctx: Context,
  command: ProcedureCommand,
  input: {
    readonly value: unknown;
    readonly target: Connected["target"];
    readonly flags: ParsedFlags;
  },
): Promise<Outcome | null> {
  const { spec } = command;
  const { target } = input;
  const decision = decide({
    effect: command.effect,
    canAsk: ctx.mode.prompts,
    profile: target.profile,
    allowWrites: target.allowWrites,
    yes: booleanFlag(input.flags, "yes"),
    dryRun: booleanFlag(input.flags, "dry-run"),
  });
  if (decision.verdict === "refuse") {
    if (decision.reason === "unconfirmed") {
      return failure(
        decision.code,
        ctx.t("error.CONFIRMATION_REQUIRED", { command: command.spoken }),
      );
    }
    return decision.reason === "one-off"
      ? failure(decision.code, ctx.t("error.writesNeedProfile"))
      : failure(decision.code, ctx.t("error.WRITES_DISABLED", { profile: target.profile ?? "" }));
  }
  if (decision.verdict === "dry-run") {
    const issues = checkShape(spec.input, input.value ?? {});
    return issues.length > 0
      ? failure("VALIDATION_FAILED", ctx.t("error.localValidation"), { issues })
      : success({ dryRun: true, operation: spec.path, input: input.value ?? null });
  }
  if (decision.verdict === "ask") {
    const confirmed = await askConfirm(
      ctx,
      ctx.t("prompt.confirmDestructive", { command: command.spoken }),
    );
    return confirmed === true ? null : failure("CANCELLED", ctx.t("error.CANCELLED"));
  }
  return null;
}

export async function runProcedure(
  ctx: Context,
  command: ProcedureCommand,
  flags: ParsedFlags,
): Promise<Outcome> {
  const { spec } = command;
  const assembled = await assemble(ctx, spec, flags);
  if (!assembled.ok) {
    return assembled;
  }
  const connected = connect(ctx, flags);
  if ("ok" in connected) {
    return connected;
  }
  let { value } = assembled;
  if (assembled.missing.length > 0) {
    const asked = await askMissing(ctx, { spec, ...assembled, connected });
    if (!asked.ok) {
      return asked;
    }
    value = { ...value, ...asked.answers };
  }
  // A procedure that takes no input is sent none, which is what the browser sends it too.
  const input = spec.input.properties === undefined ? undefined : value;
  const settled = await settle(ctx, command, { value: input, target: connected.target, flags });
  return settled ?? (await callProcedure(ctx.t, connected.connection, spec, input));
}
