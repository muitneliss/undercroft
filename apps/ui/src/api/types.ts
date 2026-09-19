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

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@undercroft/control-plane/router";

export type Source = "hubspot" | "xero" | "gmail" | "drive";

export const SOURCES: readonly Source[] = ["hubspot", "xero", "gmail", "drive"] as const;

/** Whether a string from a URL or a ledger row names one of the four. */
export function isSource(value: string | undefined): value is Source {
  return SOURCES.some((source) => source === value);
}

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

/** One line of the ledger, exactly as `runs.list` returns it. */
export type RunView = inferRouterOutputs<AppRouter>["runs"]["list"]["items"][number];

/** One run in full, as `runs.get` returns it: the line plus what it recorded beneath. */
export type RunDetail = inferRouterOutputs<AppRouter>["runs"]["get"];

/** What has landed, per stream, as `lake.summary` returns it. */
export type LakeSummary = inferRouterOutputs<AppRouter>["lake"]["summary"];
