/**
 * The catalogue constants the interface owns, and the server types it borrows.
 *
 * `Connection` is INFERRED from the router rather than written here. The hand-written copy
 * this replaces was a leftover mirror of a Python API that no longer exists, in snake_case
 * no endpoint has ever returned -- a type that agreed with nothing and could not fail
 * loudly when it drifted. Inferring it means a server field renamed is a compile error here,
 * which is the whole argument for a monorepo carrying both halves.
 *
 * What stays hand-written is what the server must NOT own: the vendors' product names, and
 * the consent sentences. Money is a string here for the reason given in `@/lib/money`.
 */

import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@undercroft/control-plane/router";
import type { Money } from "@/lib/money";

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

/**
 * One grant, exactly as `connections.list` returns it.
 *
 * `status` here is the CARD's status, which is not the database's: `needs_scope` and
 * `needs_reconnect` are derived server-side in `services/connections.ts`, because both are
 * facts about rows in other tables rather than a column anybody writes.
 */
export type Connection = inferRouterOutputs<AppRouter>["connections"]["list"][number];

export type ConnectionStatus = Connection["status"];

export type Tenant = {
  id: string;
  display_name: string;
  status: string;
  created_at: string;
};

export type Member = {
  id: string;
  email: string;
  display_name: string;
  is_staff: boolean;
  role: string | null;
};

export type SessionUser = {
  id: string;
  email: string;
  display_name: string;
  is_staff: boolean;
};

export type LakeObject = {
  key: string;
  versions: number;
  newest_sha256: string | null;
  bytes: number | null;
};

/**
 * One observation of an object, from `vcdo/lake/store.py`.
 *
 * Every field is optional because a manifest is written once and never migrated
 * -- an object observed by an older build genuinely may not carry a field a
 * newer one writes. Marking them required would make the type lie about the
 * lake's oldest contents, and the interface renders each absence as MISSING
 * rather than as a zero or an empty cell.
 */
export type LakeManifest = {
  stamp: string;
  source_key?: string;
  sha256?: string;
  blob_key?: string;
  bytes?: number;
  run_id?: string;
  observed_at?: string;
  reason?: string;
};

export type LakeManifests = {
  key: string;
  versions: LakeManifest[];
};

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
export type CustomerTotals = {
  customer: string;
  invoiced: Money | null;
  outstanding: Money | null;
};
