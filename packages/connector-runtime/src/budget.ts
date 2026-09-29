/**
 * The seam through which a caller rations a read's requests. ADR 0081.
 *
 * Split from `reader.ts`, which had grown past what one file may be; a `Reader` asks its budget
 * through {@link admitUnder} before each page and tells it about each answer.
 */

/**
 * How many requests a read may make, asked before each one and told what each answer said.
 *
 * The runtime knows when it is about to ask a source for another page; only the caller knows how
 * much of the provider's day is left and how much of it this read may spend (ADR 0081). So the
 * decision stays the caller's, and the runtime only asks and reports.
 *
 * - `admit` is asked before each page of a list and each chunk of a relation. `false` ends the
 *   read where it stands, as a truncated read: its records so far are kept, nothing claims it
 *   was the whole source, and `ReadEnd.exhausted` says why it stopped. Not asked before the
 *   further pages of ONE record: stopping half-way through a record would land it short.
 * - `spent` is told the headers of every answer, retries included, because every attempt is a
 *   request the provider counted.
 */
export interface RequestBudget {
  readonly admit: () => boolean;
  readonly spent: (headers: Readonly<Record<string, string>>) => void;
}

/** Whether a budget admits one more request, telling `refused` when it does not. */
export function admitUnder(budget: RequestBudget | undefined, refused: () => void): () => boolean {
  return (): boolean => {
    if (budget === undefined || budget.admit()) {
      return true;
    }
    refused();
    return false;
  };
}
