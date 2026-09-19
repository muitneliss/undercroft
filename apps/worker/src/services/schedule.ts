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
 */

import { isDue } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import { type DueCandidate, listDueCandidates } from "@undercroft/db/repos";

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
