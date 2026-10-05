/**
 * A model's business context, and whether it still describes the model. ADR 0105.
 *
 * A context is approved against a DEFINITION, and this module is the one place that says what
 * a definition is and when two differ. At approval it stores a fingerprint of:
 *
 * - the model's own SQL and tests (each as a sha256) and the set of columns its build found;
 * - the same three of each model it reads DIRECTLY -- every `ref` its text declares, a macro's
 *   included (`modelLineage.ts`) -- keyed by name.
 *
 * Read later, the fingerprint is compared with what `app.model` holds now, and the state is
 * derived from that comparison and never stored:
 *
 * - `incomplete` -- a section is unanswered (`missingSections`), whatever else is true;
 * - `needs_review` -- the definition changed since approval, each change named `{model, kind}`;
 * - `current` -- neither.
 *
 * WHY READ-TIME. The worker records a model's columns after every build, scheduled ones
 * included, and the control plane hears about none of them. A state stored at save time would
 * be wrong after the first scheduled build that added a column; a state derived on read cannot
 * be, and it needs no grant for the worker on the context table.
 *
 * WHY DIRECT UPSTREAM ONLY. With A -> B -> C, B is described in terms of A, so a change to A is
 * B's to review. C is described in terms of B, and if B's definition did not change, neither
 * did what C reads. Following the whole chain would flag every model below the first change
 * and teach a reader to ignore the flag. Re-approving B without changing it leaves C alone.
 *
 * WHAT DOES NOT COUNT AS A CHANGE. Test kinds in another order, a column listed with no tests,
 * columns in another order: none of them changes what the model is. And the FIRST build of a
 * model approved before it was ever built: columns going from none to some is the build
 * finding what the SQL always said, not the SQL changing. The cost, recorded in the ADR: a
 * column change after that first build is not seen until the context is approved again.
 *
 * NOTHING IS INFERRED. `absentColumns` lists only what the context names that the last build
 * did not have; `upstreamUndeclared` only says lineage could not read part of the model, so a
 * change through that part cannot be seen. Neither guesses at meaning, and neither is a test.
 *
 * Saving IS approval, and it carries the `basis` the reader approved -- the hash of the
 * fingerprint `get` showed them. A definition that changed since then is refused and nothing
 * is written: an approval is of what somebody read, never of what happened to be there.
 */

import { createHash } from "node:crypto";

import {
  type ContextChangeKind,
  type ContextSection,
  type ContextState,
  missingSections,
  ModelContext,
} from "@undercroft/contracts";
import { canonicalJson } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { listMacros, listModels, type Model } from "@undercroft/db/repos";
import { type Lineage, modelLineage } from "@undercroft/db/services";
import { z } from "zod";

import { record as recordAudit } from "../repos/auditLog.ts";
import { listModelContexts, upsertModelContext } from "../repos/modelContext.ts";

/** One thing that changed since approval: in this model, or in a model it reads. */
export interface ContextChange {
  readonly model: string;
  readonly kind: ContextChangeKind;
}

export interface ContextView {
  readonly state: ContextState;
  readonly missing: readonly ContextSection[];
  /** Since approval. Kept when the state is `incomplete`, which outranks it. */
  readonly changes: readonly ContextChange[];
  /** The approved text, shown under any warning rather than hidden by it. */
  readonly body: ModelContext | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  /** What an approval of THIS definition must carry back to `setContext`. */
  readonly basis: string;
  /** Key or defined columns the last build did not have; `null` when it was never built. */
  readonly absentColumns: readonly string[] | null;
  /** Lineage cannot read part of this model, so a change through that part goes unseen. */
  readonly upstreamUndeclared: boolean;
}

/** The three facts of one model's definition that a context is approved against. */
const Print = z.object({
  sql: z.string(),
  tests: z.string(),
  columns: z.array(z.string()),
});
type Print = z.infer<typeof Print>;

const Fingerprint = z.object({ model: Print, upstream: z.record(z.string(), Print) });
type Fingerprint = z.infer<typeof Fingerprint>;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Tests as what they check, not as they were typed: a column with no tests is no test, and
 * kinds are a set. `canonicalJson` orders the keys.
 */
function canonicalTests(tests: Model["tests"]): string {
  const columns: Record<string, string[]> = {};
  for (const [column, kinds] of Object.entries(tests.columns)) {
    if (kinds.length > 0) {
      columns[column] = [...new Set(kinds)].sort();
    }
  }
  return canonicalJson({ columns });
}

function printOf(model: Model): Print {
  return {
    sql: sha256(model.sql),
    tests: sha256(canonicalTests(model.tests)),
    columns: [...new Set(model.columns)].sort(),
  };
}

/** The tenant's definitions as one reading: every model, the lineage, the approved contexts. */
interface Definitions {
  readonly byName: ReadonlyMap<string, Model>;
  readonly lineage: Lineage;
  readonly approved: ReadonlyMap<
    string,
    { body: ModelContext; reviewed: Fingerprint; reviewedBy: string; reviewedAt: string }
  >;
}

async function readDefinitions(
  exec: SqlExecutor,
  tenantId: string,
  models: readonly Model[],
): Promise<Definitions> {
  const [macros, rows] = await Promise.all([
    listMacros(exec, tenantId),
    listModelContexts(exec, tenantId),
  ]);
  const approved = new Map<
    string,
    { body: ModelContext; reviewed: Fingerprint; reviewedBy: string; reviewedAt: string }
  >();
  for (const row of rows) {
    // A row an older shape wrote is refused rather than half-read: the model then reads as
    // having no context, which is visibly incomplete, where a half-parsed one would not be.
    const body = ModelContext.safeParse(row.body);
    const reviewed = Fingerprint.safeParse(row.reviewed);
    if (body.success && reviewed.success) {
      approved.set(row.modelName, {
        body: body.data,
        reviewed: reviewed.data,
        reviewedBy: row.reviewedBy,
        reviewedAt: row.reviewedAt,
      });
    }
  }
  return {
    byName: new Map(models.map((model) => [model.name, model])),
    lineage: modelLineage({ models, macros }),
    approved,
  };
}

/** The models `name` reads directly, by declared `ref`, its macros' included. */
function upstreamOf(definitions: Definitions, name: string): string[] {
  const to = `model:${name}`;
  const names = definitions.lineage.edges
    .filter((edge) => edge.to === to && edge.from.startsWith("model:"))
    .map((edge) => edge.from.slice("model:".length));
  return [...new Set(names)].sort();
}

function fingerprintOf(definitions: Definitions, model: Model): Fingerprint {
  const upstream: Record<string, Print> = {};
  for (const name of upstreamOf(definitions, model.name)) {
    const read = definitions.byName.get(name);
    if (read !== undefined) {
      upstream[name] = printOf(read);
    }
  }
  return { model: printOf(model), upstream };
}

function basisOf(fingerprint: Fingerprint): string {
  return sha256(canonicalJson(fingerprint));
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((item) => right.has(item));
}

/** What changed in one definition. Columns found by a first build are not a change. */
function printChanges(name: string, then: Print, now: Print): ContextChange[] {
  const changes: ContextChange[] = [];
  if (then.sql !== now.sql) {
    changes.push({ model: name, kind: "sql" });
  }
  if (then.tests !== now.tests) {
    changes.push({ model: name, kind: "tests" });
  }
  if (then.columns.length > 0 && !sameSet(then.columns, now.columns)) {
    changes.push({ model: name, kind: "columns" });
  }
  return changes;
}

function changesBetween(
  name: string,
  then: Fingerprint,
  now: Fingerprint,
  exists: (model: string) => boolean,
): ContextChange[] {
  const changes = printChanges(name, then.model, now.model);
  const names = [...new Set([...Object.keys(then.upstream), ...Object.keys(now.upstream)])].sort();
  for (const upstream of names) {
    const before = then.upstream[upstream];
    const after = now.upstream[upstream];
    if (before === undefined || after === undefined) {
      // Read now and not then, or then and not now: which models this one reads changed. One
      // it read that is gone altogether is said as that, rather than as a changed dependency.
      const gone = before !== undefined && !exists(upstream);
      changes.push({ model: upstream, kind: gone ? "missing" : "dependency" });
    } else {
      changes.push(...printChanges(upstream, before, after));
    }
  }
  return changes;
}

/** What the context names that the last build did not have; `null` with no build to ask. */
function absentColumns(model: Model, body: ModelContext | null): string[] | null {
  if (model.columns.length === 0) {
    return null;
  }
  const named = [
    ...(body?.key?.kind === "declared" ? body.key.columns : []),
    ...(body?.columns.map((column) => column.name) ?? []),
  ];
  const built = new Set(model.columns);
  return [...new Set(named)].filter((name) => !built.has(name));
}

function viewOf(definitions: Definitions, model: Model): ContextView {
  const now = fingerprintOf(definitions, model);
  const approved = definitions.approved.get(model.name);
  const body = approved?.body ?? null;
  const missing = missingSections(body);
  const changes =
    approved === undefined
      ? []
      : changesBetween(model.name, approved.reviewed, now, (name) => definitions.byName.has(name));
  const node = definitions.lineage.nodes.find((n) => n.id === `model:${model.name}`);
  let state: ContextState = "current";
  if (missing.length > 0) {
    state = "incomplete";
  } else if (changes.length > 0) {
    state = "needs_review";
  }
  return {
    state,
    missing,
    changes,
    body,
    reviewedBy: approved?.reviewedBy ?? null,
    reviewedAt: approved?.reviewedAt ?? null,
    basis: basisOf(now),
    absentColumns: absentColumns(model, body),
    upstreamUndeclared: node?.kind === "model" && node.undeclared.length > 0,
  };
}

/**
 * Each of `models`' context as it reads now. The models are the caller's, already read, so
 * every one asked about has its answer; the macros and the approved contexts are read here,
 * once, and the lineage worked out once, however many models are asked about.
 */
export async function readContexts(
  exec: SqlExecutor,
  tenantId: string,
  models: readonly Model[],
): Promise<(model: Model) => ContextView> {
  const definitions = await readDefinitions(exec, tenantId, models);
  return (model) => viewOf(definitions, model);
}

export type SetContextOutcome =
  | { readonly ok: true; readonly context: ContextView }
  | { readonly ok: false; readonly reason: "not-found" | "changed" };

/**
 * Approve `context` as the model's, if the definition is still the one `basis` was read from.
 *
 * Nothing about the model's save, build or delete waits on this: a context is advice to a
 * reader, never a gate on the definition. The trail names the model and the state the context
 * was approved in, never its text -- the text is in the table beside it.
 */
export async function setContext(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    name: string;
    basis: string;
    context: ModelContext;
    actor: string;
    actorId: string;
  },
): Promise<SetContextOutcome> {
  const models = await listModels(exec, input.tenantId);
  const model = models.find((m) => m.name === input.name);
  if (model === undefined) {
    return { ok: false, reason: "not-found" };
  }
  const reviewed = fingerprintOf(await readDefinitions(exec, input.tenantId, models), model);
  if (basisOf(reviewed) !== input.basis) {
    return { ok: false, reason: "changed" };
  }
  const written = await upsertModelContext(exec, input.tenantId, {
    modelName: input.name,
    body: input.context,
    reviewed,
    reviewedBy: input.actorId,
  });
  if (!written) {
    return { ok: false, reason: "not-found" };
  }
  const context = viewOf(await readDefinitions(exec, input.tenantId, models), model);
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "models.setContext",
    detail: JSON.stringify({ name: input.name, state: context.state }),
  });
  return { ok: true, context };
}
