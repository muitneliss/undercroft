/**
 * What the assistant may ask for, in what arguments, and what it is allowed to do with it.
 *
 * This is a DECLARATION, not an implementation: no entry here carries an `execute`. That is
 * deliberate and it is what `.claude/rules/layering.md` forces -- a service may not import
 * `@trpc/*`, and every one of these reaches its answer through a tRPC procedure. So the
 * catalogue says WHAT a tool is and `handlers/assistantTools.ts` binds it to
 * `appRouter.createCaller(ctx)`, which is the one place the model and the router meet.
 *
 * The split is worth more than rule compliance. Because the binding goes through the real
 * router, every tool inherits `tenantProcedure`, `requireRole`, the 404-not-403 boundary and
 * the locale-worded refusals unchanged -- a viewer who asks the assistant to trigger a run gets
 * the refusal a viewer clicking the button gets, because the tool refuses ITSELF. Nothing here
 * re-implements an authorization check, so nothing here can drift away from one.
 *
 * WHY THE DESCRIPTIONS ARE IN ENGLISH while every reader-facing string is Vietnamese-first: a
 * description is read by the model, never rendered. `.claude/rules/i18n.md` governs what a
 * person sees, and what a person sees about a tool is the proof slip, whose sentence comes from
 * the i18n catalogue keyed by `proofKey`. Writing these in Vietnamese would translate a prompt
 * and leave the reader's sentence untranslated -- exactly backwards.
 *
 * WHAT IS NOT HERE. `connections.setScope` takes `z.unknown()` (a Google Picker payload), which
 * cannot become a tool input schema and should not: choosing which mailbox labels to read is a
 * consent decision a person makes in Google's own dialog. The prompt says so, so the model
 * offers to open the picker rather than inventing a selection.
 */

import { z } from "zod";

import { inTenant, type Tier, type ToolSpec } from "./toolSpec.ts";
import { PRIVILEGED_WRITE_TOOLS, WRITE_TOOLS } from "./writeTools.ts";

/** `{ rows: [...] }` is the shape three read tools answer with; count them, never quote them. */
function countRows(output: unknown): string | null {
  if (output !== null && typeof output === "object" && "rows" in output) {
    const { rows } = output;
    return Array.isArray(rows) ? `${rows.length} rows` : null;
  }
  return null;
}

function countItems(output: unknown): string | null {
  return Array.isArray(output) ? `${output.length} items` : null;
}

/**
 * The read tier: everything the assistant may answer a question from.
 *
 * Every one of these is something the caller could already have read by clicking, and each runs
 * as them. So the worst a wrong call does is fetch the wrong page of the reader's own data.
 */
export const READ_TOOLS = {
  listCustomers: {
    description:
      "List the customers (cases) this person can see, with the role they hold in each. " +
      "Call this first when the person has not said which customer they mean.",
    inputSchema: z.object({}),
    tier: "read",
    plate: "facts",
    procedure: "tenants.list",
    summarize: countItems,
  },
  sourceStatus: {
    description:
      "For one customer, every connected source (hubspot, xero, gmail, drive) with its grant " +
      "status, ingest cadence and last run. This answers 'is my data flowing?'. Gmail and " +
      "Drive may list several accounts, each with its own `source` id; name each by address.",
    inputSchema: inTenant,
    tier: "read",
    plate: "grants",
    procedure: "connections.list",
    summarize: countItems,
  },
  recentRuns: {
    description:
      "The ingest and build runs for one customer, newest first, with counts and status. Use " +
      "this to answer whether something landed, and when.",
    inputSchema: inTenant.extend({
      limit: z.number().int().min(1).max(100).default(20),
    }),
    tier: "read",
    plate: "runs",
    procedure: "runs.list",
  },
  runDetail: {
    description:
      "One run in full: every step, what it landed, and every row it REFUSED with the reason. " +
      "This is how to answer 'why was that row not imported?'.",
    inputSchema: inTenant.extend({ runId: z.string().min(1) }),
    tier: "read",
    plate: "facts",
    procedure: "runs.get",
  },
  lakeSummary: {
    description: "What has landed in the raw lake for one customer, by source and entity.",
    inputSchema: inTenant,
    tier: "read",
    plate: "facts",
    procedure: "lake.summary",
  },
  searchLake: {
    description:
      "Full-text search across everything landed for one customer, in Vietnamese or English. " +
      "Diacritics are folded, so 'hop dong' finds 'Hợp đồng'. Admin only.",
    inputSchema: inTenant.extend({
      q: z.string().min(1).describe("What to look for, in the reader's own words."),
      limit: z.number().int().min(1).max(25).default(10),
    }),
    tier: "read",
    plate: "table",
    procedure: "lake.search",
    summarize: countRows,
  },
  listQuestions: {
    description: "The saved questions and dashboards in this customer's Reports division.",
    inputSchema: inTenant,
    tier: "read",
    plate: "questions",
    procedure: "bi.questions.list",
    summarize: countItems,
  },
  listModels: {
    description: "The dbt models this customer has authored, and each one's last build.",
    inputSchema: inTenant,
    tier: "read",
    plate: "facts",
    procedure: "models.list",
    summarize: countItems,
  },
  analyticsSchema: {
    description:
      "The tables and columns available in this customer's analytics schema. Call this BEFORE " +
      "proposing a chart or a query, so the columns named are ones that exist.",
    inputSchema: inTenant,
    tier: "read",
    plate: "facts",
    procedure: "bi.schema",
  },
} as const satisfies Record<string, ToolSpec>;

/**
 * The navigate tier: the assistant moves the reader, or fills a draft, and stops.
 *
 * These are the only tools with no `procedure` and no server-side `execute`, which is what
 * makes them safe by construction rather than by policy: they are handled in the browser, so
 * the server sees nothing until the reader presses something themselves. No proof is pulled,
 * because there is nothing to confirm -- opening a page is not an action on anybody's data.
 *
 * `draftLakeQuery` is the one that earns this tier. The assistant is good at writing SQL and
 * must not run it: `lake.query` executes as the customer's own read-only role against their
 * data, and an author has to SEE what they are about to run. So the model writes the query
 * into the console's draft, takes the reader there, and stops -- they read it and press Run.
 * That is also why no `runQuery` tool exists at any tier.
 */
export const NAVIGATE_TOOLS = {
  openDivision: {
    description:
      "Take the reader to one division of a customer's book: sources, journal, lake, models, " +
      "reports or people. Use when the answer is a screen rather than a sentence.",
    inputSchema: inTenant.extend({
      division: z.enum(["sources", "journal", "lake", "models", "reports", "people"]),
    }),
    tier: "navigate",
    plate: "none",
  },
  draftLakeQuery: {
    description:
      "Write a SQL query into the lake console's editor and take the reader there. It is NOT " +
      "run: they read it and press Run themselves. Use this whenever a question needs SQL. " +
      "Call analyticsSchema first so the columns you name exist.",
    inputSchema: inTenant.extend({
      sql: z.string().min(1).describe("A single read-only SELECT. It will not be executed."),
    }),
    tier: "navigate",
    plate: "none",
  },
} as const satisfies Record<string, ToolSpec>;

/**
 * Every tool the assistant has, by tier.
 *
 * One object rather than a per-tier export, so `handlers/assistantTools.ts` binds one map and
 * the tier decides the approval -- rather than a caller having to remember to include a tier.
 * The write and privileged tiers join here as they land.
 */
export const CATALOGUE = {
  ...READ_TOOLS,
  ...NAVIGATE_TOOLS,
  ...WRITE_TOOLS,
  ...PRIVILEGED_WRITE_TOOLS,
} as const satisfies Record<string, ToolSpec>;

export type ToolName = keyof typeof CATALOGUE;

/**
 * The same catalogue, widened to `ToolSpec`.
 *
 * `CATALOGUE` is `as const` so `ToolName` is a union of literals rather than `string`, which is
 * what makes `summarizeFor` type-safe. That also makes `Object.entries` yield the literal types,
 * and a caller iterating it then needs a cast to talk about a `ToolSpec` -- so the widened view
 * is declared once here instead of asserted at each of them.
 */
export const TOOLS: Readonly<Record<string, ToolSpec>> = CATALOGUE;

/** The tiers that change something, and therefore must be confirmed before they run. */
export const MUTATING_TIERS: readonly Tier[] = ["write", "privileged"];

export function mutates(spec: ToolSpec): boolean {
  return MUTATING_TIERS.includes(spec.tier);
}

/**
 * Tools whose declaration does not match their tier.
 *
 * A mutation with no `proofKey` would render a proof the reader cannot read; a read with one
 * is dead prose. Both are caught by a test rather than by review, because both look fine.
 */
export function misdeclared(): readonly string[] {
  return Object.entries(TOOLS)
    .filter(([, spec]) => mutates(spec) !== (spec.proofKey !== undefined))
    .map(([name]) => name);
}

/**
 * Tools whose tier and `procedure` disagree.
 *
 * A navigate tool WITH a procedure would be given a server-side `execute` and would stop being
 * a navigation; anything else WITHOUT one would be offered to the model and then handled by
 * nobody. Both are silent: the first acts without a proof, the second hangs.
 */
export function misrouted(): readonly string[] {
  return Object.entries(TOOLS)
    .filter(([, spec]) => (spec.tier === "navigate") === (spec.procedure !== undefined))
    .map(([name]) => name);
}

/** The summariser `transcript.ts` takes, assembled from what each tool declared about itself. */
export function summarizeFor(toolName: string, output: unknown): string | null {
  return TOOLS[toolName]?.summarize?.(output) ?? null;
}

/**
 * The input schemas alone, for `validateUIMessages`.
 *
 * Deliberately built from the catalogue rather than from the bound tool set: a restored
 * transcript is checked against what a tool is DECLARED to take, which is the fact that
 * outlives any one request's binding. It also keeps the validator independent of the SDK's
 * `ToolSet` shape, which carries an `execute` the validator has no use for.
 */
export function inputSchemas(
  tiers: readonly Tier[],
): Record<string, { inputSchema: z.ZodTypeAny }> {
  const schemas: Record<string, { inputSchema: z.ZodTypeAny }> = {};
  for (const [name, spec] of Object.entries(TOOLS)) {
    if (tiers.includes(spec.tier)) {
      schemas[name] = { inputSchema: spec.inputSchema };
    }
  }
  return schemas;
}
