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

/**
 * What a source IS -- its kind -- and not which connection.
 *
 * Since ADR 0043 a tenant may hold several Gmail mailboxes and several Drive accounts, each its
 * own source (`gmail`, `gmail.3fa9c1d2e0ab`). Everything keyed by this type -- the vendor's
 * name, the consent sentence, which picker opens -- is a fact about the KIND, so it is read
 * off `connection.kind`, or off `sourceKind(source)` from `@undercroft/contracts/sources`.
 * Anything that acts on one connection -- a mutation, a draft in the store -- takes the
 * instance `source` string instead, so it acts on the account the reader is looking at.
 */
export type Source = "hubspot" | "xero" | "gmail" | "drive";

export const SOURCES: readonly Source[] = ["hubspot", "xero", "gmail", "drive"] as const;

/** Whether a string from a URL or a ledger row names one of the four kinds. */
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
 *
 * `kind` is what the connection is and `source` is which one; see `Source` above. The list
 * carries one of these per ACCOUNT, so a kind with two mailboxes appears twice.
 */
export type Connection = inferRouterOutputs<AppRouter>["connections"]["list"][number];

export type ConnectionStatus = Connection["status"];

/** One line of the ledger, exactly as `runs.list` returns it. */
export type RunView = inferRouterOutputs<AppRouter>["runs"]["list"]["items"][number];

/** One run in full, as `runs.get` returns it: the line plus what it recorded beneath. */
export type RunDetail = inferRouterOutputs<AppRouter>["runs"]["get"];

/** One line of what a run said while it ran, as `runs.events` returns it. */
export type RunEventView = inferRouterOutputs<AppRouter>["runs"]["events"][number];

/** One ingest key as `keys.list` returns it. Never the token itself, which is minted once. */
export type IngestKey = inferRouterOutputs<AppRouter>["keys"]["list"][number];

/** What has landed, per stream, as `lake.summary` returns it. */
export type LakeSummary = inferRouterOutputs<AppRouter>["lake"]["summary"];

/**
 * One search hit, as `lake.search` returns it: a record's or a document's, never both.
 *
 * Inferred rather than imported from `@undercroft/contracts` for the reason the docstring at
 * the top of this file gives about `Connection`: what the SERVER actually answers with is the
 * thing the interface must agree with, and inferring it makes a drift a compile error here.
 */
export type RawSearchHit = inferRouterOutputs<AppRouter>["lake"]["search"]["hits"][number];

/** One model on the list, as `models.list` returns it: its name and its last build. */
export type ModelItem = inferRouterOutputs<AppRouter>["models"]["list"][number];

/** One model in full, as `models.get` returns it: the item plus its SQL and tests. */
export type ModelDetail = inferRouterOutputs<AppRouter>["models"]["get"];

/** What a build answered: the run, its steps, and the model's first rows. */
export type BuildResult = inferRouterOutputs<AppRouter>["models"]["build"];

/** A query result as every tenant-scoped read answers it: columns, rows, and whether cut. */
export type TableResult = BuildResult["preview"] & object;

/** One saved question in full, as `bi.questions.get` returns it. */
export type QuestionView = inferRouterOutputs<AppRouter>["bi"]["questions"]["get"];

/** One saved question on the list, as `bi.questions.list` returns it: no SQL, no rows. */
export type QuestionItem = inferRouterOutputs<AppRouter>["bi"]["questions"]["list"][number];

/** One dashboard in full, as `bi.dashboards.get` returns it. */
export type DashboardView = inferRouterOutputs<AppRouter>["bi"]["dashboards"]["get"];

/** One dashboard on the list, as `bi.dashboards.list` returns it. */
export type DashboardItem = inferRouterOutputs<AppRouter>["bi"]["dashboards"]["list"][number];

/** The tenant's analytics schema as its read-only login sees it. */
export type SchemaView = inferRouterOutputs<AppRouter>["bi"]["schema"];
