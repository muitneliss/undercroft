/**
 * What a spec keeps out of a record's payload: the text a person wrote, which lands beside the
 * record as a document of it (`documents`), and the fields the source is never asked for at all
 * (`neverRead`). ADR 0101.
 *
 * Split from `connectorSpec.ts` along the line between them: the rest of that file says how a
 * source is READ, and this says what of a record must not reach `raw.records` -- the one table
 * `undercroft_app` reads and full-text indexes, where `.claude/rules/pii.md` forbids what a person
 * wrote. `raw.document_text` is the place for that (ADR 0024), as it is for a Gmail body (ADR 0084).
 */

import { z } from "zod";

import type { ConnectorEntity } from "./connectorSpec.ts";

/**
 * A dotted path of names only, no `[n]` subscripts: a field that can be taken OUT of a record.
 * Removing an array element would renumber every element after it, and the payload would then
 * say something the source never did.
 */
const FieldPath = z
  .string()
  .regex(/^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*$/u, "must be a dotted path of names, no [n]");

/**
 * One field of a record that holds text a person wrote, and is landed as a DOCUMENT of that
 * record rather than as part of it: HubSpot's `properties.hs_note_body`.
 *
 * The runtime removes the field from the record's payload WHATEVER asked for it -- the spec's own
 * query or a scope a person widened -- and hands the text on beside the record. A field that is
 * missing, `null` or empty yields no document; any value that is not text raises, because the
 * spec has named the wrong field and landing it either way would be a guess.
 */
export const DocumentField = z.object({
  path: FieldPath,
  /** Which document of the record this is; it ends the document's id (`<entity>:<id>:<part>`). */
  part: z.string().regex(/^[a-z][a-z0-9_]*$/u, "part must be snake_case"),
  /** How the extract verb reads it. Only what it reads in process, without spawning anything. */
  contentType: z.enum(["text/plain", "text/html"]),
});

/**
 * A field name a source is never asked for on this entity, whoever asks: `*` matches any run of
 * characters, anything else matches itself. `*recording*` refuses HubSpot's call recording URL.
 */
export const NeverReadPattern = z
  .string()
  .regex(/^[A-Za-z0-9_*-]+$/u, "a field name, with `*` for any run of characters");

/** A regex's own metacharacters, so a pattern's literal parts match only themselves. */
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/gu;

/** Whether `name` is a field this entity's `neverRead` refuses. */
export function neverReads(entity: Pick<ConnectorEntity, "neverRead">, name: string): boolean {
  return (entity.neverRead ?? []).some((pattern) => {
    const literal = pattern.split("*").map((piece) => piece.replaceAll(REGEX_SPECIAL, "\\$&"));
    return new RegExp(`^${literal.join(".*")}$`, "u").test(name);
  });
}

/**
 * Why this entity's `documents` cannot work, or `null` when they can.
 *
 * A document's field is REMOVED from the record, so it must not hold anything the record is
 * keyed, dated or watermarked by: taking the id out would leave a record nobody could key. Two
 * documents of one part would land under one id, the second overwriting the first's history.
 */
export function documentsProblem(entity: ConnectorEntity): string | null {
  const documents = entity.documents ?? [];
  const parts = documents.map((document) => document.part);
  if (new Set(parts).size !== parts.length) {
    return "two documents of one entity share a part, and would land under one document id";
  }
  const needed = [entity.idPath, entity.updatedAtPath, entity.incremental?.sourcePath].filter(
    (path): path is string => path !== undefined,
  );
  const taken = documents.find((document) =>
    needed.some((path) => path === document.path || path.startsWith(`${document.path}.`)),
  );
  return taken === undefined
    ? null
    : `document path '${taken.path}' would take out the record's id, change time or watermark`;
}
