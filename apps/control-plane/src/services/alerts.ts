/**
 * Telling a customer's administrators when something needs a person.
 *
 * Three notices, each sent at most once: a run that failed, a grant about to lapse, and an
 * ingest key about to expire. "At most once" is a property of the claim, not of this
 * module -- each repo claims its rows with one UPDATE that marks and returns, so a second
 * tick or a second replica finds nothing to send. What is decided here is who is told, in
 * which language, and in what words.
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
 */

import {
  DEFAULT_LOCALE,
  describeError,
  type EmailMessage,
  type EmailSender,
  type Locale,
  type Logger,
} from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import {
  claimExpiringGrants,
  claimExpiringKeys,
  claimFailedRuns,
  SOURCE_OF_TRANSFORM,
} from "@undercroft/db/repos";

import { messages } from "../i18n/index.ts";
import { listAdmins, type Recipient } from "../repos/membership.ts";
import type { Superadmins } from "./superadmin.ts";

/** How far ahead a grant or a key is warned about. A week is a working week to act in. */
export const WARN_DAYS = 7;

/**
 * The vendors' own names, untranslated in both languages -- the same rule the interface
 * follows. A source this build has no name for keeps its id rather than being dropped.
 */
const SOURCE_NAMES: Readonly<Record<string, string>> = {
  hubspot: "HubSpot",
  xero: "Xero",
  gmail: "Gmail",
  drive: "Google Drive",
};

export interface AlertDeps {
  readonly exec: SqlExecutor;
  readonly email: EmailSender;
  /** The origin a link in an email points at. */
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
  readonly grants: number;
  readonly keys: number;
  /** Messages the sender refused or could not deliver. Logged; never retried. */
  readonly undeliverable: number;
}

/**
 * Which CLDR locale writes a date for each language, in the platform's fixed zone -- the
 * same table and the same zone `apps/ui/src/lib/when.ts` uses, so an email and the screen
 * beside it never disagree by an hour.
 */
const CLDR: Record<Locale, string> = { vi: "vi-VN", en: "en-SG" };

function formatWhen(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(CLDR[locale], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore",
  }).format(new Date(iso));
}

function sourceName(source: string): string {
  return SOURCE_NAMES[source] ?? source;
}

/** What an admin is told about a run that failed. Pure: composing is a decision, sending is transport. */
export function failedRunMessage(
  to: Recipient,
  input: {
    tenantId: string;
    source: string;
    verb: string;
    runId: string;
    endedAt: string;
    error: string | null;
    publicUrl: string;
  },
): EmailMessage {
  const t = messages(to.locale);
  const source =
    input.source === SOURCE_OF_TRANSFORM ? t("runFailed.models") : sourceName(input.source);
  return {
    to: to.email,
    subject: t("runFailed.subject", { source, tenantId: input.tenantId }),
    text: t("runFailed.body", {
      source,
      tenantId: input.tenantId,
      when: formatWhen(input.endedAt, to.locale),
      error: input.error ?? t("runFailed.noReason"),
      link: `${input.publicUrl}/tenants/${input.tenantId}/journal/${input.runId}`,
    }),
  };
}

export function grantExpiringMessage(
  to: Recipient,
  input: { tenantId: string; source: string; grantExpiresAt: string; publicUrl: string },
): EmailMessage {
  const t = messages(to.locale);
  return {
    to: to.email,
    subject: t("grantExpiring.subject", {
      source: sourceName(input.source),
      tenantId: input.tenantId,
    }),
    text: t("grantExpiring.body", {
      source: sourceName(input.source),
      tenantId: input.tenantId,
      when: formatWhen(input.grantExpiresAt, to.locale),
      link: `${input.publicUrl}/tenants/${input.tenantId}`,
    }),
  };
}

export function keyExpiringMessage(
  to: Recipient,
  input: { tenantId: string; label: string; expiresAt: string; publicUrl: string },
): EmailMessage {
  const t = messages(to.locale);
  return {
    to: to.email,
    subject: t("keyExpiring.subject", { label: input.label, tenantId: input.tenantId }),
    text: t("keyExpiring.body", {
      label: input.label,
      tenantId: input.tenantId,
      when: formatWhen(input.expiresAt, to.locale),
      link: `${input.publicUrl}/tenants/${input.tenantId}`,
    }),
  };
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
  deps: AlertDeps,
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

/**
 * One tick: claim what is due, tell whoever should be told. Safe to run as often as wanted.
 */
export async function runAlerts(deps: AlertDeps): Promise<AlertSummary> {
  let failures = 0;
  let suppressed = 0;
  let undeliverable = 0;

  for (const run of await claimFailedRuns(deps.exec)) {
    if (run.notice === "suppressed") {
      suppressed += 1;
    } else {
      failures += 1;
      undeliverable += await deliver(
        deps,
        await recipientsFor(deps, run.tenantId),
        (to) => failedRunMessage(to, { ...run, runId: run.id, publicUrl: deps.publicUrl }),
        { kind: "run_failed", runId: run.id, tenantId: run.tenantId },
      );
    }
  }

  const grants = await claimExpiringGrants(deps.exec, WARN_DAYS);
  for (const grant of grants) {
    undeliverable += await deliver(
      deps,
      await recipientsFor(deps, grant.tenantId),
      (to) => grantExpiringMessage(to, { ...grant, publicUrl: deps.publicUrl }),
      { kind: "grant_expiring", tenantId: grant.tenantId, source: grant.source },
    );
  }

  const keys = await claimExpiringKeys(deps.exec, WARN_DAYS);
  for (const key of keys) {
    undeliverable += await deliver(
      deps,
      await recipientsFor(deps, key.tenantId),
      (to) => keyExpiringMessage(to, { ...key, publicUrl: deps.publicUrl }),
      { kind: "key_expiring", tenantId: key.tenantId, keyId: key.id },
    );
  }

  const summary = { failures, suppressed, grants: grants.length, keys: keys.length, undeliverable };
  if (failures + suppressed + grants.length + keys.length > 0) {
    deps.log?.info("alerts_tick", summary);
  }
  return summary;
}
