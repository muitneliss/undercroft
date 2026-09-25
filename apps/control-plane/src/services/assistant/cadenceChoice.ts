import { Cadence } from "@undercroft/contracts";
import { z } from "zod";

/**
 * How often a source is read, as the model writes it: the cadence, and for `custom` its cron.
 *
 * Two flat fields rather than a union discriminated on `cadence`, because a tool's input schema
 * must be one object -- the same reason `connections.setCadence` takes one. The pairing rule
 * (a cron with `custom` and nothing else, five fields, Singapore time, no two fires closer than
 * the scheduler's tick) is the procedure's to enforce, and it refuses in the reader's words; the
 * descriptions below exist so the model rarely has to be refused. ADR 0059.
 */
export const CadenceChoice = {
  cadence: Cadence.describe(
    "hourly, every_6h and daily are gaps since the last run; paused runs only when asked; " +
      "custom runs on the expression in `cron`.",
  ),
  cron: z
    .string()
    .optional()
    .describe(
      "Required when cadence is custom, and only then. Five fields (minute hour day-of-month " +
        "month day-of-week), read in Asia/Singapore time, firing no more often than every five " +
        "minutes -- e.g. '30 7 * * 1-5' for 07:30 on weekdays.",
    ),
};
