/**
 * The end of a consent that is known good: which connection it seals under, and the sealing.
 *
 * Split from `oauth.ts` so that file stays the flow -- state, authority, exchange, grant --
 * and this one holds what happens once all four have said yes. Two steps, in order: resolve
 * the account the consent belongs to (`accountResolution.ts`, ADR 0043), then seal, label and
 * audit under it.
 */

import { writeConnectionDetail } from "@undercroft/db/repos";

import { record as recordAudit } from "../repos/auditLog.ts";
import { resolveFor } from "./accountResolution.ts";
import type { CompleteDeps, CompleteOutcome } from "./oauth.ts";
import type { exchangeCode } from "./tokenExchange.ts";

/**
 * Everything after the consent is known good: seal the credential, label the card, audit it.
 *
 * The ORDER is the point. The worker seals first, because it is the only process holding the
 * master key (ADR 0016); the address is written only once the worker has confirmed, since a
 * label for a connection that does not exist is worse than no label; and the audit insert is
 * swallowed, because a failed audit must not undo a consent Google has already accepted.
 */
async function sealAndRecord(
  deps: CompleteDeps,
  input: {
    handshake: { tenantId: string; source: string };
    exchanged: Awaited<ReturnType<typeof exchangeCode>> & object;
    caller: { userId: string; email: string };
  },
): Promise<CompleteOutcome> {
  const { handshake, exchanged, caller } = input;
  const { worker } = deps;
  if (worker === undefined) {
    return { ok: false, reason: "not-configured" };
  }

  const stored = await worker.storeCredential({
    source: handshake.source,
    tenantId: handshake.tenantId,
    // Google's opaque `sub`, never the address: `ops.connection` is readable by BI. Xero
    // names nobody here; its organisation id is recorded when the admin chooses one.
    externalAccountId: exchanged.sub,
    scope: exchanged.scope,
    credential: {
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
      expiresAt: exchanged.expiresAt,
    },
  });
  if (!stored.ok) {
    return {
      ok: false,
      reason: stored.reason === "account-mismatch" ? "account-mismatch" : "worker-refused",
      tenantId: handshake.tenantId,
      source: handshake.source,
    };
  }

  // The address, for the card. `app.connection_detail`, never `ops.connection`, which BI
  // can read. Written only after the worker confirmed the credential is sealed: a label for
  // a connection that does not exist is worse than no label. A provider that names nobody
  // writes nothing; the organisation's name arrives with the scope.
  if (exchanged.email !== "") {
    await writeConnectionDetail(deps.exec, {
      tenantId: handshake.tenantId,
      source: handshake.source,
      accountLabel: exchanged.email,
    });
  }

  // Swallowed exactly as `recordRefusal` swallows its own, and for the same reason: a
  // failed audit insert must not undo a consent that has already succeeded at the provider.
  try {
    await recordAudit(deps.exec, {
      tenantId: handshake.tenantId,
      actor: caller.email,
      action: "connection.connected",
      // Which source and who. Not the address: that is in `connection_detail`, and
      // `ops.audit_log` has a different readership.
      detail: JSON.stringify({ source: handshake.source }),
    });
  } catch {
    // Intentionally ignored; see above.
  }

  return {
    ok: true,
    tenantId: handshake.tenantId,
    source: handshake.source,
    accountLabel: exchanged.email,
  };
}

/**
 * Seal under the source the consenting account resolves to.
 *
 * An add is resolved ONCE MORE if the worker refuses it as another account's: two admins adding
 * two different mailboxes at the same moment both read "no first account yet", both resolve to
 * the bare source, and the worker's pin lets exactly one of them in. The loser's second read
 * sees the winner and resolves to a source of its own. A (re)connect is not retried -- its
 * refusal is the answer.
 */
export async function sealResolved(
  deps: CompleteDeps,
  input: {
    handshake: { tenantId: string; source: string; addsAccount: boolean };
    exchanged: Awaited<ReturnType<typeof exchangeCode>> & object;
    caller: { userId: string; email: string };
  },
): Promise<CompleteOutcome> {
  const first = await sealOnce(deps, input);
  if (!input.handshake.addsAccount || first.ok || first.reason !== "account-mismatch") {
    return first;
  }
  return await sealOnce(deps, input);
}

async function sealOnce(
  deps: CompleteDeps,
  input: Parameters<typeof sealResolved>[1],
): Promise<CompleteOutcome> {
  const { handshake, exchanged } = input;
  const resolved = await resolveFor(deps.exec, handshake, exchanged.sub);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      tenantId: handshake.tenantId,
      source: handshake.source,
    };
  }
  return await sealAndRecord(deps, {
    ...input,
    handshake: { tenantId: handshake.tenantId, source: resolved.source },
  });
}
