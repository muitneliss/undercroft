/**
 * Telling a customer's administrators when something needs a person.
 *
 * Three notices, each sent at most once: a run that failed, a grant about to lapse, and an
 * ingest key about to expire. "At most once" is a property of the claim, not of this
 * module -- each repo claims its rows with one UPDATE that marks and returns, so a second
 * tick or a second replica finds nothing to send. What is decided here is who is told, on
 * which channel; the words are `alertEmails.ts`'s and `syncCards.ts`'s.
 *
 * A failure is told to the tenant's admins in each one's own language; a tenant with no
 * admin falls back to the platform's superadmins, in the default language, because the
 * alternative is a failure nobody hears about. A failed send is logged and lost: the claim
 * is already made, and re-sending from a claim would be the double notice the claim exists
 * to prevent. A mail outage is a thing the log says, loudly, rather than a thing the ledger
 * pretends did not happen.
 *
 * Repeats are suppressed for a day per (tenant, source, verb) after a notice goes out, and
 * the email says so; a successful run in between resets the window. `claimFailedRuns`
 * decides that in SQL and answers `suppressed` for the runs it applied it to.
 *
 * A failure the admins are emailed about is also posted to the platform operators' Lark group,
 * when the deployment names one, and so is the success that next ends it -- the group reads
 * sync status across every customer, and a red card with no green one after it would read as
 * a sync still down. The recovery is Lark's alone: an admin was told the data would not change
 * until a later run succeeded, and that later run is visible on the screen they were linked
 * to. Either channel may be absent. What only email carries -- grants and keys -- is not
 * claimed without email, since a claim with nobody told is a notice lost.
 */

import {
  DEFAULT_LOCALE,
  describeError,
  type EmailMessage,
  type EmailSender,
  type LarkNotice,
  type Logger,
} from "@undercroft/core";
import { MULTI_ACCOUNT_KINDS, sourceKind } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import {
  claimExpiringGrants,
  claimExpiringKeys,
  claimFailedRuns,
  claimRecoveredRuns,
  readConnectionDetail,
} from "@undercroft/db/repos";

import { listAdmins, type Recipient } from "../repos/membership.ts";
import { failedRunMessage, grantExpiringMessage, keyExpiringMessage } from "./alertEmails.ts";
import type { Superadmins } from "./superadmin.ts";
import { failedRunCard, recoveredRunCard } from "./syncCards.ts";

/** How far ahead a grant or a key is warned about. A week is a working week to act in. */
export const WARN_DAYS = 7;

export interface AlertDeps {
  readonly exec: SqlExecutor;
  /** Absent: nothing is emailed, and grants and keys are not claimed. */
  readonly email?: EmailSender;
  /** Posts a card to the operators' Lark group. Absent: failures are emailed only. */
  readonly lark?: (notice: LarkNotice) => Promise<void>;
  /** The origin a link in an email or a card points at. */
  readonly publicUrl: string;
  /** Who is told about a tenant that has no administrator of its own. */
  readonly superadmins: Superadmins;
  readonly log?: Logger;
}

export interface AlertSummary {
  /** Failures a notice went out for. */
  readonly failures: number;
  /** Failures claimed and deliberately not sent, within a day of a sent notice. */
  readonly suppressed: number;
  /** Successes that ended an announced failure, posted to Lark. */
  readonly recoveries: number;
  readonly grants: number;
  readonly keys: number;
  /** Messages or cards the channel refused or could not deliver. Logged; never retried. */
  readonly undeliverable: number;
}

/**
 * Which account a notice is about, where a source may hold several -- or `""` where it cannot,
 * or where no address was ever recorded.
 *
 * "The Gmail sync failed" is not a sentence an admin with two mailboxes can act on: which one
 * stopped is the whole question (issue #125, item 6). The address is theirs -- they granted it
 * -- and it is read from `app.connection_detail`, where it has always lived. ADR 0043.
 */
async function accountLabelOf(
  exec: SqlExecutor,
  input: { tenantId: string; source: string },
): Promise<string> {
  if (!MULTI_ACCOUNT_KINDS.has(sourceKind(input.source))) {
    return "";
  }
  const detail = await readConnectionDetail(exec, input.tenantId, input.source);
  return detail?.accountLabel ?? "";
}

/** Post one card: 1 when Lark would not take it, to be counted. */
async function post(
  deps: AlertDeps,
  lark: (notice: LarkNotice) => Promise<void>,
  card: LarkNotice,
  about: Record<string, string>,
): Promise<0 | 1> {
  try {
    await lark(card);
    return 0;
  } catch (error) {
    deps.log?.error("alert_post_failed", { ...about, ...describeError(error) });
    return 1;
  }
}

/** The tenant's admins, or the platform's when it has none. Never nobody, while anybody exists. */
async function recipientsFor(deps: AlertDeps, tenantId: string): Promise<Recipient[]> {
  const admins = await listAdmins(deps.exec, tenantId);
  if (admins.length > 0) {
    return admins;
  }
  return [...deps.superadmins].map((email) => ({ email, locale: DEFAULT_LOCALE }));
}

/** Send one message to each recipient, counting what the sender would not take. */
async function deliver(
  deps: AlertDeps & { readonly email: EmailSender },
  recipients: readonly Recipient[],
  compose: (to: Recipient) => EmailMessage,
  about: Record<string, string>,
): Promise<number> {
  const refused: string[] = [];
  for (const recipient of recipients) {
    try {
      await deps.email.send(compose(recipient));
    } catch (error) {
      refused.push(recipient.email);
      deps.log?.error("alert_send_failed", { ...about, ...describeError(error) });
    }
  }
  return refused.length;
}

interface Counts {
  readonly told: number;
  readonly undeliverable: number;
}

/** Claim the failures and tell each channel there is; a suppressed one is told to neither. */
async function tellFailures(deps: AlertDeps): Promise<{
  readonly failures: number;
  readonly suppressed: number;
  readonly undeliverable: number;
}> {
  let failures = 0;
  let suppressed = 0;
  let undeliverable = 0;
  for (const run of await claimFailedRuns(deps.exec)) {
    if (run.notice === "suppressed") {
      suppressed += 1;
      continue;
    }
    failures += 1;
    const about = { kind: "run_failed", runId: run.id, tenantId: run.tenantId };
    const input = {
      ...run,
      runId: run.id,
      publicUrl: deps.publicUrl,
      account: await accountLabelOf(deps.exec, run),
    };
    if (deps.email !== undefined) {
      undeliverable += await deliver(
        { ...deps, email: deps.email },
        await recipientsFor(deps, run.tenantId),
        (to) => failedRunMessage(to, input),
        about,
      );
    }
    if (deps.lark !== undefined) {
      undeliverable += await post(deps, deps.lark, failedRunCard(input), about);
    }
  }
  return { failures, suppressed, undeliverable };
}

async function tellRecoveries(
  deps: AlertDeps,
  lark: (notice: LarkNotice) => Promise<void>,
): Promise<Counts> {
  const recovered = await claimRecoveredRuns(deps.exec);
  let undeliverable = 0;
  for (const run of recovered) {
    const card = recoveredRunCard({
      ...run,
      runId: run.id,
      publicUrl: deps.publicUrl,
      account: await accountLabelOf(deps.exec, run),
    });
    undeliverable += await post(deps, lark, card, {
      kind: "run_recovered",
      runId: run.id,
      tenantId: run.tenantId,
    });
  }
  return { told: recovered.length, undeliverable };
}

async function tellExpiringGrants(deps: AlertDeps, email: EmailSender): Promise<Counts> {
  const grants = await claimExpiringGrants(deps.exec, WARN_DAYS);
  let undeliverable = 0;
  for (const grant of grants) {
    undeliverable += await deliver(
      { ...deps, email },
      await recipientsFor(deps, grant.tenantId),
      (to) => grantExpiringMessage(to, { ...grant, publicUrl: deps.publicUrl }),
      { kind: "grant_expiring", tenantId: grant.tenantId, source: grant.source },
    );
  }
  return { told: grants.length, undeliverable };
}

async function tellExpiringKeys(deps: AlertDeps, email: EmailSender): Promise<Counts> {
  const keys = await claimExpiringKeys(deps.exec, WARN_DAYS);
  let undeliverable = 0;
  for (const key of keys) {
    undeliverable += await deliver(
      { ...deps, email },
      await recipientsFor(deps, key.tenantId),
      (to) => keyExpiringMessage(to, { ...key, publicUrl: deps.publicUrl }),
      { kind: "key_expiring", tenantId: key.tenantId, keyId: key.id },
    );
  }
  return { told: keys.length, undeliverable };
}

const NONE: Counts = { told: 0, undeliverable: 0 };

/**
 * One tick: claim what is due, tell whoever should be told. Safe to run as often as wanted.
 */
export async function runAlerts(deps: AlertDeps): Promise<AlertSummary> {
  const failed = await tellFailures(deps);
  // After the failures, so a failure and the success that ended it in one interval are both told.
  const recoveries = deps.lark === undefined ? NONE : await tellRecoveries(deps, deps.lark);
  const grants = deps.email === undefined ? NONE : await tellExpiringGrants(deps, deps.email);
  const keys = deps.email === undefined ? NONE : await tellExpiringKeys(deps, deps.email);

  const summary = {
    failures: failed.failures,
    suppressed: failed.suppressed,
    recoveries: recoveries.told,
    grants: grants.told,
    keys: keys.told,
    undeliverable:
      failed.undeliverable + recoveries.undeliverable + grants.undeliverable + keys.undeliverable,
  };
  if (
    summary.failures + summary.suppressed + summary.recoveries + summary.grants + summary.keys >
    0
  ) {
    deps.log?.info("alerts_tick", summary);
  }
  return summary;
}
