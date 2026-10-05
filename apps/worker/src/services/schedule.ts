/**
 * What is due: the list the scheduler starts from.
 *
 * Kestra asks every five minutes (`SCHEDULER_TICK_MS`) and starts exactly what comes back, so
 * this is the whole schedule -- a flow that took a tenant as input could only ever run one
 * customer, which is why the old one never fired. The rule for "due" is `isDue` in
 * `@undercroft/contracts`, the same function the card uses to print a next run; this module
 * reads the candidates and applies it, and decides nothing of its own. That includes a custom
 * cadence's cron expression (ADR 0059): it is evaluated there, in Singapore time, and a cron is
 * due at the first fire after the pair's last run started -- which is why the tick, not the
 * expression, is what bounds how late a run may start.
 *
 * A scoped source with no scope chosen is not due, deliberately: it would fail on every tick
 * and, once alerts exist, email an administrator at every tick about a choice they have not
 * made yet.
 *
 * TWO SCHEDULES, ONE MODULE, AND THEY ANSWER DIFFERENT QUESTIONS. An ingest is due by the
 * CLOCK -- a cadence or a cron the customer chose, whether or not anything changed at the
 * source. An extract is due by WORK OUTSTANDING: there is no cadence to consult, only "are
 * there documents nobody has read". Giving extract a cadence of its own would mean a tick that
 * starts a run over a tenant with nothing to do, every time, forever. ADR 0024 keeps it a
 * separate run from the ingest that landed the documents; this keeps it a separate question.
 *
 * A DEACTIVATED CUSTOMER IS SKIPPED BY EVERY LIST, AND THE LIST SAYS SO (ADR 0110). What is
 * outstanding is still worked out for it, then set aside under `skipped` with its reason rather
 * than left out: a tick that starts nothing for a customer reads, in the flow's own record,
 * differently from one that found nothing to do. The ledger refuses such a run anyway (`openRun`);
 * skipping here is what keeps the scheduler from asking every five minutes to be refused.
 */

import { isDue } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import { deactivatedTenants, type DueCandidate, listDueCandidates } from "@undercroft/db/repos";

import { staleLayoutScopes } from "../repos/documentLayout.ts";
import { pendingScopes } from "../repos/documentText.ts";
import { owedWorkbookScopes } from "../repos/workbookBacklog.ts";
import {
  CURRENT_LAYOUT_VERSION,
  CURRENT_READER_VERSION,
  RELAYABLE_METHODS,
} from "./extract/extractText.ts";
import { CURRENT_ROWS_VERSION, TABULAR_TYPES, WORKBOOK_METHODS } from "./extract/workbookRows.ts";

export interface DuePair {
  readonly tenantId: string;
  readonly source: string;
}

/** A pair that had work outstanding and was not started, and why. */
export interface SkippedPair extends DuePair {
  /** The worker's refusal code for the same run, so a reader matches one word for both. */
  readonly reason: "tenant_deactivated";
}

/** What a due list answers: the pairs to start, and the ones set aside with their reason. */
export interface DueList<P extends DuePair = DuePair> {
  readonly due: P[];
  readonly skipped: SkippedPair[];
}

/**
 * Set aside the pairs whose customer is deactivated, naming each. One read of the deactivated
 * set per tick, and none at all for a tick with nothing outstanding.
 */
export async function startable<P extends DuePair>(
  exec: SqlExecutor,
  pairs: readonly P[],
): Promise<DueList<P>> {
  if (pairs.length === 0) {
    return { due: [], skipped: [] };
  }
  const deactivated = await deactivatedTenants(exec);
  return {
    due: pairs.filter((pair) => !deactivated.has(pair.tenantId)),
    skipped: pairs
      .filter((pair) => deactivated.has(pair.tenantId))
      .map((pair) => ({
        tenantId: pair.tenantId,
        source: pair.source,
        reason: "tenant_deactivated",
      })),
  };
}

/** The pure half: which of these candidates the scheduler should start at `now`. */
export function dueNow(candidates: readonly DueCandidate[], now: Date): DuePair[] {
  return candidates
    .filter((candidate) => isDue(candidate, now))
    .map((candidate) => ({ tenantId: candidate.tenantId, source: candidate.source }));
}

export async function listDue(exec: SqlExecutor, now: Date = new Date()): Promise<DueList> {
  return startable(exec, dueNow(await listDueCandidates(exec), now));
}

/**
 * The pairs with documents waiting to be read.
 *
 * No `now` and no cadence: see the module docstring. The decision this layer makes is that
 * "due" for an extract MEANS "has outstanding work", which is why a caller gets this rather
 * than the catalogue and a rule to apply to it.
 *
 * Outstanding work includes a document REFUSED by an older generation of readers, so the tick
 * that follows a release with a new reader finds the tenants that release can now help. The
 * generation is supplied here rather than by the caller because it is the same decision:
 * a scheduler asking an older question than `runExtract` answers would start runs that find
 * nothing, which is the one thing this function exists not to do.
 */
export async function listExtractDue(exec: SqlExecutor): Promise<DueList> {
  const [unread, unlaid, owed] = await Promise.all([
    pendingScopes(exec, { readerVersion: CURRENT_READER_VERSION }),
    // A text written under an older layout is outstanding work too, and a scope may hold
    // nothing else: the tenant whose only change is that its templates became known.
    staleLayoutScopes(exec, {
      methods: RELAYABLE_METHODS,
      layoutVersion: CURRENT_LAYOUT_VERSION,
    }),
    // So is a workbook read before its rows existed (ADR 0104): a settled tenant's whole
    // spreadsheet history is owed rows the day this ships, and nothing else would start a run.
    owedWorkbookScopes(exec, {
      methods: WORKBOOK_METHODS,
      tabularTypes: TABULAR_TYPES,
      rowsVersion: CURRENT_ROWS_VERSION,
    }),
  ]);
  const due = new Map(
    [...unread, ...unlaid, ...owed].map((pair) => [`${pair.tenantId}\u0000${pair.source}`, pair]),
  );
  return startable(
    exec,
    [...due.values()].sort(
      (a, b) => a.tenantId.localeCompare(b.tenantId) || a.source.localeCompare(b.source),
    ),
  );
}
