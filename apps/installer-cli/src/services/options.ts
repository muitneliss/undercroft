/**
 * The command line, read into a command and into install answers. Pure: argv in, values out.
 *
 * Flags are how an install runs with nobody at the terminal -- `--yes` in a provisioning script,
 * CI, the Phase 2 GUI's own smoke test -- so they reach every answer the wizard would ask for.
 * On a re-run a flag overrides ONE answer and the install's other answers stand: `--port 14000`
 * on a server install must not clear its sign-in method, or its Xero client, because they were
 * not repeated. That is `answersFromFlags`'s `base`.
 */

import { parseArgs } from "node:util";
import type {
  Answers,
  Connectors,
  Field,
  Mode,
  OAuthClient,
  ProblemCode,
  SignIn,
} from "@undercroft/setup";
import { validateAnswers } from "@undercroft/setup";

export const COMMANDS = ["up", "down", "status", "logs", "update", "uninstall"] as const;
export type CommandName = (typeof COMMANDS)[number];

/** The setup package's problems, and the one only a flag can cause. */
export type CliProblemCode = ProblemCode | "desktop-bind";

export interface CliProblem {
  readonly field: Field;
  readonly code: CliProblemCode;
}

const FLAGS = {
  lang: { type: "string" },
  dir: { type: "string" },
  yes: { type: "boolean", default: false },
  mode: { type: "string" },
  port: { type: "string" },
  bind: { type: "string" },
  "public-url": { type: "string" },
  admin: { type: "string" },
  "email-api-key": { type: "string" },
  "email-from": { type: "string" },
  "google-client-id": { type: "string" },
  "google-client-secret": { type: "string" },
  "google-ingest-client-id": { type: "string" },
  "google-ingest-client-secret": { type: "string" },
  "xero-client-id": { type: "string" },
  "xero-client-secret": { type: "string" },
  tag: { type: "string" },
  "dry-run": { type: "boolean", default: false },
  "keep-data": { type: "boolean", default: false },
  open: { type: "boolean", default: true },
  help: { type: "boolean", default: false },
  version: { type: "boolean", default: false },
} as const;

export type Flags = ReturnType<
  typeof parseArgs<{ options: typeof FLAGS; allowNegative: true }>
>["values"];

export interface Invocation {
  readonly command: CommandName;
  /** What follows the command: `logs control-plane` names a service. */
  readonly operands: readonly string[];
  readonly flags: Flags;
}

export type ParsedInvocation =
  | { readonly ok: true; readonly invocation: Invocation }
  | { readonly ok: false; readonly detail: string };

const COMMAND_NAMES: ReadonlySet<string> = new Set(COMMANDS);

function isCommand(value: string): value is CommandName {
  return COMMAND_NAMES.has(value);
}

export function parseInvocation(argv: readonly string[]): ParsedInvocation {
  let parsed: { values: Flags; positionals: string[] };
  try {
    parsed = parseArgs({
      args: [...argv],
      options: FLAGS,
      allowPositionals: true,
      allowNegative: true,
      strict: true,
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
  const { mode } = parsed.values;
  if (mode !== undefined && mode !== "desktop" && mode !== "server") {
    return { ok: false, detail: `--mode ${mode}` };
  }
  const [first, ...rest] = parsed.positionals;
  if (first === undefined) {
    return { ok: true, invocation: { command: "up", operands: [], flags: parsed.values } };
  }
  if (!isCommand(first)) {
    return { ok: false, detail: first };
  }
  return { ok: true, invocation: { command: first, operands: rest, flags: parsed.values } };
}

export const DEFAULT_PORT = 13_000;
const PORT = /^\d{1,5}$/u;

/** A port as typed; anything but digits is `NaN`, which `validateAnswers` reports. */
export function portOf(raw: string): number {
  return PORT.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
}

const DEFAULT_BIND = "127.0.0.1";

/** A client from its two flags when either is given, else what the install already had. */
function client(
  id: string | undefined,
  secret: string | undefined,
  base: OAuthClient | null,
): OAuthClient | null {
  if (id === undefined && secret === undefined) {
    return base;
  }
  return { clientId: id ?? base?.clientId ?? "", clientSecret: secret ?? base?.clientSecret ?? "" };
}

function signInFrom(flags: Flags, base: SignIn | null): SignIn {
  if (flags["email-api-key"] !== undefined || flags["email-from"] !== undefined) {
    const email = base?.kind === "email" ? base : null;
    return {
      kind: "email",
      apiKey: flags["email-api-key"] ?? email?.apiKey ?? "",
      from: flags["email-from"] ?? email?.from ?? "",
    };
  }
  if (flags["google-client-id"] !== undefined || flags["google-client-secret"] !== undefined) {
    const google = base?.kind === "google" ? base : null;
    return {
      kind: "google",
      clientId: flags["google-client-id"] ?? google?.clientId ?? "",
      clientSecret: flags["google-client-secret"] ?? google?.clientSecret ?? "",
    };
  }
  return base ?? { kind: "email", apiKey: "", from: "" };
}

function modeOf(flags: Flags, base: Answers | null): Mode {
  return flags.mode === "server" || (flags.mode === undefined && base?.mode === "server")
    ? "server"
    : "desktop";
}

/**
 * The answers the flags describe, laid over an existing install's (`base`) and then over the
 * defaults, with every problem they have. `imageTag` is the release when no `--tag` is given --
 * the installer's own, so a binary installs the images it was built with.
 */
export function answersFromFlags(
  flags: Flags,
  base: Answers | null,
  imageTag: string,
): { readonly answers: Answers; readonly problems: readonly CliProblem[] } {
  const mode = modeOf(flags, base);
  const port = flags.port === undefined ? (base?.port ?? DEFAULT_PORT) : portOf(flags.port);
  const connectors: Connectors = {
    googleIngest: client(
      flags["google-ingest-client-id"],
      flags["google-ingest-client-secret"],
      base?.connectors.googleIngest ?? null,
    ),
    xero: client(
      flags["xero-client-id"],
      flags["xero-client-secret"],
      base?.connectors.xero ?? null,
    ),
  };
  const common = { port, imageTag: flags.tag ?? imageTag, connectors };
  if (mode === "desktop") {
    const answers: Answers = { mode, ...common };
    const bind: CliProblem[] =
      flags.bind === undefined ? [] : [{ field: "bind", code: "desktop-bind" }];
    return { answers, problems: [...bind, ...validateAnswers(answers)] };
  }
  const server = base?.mode === "server" ? base : null;
  const answers: Answers = {
    mode,
    ...common,
    bind: flags.bind ?? server?.bind ?? DEFAULT_BIND,
    publicUrl: flags["public-url"] ?? server?.publicUrl ?? "",
    adminEmail: flags.admin ?? server?.adminEmail ?? "",
    signIn: signInFrom(flags, server?.signIn ?? null),
  };
  return { answers, problems: validateAnswers(answers) };
}
