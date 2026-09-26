/**
 * OSTWIN's side of a client's Gmail: its published messages and harvest facts from the mart,
 * its route queries and discard lists from the source candidate, and the case that checks
 * OSTWIN's own claim to have read every route to its end (the 20-page cap regression).
 */

import type { ClientConfig } from "./config.ts";
import { base, type GmailDeps, type OstwinMessage } from "./gmailCommon.ts";
import { arrayOrEmpty, asObject, text } from "./json.ts";
import type { TestResult } from "./model.ts";
import { type Row, sqlText } from "./ostwin.ts";

const MESSAGE_COLUMNS = [
  "mailbox",
  "message_id",
  "thread_id",
  "message_time",
  "subject",
  "route",
  "labels",
  "rfc822_message_id",
  "source_run",
];
const COVERAGE_COLUMNS = [
  "mailbox",
  "mode",
  "coverage_status",
  "pages_used",
  "max_pages",
  "pagination_exhausted",
  "messages_found",
  "messages_discarded",
  "query_sha256",
  "source_run",
];

/** OSTWIN's newest harvest, which waits for review before it is published to the mart. */
export interface Unpublished {
  readonly sourceRun: string;
  readonly state: string;
  /** Message ids the harvest holds, as far as the 200-row named query shows them. */
  readonly ids: ReadonlySet<string>;
  /** The listing hit its 200-row cap: an id absent from `ids` is unproven, not absent. */
  readonly truncated: boolean;
}

export interface OstwinCase {
  /** OSTWIN's source-candidate coverage: route queries and discard lists, per mailbox. */
  readonly candidate: readonly Record<string, unknown>[];
  readonly unpublished: Unpublished;
  /** OSTWIN's published harvest facts, per mailbox (`gmail_coverage`). */
  readonly harvests: readonly Row[];
  readonly messages: readonly OstwinMessage[];
}

function toOstwinMessage(row: Row): OstwinMessage {
  return {
    mailbox: row.mailbox ?? "",
    messageId: row.message_id ?? "",
    threadId: row.thread_id ?? null,
    messageTime: row.message_time ?? null,
    subject: row.subject ?? null,
    route: row.route ?? null,
    labels: row.labels ?? null,
    rfc822MessageId: row.rfc822_message_id ?? null,
    sourceRun: row.source_run ?? null,
  };
}

export async function readOstwin(deps: GmailDeps, caseId: string): Promise<OstwinCase> {
  const where = `WHERE case_id = ${sqlText(caseId)}`;
  const coverage = await deps.ostwin.named("gmail-source-coverage", caseId);
  const messages = await deps.ostwin.fullRows(
    `SELECT ${MESSAGE_COLUMNS.join(", ")} FROM gmail_message_evidence ${where}`,
    MESSAGE_COLUMNS,
  );
  const harvests = await deps.ostwin.fullRows(
    `SELECT ${COVERAGE_COLUMNS.join(", ")} FROM gmail_coverage ${where}`,
    COVERAGE_COLUMNS,
  );
  return {
    candidate: coverage.rows,
    unpublished: await readUnpublished(deps, caseId),
    harvests,
    messages: messages.map(toOstwinMessage),
  };
}

async function readUnpublished(deps: GmailDeps, caseId: string): Promise<Unpublished> {
  const [status] = (await deps.ostwin.named("gmail-source-status", caseId)).rows;
  const listed = await deps.ostwin.named("gmail-source-messages", caseId);
  return {
    sourceRun: text(status?.source_run),
    state: text(status?.state),
    ids: new Set(listed.rows.map((row) => text(row.message_id))),
    truncated: listed.possiblyTruncated,
  };
}

function harvestProblems(ostwin: OstwinCase): string[] {
  const problems: string[] = [];
  for (const row of ostwin.harvests) {
    const pages = Number.parseInt(row.pages_used ?? "0", 10);
    const cap = Number.parseInt(row.max_pages ?? "0", 10);
    if (row.pagination_exhausted !== "1") {
      problems.push(`${row.mailbox ?? "?"}: published harvest not exhausted`);
    } else if (cap > 0 && pages >= cap) {
      problems.push(`${row.mailbox ?? "?"}: exhausted exactly at the ${cap}-page cap`);
    }
  }
  return problems;
}

function routeProblems(ostwin: OstwinCase): string[] {
  return ostwin.candidate.flatMap((row) =>
    arrayOrEmpty(row.routes)
      .map(asObject)
      .filter((route) => route.pagination_exhausted !== true)
      .map((route) => `${text(row.mailbox)}: route ${text(route.route)} not exhausted`),
  );
}

/** OSTWIN's own statement that each route read to the end, and did not stop at its cap. */
function pagingProblems(ostwin: OstwinCase): string[] {
  return [...harvestProblems(ostwin), ...routeProblems(ostwin)];
}

export function ostwinPagingCase(
  deps: Pick<GmailDeps, "sink">,
  client: ClientConfig,
  ostwin: OstwinCase,
): TestResult {
  const problems = pagingProblems(ostwin);
  const none = ostwin.harvests.length === 0;
  const evidence = deps.sink.json(`GM-${client.label}-O-PAGE`, {
    harvests: ostwin.harvests,
    problems,
  });
  let status: TestResult["status"] = problems.length === 0 ? "PASS" : "FAIL";
  if (none) {
    status = "BLOCKED";
  }
  return base(`GM-${client.label}-O-PAGE-001`, "OSTWIN read every Gmail route to its end", {
    group: "regression",
    client: client.label,
    requirement: "REQ-GEN-02 pagination completeness",
    contract: "OSTWIN gmail coverage: pagination_exhausted, pages_used < max_pages (20 x 500)",
    finding: "OSTWIN max_pages=20 truncation risk",
    preconditions: "OSTWIN coverage rows present",
    expected: "every route exhausted below its page cap",
    actual:
      problems.length === 0
        ? `${ostwin.harvests.length} mailbox harvest(s) exhausted`
        : problems.join("; "),
    status,
    reason: none ? "OSTWIN mart has no coverage row for this client" : problems.join("; "),
    evidence: [{ label: "coverage", path: evidence }],
  });
}
