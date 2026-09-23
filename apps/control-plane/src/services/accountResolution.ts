/**
 * Which connection a consent belongs to -- decided from WHO consented, never guessed.
 *
 * A tenant may hold several accounts of one kind, each a source of its own (`gmail`,
 * `gmail.3fa9c1d2e0ab`; ADR 0043). A consent arrives naming the Google account that granted it,
 * by its opaque `sub`, and this module decides which source it is sealed under. The decision,
 * `resolveAccount`, is pure; the two reads around it are here so `oauth.ts` stays the flow.
 *
 * THE FAILURE THIS EXISTS TO REFUSE is the quiet one. "Reconnect" on mailbox A, completed by a
 * browser signed in as B, used to seal B's token under A's source -- and every run after it
 * filed B's mail under A's stream, green, with nothing erroring. So:
 *
 * - **A (re)connect is pinned.** The target's recorded account must be the one that consented,
 *   and the account must not already be connected under another source: two sources for one
 *   mailbox is the double count the issue measured at 18%.
 * - **An add resolves by identity.** An account already held is reconnected where it is, never
 *   duplicated; a new one gets the bare source if the kind has none yet, and a derived source
 *   of its own otherwise.
 * - **No identity is not a match.** A consent that names nobody cannot be keyed or pinned, and a
 *   bare connection that never recorded who it was cannot be told apart from the account being
 *   added -- both are refused rather than resolved by the likelier reading. CLAUDE.md rule 2.
 *
 * This is the path, not the guard. The guard is `upsertConnection`'s own `WHERE`, which holds
 * for two consents racing between this read and the seal; see `packages/db/src/repos/connections.ts`.
 */

import {
  accountSourceOf,
  MULTI_ACCOUNT_KINDS,
  parseSourceInstance,
  sourceKind,
} from "@undercroft/contracts";
import { hashToken } from "@undercroft/crypto";
import type { SqlExecutor } from "@undercroft/db";
import { getConnection, listConnections, readConnectionDetail } from "@undercroft/db/repos";

/** One connection of the consent's kind, as far as resolving an account needs it. */
export interface AccountRow {
  readonly source: string;
  /** Google's opaque `sub`, or empty/null where none was ever recorded. */
  readonly externalAccountId: string | null;
}

export type AccountResolution =
  | { ok: true; source: string }
  | { ok: false; reason: "account-mismatch" | "account-unidentified" };

/** The source a further account of `kind` lands under. Deterministic in the account. */
export function accountSourceFor(kind: string, sub: string): string {
  return accountSourceOf(kind, hashToken(sub));
}

/**
 * Resolve a consent to the source it seals under, or refuse it.
 *
 * `rows` are this tenant's connections of the target's kind -- every account, connected or not.
 * A kind that holds one account (Xero, HubSpot) resolves to its target unchanged; its pin, if
 * any, is the repo's.
 */
export function resolveAccount(input: {
  target: string;
  adding: boolean;
  sub: string;
  rows: readonly AccountRow[];
}): AccountResolution {
  const kind = sourceKind(input.target);
  if (!MULTI_ACCOUNT_KINDS.has(kind)) {
    return { ok: true, source: input.target };
  }
  if (input.sub === "") {
    return { ok: false, reason: "account-unidentified" };
  }

  const holder = input.rows.find((row) => row.externalAccountId === input.sub);
  return input.adding
    ? resolveAdd(kind, input.sub, holder, input.rows)
    : resolveConnect(input.target, input.sub, holder, input.rows);
}

function resolveAdd(
  kind: string,
  sub: string,
  holder: AccountRow | undefined,
  rows: readonly AccountRow[],
): AccountResolution {
  // Already held: this is a reconnect of that account, wherever it lives.
  if (holder !== undefined) {
    return { ok: true, source: holder.source };
  }
  const bare = rows.find((row) => row.source === kind);
  // The kind's first account keeps the bare name, so a tenant with one mailbox looks exactly
  // as it did before several were possible.
  if (bare === undefined) {
    return { ok: true, source: kind };
  }
  // A first account that never recorded who it is could BE the one being added. Resolving
  // either way is a guess; reconnecting it first records its identity and ends the question.
  if ((bare.externalAccountId ?? "") === "") {
    return { ok: false, reason: "account-unidentified" };
  }
  return { ok: true, source: accountSourceFor(kind, sub) };
}

function resolveConnect(
  target: string,
  sub: string,
  holder: AccountRow | undefined,
  rows: readonly AccountRow[],
): AccountResolution {
  // Connected elsewhere already: sealing it here too would read one mailbox twice.
  if (holder !== undefined && holder.source !== target) {
    return { ok: false, reason: "account-mismatch" };
  }
  const recorded = rows.find((row) => row.source === target)?.externalAccountId ?? "";
  if (recorded !== "" && recorded !== sub) {
    return { ok: false, reason: "account-mismatch" };
  }
  // A derived source names its account by construction, so only that account may fill it.
  const account = parseSourceInstance(target)?.account ?? null;
  if (account !== null && accountSourceFor(sourceKind(target), sub) !== target) {
    return { ok: false, reason: "account-mismatch" };
  }
  return { ok: true, source: target };
}

/**
 * What a consent may be asked to do, or `null` for a request no button could have made.
 *
 * An add starts from the bare kind and only for a kind that holds several accounts. A
 * (re)connect of a DERIVED source needs that source to exist: `gmail.<key>` names one account
 * by construction, and a consent to a made-up key would seal somebody under a name that is not
 * theirs. ADR 0043.
 */
export async function consentTarget(
  exec: SqlExecutor,
  input: { tenantId: string; source: string; addAccount: boolean },
): Promise<{ loginHint: string } | null> {
  const instance = parseSourceInstance(input.source);
  if (instance === null) {
    return null;
  }
  if (input.addAccount) {
    return MULTI_ACCOUNT_KINDS.has(instance.kind) && instance.account === null
      ? { loginHint: "" }
      : null;
  }
  if (instance.account !== null) {
    const existing = await getConnection(exec, input.tenantId, input.source);
    if (existing === null) {
      return null;
    }
  }
  // A reconnect of a named account says which one to Google, so a browser signed into several
  // offers the right one first. A hint, not a guard: the pin at the callback is the guard.
  const detail = MULTI_ACCOUNT_KINDS.has(instance.kind)
    ? await readConnectionDetail(exec, input.tenantId, input.source)
    : null;
  return { loginHint: detail?.accountLabel ?? "" };
}

/** This tenant's connections of the handshake's kind, resolved against who consented. */
export async function resolveFor(
  exec: SqlExecutor,
  handshake: { tenantId: string; source: string; addsAccount: boolean },
  sub: string,
): Promise<AccountResolution> {
  const kind = sourceKind(handshake.source);
  const rows = (await listConnections(exec, handshake.tenantId)).filter(
    (row) => sourceKind(row.source) === kind,
  );
  return resolveAccount({ target: handshake.source, adding: handshake.addsAccount, sub, rows });
}
