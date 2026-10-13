/**
 * How a refused scope browse is worded, for `connections.browseScope`: the worker's refusals
 * and the refusals of a cut it could not make (ADR 0125).
 *
 * Split from `connectionsRouter.ts`, which had grown past what one file may be, as
 * `scheduleRefusal.ts` was. Each sentence is worded for the reader and `details` carries the
 * same verdict as codes an agent matches on.
 */

import type { TRPCError } from "@trpc/server";
import type { BrowseListing } from "@undercroft/contracts";
import type { Locale } from "@undercroft/core";
import { messages } from "../i18n/index.ts";
import type { ChoiceRefusal } from "../services/scopeChoices.ts";
import type { WorkerFailure } from "../services/workerRefusals.ts";
import { refusal } from "./trpc.ts";

/**
 * Why a browse was refused, and what the person or agent reading it can do about it.
 *
 * Five answers, because the remedies have nothing in common. One message for all of them
 * told an administrator whose Gmail grant Google had refused that "the processing service is
 * not responding" -- on the very screen where the remedy was a reconnect they could do
 * themselves, and about a service that was answering perfectly. The sentence is worded for
 * the reader; `details` carries the same verdict as codes an agent matches on, since the
 * sentence alone left one guessing what could not be listed (issue 177).
 */
export function browseRefusal(
  locale: Locale,
  at: { source: string; listing: BrowseListing | null },
  reason: WorkerFailure | "unsupported",
): TRPCError {
  const t = messages(locale);
  const facts = { source: at.source, listing: at.listing };
  switch (reason) {
    // A source with nothing to choose from. The request will never succeed, so BAD_REQUEST;
    // the facts say so, which is what keeps an agent from "fixing the input" and retrying.
    case "unsupported":
      return refusal("BAD_REQUEST", t("error.browseUnsupported", { source: at.source }), {
        ...facts,
        reason: "unsupported",
        remedy: "none",
      });
    // Google refused the grant, or the recorded grant lacks the scope -- a Drive grant from
    // before ADR 0047 is `drive.file`, which Google answers with an empty list rather than a
    // refusal, so the worker refuses it by the recorded scope instead. HubSpot's token is a
    // private app's, and its remedy is worded for that: there is no consent screen to tick.
    case "scope-insufficient":
      return refusal(
        "PRECONDITION_FAILED",
        at.listing === "properties"
          ? t("error.propertiesInsufficient")
          : t("error.scopeInsufficient", { source: at.source }),
        { ...facts, reason: "scope-insufficient", remedy: "reconnect" },
      );
    // The credential itself is dead -- lapsed with nothing to refresh it, or its refresh token
    // refused -- and the connection now reads `expired`. Worded apart from the case above: there
    // is no permission to tick, only a source to connect again. Worded apart from the catch-all
    // below, which is what it used to be, and which named no remedy at all (issue 213).
    case "credential-expired":
      return refusal("PRECONDITION_FAILED", t("error.credentialExpired", { source: at.source }), {
        ...facts,
        reason: "credential-expired",
        remedy: "reconnect",
      });
    case "unreachable":
      return refusal("PRECONDITION_FAILED", t("error.workerUnavailable"), {
        ...facts,
        reason: "worker-unreachable",
        remedy: "retry-later",
      });
    default:
      return refusal("BAD_REQUEST", t("error.browseRefused", { source: at.source }), {
        ...facts,
        reason: "refused",
        remedy: "none",
      });
  }
}

/**
 * Why a listing could not be cut as asked (issue 443, ADR 0125). Each is the request's fault,
 * and the facts say what to change -- leave the parent out, name an id the listing holds, start
 * the pages again -- never "retry", which would only be refused the same way.
 */
export function cutRefusal(
  locale: Locale,
  at: { source: string; listing: BrowseListing; parentId: string | null | undefined },
  reason: ChoiceRefusal,
): TRPCError {
  const t = messages(locale);
  const facts = { source: at.source, listing: at.listing, reason };
  switch (reason) {
    case "not-a-tree":
      return refusal("BAD_REQUEST", t("error.browseNotTree", { source: at.source }), {
        ...facts,
        remedy: "omit-parent",
      });
    case "unknown-parent":
      return refusal(
        "NOT_FOUND",
        t("error.browseParentUnknown", { source: at.source, parentId: at.parentId ?? "" }),
        { ...facts, parentId: at.parentId ?? null, remedy: "none" },
      );
    default:
      return refusal("BAD_REQUEST", t("error.browseCursorUnknown", { source: at.source }), {
        ...facts,
        remedy: "restart",
      });
  }
}
