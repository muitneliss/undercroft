/**
 * Structured logging, as JSONL on stdout.
 *
 * The Python this replaces wrote to a file under an advisory `flock`, because appending
 * from several processes is only atomic below `PIPE_BUF` and interleaved half-lines
 * corrupt the log for every reader at once. Node and Bun have no portable advisory
 * locking, so reimplementing that would mean reimplementing it *badly*.
 *
 * So the failure mode is removed instead of re-created: one `write` of one line to
 * stdout, and the container runtime does the collecting. This is a deliberate behaviour
 * change from the Python -- `events.jsonl` no longer exists -- and it is recorded in an
 * ADR rather than discovered by someone grepping for a file that is not there.
 *
 * A consequence worth stating: running outside a container without a shell redirect
 * means the log is not persisted. That is the trade, and it is the right way round --
 * a corrupted shared log is worse than an ephemeral one.
 */

// biome-ignore-all lint/nursery/useExplicitType: The 50 sites whose type the compiler could print are annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type is supplied contextually and writing it out means naming a library-internal type that will drift on the next upgrade.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

// biome-ignore-all lint/correctness/noNodejsModules: This is server code running on Bun. `node:` builtins are the platform here, not a portability hazard -- the rule exists for code that must also run in a browser.

import process from "node:process";
import { type Clock, systemClock } from "./clock.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  write: (level: LogLevel, event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
  /** A logger carrying extra fields on every line. Used per run, per tenant, per entity. */
  child: (fields: LogFields) => Logger;
}

export interface LoggerOptions {
  readonly component: string;
  readonly fields?: LogFields;
  readonly clock?: Clock;
  readonly sink?: (line: string) => void;
}

/**
 * Render an error without letting a payload into the log.
 *
 * Exception messages routinely embed the offending row, and a log line is a far less
 * controlled surface than the quarantine record that is *supposed* to hold it.
 */
function describeError(value: unknown): LogFields {
  if (value instanceof Error) {
    return { errorType: value.name, errorMessage: value.message };
  }
  return { errorType: typeof value };
}

export function createLogger(options: LoggerOptions): Logger {
  const clock = options.clock ?? systemClock;
  const sink = options.sink ?? ((line: string): boolean => process.stdout.write(`${line}\n`));
  const base = options.fields ?? {};

  function make(fields: LogFields): Logger {
    const logger: Logger = {
      write(level, event, extra): void {
        const line = {
          at: clock.now().toISOString(),
          level,
          component: options.component,
          event,
          ...fields,
          ...extra,
        };
        sink(JSON.stringify(line));
      },
      info: (event, extra): void => logger.write("info", event, extra),
      warn: (event, extra): void => logger.write("warn", event, extra),
      error: (event, extra): void => logger.write("error", event, extra),
      child: (extra): Logger => make({ ...fields, ...extra }),
    };
    return logger;
  }

  return make(base);
}

export { describeError };
