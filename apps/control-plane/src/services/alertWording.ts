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

/** Which CLDR locale writes a date for each language, as in `apps/ui/src/lib/when.ts`. */
const CLDR: Record<Locale, string> = { vi: "vi-VN", en: "en-SG" };

/**
 * An instant as the server writes it: in Asia/Singapore, with the zone named on it.
 *
 * The screen shows an instant in the viewer's own zone (ADR 0149), but an email, a Lark card or
 * a refusal is written here, which cannot know where its reader is -- and one card goes to a
 * whole group. So it stays in the platform's zone and says which one (`SGT` in English,
 * `GMT+8` in Vietnamese, as CLDR names it): a time carrying its zone can be converted, while a
 * bare one an hour off from the screen is not even noticed.
 */
export function formatWhen(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(CLDR[locale], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore",
    timeZoneName: "short",
  }).format(new Date(iso));
}

/** The vendor's name for any account of it: a second mailbox is still Gmail. */
export function sourceName(source: string): string {
  return SOURCE_NAMES[sourceKind(source)] ?? source;
}
