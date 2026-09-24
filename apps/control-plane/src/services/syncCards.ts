/**
 * A sync's status as a card for the platform operators' Lark group.
 *
 * Pure: what a card says is decided here, and `alerts.ts` decides when one is posted. A failure's
 * card carries what the admins' email carries -- the same subject sentence, source, account,
 * customer and minute -- plus the run's reason, so the group can triage without opening the
 * journal. A recovery's card says since when the pair had been failing, which is the one fact
 * the group cannot read off the red card above it.
 *
 * The reason is a fact, not the body. A body is rendered as markdown, and a vendor's error is
 * not markdown: `invalid_grant ... refresh_token` would lose its underscores to italics. A
 * fact is shown exactly as written. The title's leading mark is the one the group's other
 * cards use for the same news, and carries no words to translate.
 */

import { DEFAULT_LOCALE, type LarkNotice } from "@undercroft/core";
import { SOURCE_OF_TRANSFORM } from "@undercroft/db/repos";

import { type MessageKey, messages } from "../i18n/index.ts";
import { formatWhen, sourceName } from "./alertWording.ts";

/** A card is read by the platform's operators, so it is written in the platform's language. */
const CARD = messages(DEFAULT_LOCALE);

function runTitle(
  mark: string,
  input: { tenantId: string; source: string },
  keys: { readonly sync: MessageKey; readonly models: MessageKey },
): string {
  const sentence =
    input.source === SOURCE_OF_TRANSFORM
      ? CARD(keys.models, { tenantId: input.tenantId })
      : CARD(keys.sync, { source: sourceName(input.source), tenantId: input.tenantId });
  return `${mark} ${sentence}`;
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
    title: runTitle("❌", input, { sync: "runFailed.subject", models: "runFailed.modelsSubject" }),
    tone: "red",
    facts: [
      ...runFacts(input),
      [CARD("email.when"), formatWhen(input.endedAt, DEFAULT_LOCALE)],
      [CARD("syncCard.reason"), input.error ?? CARD("runFailed.noReason")],
    ],
    body: "",
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
    title: runTitle("✅", input, {
      sync: "syncCard.recovered",
      models: "syncCard.modelsRecovered",
    }),
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
