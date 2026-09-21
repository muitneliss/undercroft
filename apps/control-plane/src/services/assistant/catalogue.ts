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

/**
 * How far a tool may go, and therefore what has to happen before it runs.
 *
 * The tiers are the four the interview settled on. They are a property of the TOOL and not of
 * the turn, so "which tier is this" is never a judgement made under time pressure:
 *
 * - `read` runs as soon as the model asks. It can only return what the caller could already
 *   have read by clicking, as themselves.
 * - `navigate` is executed in the browser, not here: it moves the reader or fills a draft, and
 *   nothing reaches the server that the reader did not then click.
 * - `write` is reversible and cheap, and is pulled as a proof the reader must strike.
 * - `privileged` is none of those. It is a proof AND a typed confirmation of the object's name.
 */
export type Tier = "read" | "navigate" | "write" | "privileged";

/**
 * Which prepared plate renders this tool's result.
 *
 * A closed set, because the model chooses among the repo's own printed components and cannot
 * cut a new one: it supplies typed props to a plate that already exists. That is what keeps a
 * model-rendered figure inside `DESIGN.md` -- no easing curve, no modal, no coloured badge, no
 * vermilion -- and it is why there is no HTML tool. See `docs/adr/0029`.
 */
export type Plate = "table" | "chart" | "runs" | "grants" | "questions" | "facts" | "none";

export interface ToolSpec {
  /** Read by the model. English, deliberately -- see the module docstring. */
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;
  readonly tier: Tier;
  readonly plate: Plate;
  /**
   * The procedure this tool is bound to, as a dotted path into `appRouter`.
   *
   * A string rather than a function so this file holds no reference to the router, which is
   * what keeps it a service. `handlers/assistantTools.ts` resolves it, and
   * `assistantTools.test.ts` asserts every path here resolves to a real procedure -- so a
   * renamed procedure fails the gate rather than failing at the first question.
   */
  readonly procedure: string;
  /**
   * The i18n key for the sentence a proof prints, interpolated with the arguments.
   *
   * Required for `write` and `privileged` and absent otherwise, and that is asserted rather
   * than trusted: a mutation with no sentence would render a proof the reader cannot read,
   * and a plate with a sentence nobody prints is dead prose.
   */
  readonly proofKey?: string;
  /**
   * How this tool summarises its own output for the transcript, safely.
   *
   * The tool knows what is safe about its own result; `transcript.ts` does not, and must not
   * guess. `null` means "nothing safe to say", which renders as absent. See that module.
   */
  readonly summarize?: (output: unknown) => string | null;
}

/** Every tenant-scoped tool carries the customer it is about, as the procedures do. */
const inTenant = z.object({
  tenantId: z.string().min(1).describe("The CASE-id of the customer, e.g. CASE-0042."),
});

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
      "status, ingest cadence and last run. This answers 'is my data flowing?'.",
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
 * Every tool the assistant has, by tier.
 *
 * One object rather than a per-tier export, so `handlers/assistantTools.ts` binds one map and
 * the tier decides the approval -- rather than a caller having to remember to include a tier.
 * The write and privileged tiers join here as they land.
 */
export const CATALOGUE = { ...READ_TOOLS } as const satisfies Record<string, ToolSpec>;

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
