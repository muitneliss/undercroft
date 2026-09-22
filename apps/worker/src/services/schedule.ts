/**
 * What is due: the list the scheduler starts from.
 *
 * Kestra asks every fifteen minutes and starts exactly what comes back, so this is the whole
 * schedule -- a flow that took a tenant as input could only ever run one customer, which is
 * why the old one never fired. The rule for "due" is `isDue` in `@undercroft/contracts`, the
 * same function the card uses to print a next run; this module reads the candidates and
 * applies it, and decides nothing of its own.
 *
 * A scoped source with no scope chosen is not due, deliberately: it would fail on every tick
 * and, once alerts exist, email an administrator every fifteen minutes about a choice they
 * have not made yet.
 *
 * TWO SCHEDULES, ONE MODULE, AND THEY ANSWER DIFFERENT QUESTIONS. An ingest is due by the
 * CLOCK -- a cadence the customer chose, whether or not anything changed at the source. An
 * extract is due by WORK OUTSTANDING: there is no cadence to consult, only "are there
 * documents nobody has read". Giving extract a cadence of its own would mean a tick that
 * starts a run over a tenant with nothing to do, every time, forever. ADR 0024 keeps it a
 * separate run from the ingest that landed the documents; this keeps it a separate question.
 */

import { isDue } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import { type DueCandidate, listDueCandidates } from "@undercroft/db/repos";

import { pendingScopes } from "../repos/documentText.ts";
import { CURRENT_READER_VERSION } from "./extract/extractText.ts";

export interface DuePair {
  readonly tenantId: string;
  readonly source: string;
}

/** The pure half: which of these candidates the scheduler should start at `now`. */
export function dueNow(candidates: readonly DueCandidate[], now: Date): DuePair[] {
  return candidates
    .filter((candidate) => isDue(candidate, now))
    .map((candidate) => ({ tenantId: candidate.tenantId, source: candidate.source }));
}

export async function listDue(exec: SqlExecutor, now: Date = new Date()): Promise<DuePair[]> {
  return dueNow(await listDueCandidates(exec), now);
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
export function listExtractDue(exec: SqlExecutor): Promise<DuePair[]> {
  return pendingScopes(exec, { readerVersion: CURRENT_READER_VERSION });
}
