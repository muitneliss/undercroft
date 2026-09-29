/**
 * How a refused schedule is worded, for `connections.setCadence` and `connections.setResync`.
 *
 * Split from `connectionsRouter.ts`, which had grown past what one file may be, when a card grew
 * its second schedule (ADR 0081). Both procedures are refused for the same reasons in the same
 * words, so the wording has one owner.
 */

import { TRPCError } from "@trpc/server";
import { type CronRefusal, SCHEDULER_TICK_MINUTES } from "@undercroft/contracts";
import type { Locale } from "@undercroft/core";
import { messages } from "../i18n/index.ts";
import type { SetResyncOutcome } from "../services/connections.ts";
import { refusal } from "./trpc.ts";

/** The sentence for each way an expression is refused. A record, so a new refusal is a type error. */
const CRON_REFUSAL_KEY: Readonly<
  Record<
    CronRefusal,
    "error.cronFields" | "error.cronInvalid" | "error.cronNever" | "error.cronTooFrequent"
  >
> = {
  fields: "error.cronFields",
  invalid: "error.cronInvalid",
  never: "error.cronNever",
  "too-frequent": "error.cronTooFrequent",
};

/**
 * Why a schedule was not saved -- a sync cadence or a re-sync, which share their words and their
 * check. BAD_REQUEST, because in each case the request is what has to change; the sentence says
 * how, and `details.reason` says which as a code an agent matches.
 */
export function scheduleRefusal(
  locale: Locale,
  at: { source: string; cron: string },
  outcome: SetResyncOutcome & { ok: false },
): TRPCError {
  const t = messages(locale);
  switch (outcome.reason) {
    case "no-connection":
      return new TRPCError({ code: "NOT_FOUND" });
    case "not-resyncable":
      return refusal("BAD_REQUEST", t("error.resyncNothingToRead", { source: at.source }), {
        source: at.source,
        reason: "not-resyncable",
      });
    case "cron-without-custom":
      return refusal("BAD_REQUEST", t("error.cronWithoutCustom"), {
        source: at.source,
        reason: "cron-without-custom",
      });
    default:
      return refusal(
        "BAD_REQUEST",
        t(CRON_REFUSAL_KEY[outcome.refusal], {
          cron: at.cron,
          minutes: String(SCHEDULER_TICK_MINUTES),
        }),
        { source: at.source, reason: `cron-${outcome.refusal}` },
      );
  }
}
