/**
 * The compiler's refusals in `surface.ts`, pinned from the side where they fire.
 *
 * The quiet side is the real tables: `EFFECTS`, the two sentence catalogues and
 * `MCP_EXCLUDED` compile, and so do the CLI's calls by name. This file is the other side. Each
 * fixture below is something a router change would leave behind, and each carries a
 * `@ts-expect-error`; if the mapped types ever stop biting -- `ProcedurePath` widening to
 * `string` after a tRPC upgrade, say -- the error goes away, the directive is unused, and
 * `tsc` fails here. A check that always passes is how a gate dies without anyone noticing.
 *
 * Never imported and never run. It is a `.ts` file under `src/`, so the ordinary typecheck
 * (`task ci:typecheck`) compiles it with everything else; that is the whole of its job.
 */

import type {
  EffectTable,
  ExclusionTable,
  InputOf,
  KindOf,
  MutationPath,
  ProcedurePath,
  SentenceTable,
} from "./surface.ts";

declare const EVERY_EFFECT: EffectTable;
declare const EVERY_SENTENCE: SentenceTable;
declare const NO_MUTATIONS: Omit<EffectTable, MutationPath>;
declare const ANY_STRING: string;

/** A new mutation nobody classified: it would otherwise reach a read-only grant unguarded. */
// @ts-expect-error -- every mutation must have an effect
export const missingEffect: EffectTable = NO_MUTATIONS;

/** A procedure renamed or deleted in the router, still classified. */
export const staleEffect: EffectTable = {
  ...EVERY_EFFECT,
  // @ts-expect-error -- the router has no such procedure
  "runs.retired": "write",
};

/** A sentence left behind for a procedure that is gone. */
export const staleSentence: SentenceTable = {
  ...EVERY_SENTENCE,
  // @ts-expect-error -- the router has no such procedure
  "runs.retired": "Một thủ tục không còn nữa.",
};

/** A procedure excluded from model-context clients after the router dropped it. */
export const staleExclusion: ExclusionTable = {
  // @ts-expect-error -- the router has no such procedure
  "runs.retired": "was once excluded",
};

/** A procedure called by name that the router does not have. */
// @ts-expect-error -- `InputOf` takes only a path the router has
export type MissingInput = InputOf<"runs.retired">;

/** A query sent as a mutation: the wire method follows the router, not the caller. */
// @ts-expect-error -- `tenants.list` is a query
export const wrongKind: KindOf<"tenants.list"> = "mutation";

/** An input the procedure does not take. */
// @ts-expect-error -- `runs.get` takes a `runId`, not a `run`
export const wrongInput: InputOf<"runs.get"> = { tenantId: "CASE-0042", run: "run-1" };

/** Sanity for the fixtures above: the path type is a finite set, not `string`. */
// @ts-expect-error -- an arbitrary string is not a procedure path
export const anyString: ProcedurePath = ANY_STRING;
