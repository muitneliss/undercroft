/**
 * The two things the assistant does in the browser rather than on the server.
 *
 * Both are the `navigate` tier, and the tier is safe by CONSTRUCTION rather than by policy:
 * these tools have no server-side `execute` at all, so nothing reaches the server that the
 * reader did not then press themselves. No proof is pulled, because opening a page is not an
 * action on anybody's data.
 *
 * `draftLakeQuery` is the one that earns the tier. The assistant is good at writing SQL and
 * must not run it -- `lake.query` executes against a customer's data as their own role, and an
 * author has to SEE what they are about to run. So the query is written into the console's
 * draft and the reader is taken there; they read it and press Run. There is deliberately no
 * tool at any tier that runs SQL.
 *
 * PURE FUNCTIONS over `(navigate, store)` rather than hooks, so they are tested as values.
 * What they return is the tool's output -- the model is told what happened, because "I have
 * opened the Journal for you" is only true if it worked.
 */

import { type DivisionId, divisionPath } from "@/lib/divisions.ts";

/** What the model is told. A sentence, not a status code: it has to report this to a reader. */
export interface Outcome {
  readonly done: boolean;
  readonly went?: string;
  readonly why?: string;
}

/** Just the store writes these need, so a test passes two functions instead of a store. */
export interface ActionDeps {
  readonly navigate: (path: string) => void;
  readonly setLakeSql: (tenantId: string, sql: string) => void;
  /**
   * Divisions a reader may actually open, as a type PREDICATE.
   *
   * A predicate rather than a boolean so the check narrows: `divisionPath` takes a
   * `DivisionId`, and without narrowing the call site would need an assertion about a value
   * that came from a model -- which is exactly the value least worth asserting about.
   */
  readonly knownDivision: (id: string) => id is DivisionId;
}

export function openDivision(
  deps: ActionDeps,
  input: { tenantId: string; division: string },
): Outcome {
  const { division } = input;
  if (!deps.knownDivision(division)) {
    // Refused rather than approximated. Sending the reader to a guessed page is worse than
    // telling the model it named something that does not exist -- rule 2.
    return { done: false, why: `no such division: ${division}` };
  }
  const path = divisionPath(division, input.tenantId);
  deps.navigate(path);
  return { done: true, went: path };
}

export function draftLakeQuery(
  deps: ActionDeps,
  input: { tenantId: string; sql: string },
): Outcome {
  // The draft first, then the move: the console reads the draft on mount, so navigating first
  // would show the reader an empty editor that fills in underneath them.
  deps.setLakeSql(input.tenantId, input.sql);
  const path = `${divisionPath("lake", input.tenantId)}/console`;
  deps.navigate(path);
  // Says plainly that it did NOT run, because the model has to tell the reader that and
  // because a tool result reading "done" invites it to claim the answer is on screen.
  return { done: true, went: path, why: "written into the editor, not run" };
}

/**
 * One field of a tool's arguments, as a string.
 *
 * The arguments arrive as `unknown` -- they came from a model -- so they are narrowed HERE
 * rather than asserted at the call site. Every field is coerced anyway, which is what made the
 * cast pointless: what the browser needs is a string, and a missing one is an empty string
 * that the two functions above then refuse or write down visibly.
 */
function field(input: unknown, name: string): string {
  if (input === null || typeof input !== "object" || !(name in input)) {
    return "";
  }
  const value = Reflect.get(input, name);
  return typeof value === "string" ? value : String(value ?? "");
}

/** Every navigate tool, by name. A name not here is one the browser will not act on. */
export const CLIENT_ACTIONS: Readonly<
  Record<string, (deps: ActionDeps, input: unknown) => Outcome>
> = {
  openDivision: (deps, input) =>
    openDivision(deps, {
      tenantId: field(input, "tenantId"),
      division: field(input, "division"),
    }),
  draftLakeQuery: (deps, input) =>
    draftLakeQuery(deps, { tenantId: field(input, "tenantId"), sql: field(input, "sql") }),
};
