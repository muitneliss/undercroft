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
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const base = options.fields ?? {};

  function make(fields: LogFields): Logger {
    const logger: Logger = {
      write(level, event, extra) {
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
      info: (event, extra) => logger.write("info", event, extra),
      warn: (event, extra) => logger.write("warn", event, extra),
      error: (event, extra) => logger.write("error", event, extra),
      child: (extra) => make({ ...fields, ...extra }),
    };
    return logger;
  }

  return make(base);
}

export { describeError };
