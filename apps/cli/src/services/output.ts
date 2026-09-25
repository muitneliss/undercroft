/**
 * What a run of the CLI says, and how it ends.
 *
 * One outcome per invocation, rendered one of two ways. In agent mode stdout carries exactly
 * one JSON envelope and nothing else -- an agent parses the whole stream, so a single stray
 * line of prose would make every answer unreadable. In human mode the same outcome is a table
 * or formatted JSON on stdout, and a sentence on stderr when it failed.
 *
 * The error codes and their exit codes are the contract an agent programs against, and they
 * live in `CODES` and nowhere else. `skills/undercroft-cli/references/cli-contract.md` states
 * the same table for a reader; this is the one that decides.
 *
 * What an envelope never carries: a cookie, a header, an environment value or a stack. The
 * `message` is the server's own localized refusal when it gave one, or the CLI's sentence.
 */

import type { Translate } from "../i18n/index.ts";
import type { SurfaceErrorCode } from "../manifest.ts";

/**
 * The server's refusals, in the words every door shares (`SurfaceErrorCode`, the control
 * plane's), and the CLI's own. A code the control plane adds is a `tsc` error below until it
 * has an exit code here and a sentence in the catalogues.
 */
export type ErrorCode =
  | SurfaceErrorCode
  | "INVALID_ARGUMENT"
  | "MISSING_REQUIRED_ARGUMENT"
  | "UNKNOWN_COMMAND"
  | "CONFIG_REQUIRED"
  | "CONFIRMATION_REQUIRED"
  | "WRITES_DISABLED"
  | "HUMAN_REQUIRED"
  | "CANCELLED";

/**
 * Exit code and recoverability per error code.
 *
 * "Recoverable" means the same caller can fix it and try again without a person: a missing
 * flag, a confirmation, a network blip, a rejected input. An authentication, permission or
 * writes-disabled failure is NOT recoverable by an agent, and the skill tells it never to
 * retry one -- the fix is a person's (signing in, granting a role, allowing writes).
 *
 * `CANCELLED` is a person pressing Ctrl-C at a prompt. Agent mode never prompts, so an agent
 * never sees it; 130 is the shell's own convention for an interrupted command.
 */
const CODES: Readonly<Record<ErrorCode, { readonly exit: number; readonly recoverable: boolean }>> =
  {
    INVALID_ARGUMENT: { exit: 2, recoverable: true },
    MISSING_REQUIRED_ARGUMENT: { exit: 2, recoverable: true },
    UNKNOWN_COMMAND: { exit: 2, recoverable: true },
    CONFIG_REQUIRED: { exit: 2, recoverable: true },
    CONFIRMATION_REQUIRED: { exit: 2, recoverable: true },
    NOT_FOUND: { exit: 3, recoverable: false },
    CONFLICT: { exit: 4, recoverable: false },
    AUTHENTICATION_REQUIRED: { exit: 5, recoverable: false },
    PERMISSION_DENIED: { exit: 6, recoverable: false },
    WRITES_DISABLED: { exit: 6, recoverable: false },
    HUMAN_REQUIRED: { exit: 6, recoverable: false },
    NETWORK_ERROR: { exit: 7, recoverable: true },
    TIMEOUT: { exit: 7, recoverable: true },
    VALIDATION_FAILED: { exit: 8, recoverable: true },
    INTERNAL_ERROR: { exit: 10, recoverable: false },
    CANCELLED: { exit: 130, recoverable: false },
  };

export interface Failure {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: unknown;
  /**
   * The trace id of the server request that refused, when a server answered. Opaque and never
   * translated: it is what a person quotes in a bug report and what the operator looks up.
   */
  readonly traceId?: string;
}

export interface Refusal {
  readonly ok: false;
  readonly error: Failure;
}

export type Outcome = { readonly ok: true; readonly data: unknown } | Refusal;

/**
 * Whether a service answered with a refusal rather than its value.
 *
 * Services here return `Value | Failure` rather than throwing, as `layering.md` asks: the
 * refusal is a value the handler maps, not an exception it has to know to catch.
 */
export function isFailure(value: object): value is Failure {
  return "code" in value && "message" in value;
}

export function fromFailure(value: Failure): Refusal {
  return { ok: false, error: value };
}

export function success(data: unknown): Outcome {
  return { ok: true, data };
}

export function failure(code: ErrorCode, message: string, details?: unknown): Refusal {
  return {
    ok: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };
}

/**
 * The envelope an agent parses.
 *
 * `data` is the server's JSON verbatim: an amount stays the string it arrived as, and a field
 * the server left out stays out -- nothing here turns an absence into `[]` or `0`.
 * `meta.count` appears only when `data` IS an array, because it is then a fact about the
 * answer; counting a nested list would be deciding which list mattered.
 */
export function envelope(outcome: Outcome): Readonly<Record<string, unknown>> {
  if (outcome.ok) {
    return Array.isArray(outcome.data)
      ? { ok: true, data: outcome.data, meta: { count: outcome.data.length } }
      : { ok: true, data: outcome.data };
  }
  const { code, message, details, traceId } = outcome.error;
  return {
    ok: false,
    error: {
      code,
      message,
      recoverable: CODES[code].recoverable,
      ...(details === undefined ? {} : { details }),
      ...(traceId === undefined ? {} : { traceId }),
    },
  };
}

export function exitCodeFor(outcome: Outcome): number {
  return outcome.ok ? 0 : CODES[outcome.error.code].exit;
}

/** The em dash `formatMoney` prints for a missing amount: absent reads as absent, never 0. */
const MISSING = "—";
const CELL_WIDTH = 48;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One table cell. A value is printed as it arrived; it is never reformatted or rounded. */
function cell(value: unknown): string {
  if (value === null || value === undefined) {
    return MISSING;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > CELL_WIDTH ? `${text.slice(0, CELL_WIDTH - 1)}…` : text;
}

function table(rows: readonly Readonly<Record<string, unknown>>[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const body = rows.map((row) => columns.map((column) => cell(row[column])));
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...body.map((cells) => cells[index]?.length ?? 0)),
  );
  function line(cells: readonly string[]): string {
    return cells
      .map((text, index) => text.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  }
  return [line(columns), ...body.map(line)].join("\n");
}

/** A successful answer, for a person: an array of records is a table, anything else JSON. */
export function humanText(t: Translate, data: unknown): string {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return t("note.noRows");
    }
    if (data.every(isRecord)) {
      return table(data);
    }
  }
  return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}
