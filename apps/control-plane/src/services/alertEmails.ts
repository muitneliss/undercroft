/**
 * What an admin is told, as an email: a run that failed, a grant about to lapse, a key about
 * to expire.
 *
 * Pure: composing is a decision, sending is transport, and `alerts.ts` decides who is sent
 * what and when. Each message is written in its recipient's own language.
 */

import { type EmailMessage, postEmailLeaf } from "@undercroft/core";
import { SOURCE_OF_TRANSFORM } from "@undercroft/db/repos";

import { messages } from "../i18n/index.ts";
import type { Recipient } from "../repos/membership.ts";
import { formatWhen, sourceName } from "./alertWording.ts";

/** What an admin is told about a run that failed. */
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
    /** The mailbox or Drive account that failed, where the source may hold several. */
    account?: string;
  },
): EmailMessage {
  const t = messages(to.locale);
  const isModelBuild = input.source === SOURCE_OF_TRANSFORM;
  const source = isModelBuild ? t("runFailed.models") : sourceName(input.source);
  // Two whole sentences, never the build's name spliced into the sync's: see `modelsSubject`.
  const subject = isModelBuild
    ? t("runFailed.modelsSubject", { tenantId: input.tenantId })
    : t("runFailed.subject", { source, tenantId: input.tenantId });
  const account = input.account ?? "";
  return postEmailLeaf(to.email, {
    locale: to.locale,
    subject,
    runningHead: input.tenantId,
    heading: t("runFailed.heading"),
    lead: t("runFailed.lead"),
    colophon: t("email.colophon"),
    blocks: [
      {
        kind: "schedule",
        rows: [
          { label: t("email.source"), value: source },
          ...(account === "" ? [] : [{ label: t("email.account"), value: account }]),
          { label: t("email.customer"), value: input.tenantId },
          { label: t("email.when"), value: formatWhen(input.endedAt, to.locale) },
        ],
      },
      // The one errata slip in the family, because this is the one message that IS a
      // correction. A run with no recorded reason keeps its sentence rather than becoming
      // an em dash: a blank correction slip reads as a slip somebody forgot to write.
      { kind: "errata", mark: t("email.errata"), text: input.error ?? t("runFailed.noReason") },
      {
        kind: "plate",
        label: t("runFailed.action"),
        href: `${input.publicUrl}/tenants/${input.tenantId}/journal/${input.runId}`,
      },
      { kind: "note", text: t("runFailed.repeats") },
    ],
  });
}

export function grantExpiringMessage(
  to: Recipient,
  input: { tenantId: string; source: string; grantExpiresAt: string; publicUrl: string },
): EmailMessage {
  const t = messages(to.locale);
  return postEmailLeaf(to.email, {
    locale: to.locale,
    subject: t("grantExpiring.subject", {
      source: sourceName(input.source),
      tenantId: input.tenantId,
    }),
    runningHead: input.tenantId,
    heading: t("grantExpiring.heading"),
    lead: t("grantExpiring.lead"),
    colophon: t("email.colophon"),
    blocks: [
      {
        kind: "schedule",
        rows: [
          { label: t("email.source"), value: sourceName(input.source) },
          { label: t("email.customer"), value: input.tenantId },
          // Umber, the pending mark's tone. A thing about to lapse has not lapsed, and
          // vermilion belongs to the correction slip alone.
          {
            label: t("email.expires"),
            value: formatWhen(input.grantExpiresAt, to.locale),
            tone: "pending",
          },
        ],
      },
      {
        kind: "plate",
        label: t("grantExpiring.action"),
        href: `${input.publicUrl}/tenants/${input.tenantId}`,
      },
    ],
  });
}

export function keyExpiringMessage(
  to: Recipient,
  input: { tenantId: string; label: string; expiresAt: string; publicUrl: string },
): EmailMessage {
  const t = messages(to.locale);
  return postEmailLeaf(to.email, {
    locale: to.locale,
    subject: t("keyExpiring.subject", { label: input.label, tenantId: input.tenantId }),
    runningHead: input.tenantId,
    heading: t("keyExpiring.heading"),
    lead: t("keyExpiring.lead"),
    colophon: t("email.colophon"),
    blocks: [
      {
        kind: "schedule",
        rows: [
          // The key's label is written by a customer, and this is the value that made the
          // template's escaping a requirement rather than a courtesy.
          { label: t("email.key"), value: input.label },
          { label: t("email.customer"), value: input.tenantId },
          {
            label: t("email.expires"),
            value: formatWhen(input.expiresAt, to.locale),
            tone: "pending",
          },
        ],
      },
      {
        kind: "plate",
        label: t("keyExpiring.action"),
        href: `${input.publicUrl}/tenants/${input.tenantId}`,
      },
    ],
  });
}
