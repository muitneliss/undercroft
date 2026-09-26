/**
 * The Gmail reconciliation: SOURCE (the two live mailboxes) <-> OSTWIN (the old warehouse)
 * <-> UNDERCROFT (the lake), for each mailbox as a whole and for each configured client.
 *
 * The mailbox-wide cases run first (`gmailMailbox.ts`): identity, lake paging, label-scope
 * completeness, cross-mailbox id conflicts. Then each client's three legs (`gmailClient.ts`).
 * A client whose data cannot be read becomes that client's BLOCKED case; it does not end the
 * run, because every other client's answer is still worth having.
 */

import { messageOf } from "./errors.ts";
import { clientCases } from "./gmailClient.ts";
import { blocked, type GmailDeps, type MailboxState } from "./gmailCommon.ts";
import { mailboxCompletenessCase } from "./gmailCompleteness.ts";
import { crossMailboxCase, identityCase, lakePagingCase, loadMailbox } from "./gmailMailbox.ts";
import type { TestResult } from "./model.ts";

export type { GmailDeps } from "./gmailCommon.ts";

export async function runGmailSuite(deps: GmailDeps): Promise<TestResult[]> {
  const context = {
    connections: await deps.undercroft.connections(),
    runs: await deps.undercroft.runs(100),
    summary: await deps.undercroft.summary(),
  };
  const results: TestResult[] = [];
  const states: MailboxState[] = [];
  for (const name of ["primary", "secondary"] as const) {
    const state = await loadMailbox(deps, name, context);
    states.push(state);
    results.push(
      identityCase(deps, state),
      lakePagingCase(deps, state, context.runs),
      await mailboxCompletenessCase(deps, state),
    );
  }
  results.push(crossMailboxCase(deps, states));
  for (const client of deps.config.clients) {
    try {
      results.push(...(await clientCases(deps, client, states)));
    } catch (error) {
      results.push(blocked(`GM-${client.label}-RUN`, client, "S2O", messageOf(error)));
    }
  }
  return results;
}
