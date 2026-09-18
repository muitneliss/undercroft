/** Mirrors vcdo/api/models.py. Money is a string here for the reason given there. */

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import type { Money } from "@/lib/money.ts";

export type Source = "hubspot" | "xero" | "gmail" | "drive";

export const SOURCES: readonly Source[] = ["hubspot", "xero", "gmail", "drive"] as const;

/**
 * Not in the catalogue, and deliberately: these are the vendors' own names for their own
 * products. "HubSpot" is HubSpot in every language, and a translated product name is how an
 * operator fails to find the button they were told to press.
 */
export const SOURCE_LABEL: Record<Source, string> = {
  hubspot: "HubSpot",
  xero: "Xero",
  gmail: "Gmail",
  drive: "Google Drive",
};

/**
 * What the platform will read, in the customer's words rather than ours.
 *
 * Shown on the card BEFORE the redirect. Someone is about to hand over access to
 * their company email and their accounting system; "Connect Gmail" with no
 * statement of what that means is not consent, it is a dark pattern.
 *
 * Catalogue keys rather than sentences, because consent has to be given in a language the
 * person giving it reads. `source.readOnly` is one key shared by all four sources on
 * purpose: "we change nothing" is the same promise everywhere, and four copies of it are
 * four chances for one translation to weaken it.
 */
export const SOURCE_ACCESS: Record<
  Source,
  { reads: `source.${Source}Reads`; writes: "source.readOnly" }
> = {
  hubspot: { reads: "source.hubspotReads", writes: "source.readOnly" },
  xero: { reads: "source.xeroReads", writes: "source.readOnly" },
  gmail: { reads: "source.gmailReads", writes: "source.readOnly" },
  drive: { reads: "source.driveReads", writes: "source.readOnly" },
};

export type ConnectionStatus = "disconnected" | "connected" | "needs_scope" | "needs_reconnect";

export interface Connection {
  source: Source;
  status: ConnectionStatus;
  external_account_id: string;
  external_account_label: string;
  scopes: string[];
  config: { folder_ids?: string[]; labels?: string[]; entities?: string[] };
  schedule_cron: string;
  last_run_id: string;
  expires_at: string | null;
}

export interface Tenant {
  id: string;
  display_name: string;
  status: string;
  created_at: string;
}

export interface Member {
  id: string;
  email: string;
  display_name: string;
  is_staff: boolean;
  role: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
  is_staff: boolean;
}

export interface LakeObject {
  key: string;
  versions: number;
  newest_sha256: string | null;
  bytes: number | null;
}

/**
 * One observation of an object, from `vcdo/lake/store.py`.
 *
 * Every field is optional because a manifest is written once and never migrated
 * -- an object observed by an older build genuinely may not carry a field a
 * newer one writes. Marking them required would make the type lie about the
 * lake's oldest contents, and the interface renders each absence as MISSING
 * rather than as a zero or an empty cell.
 */
export interface LakeManifest {
  stamp: string;
  source_key?: string;
  sha256?: string;
  blob_key?: string;
  bytes?: number;
  run_id?: string;
  observed_at?: string;
  reason?: string;
}

export interface LakeManifests {
  key: string;
  versions: LakeManifest[];
}

/**
 * Totals for one customer.
 *
 * NO ENDPOINT SERVES THIS YET. `curated.customer_commercial_overview` exists in
 * migration 006 and nothing in `vcdo/api/routers/` exposes it, so nothing in the
 * interface renders a money figure. The type and `@/lib/money` stay because the
 * discipline they encode is the expensive part -- an amount crosses as a string
 * and is never parsed into a JavaScript number -- and re-deriving that later,
 * against a UI already rendering floats, is how the rule gets broken once and
 * for good.
 */
export interface CustomerTotals {
  customer: string;
  invoiced: Money | null;
  outstanding: Money | null;
}
