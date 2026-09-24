/**
 * The words an alert shares whichever channel carries it: a vendor's name, and a time.
 *
 * An email to an admin and a card in the operators' Lark group name one run, and must name it
 * alike -- the same vendor spelling, the same minute in the same zone -- or a reader holding
 * both would take them for two events.
 */

import type { Locale } from "@undercroft/core";
import { sourceKind } from "@undercroft/contracts";

/**
 * The vendors' own names, untranslated in both languages -- the same rule the interface
 * follows. A source this build has no name for keeps its id rather than being dropped.
 */
const SOURCE_NAMES: Readonly<Record<string, string>> = {
  hubspot: "HubSpot",
  xero: "Xero",
  gmail: "Gmail",
  drive: "Google Drive",
};

/**
 * Which CLDR locale writes a date for each language, in the platform's fixed zone -- the
 * same table and the same zone `apps/ui/src/lib/when.ts` uses, so an email and the screen
 * beside it never disagree by an hour.
 */
const CLDR: Record<Locale, string> = { vi: "vi-VN", en: "en-SG" };

export function formatWhen(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(CLDR[locale], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore",
  }).format(new Date(iso));
}

/** The vendor's name for any account of it: a second mailbox is still Gmail. */
export function sourceName(source: string): string {
  return SOURCE_NAMES[sourceKind(source)] ?? source;
}
