/**
 * A sync's status as a card for the platform operators' Lark group.
 *
 * Pure: what a card says is decided here, and `alerts.ts` decides when one is posted. A failure's
 * card carries what the admins' email carries -- the same subject sentence, source, account,
 * customer and minute -- plus the run's reason in the body, so the group can triage without
 * opening the journal. A recovery's card says since when the pair had been failing, which is
 * the one fact the group cannot read off the red card above it.
 */

import { DEFAULT_LOCALE, type LarkNotice } from "@undercroft/core";
import { SOURCE_OF_TRANSFORM } from "@undercroft/db/repos";

import { type MessageKey, messages } from "../i18n/index.ts";
import { formatWhen, sourceName } from "./alertWording.ts";

/** A card is read by the platform's operators, so it is written in the platform's language. */
const CARD = messages(DEFAULT_LOCALE);

function runTitle(
  input: { tenantId: string; source: string },
  sync: MessageKey,
  models: MessageKey,
): string {
  return input.source === SOURCE_OF_TRANSFORM
    ? CARD(models, { tenantId: input.tenantId })
    : CARD(sync, { source: sourceName(input.source), tenantId: input.tenantId });
}

/** The email's schedule, as a card's facts: source, the account where there are several, customer. */
function runFacts(input: {
  tenantId: string;
  source: string;
  account: string;
}): [label: string, value: string][] {
  const source =
    input.source === SOURCE_OF_TRANSFORM ? CARD("runFailed.models") : sourceName(input.source);
  const facts: [string, string][] = [[CARD("email.source"), source]];
  if (input.account !== "") {
    facts.push([CARD("email.account"), input.account]);
  }
  facts.push([CARD("email.customer"), input.tenantId]);
  return facts;
}

function journalLink(
  publicUrl: string,
  input: { tenantId: string; runId: string },
): LarkNotice["links"] {
  return [
    [CARD("runFailed.action"), `${publicUrl}/tenants/${input.tenantId}/journal/${input.runId}`],
  ];
}

/** The card for a failed run: the email's subject, its schedule, and the run's own reason. */
export function failedRunCard(input: {
  tenantId: string;
  source: string;
  runId: string;
  endedAt: string;
  error: string | null;
  publicUrl: string;
  account: string;
}): LarkNotice {
  return {
    title: runTitle(input, "runFailed.subject", "runFailed.modelsSubject"),
    tone: "red",
    facts: [...runFacts(input), [CARD("email.when"), formatWhen(input.endedAt, DEFAULT_LOCALE)]],
    body: `${CARD("syncCard.reason")}: ${input.error ?? CARD("runFailed.noReason")}`,
    links: journalLink(input.publicUrl, input),
  };
}

/** The card for the success that ended an announced failure, and how long it had been failing. */
export function recoveredRunCard(input: {
  tenantId: string;
  source: string;
  runId: string;
  endedAt: string;
  failingSince: string;
  publicUrl: string;
  account: string;
}): LarkNotice {
  return {
    title: runTitle(input, "syncCard.recovered", "syncCard.modelsRecovered"),
    tone: "green",
    facts: [
      ...runFacts(input),
      [CARD("syncCard.failingSince"), formatWhen(input.failingSince, DEFAULT_LOCALE)],
      [CARD("email.when"), formatWhen(input.endedAt, DEFAULT_LOCALE)],
    ],
    body: "",
    links: journalLink(input.publicUrl, input),
  };
}
