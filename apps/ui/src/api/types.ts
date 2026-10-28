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
 *
 * `config` -- every name the scope chose -- is there only when the list was asked for it
 * (ADR 0127); without it a card carries `chosen`, the counts. See `ConnectionWithConfig`.
 */
export type Connection = inferRouterOutputs<AppRouter>["connections"]["list"][number];

/** A recorded scope by every name it chose: a card's `config`, and the scope a run recorded. */
export type ConnectionConfig = NonNullable<Connection["config"]>;

/** A card read with `include: ["config"]`, as the scope picker and the schedule ask for it. */
export type ConnectionWithConfig = Connection & { readonly config: ConnectionConfig };

export type ConnectionStatus = Connection["status"];

/** One line of the ledger, exactly as `runs.list` returns it. */
export type RunView = inferRouterOutputs<AppRouter>["runs"]["list"]["items"][number];

/** One run in full, as `runs.get` returns it: the line plus what it recorded beneath. */
export type RunDetail = inferRouterOutputs<AppRouter>["runs"]["get"];

/** One line of what a run said while it ran, as `runs.events` returns it. */
export type RunEventView = inferRouterOutputs<AppRouter>["runs"]["events"][number];

/** One ingest key as `keys.list` returns it. Never the token itself, which is minted once. */
export type IngestKey = inferRouterOutputs<AppRouter>["keys"]["list"][number];

/** One personal access token as `account.tokens.list` returns it. Never the token itself. */
export type PersonalToken = inferRouterOutputs<AppRouter>["account"]["tokens"]["list"][number];

/** One app a person let in through the OAuth flow, as `account.apps.list` returns it. */
export type ConnectedApp = inferRouterOutputs<AppRouter>["account"]["apps"]["list"][number];

/** One row of the audit log (ADR 0113), as each of its three readers answers it. */
export type AuditEntry = inferRouterOutputs<AppRouter>["audit"]["mine"]["items"][number];

/** One agent's call as the call log lists it (ADR 0151), without its bodies. */
export type CallEntry = inferRouterOutputs<AppRouter>["audit"]["calls"]["list"]["items"][number];

/** What has landed, per stream, as `lake.summary` returns it. */
export type LakeSummary = inferRouterOutputs<AppRouter>["lake"]["summary"];

/**
 * What one run wrote into a stream against the rows that still name it, as `lake.records` and
 * `lake.documents` answer it beside a page narrowed to that run -- `null` when it cannot be said.
 */
export type RunWrites = inferRouterOutputs<AppRouter>["lake"]["records"]["ofRun"];

/**
 * One search hit, as `lake.search` returns it: a record's or a document's, never both.
 *
 * Inferred rather than imported from `@undercroft/contracts` for the reason the docstring at
 * the top of this file gives about `Connection`: what the SERVER actually answers with is the
 * thing the interface must agree with, and inferring it makes a drift a compile error here.
 */
export type RawSearchHit = inferRouterOutputs<AppRouter>["lake"]["search"]["hits"][number];

/**
 * An answer as the browser asks for it: whole. `models.list`, `macros.list`, `bi.questions.list`
 * and `models.lineage` answer one page, with `nextCursor`, when asked a `limit` or a `cursor`,
 * which only an agent asks (ADR 0133). See `@/lib/listAnswers`.
 */
type Whole<Answer> = Exclude<Answer, { readonly nextCursor: unknown }>;

/**
 * One model on the list, as `models.list` returns it: its name, its hashes and its last build
 * with a column count. No SQL, and the columns only when asked for, which no screen does.
 */
export type ModelItem = Whole<inferRouterOutputs<AppRouter>["models"]["list"]>[number];

/** One model in full, as `models.get` returns it: the item plus its SQL and tests. */
export type ModelDetail = inferRouterOutputs<AppRouter>["models"]["get"];

/**
 * What the models declare they read (ADR 0092): a node per model, raw lake table read and
 * missing dependency, and an edge per declaration. Nothing in it is inferred.
 */
export type ModelLineage = Whole<inferRouterOutputs<AppRouter>["models"]["lineage"]>;
export type LineageNode = ModelLineage["nodes"][number];

/**
 * What a build answered once it was waited for: the run, its steps, the named models' row
 * counts and the model's first rows. A build not waited for answers only its run, and the
 * editor never asks for one.
 */
export type BuildResult = Extract<
  inferRouterOutputs<AppRouter>["models"]["build"],
  { readonly waited: true }
>;

/** A query result as every tenant-scoped read answers it: columns, rows, and whether cut. */
export type TableResult = BuildResult["preview"] & object;

/**
 * A Reports answer: the rows, whole, and `qualifiers` -- each table the query read whose latest
 * tests fail or are unknown, or `null` when which tables were read is not known (ADR 0129).
 */
export type QualifiedAnswer = inferRouterOutputs<AppRouter>["bi"]["questions"]["answer"];
export type AnswerQualifier = NonNullable<QualifiedAnswer["qualifiers"]>[number];

/** One saved question in full, as `bi.questions.get` returns it. */
export type QuestionView = inferRouterOutputs<AppRouter>["bi"]["questions"]["get"];

/**
 * One saved question on the list, as `bi.questions.list` returns it: its kind and chart type,
 * and its definition and chart only when asked for (ADR 0127). See `@/lib/listAnswers`.
 */
export type QuestionItem = Whole<QuestionListAnswer>[number];

/** Either answer `bi.questions.list` gives: the array, or one page of it. */
export type QuestionListAnswer = inferRouterOutputs<AppRouter>["bi"]["questions"]["list"];

/** The modelling reference whole, as the editor's panel asks for it: no `parts`. */
export type ModelReference = Exclude<
  inferRouterOutputs<AppRouter>["models"]["reference"],
  { readonly parts: readonly string[] }
>;

/** Either answer `models.reference` gives: whole, or only the `parts` an agent named. */
export type ModelReferenceAnswer = inferRouterOutputs<AppRouter>["models"]["reference"];

/** One dashboard in full, as `bi.dashboards.get` returns it. */
export type DashboardView = inferRouterOutputs<AppRouter>["bi"]["dashboards"]["get"];

/** One dashboard on the list, as `bi.dashboards.list` returns it. */
export type DashboardItem = inferRouterOutputs<AppRouter>["bi"]["dashboards"]["list"][number];

/**
 * Either answer `bi.schema` and `lake.querySchema` give: the tables with their columns, or --
 * asked `columns: false`, which only an agent asks -- the table names alone (issue 443).
 */
export type SchemaAnswer = inferRouterOutputs<AppRouter>["bi"]["schema"];

/** A schema with its columns, as the browser always asks for it. See `@/lib/schemaAnswer`. */
export type SchemaView = Exclude<SchemaAnswer, { readonly columns: false }>;
