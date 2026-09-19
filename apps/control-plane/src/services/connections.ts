/**
 * What a tenant has connected, as the schedule of standing grants renders it.
 *
 * The screen this feeds IS the product: the page a new customer lands on is the one an
 * established one uses. So the decisions live here rather than in the component -- whether a
 * grant has lapsed, whether it is waiting for somebody to choose a scope, whether a source
 * nobody has touched should appear at all -- and each is a pure function a test can ask from
 * both sides.
 *
 * Nothing here opens a credential. `app.connection_secret.ciphertext` is never selected, and
 * the control plane could not open it anyway: it holds no master key. What it MAY know is
 * *when* a credential expires, which is what turns "which connections need attention" into a
 * query rather than a decrypt-everything loop.
 *
 * Knowing it is not the same as showing it. `credentialExpiresAt` is when the access token
 * rotates -- an hour after consent, on a schedule the worker keeps by itself -- and it is
 * deliberately not what the card's `expiresAt` carries. See that field.
 */

import { parseScope } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import {
  type Connection,
  type ConnectionView,
  getConnection,
  listConnections,
  listConnectionViews,
  setStatus,
  writeConnectionDetail,
} from "@undercroft/db/repos";

import { record as recordAudit } from "../repos/auditLog.ts";
import { grantCovers, requestedScopeFor } from "./oauth.ts";
import type { WorkerClient } from "./workerClient.ts";

export type { Connection };

/**
 * The sources the schedule always shows.
 *
 * Duplicated from the UI's own list on purpose. The UI's copy also carries display names and
 * the consent sentences, which are product copy and must not be owned by a database column.
 * What is shared is only the set of names, so a drift shows up as a source missing from a
 * screen rather than as a wrong promise on one.
 */
export const KNOWN_SOURCES = ["hubspot", "xero", "gmail", "drive"] as const;

/** Narrow, so the union survives tRPC inference and the UI can index its label maps. */
export type KnownSource = (typeof KNOWN_SOURCES)[number];

/** Sources that must be told what to read before a run may read anything. */
const SCOPED_SOURCES = new Set(["gmail", "drive"]);

/**
 * What the card shows, which is not what the database stores.
 *
 * `needs_scope` and `needs_reconnect` are derivations rather than columns. A status column
 * carrying them would have to be written by somebody, and the two facts that produce them --
 * "no selection recorded" and "the credential is finished" -- are already stored elsewhere
 * and already true. A second copy is a second thing to keep in step.
 */
export type CardStatus = "disconnected" | "connected" | "needs_scope" | "needs_reconnect";

export interface ConnectionCardView {
  readonly source: KnownSource;
  readonly status: CardStatus;
  readonly externalAccountId: string;
  readonly externalAccountLabel: string;
  readonly scopes: string[];
  readonly config: { labels?: string[]; folderIds?: string[]; entities?: string[] };
  /**
   * When this GRANT lapses -- the date after which the customer has to consent again.
   *
   * Always `null` for now, and honestly so: no provider we speak to tells us one. Google's
   * refresh token has no announced end (a project still in Testing loses it after seven days,
   * which is a property of the console setting rather than of the grant, and nothing in the
   * token response says which); Xero's dies after sixty days unused, which is a date that
   * moves every time a run succeeds; HubSpot's private-app token genuinely never expires. The
   * card renders the absence as "no expiry recorded", which is the true statement.
   *
   * **It is NOT `credentialExpiresAt`.** That is the access token's hourly rotation, which
   * the worker handles without telling anybody, and feeding it to this field is what made a
   * healthy connection announce "expires today" and then demand a reconnect an hour later.
   * Rule 2 cuts both ways: a value we do not have is left empty rather than filled with the
   * nearest number to hand.
   */
  readonly expiresAt: string | null;
  readonly lastRunId: string;
  /**
   * Always `""` for now. Kestra owns schedules and nothing in this database writes one; a
   * column would be a promise nobody keeps, and the card already renders an absent value as
   * absent rather than as "never".
   */
  readonly scheduleCron: string;
}

/**
 * Turn a stored row into the status the card shows.
 *
 * Pure and exported, so the rule deciding whether a customer is asked to reconnect is tested
 * with no database.
 */
export function presentStatus(row: {
  status: Connection["status"];
  selectionJson: string;
  source: string;
  /**
   * What Google said it granted. Required rather than optional on purpose: a caller that
   * could omit it would silently skip the grant check below, which is the very failure
   * this function exists to surface.
   */
  scope: string;
}): CardStatus {
  // `error` and `expired` are both "this will not run until somebody acts", and the card has
  // one state for that. Keeping them apart on screen would ask a customer to tell a token
  // expiry from a provider fault, which is not their question to answer.
  if (row.status === "error" || row.status === "expired") {
    return "needs_reconnect";
  }
  if (row.status === "disconnected") {
    return "disconnected";
  }
  // Connected, and holding a grant that cannot do the job. Google's consent screen lets a
  // person untick one permission and press Allow, which yields a working token for a
  // narrower grant -- `case-001` sat at `connected` on `openid email` alone, and said so on
  // the card while every Gmail call came back 403.
  //
  // A reconnect is the only repair, so this is `needs_reconnect` rather than a fourth state:
  // the copy and the button for "your grant no longer works, connect again" already exist
  // and already say the right thing.
  //
  // An EMPTY scope column is left alone deliberately. It means nothing was recorded -- rows
  // predating the column, and every source that does not go through Google -- and rule 2
  // forbids turning no evidence into a verdict in either direction.
  if (row.scope !== "" && !grantCovers(requestedScopeFor(row.source), row.scope)) {
    return "needs_reconnect";
  }
  // Connected, but nobody has said what may be read. Running in this state would read a
  // whole mailbox on the strength of a missing row.
  if (SCOPED_SOURCES.has(row.source) && parseScope(row.source, row.selectionJson) === null) {
    return "needs_scope";
  }
  return "connected";
}

/**
 * Every source, connected or not.
 *
 * A tenant with nothing connected previously got `[]`, and the schedule -- which is the
 * product -- had nothing to offer on the very screen a new customer lands on. A source with
 * no row is synthesised as `disconnected`, which is what it is.
 */
export async function list(exec: SqlExecutor, tenantId: string): Promise<ConnectionCardView[]> {
  const rows = await listConnectionViews(exec, tenantId);
  // Typed explicitly: an inferred tuple widens to `(string | ConnectionView)[]` and the map
  // loses its value type.
  const bySource = new Map<string, ConnectionView>(rows.map((row) => [row.source, row]));

  return KNOWN_SOURCES.map((source) => {
    const row = bySource.get(source);
    if (row === undefined) {
      return {
        source,
        status: "disconnected" as const,
        externalAccountId: "",
        externalAccountLabel: "",
        scopes: [],
        config: {},
        expiresAt: null,
        lastRunId: "",
        scheduleCron: "",
      };
    }
    return {
      source,
      status: presentStatus(row),
      externalAccountId: row.externalAccountId ?? "",
      externalAccountLabel: row.accountLabel,
      // Google returns what it granted as one space-delimited string.
      scopes: row.scope === "" ? [] : row.scope.split(" "),
      config: configOf(row.source, row.selectionJson),
      // Not `row.credentialExpiresAt`. See the field.
      expiresAt: null,
      lastRunId: row.lastRunId,
      scheduleCron: "",
    };
  });
}

export function get(
  exec: SqlExecutor,
  tenantId: string,
  source: string,
): Promise<Connection | null> {
  return getConnection(exec, tenantId, source);
}

/** The stored rows, for a caller that wants what is recorded rather than what is shown. */
export function listRaw(exec: SqlExecutor, tenantId: string): Promise<Connection[]> {
  return listConnections(exec, tenantId);
}

export type SetScopeOutcome = { ok: true } | { ok: false; reason: "unsupported-source" };

/**
 * Record what an admin chose to share.
 *
 * The audit entry carries a COUNT, never the names. What was decided and by whom is what a
 * trail is for; which folders a customer picked is their data, and `ops.audit_log` has a
 * wider readership than `app.connection_detail` does.
 */
export async function setScope(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    source: string;
    selectionJson: string;
    actor: string;
    actorId: string;
  },
): Promise<SetScopeOutcome> {
  const scope = parseScope(input.source, input.selectionJson);
  if (scope === null) {
    return { ok: false, reason: "unsupported-source" };
  }

  await writeConnectionDetail(exec, {
    tenantId: input.tenantId,
    source: input.source,
    selectionJson: input.selectionJson,
    chosenBy: input.actorId,
  });

  try {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "connection.scope_set",
      detail: JSON.stringify({
        source: input.source,
        count: scope.kind === "gmail" ? scope.labels.length : scope.files.length,
      }),
    });
  } catch {
    // Swallowed like every other audit write here: a failed insert must not lose a scope an
    // admin has already saved.
  }

  return { ok: true };
}

export interface DisconnectResult {
  /** Whether the provider was told. Reported, never assumed; see `revokeConnection`. */
  readonly revokedUpstream: boolean;
}

/**
 * End a grant.
 *
 * The worker revokes at the provider and deletes the sealed credential, because it is the
 * only process that may touch one. What is left here is our side: the status, the scope and
 * the trail. The `ops.connection` row itself stays -- `external_account_id` is history worth
 * keeping, and a customer reconnecting the same account should look like the same account.
 */
export async function disconnect(
  exec: SqlExecutor,
  worker: WorkerClient | null,
  input: { tenantId: string; source: string; actor: string },
): Promise<DisconnectResult> {
  let revokedUpstream = false;
  if (worker !== null) {
    const outcome = await worker.revokeConnection({
      tenantId: input.tenantId,
      source: input.source,
    });
    revokedUpstream = outcome.ok && outcome.value.revokedUpstream;
  }

  await setStatus(exec, input.tenantId, input.source, "disconnected");
  // The selection goes with it. A stored scope for a connection nobody may use is a record
  // of what a customer once shared, kept past the moment they asked us to stop.
  await writeConnectionDetail(exec, {
    tenantId: input.tenantId,
    source: input.source,
    selectionJson: "{}",
  });

  try {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "connection.disconnected",
      detail: JSON.stringify({ source: input.source, revokedUpstream }),
    });
  } catch {
    // As above.
  }

  return { revokedUpstream };
}

/** The shape `scopeSummary` in the UI reads. */
function configOf(
  source: string,
  selectionJson: string,
): { labels?: string[]; folderIds?: string[]; entities?: string[] } {
  const scope = parseScope(source, selectionJson);
  if (scope === null) {
    return {};
  }
  if (scope.kind === "gmail") {
    return { labels: scope.labels.map((l) => l.name) };
  }
  return { folderIds: scope.files.map((f) => f.id) };
}
