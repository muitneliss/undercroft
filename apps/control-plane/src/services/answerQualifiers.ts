/**
 * What a Reports answer must say about the tables it read: which of them are served with
 * failing tests, or with none on record (issue 456, ADR 0129), and which are an older version
 * because the current build was held back (ADR 0131).
 *
 * Since write-audit-publish a build whose tests fail is not published: the table a question
 * reads is the model's last passing version, and the answer says so -- "last passing version
 * from run X, current build failing" -- because a figure that silently stopped moving is as
 * misleading as a wrong one. A table built before write-audit-publish may still be served with
 * failing tests; the rows are served whole and qualified, never withheld (ADR 0090).
 *
 * Which tables a query read is never guessed from its SQL: the worker reports the relations of
 * Postgres's own plan of the statement it ran (`runFramedWithRelations`), as the BI login. The
 * BI login cannot read `ops`, so the state is joined in here, from the ledger, by the control
 * plane. A table no model builds -- one a model built and was since dropped from the project,
 * say -- has no test record and is qualified as unknown.
 */

import type { QueryAnswer, TableResult } from "@undercroft/contracts";
import { hiddenColumns, type Reach, rowsLimited } from "@undercroft/contracts/access";
import type { SqlExecutor } from "@undercroft/db";

import { readTestStates, type TestStateName } from "./testState.ts";

/** One table the answer read whose tests are not passing, or whose current build was held. */
export interface AnswerQualifier {
  /** The table's name in the tenant's analytics schema: the model that builds it. */
  readonly table: string;
  /** What the tests of the version served say. */
  readonly state: TestStateName;
  /** How many tests failed; `null` when unknown. */
  readonly failing: number | null;
  /** The failing tests' names, empty when unknown. */
  readonly failingTests: readonly string[];
  /** The published build whose tests these are, and when it ended; `null` when not known. */
  readonly runId: string | null;
  readonly endedAt: string | null;
  /** A newer build held back in staging (ADR 0131): the served version is older than it. */
  readonly unpublished: { readonly runId: string; readonly endedAt: string | null } | null;
}

/**
 * An answer as Reports serves it: the rows, whole, and the qualifiers. `qualifiers` is `null`
 * when which tables were read is not known -- a worker older than the plan read, or a plan it
 * could not read -- which a screen words as "not known", never as "nothing to say".
 *
 * `rowsLimited` names the tables it read of which the reader sees only some rows (ADR 0143): a
 * total over one is the total of what they may see, not of the table, and the answer says so
 * rather than letting it pass for the whole. `null` when which tables were read is not known.
 */
export interface QualifiedAnswer extends TableResult {
  readonly qualifiers: readonly AnswerQualifier[] | null;
  readonly rowsLimited: readonly string[] | null;
}

/**
 * The worker's answer with a qualifier for each table it read whose tests are not passing, and
 * the tables it read whose rows `reach` sees only some of.
 */
export async function qualify(
  exec: SqlExecutor,
  tenantId: string,
  answer: QueryAnswer,
  reach: Reach,
): Promise<QualifiedAnswer> {
  const { relations, ...table } = answer;
  if (relations === null || relations === undefined) {
    return { ...table, qualifiers: null, rowsLimited: null };
  }
  const rowsLimitedHere = relations.filter((name) => rowsLimited(reach, name));
  if (relations.length === 0) {
    return { ...table, qualifiers: [], rowsLimited: [] };
  }
  const testsOf = await readTestStates(exec, tenantId, relations);
  const qualifiers: AnswerQualifier[] = [];
  for (const name of relations) {
    const tests = testsOf(name);
    if (tests.state === "passing" && tests.unpublished === null) {
      continue;
    }
    qualifiers.push({
      table: name,
      state: tests.state,
      failing: tests.failing,
      failingTests: tests.failingTests.map((test) => test.name),
      runId: tests.runId,
      endedAt: tests.endedAt,
      unpublished: tests.unpublished,
    });
  }
  return { ...table, qualifiers, rowsLimited: rowsLimitedHere };
}

/**
 * `permission denied for table fct_sales`: Postgres's sentence for a statement that read a table,
 * or a column of one, its login holds no privilege on. Read only to name a refusal that is
 * already a refusal; a message it does not match is relayed as Postgres wrote it.
 */
const PERMISSION_DENIED = /permission denied for (?:table|relation) "?(?<name>[^"\s.]+)"?/u;

/** A table the reader reaches but whose hidden columns their query named, or read with `*`. */
export interface ColumnNotGranted {
  readonly model: string;
  readonly hidden: readonly string[];
}

/**
 * Whether a query Postgres refused for want of a privilege read a table the reader reaches with
 * hidden columns (ADR 0143). Postgres says "permission denied for table" for a hidden column as for
 * a table outside the reader's reach, which reads as if they could not see the table at all; this
 * names what they cannot see of it. `null` for anything else: a table they do not reach is refused
 * as Postgres said it, which confirms nothing about it.
 */
export function columnNotGranted(
  message: string | null | undefined,
  reach: Reach,
): ColumnNotGranted | null {
  const name = PERMISSION_DENIED.exec(message ?? "")?.groups?.name;
  if (name === undefined) {
    return null;
  }
  const hidden = hiddenColumns(reach, name);
  return hidden.length === 0 ? null : { model: name, hidden };
}

/**
 * `relation "analytics_x.fct" does not exist`, or `relation "fct" does not exist`: Postgres's
 * own sentence for a relation a statement named and the catalogue does not hold. Read only to
 * name a model in a refusal that is already a refusal; a message it does not match is relayed
 * as Postgres wrote it.
 */
const MISSING_RELATION = /relation "(?:[^"]*\.)?(?<name>[^".]+)" does not exist/u;

/** A model the answer read that has no passing version yet: never published, a build held. */
export interface NoPassingVersion {
  readonly model: string;
  /** The held build: the newest that tried and was not published. */
  readonly runId: string;
}

/**
 * Whether a query Postgres refused for a missing relation named a model that was built but
 * never published (ADR 0131): the first build of a model whose tests failed leaves nothing in
 * analytics, and "relation does not exist" would read as a typo. `null` for anything else --
 * another error, a name no model has, a model that was simply never built -- which is relayed
 * as Postgres said it.
 */
export async function noPassingVersion(
  exec: SqlExecutor,
  tenantId: string,
  message: string | null | undefined,
): Promise<NoPassingVersion | null> {
  const name = MISSING_RELATION.exec(message ?? "")?.groups?.name;
  if (name === undefined) {
    return null;
  }
  const tests = (await readTestStates(exec, tenantId, [name]))(name);
  if (tests.runId !== null || tests.unpublished === null) {
    return null;
  }
  return { model: name, runId: tests.unpublished.runId };
}
