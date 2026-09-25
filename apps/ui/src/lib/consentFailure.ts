/**
 * A consent that failed, as the page reads it and as it words it.
 *
 * One module because it is one piece of knowledge: the callback (`handlers/oauth.ts` in the
 * control plane, `failurePath`) sends the browser back with `?connect=failed&reason=…&source=…`,
 * and this is the only reader of that address. The route renders what it is handed.
 *
 * A consent that failed before it left -- `startOAuth` refused -- has no URL to read, and gets
 * only the heading: its sentence is the server's own.
 */

import { sourceKind } from "@undercroft/contracts/sources";
import type { TFunction } from "i18next";

import { isSource, SOURCE_LABEL } from "@/api/types.ts";

/**
 * A consent that came back refused, as the callback's redirect describes it: why, and which
 * source it was for. Either may be missing from a hand-edited URL.
 */
export interface FailedReturn {
  readonly reason: string | null;
  readonly source: string | null;
}

/** The failed return this page was reached by, or `null` when it was not reached by one. */
export function failedReturnFrom(params: URLSearchParams): FailedReturn | null {
  return params.get("connect") === "failed"
    ? { reason: params.get("reason"), source: params.get("source") }
    : null;
}

/**
 * Which sentence a failed consent gets, from the reason the callback redirected with.
 *
 * Three outcomes rather than two. `scope-declined` is not a cancellation: the admin pressed
 * Allow with the one permission that matters unticked, which Google accepts and we refuse.
 * Told only "this source could not be connected", they repeat the exact steps that produced
 * it -- so the case that names the tick to leave alone has to be its own sentence.
 *
 * Two more since a tenant may hold several Google accounts of one kind (ADR 0043), and both
 * are about WHICH account consented rather than whether anybody did. `account-mismatch` is a
 * reconnect finished by somebody else's Google account, or by one already connected under
 * another entry -- most often an admin who meant to add a second mailbox, so its sentence
 * names the plate that does that. `account-unidentified` is Google not saying who consented,
 * and its sentence says the one thing that fixes it.
 *
 * A function rather than a chain inside the JSX, because it is a decision with a name and
 * the compiler checks each key against the catalogue.
 */
export function connectFailureKey(
  reason: string | null,
):
  | "grant.connectDeclined"
  | "grant.connectScopeDeclined"
  | "grant.connectAccountMismatch"
  | "grant.connectAccountUnidentified"
  | "grant.connectFailed" {
  switch (reason) {
    case "declined":
      return "grant.connectDeclined";
    case "scope-declined":
      return "grant.connectScopeDeclined";
    case "account-mismatch":
      return "grant.connectAccountMismatch";
    case "account-unidentified":
      return "grant.connectAccountUnidentified";
    default:
      return "grant.connectFailed";
  }
}

/**
 * The heading over a failed consent: the vendor whose Connect was pressed, where the page
 * knows it.
 *
 * By vendor -- the name on the card's own Connect plate -- rather than by account, because a
 * consent that failed may be for an account nobody here holds yet. Without a source the page
 * can read, a hand-edited URL, it says "this source" rather than guessing one.
 */
export function connectFailedHeading(t: TFunction, source: string | null): string {
  const kind = sourceKind(source ?? "");
  return isSource(kind)
    ? t("grant.connectFailedFor", { name: SOURCE_LABEL[kind] })
    : t("grant.connectFailed");
}
