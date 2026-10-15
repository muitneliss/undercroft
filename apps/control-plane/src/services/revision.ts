/**
 * A tenant's project revision: one small read that answers "has anything an author writes
 * changed since I last looked?" (issue 445, ADR 0127).
 *
 * An agent that keeps model, macro and question text in a repository and publishes it here used
 * to answer that by downloading every list and hashing it on the client -- 401 times in two
 * weeks. Here the server hashes what it stores and the answer is a few hex strings.
 *
 * **Each part is a hash of its items' content, never of their timestamps.** A part is the
 * SHA-256 of the canonical JSON of one entry per item, in key order: the item's key, then the
 * hash of each thing a save writes (`*Sha256`, computed by Postgres over the stored bytes). So
 * a part changes on a create, a delete, a rename and a real edit, and stays equal on an
 * identical re-save -- which the saves no longer write at all -- and on a build, which changes
 * what was built and not what was written. `revision` is the hash of the parts together.
 *
 * **Opaque, compared for equality only.** A revision is not ordered and not a counter: equal
 * means nothing a save writes differs, different means something does, and the parts say which
 * kind. No content leaves Postgres to compute one: the repos read only names and hashes.
 *
 * A new kind of authored content is one more field on `RevisionParts`, which the compiler then
 * requires `partsOf` to answer. Adding one changes every tenant's `revision` once, and leaves
 * each existing part as it was.
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { listMacroHashes, listModelHashes, listSeedSummaries } from "@undercroft/db/repos";

import { listQuestionHashes } from "../repos/biQuestions.ts";

/** One hash per kind of authored content. */
export interface RevisionParts {
  readonly models: string;
  readonly macros: string;
  /** The tenant's reference tables (ADR 0128), each by its name and the hash of its content. */
  readonly seeds: string;
  readonly questions: string;
}

export type Revision = RevisionParts & {
  /** The hash of every part together: equal exactly when every part is. */
  readonly revision: string;
};

/** One item of a part: its key first -- the name, or a question's id -- then its hashes. */
type Entry = readonly [key: string, ...content: string[]];

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * A part's hash over its entries, sorted by key so the order rows arrive in changes nothing.
 * Canonical JSON rather than joined text, so no name or hash can run into the next.
 */
export function partRevision(entries: readonly Entry[]): string {
  const sorted = entries.toSorted((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256(canonicalJson(sorted));
}

async function partsOf(exec: SqlExecutor, tenantId: string): Promise<RevisionParts> {
  const [models, macros, seeds, questions] = await Promise.all([
    listModelHashes(exec, tenantId),
    listMacroHashes(exec, tenantId),
    listSeedSummaries(exec, tenantId),
    listQuestionHashes(exec, tenantId),
  ]);
  return {
    // A description's hash only where there is one (ADR 0137): every model saved without one
    // keeps the entry -- and the revision -- it had before descriptions existed, rather than
    // every tenant's models reading as changed on the deploy that added them.
    models: partRevision(
      models.map((m) =>
        m.descriptionSha256 === null
          ? [m.name, m.sqlSha256, m.testsSha256]
          : [m.name, m.sqlSha256, m.testsSha256, m.descriptionSha256],
      ),
    ),
    macros: partRevision(macros.map((m) => [m.name, m.sqlSha256, m.descriptionSha256])),
    seeds: partRevision(seeds.map((s) => [s.name, s.sha256])),
    // A question is keyed by its id, since two may share a name; renaming one is a change.
    questions: partRevision(
      questions.map((q) => [q.id, q.name, q.definitionSha256, q.chartSha256]),
    ),
  };
}

/** The tenant's revision, per kind and together. */
export async function revision(exec: SqlExecutor, tenantId: string): Promise<Revision> {
  const parts = await partsOf(exec, tenantId);
  return { revision: sha256(canonicalJson(parts)), ...parts };
}
