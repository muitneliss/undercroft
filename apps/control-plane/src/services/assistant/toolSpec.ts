/**
 * What a tool IS, as the catalogue declares it: its tier, its plate and its shape.
 *
 * Split from `catalogue.ts`, which had grown past what one file may be once the write tier grew
 * a re-sync (ADR 0082). The tiers themselves are declared in `catalogue.ts` and `writeTools.ts`;
 * this holds what every one of them is made of, so neither has to import the other.
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
   *
   * ABSENT for the `navigate` tier, and that absence is the tier: a navigate tool has no
   * server-side `execute` at all, so the SDK hands it to the browser. Nothing reaches the
   * server that the reader did not then click.
   */
  readonly procedure?: string;
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
export const inTenant = z.object({
  tenantId: z.string().min(1).describe("The CASE-id of the customer, e.g. CASE-0042."),
});
