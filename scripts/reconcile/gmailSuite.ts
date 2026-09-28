/**
 * The Gmail reconciliation: SOURCE (the two live mailboxes) against UNDERCROFT (the lake), and
 * the lake against itself.
 *
 * Per mailbox: whose mailbox the token reads, whether the lake source was read to its end,
 * whether every message under a label the connection reads is in the lake with the connector's
 * fields, and whether every attachment its file types allow is stored. Then once, across both
 * mailboxes: whether a Gmail id ever names two different letters. A mailbox whose data cannot be
 * read becomes that mailbox's BLOCKED cases; it does not end the run, because the other
 * mailbox's answer is still worth having.
 */

import { messageOf } from "./errors.ts";
import { attachmentsCase } from "./gmailAttachments.ts";
import type { GmailDeps, MailboxState } from "./gmailCommon.ts";
import { mailboxBlocker, mailboxCompletenessCase } from "./gmailCompleteness.ts";
import { crossMailboxCase, identityCase, lakePagingCase, loadMailbox } from "./gmailMailbox.ts";
import { readSource, type SourceRead } from "./gmailSource.ts";
import type { TestResult } from "./model.ts";
import type { Walk } from "./paginate.ts";
import type { LakeDocument } from "./undercroft.ts";

export type { GmailDeps } from "./gmailCommon.ts";

async function lakeDocuments(
  deps: GmailDeps,
  source: string,
  declared: readonly { source: string; documents: number }[],
): Promise<{ walk: Walk<LakeDocument> | null; error: string | null }> {
  try {
    const total = declared.find((entry) => entry.source === source)?.documents;
    return { walk: await deps.undercroft.documents(source, total), error: null };
  } catch (error) {
    return { walk: null, error: messageOf(error) };
  }
}

/** One mailbox's own cases; one read of the mailbox serves the message and attachment legs. */
async function mailboxCases(
  deps: GmailDeps,
  state: MailboxState,
  context: {
    runs: Parameters<typeof lakePagingCase>[2];
    summary: { documents: readonly { source: string; documents: number }[] };
  },
): Promise<TestResult[]> {
  const documents = await lakeDocuments(deps, state.source, context.summary.documents);
  const blocker = mailboxBlocker(state);
  let read: SourceRead | null = null;
  let why = blocker;
  if (blocker === null) {
    try {
      read = await readSource(
        deps,
        state,
        (documents.walk?.items ?? []).map(
          (document) => `${state.name}:${document.documentId.split(":")[0] ?? ""}`,
        ),
      );
    } catch (error) {
      why = `the mailbox could not be read: ${messageOf(error)}`;
    }
  }
  return [
    identityCase(deps, state),
    lakePagingCase(deps, state, context.runs),
    read === null && why !== null
      ? { ...mailboxCompletenessCase(deps, state, null), reason: why }
      : mailboxCompletenessCase(deps, state, read),
    attachmentsCase(deps, state, { read, documents, blocker: why }),
  ];
}

export async function runGmailSuite(deps: GmailDeps): Promise<TestResult[]> {
  const context = {
    connections: await deps.undercroft.connections(),
    runs: await deps.undercroft.runs(100),
    summary: await deps.undercroft.summary(),
  };
  const states: MailboxState[] = [];
  for (const name of ["primary", "secondary"] as const) {
    states.push(await loadMailbox(deps, name, context));
  }
  // Gmail's quota is per mailbox, so the two mailboxes are read side by side.
  const mailboxes = await Promise.all(states.map((state) => mailboxCases(deps, state, context)));
  return [...mailboxes.flat(), crossMailboxCase(deps, states)];
}
