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

import {
  type BrowseListing,
  type Cadence,
  cadenceSetting,
  type ConnectionScope,
  type ConnectorEntity,
  type CronRefusal,
  needsScope,
  nextRunAt,
  parseScope,
  parseSourceInstance,
  partitionByGrant,
  sourceKind,
  type UngrantedRead,
} from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import {
  type Connection,
  type ConnectionView,
  type LastRun,
  getConnection,
  listConnections,
  listConnectionViews,
  listWholeReads,
  setCadence as writeCadence,
  setExternalAccount,
  setResync as writeResync,
  setStatus,
  type WholeRead,
  writeConnectionDetail,
} from "@undercroft/db/repos";

import { record as recordAudit } from "../repos/auditLog.ts";
import { missingScopes, requestedScopeFor } from "./oauth.ts";
import type { WorkerClient } from "./workerClient.ts";

export type { Connection } from "@undercroft/db/repos";

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

/**
 * What the card shows, which is not what the database stores.
 *
 * `needs_scope` and `needs_reconnect` are derivations rather than columns. A status column
 * carrying them would have to be written by somebody, and the two facts that produce them --
 * "no selection recorded" and "the credential is finished" -- are already stored elsewhere
 * and already true. A second copy is a second thing to keep in step.
 */
export type CardStatus = "disconnected" | "connected" | "needs_scope" | "needs_reconnect";

/**
 * The lists each connector spec this deployment carries reads, and the scope each is read under,
 * keyed by the kind of source it is read for, which is the spec's file name.
 *
 * The spec's own `entities`, read once at boot (`../specs.ts`), never a copy of them: the card
 * judges a grant by the same `readScope` the run does. A kind with no spec here -- Gmail and
 * Drive, which read under one scope and have no lists to share it out over -- is judged whole.
 */
export type SpecReads = ReadonlyMap<string, SpecRead>;

/** What the card reads of one spec: its lists, and how many whole-read requests a day it allows. */
export interface SpecRead {
  readonly entities: readonly Pick<ConnectorEntity, "name" | "readScope" | "incremental">[];
  /**
   * The spec's `wholeReadBudget.requestsPerDay`, or `null` for a spec that rations no whole
   * reads -- whose re-sync, however large, never has to wait for another day (ADR 0082).
   */
  readonly wholeReadsPerDay: number | null;
}

/** The status a card shows, and the lists its connection would read that its grant cannot. */
export interface CardGrant {
  readonly status: CardStatus;
  /**
   * In spec order, each with the scope a reconnect would add. Empty unless the grant still reads
   * some of what the connection chose and lacks the scope of the rest; see `presentStatus`.
   */
  readonly ungranted: readonly UngrantedRead[];
}

export interface ConnectionCardView {
  /** What this connection IS -- which labels, access statement and consent it has. */
  readonly kind: KnownSource;
  /**
   * Which connection: the kind itself for its first account, `<kind>.<account key>` for each
   * further one (ADR 0043). Every per-connection procedure takes this, never the kind, so an
   * action on the card acts on the account the card shows.
   */
  readonly source: string;
  readonly status: CardStatus;
  /**
   * The lists this connection would read that its recorded grant cannot, each with the scope a
   * reconnect would add, in spec order. A run skips exactly these and names each as not granted
   * (ADR 0073); the card names them before it does. Empty for every grant that is whole.
   */
  readonly ungranted: readonly UngrantedRead[];
  readonly externalAccountId: string;
  readonly externalAccountLabel: string;
  readonly scopes: string[];
  readonly config: {
    labels?: string[];
    /**
     * What was picked in Drive: id, name, and WHICH KIND each pick is.
     *
     * The kind is load-bearing rather than decorative. This used to be `folderIds: string[]`,
     * and the scope picker rebuilt its draft from it as `{ id, name: id, kind: "folder" }` --
     * so a directly-picked FILE was read back as a folder, and an admin who re-saved without
     * re-picking turned it into a folder pick that lists nothing and refuses. The names are
     * the ones the picker showed at pick time and stay inside `app`, which no BI role has
     * USAGE on; `raw` sees none of this.
     */
    files?: { id: string; name: string; kind: "folder" | "file" }[];
    /** Whether a picked Drive folder is read to the bottom. ADR 0031. */
    recurse?: boolean;
    entities?: string[];
    fileTypes?: string[];
    /**
     * HubSpot: the properties each object reads beyond its spec's own, by internal name --
     * what the picker re-ticks and the card counts. Absent when nobody has chosen any.
     */
    properties?: Record<string, string[]>;
  };
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
  /**
   * The newest ingest run for this source, or `null` when there has never been one. The
   * card prints its outcome, its time and how much it saw; the Journal holds the rest.
   */
  readonly lastRun: LastRun | null;
  /** How often this source is read: a preset, or `custom`. `daily` until an admin says otherwise. */
  readonly cadence: Cadence;
  /**
   * The expression a `custom` cadence fires on, in Singapore time; `null` for every preset.
   * Shown as written -- the card prints the fires it produces beside it rather than a
   * paraphrase of it (ADR 0059).
   */
  readonly cron: string | null;
  /**
   * When this source is next due, or `null` when nothing will run: disconnected, paused, or
   * waiting for a scope. A value in the past means "at the scheduler's next tick" -- the
   * rule is `nextRunAt` in `@undercroft/contracts`, the same one the due list applies.
   */
  readonly nextRunAt: string | null;
  /**
   * Reading this connection's lists WHOLE again, on a schedule of its own: a watermark vouches
   * only for what a source's change filter can see, and Xero documents edits its filter never
   * returns (ADR 0082). `null` for a source with no list read through such a filter -- there is
   * nothing to re-sync, and the card offers no schedule for it.
   */
  readonly resync: ResyncView | null;
}

export interface ResyncView {
  /** `paused` until an admin opts in, in the same words as `cadence`. */
  readonly cadence: Cadence;
  readonly cron: string | null;
  /**
   * The start of the run that last read the stalest of these lists whole, or `null` while any
   * of them has none recorded: the whole connection is only as fresh as its oldest list.
   */
  readonly lastWholeReadAt: string | null;
  /**
   * How many days one re-sync of every list takes at the provider's daily limit, from what each
   * list's last complete whole read cost; `null` until every list has completed one, or for a
   * spec that rations nothing. Above 1, the card warns that a re-sync spans days.
   */
  readonly days: number | null;
  /** The whole-read requests a day the spec allows, which `days` is measured against; `null` for none. */
  readonly budget: number | null;
}

/**
 * Turn a stored row into the status the card shows, and the lists its grant cannot read.
 *
 * Pure and exported, so the rule deciding whether a customer is asked to reconnect is tested
 * with no database.
 */
export function presentStatus(
  row: {
    status: Connection["status"];
    selectionJson: string;
    source: string;
    /**
     * What the provider said it granted. Required rather than optional on purpose: a caller
     * that could omit it would silently skip the grant check below, which is the very failure
     * this function exists to surface.
     */
    scope: string;
  },
  specs: SpecReads,
): CardGrant {
  // `error` and `expired` are both "this will not run until somebody acts", and the card has
  // one state for that. Keeping them apart on screen would ask a customer to tell a token
  // expiry from a provider fault, which is not their question to answer.
  if (row.status === "error" || row.status === "expired") {
    return { status: "needs_reconnect", ungranted: [] };
  }
  if (row.status === "disconnected") {
    return { status: "disconnected", ungranted: [] };
  }
  // An EMPTY scope column is left alone deliberately. It means nothing was recorded -- rows
  // predating the column, and a source with a pasted token -- and rule 2 forbids turning no
  // evidence into a verdict in either direction.
  const ungranted = row.scope === "" ? [] : grantShortfall(row, specs);
  if (ungranted === null) {
    return { status: "needs_reconnect", ungranted: [] };
  }
  // Connected, but nobody has said what may be read. Running in this state would read a
  // whole mailbox on the strength of a missing row.
  if (needsScope(row.source, row.selectionJson)) {
    return { status: "needs_scope", ungranted };
  }
  return { status: "connected", ungranted };
}

/**
 * What a recorded grant lacks, judged against what the connection reads: `[]` when nothing it
 * reads, the lists it cannot read when it can still read the rest, and `null` when it cannot
 * run at all.
 *
 * Google's consent screen lets a person untick one permission and press Allow, which yields a
 * working token for a narrower grant -- `case-001` sat at `connected` on `openid email` alone,
 * and said so on the card while every Gmail call came back 403. Gmail and Drive read under ONE
 * scope, so a grant without it reads nothing, and a reconnect is the only repair: `null`, which
 * the card shows with the copy and the button that already say so.
 *
 * A spec source reads each list under the scope its spec names (`readScope`), and a consent that
 * gained a scope leaves every grant recorded before it still able to read the other lists. Xero
 * asked for `accounting.settings.read` only from ADR 0073, and a run on an older grant reads
 * twelve lists and names the five it cannot; the bank and journal scopes (#308) did the same. So the grant is shared out over the lists the
 * connection would read, by the run's own rule (`partitionByGrant`), and it is runnable while
 * any of them is granted -- with the rest named, so the card says what a reconnect would add.
 * One that reaches none of them is `null`: a run would read nothing and fail. ADR 0074.
 *
 * A missing capability that gates no list at all -- Xero's `offline_access`, without which no
 * refresh token is issued -- is not something the run can read around, so it is `null` too.
 */
function grantShortfall(
  row: { source: string; selectionJson: string; scope: string },
  specs: SpecReads,
): readonly UngrantedRead[] | null {
  const missing = missingScopes(requestedScopeFor(row.source), row.scope);
  if (missing.length === 0) {
    return [];
  }
  const lists = specs.get(sourceKind(row.source))?.entities;
  if (lists === undefined) {
    return null;
  }
  const gating = new Set(lists.map((read) => read.readScope));
  if (missing.some((scope) => !gating.has(scope))) {
    return null;
  }
  const { granted, ungranted } = partitionByGrant(lists, {
    scope: parseScope(row.source, row.selectionJson),
    grantedScope: row.scope,
  });
  return granted.length === 0 ? null : ungranted;
}

/** The listing each kind's scope is chosen from. By kind, so a second account browses too. */
const BROWSE_LISTINGS: ReadonlyMap<string, BrowseListing> = new Map<string, BrowseListing>([
  ["gmail", "labels"],
  ["xero", "organisations"],
  ["drive", "folders"],
  ["hubspot", "properties"],
]);

/**
 * Which listing a source's scope is chosen from, or `null` for a source chosen from none.
 *
 * Decided here rather than by asking the worker and reading its refusal: "the processing
 * service could not fetch the list" is not true of a list that does not exist. It used to be
 * decided inline as "Xero, else labels", which sent Drive to the worker asking for Gmail labels
 * -- issue 177. HubSpot had no listing until its properties could be chosen (issue 202).
 */
export function browseListingFor(source: string): BrowseListing | null {
  return BROWSE_LISTINGS.get(sourceKind(source)) ?? null;
}

/**
 * The connections of one kind, as the schedule lists them: the first account, then the rest by
 * the address a person reads.
 *
 * A row whose source is not a well-formed account of this kind is left out rather than shown:
 * it is not a connection anything can run, and no button on it could work.
 */
function accountsOf(rows: readonly ConnectionView[], kind: KnownSource): ConnectionView[] {
  return rows
    .filter((row) => parseSourceInstance(row.source)?.kind === kind)
    .toSorted((a, b) => {
      if (a.source === kind || b.source === kind) {
        return a.source === kind ? -1 : 1;
      }
      return a.accountLabel.localeCompare(b.accountLabel) || a.source.localeCompare(b.source);
    });
}

/**
 * Every source, connected or not -- and every ACCOUNT of a kind that may hold several.
 *
 * A tenant with nothing connected previously got `[]`, and the schedule -- which is the
 * product -- had nothing to offer on the very screen a new customer lands on. A source with
 * no row is synthesised as `disconnected`, which is what it is.
 *
 * A second Gmail mailbox is a card of its own, with its own status, last run and schedule:
 * one aggregate status over two mailboxes could not say WHICH of them stopped. ADR 0043. A
 * disconnected account stays listed, because it can be reconnected and its history is still
 * its own.
 */
export async function list(
  exec: SqlExecutor,
  tenantId: string,
  specs: SpecReads,
  now: Date = new Date(),
): Promise<ConnectionCardView[]> {
  const rows = await listConnectionViews(exec, tenantId);
  const wholeReads = await listWholeReads(exec, tenantId);

  return KNOWN_SOURCES.flatMap((kind): ConnectionCardView[] => {
    const accounts = accountsOf(rows, kind);
    return accounts.length === 0
      ? [unconnected(kind)]
      : accounts.map((row) => ({
          ...presentCard(kind, row, specs, now),
          resync: presentResync(row, specs, wholeReads),
        }));
  });
}

/**
 * The lists of this connection a re-sync reads whole: the ones it reads, as its scope and grant
 * narrow them -- the run's own rule -- that are read through a change filter the source runs. A
 * client-side filter pages the whole source anyway, so HubSpot's lists have nothing to re-sync.
 */
function resyncedLists(
  row: { source: string; selectionJson: string; scope: string },
  specs: SpecReads,
): readonly string[] {
  const lists = specs.get(sourceKind(row.source))?.entities ?? [];
  const { granted } = partitionByGrant(lists, {
    scope: parseScope(row.source, row.selectionJson),
    grantedScope: row.scope,
  });
  return granted
    .filter(
      (read) => read.incremental !== undefined && read.incremental.strategy !== "client-filter",
    )
    .map((read) => read.name);
}

/** What the card says about re-syncing one connection, or `null` when it has nothing to re-sync. */
function presentResync(
  row: ConnectionView,
  specs: SpecReads,
  wholeReads: readonly WholeRead[],
): ResyncView | null {
  const names = resyncedLists(row, specs);
  if (names.length === 0) {
    return null;
  }
  const held = new Map(
    wholeReads.filter((read) => read.source === row.source).map((read) => [read.entity, read]),
  );
  const reads = names.map((name) => held.get(name));
  const times = reads.map((read) => read?.at ?? null);
  const costs = reads.map((read) => read?.requests ?? null);
  const perDay = specs.get(sourceKind(row.source))?.wholeReadsPerDay ?? null;
  return {
    cadence: row.resyncCadence,
    cron: row.resyncCron,
    lastWholeReadAt: times.includes(null) ? null : (times.toSorted()[0] ?? null),
    days:
      perDay === null || costs.includes(null)
        ? null
        : Math.ceil(costs.reduce((sum: number, cost) => sum + (cost ?? 0), 0) / perDay),
    budget: perDay,
  };
}

/** A kind nobody has connected: one blank card, offering the consent. */
function unconnected(kind: KnownSource): ConnectionCardView {
  return {
    kind,
    source: kind,
    status: "disconnected",
    ungranted: [],
    externalAccountId: "",
    externalAccountLabel: "",
    scopes: [],
    config: {},
    expiresAt: null,
    lastRun: null,
    cadence: "daily",
    cron: null,
    nextRunAt: null,
    resync: null,
  };
}

/** One stored connection as its card shows it, but for its re-sync ({@link presentResync}). */
function presentCard(
  kind: KnownSource,
  row: ConnectionView,
  specs: SpecReads,
  now: Date,
): Omit<ConnectionCardView, "resync"> {
  return {
    kind,
    source: row.source,
    ...presentStatus(row, specs),
    externalAccountId: row.externalAccountId ?? "",
    externalAccountLabel: row.accountLabel,
    // Google returns what it granted as one space-delimited string.
    scopes: row.scope === "" ? [] : row.scope.split(" "),
    config: configOf(row.source, row.selectionJson),
    // Not `row.credentialExpiresAt`. See the field.
    expiresAt: null,
    lastRun: row.lastRun,
    cadence: row.cadence,
    cron: row.cron,
    nextRunAt: nextRunAt(
      {
        source: row.source,
        status: row.status,
        cadence: row.cadence,
        cron: row.cron,
        selectionJson: row.selectionJson,
        lastRunStartedAt: row.lastRun?.startedAt ?? null,
      },
      now,
    ),
  };
}

export type SetCadenceOutcome =
  | { ok: true }
  | { ok: false; reason: "no-connection" | "cron-without-custom" }
  | { ok: false; reason: "cron-refused"; refusal: CronRefusal };

/**
 * Record how often a source is read. Admin-only at the handler: it changes how often a
 * customer's accounts are opened, which is a decision about their data, not ours.
 *
 * The expression is checked HERE, by the rule in `@undercroft/contracts`, rather than by the
 * procedure's input schema: this is the one door a browser, the CLI and the assistant all come
 * through, and a refusal returned as a reason is one the handler can word in the reader's
 * language -- where a schema failure reaches a person as a list of zod issues. The UI runs the
 * same check before offering Save, so a person at the form never meets this refusal.
 */
export async function setCadence(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    source: string;
    cadence: Cadence;
    cron?: string | undefined;
    actor: string;
  },
): Promise<SetCadenceOutcome> {
  const decided = cadenceSetting(input);
  if (!decided.ok) {
    return decided;
  }
  const { setting } = decided;
  const written = await writeCadence(exec, input.tenantId, input.source, setting);
  if (!written) {
    return { ok: false, reason: "no-connection" };
  }
  try {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "connection.cadence_set",
      // The expression is a schedule, not customer data, so the trail carries it whole: "who
      // made this run at 03:00" is the question an audit of a cadence is asked.
      detail: JSON.stringify({
        source: input.source,
        cadence: setting.cadence,
        cron: setting.cron,
      }),
    });
  } catch {
    // Swallowed like every other audit write here: a failed insert must not lose a cadence
    // an admin has already saved.
  }
  return { ok: true };
}

export type SetResyncOutcome = SetCadenceOutcome | { ok: false; reason: "not-resyncable" };

/**
 * Record how often a source's lists are read whole again. Admin-only at the handler, for the
 * reason a cadence is: on a large organisation a re-sync spends most of a day's requests.
 *
 * The same words and the same check as {@link setCadence}, and one more refusal: a source that
 * reads no list through a change filter the source runs has nothing a re-sync could catch up on,
 * and a schedule stored for it would be a promise that changes nothing. ADR 0082.
 */
export async function setResync(
  exec: SqlExecutor,
  specs: SpecReads,
  input: {
    tenantId: string;
    source: string;
    cadence: Cadence;
    cron?: string | undefined;
    actor: string;
  },
): Promise<SetResyncOutcome> {
  const lists = specs.get(sourceKind(input.source))?.entities ?? [];
  if (
    !lists.some(
      (read) => read.incremental !== undefined && read.incremental.strategy !== "client-filter",
    )
  ) {
    return { ok: false, reason: "not-resyncable" };
  }
  const decided = cadenceSetting(input);
  if (!decided.ok) {
    return decided;
  }
  const { setting } = decided;
  if (!(await writeResync(exec, input.tenantId, input.source, setting))) {
    return { ok: false, reason: "no-connection" };
  }
  try {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "connection.resync_set",
      detail: JSON.stringify({
        source: input.source,
        cadence: setting.cadence,
        cron: setting.cron,
      }),
    });
  } catch {
    // Swallowed as the cadence's is: a failed audit insert must not lose a saved schedule.
  }
  return { ok: true };
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

/**
 * A HubSpot choice has no length to be refused for: a widened object's properties travel in a
 * batch read's body, not in a URL (ADR 0054), so any number of them can be saved and read.
 */
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

  // A Xero choice names an organisation. Its id goes where a run reads it, on the
  // connection; its name goes where BI cannot, as the card's account label.
  if (scope.kind === "xero") {
    await setExternalAccount(exec, input.tenantId, input.source, scope.organisation.id);
  }
  await writeConnectionDetail(exec, {
    tenantId: input.tenantId,
    source: input.source,
    selectionJson: input.selectionJson,
    chosenBy: input.actorId,
    ...(scope.kind === "xero" ? { accountLabel: scope.organisation.name } : {}),
  });

  try {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "connection.scope_set",
      detail: JSON.stringify({ source: input.source, count: chosenCount(scope) }),
    });
  } catch {
    // Swallowed like every other audit write here: a failed insert must not lose a scope an
    // admin has already saved.
  }

  return { ok: true };
}

/** Sources whose credential is a token an admin pastes, rather than an OAuth consent. */
const PASTED_TOKEN_SOURCES: ReadonlySet<string> = new Set(["hubspot"]);

export type SetTokenOutcome =
  | { ok: true }
  | { ok: false; reason: "unsupported-source" | "rejected" | "unreachable" | "refused" };

/**
 * Connect a source with a token the admin pasted.
 *
 * The token goes to the worker to be PROVEN and sealed, and nowhere else: not to this
 * process's log, not to the audit row, not back to the browser. The worker probes the
 * provider with it before writing anything, so a typo is refused here and now rather than
 * sealed into a "connected" card that 401s at its first run.
 *
 * `externalAccountId` is empty: a private app names no account, and inventing one would
 * be a guess on a column BI can read.
 */
export async function setToken(
  exec: SqlExecutor,
  worker: WorkerClient,
  input: { tenantId: string; source: string; token: string; actor: string },
): Promise<SetTokenOutcome> {
  if (!PASTED_TOKEN_SOURCES.has(input.source)) {
    return { ok: false, reason: "unsupported-source" };
  }

  const stored = await worker.storeCredential({
    source: input.source,
    tenantId: input.tenantId,
    externalAccountId: "",
    scope: "",
    credential: { accessToken: input.token, refreshToken: "", expiresAt: null },
    validate: true,
  });
  if (!stored.ok) {
    if (stored.reason === "credential-rejected") {
      return { ok: false, reason: "rejected" };
    }
    return { ok: false, reason: stored.reason === "unreachable" ? "unreachable" : "refused" };
  }

  try {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "connection.connected",
      // Which source, and that it was a pasted token. Never the token.
      detail: JSON.stringify({ source: input.source, method: "token" }),
    });
  } catch {
    // Swallowed like every other audit write here: a failed insert must not undo a
    // connection the worker has already sealed.
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

/** How many things were chosen, for the trail. A count, never the names. */
function chosenCount(scope: ConnectionScope): number {
  switch (scope.kind) {
    case "gmail":
      return scope.labels.length;
    case "drive":
      return scope.files.length;
    case "xero":
      return scope.entities.length;
    case "hubspot":
      return Object.values(scope.properties).reduce((sum, names) => sum + names.length, 0);
    default: {
      const exhaustive: never = scope;
      throw new Error(`unhandled scope ${String(exhaustive)}`);
    }
  }
}

/** The shape `scopeSummary` in the UI reads. */
function configOf(source: string, selectionJson: string): ConnectionCardView["config"] {
  const scope = parseScope(source, selectionJson);
  if (scope === null) {
    return {};
  }
  switch (scope.kind) {
    case "gmail":
      return { labels: scope.labels.map((l) => l.name), fileTypes: scope.fileTypes };
    case "drive":
      return { files: scope.files, recurse: scope.recurse, fileTypes: scope.fileTypes };
    case "xero":
      return { entities: scope.entities };
    case "hubspot":
      return { properties: scope.properties };
    default: {
      const exhaustive: never = scope;
      throw new Error(`unhandled scope ${String(exhaustive)}`);
    }
  }
}
