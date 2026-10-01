/**
 * A record's documents: the text a person wrote, taken out of the payload and handed on beside
 * it. ADR 0101, after ADR 0084 did the same for a Gmail body.
 *
 * Here, in the runtime, because this is the one place that holds the record as `lossless-json`
 * parsed it: removing a field anywhere later would mean parsing the canonical text again and
 * re-serialising it, which `.claude/rules/connectors.md` forbids. The field is removed from the
 * tree BEFORE it is canonicalised, so the payload that is hashed, landed and projected into
 * `raw.records` never held the text -- whichever request asked for it, the spec's own query or a
 * batch read a person's scope widened (ADR 0052). Stripping is by declared path, not by what was
 * requested, which is what makes the second case impossible to get wrong.
 *
 * What becomes of the text -- its document id, the lake, `raw.documents` -- is the caller's: the
 * runtime streams records and never lands anything.
 */

import type { ConnectorEntity } from "@undercroft/contracts";
import { ConnectorError, getPath, parsePath } from "@undercroft/core";

/** One document of a record, as the spec declared it, with the text the source sent. */
export interface RecordDocument {
  /** Which document of the record this is: the spec's `part`. */
  readonly part: string;
  readonly contentType: string;
  /** Exactly as the source sent it, decoded from JSON and nothing else. Never empty. */
  readonly text: string;
}

/** `typeof x === "object"` still admits null and arrays. This does not. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `node` without the field `segments` names, sharing everything it does not touch. A path that
 * does not reach a field leaves the node as it is: there was nothing there to take out.
 */
function without(node: unknown, segments: readonly string[]): unknown {
  const [head, ...rest] = segments;
  if (head === undefined || !isRecord(node) || !Object.hasOwn(node, head)) {
    return node;
  }
  if (rest.length === 0) {
    const { [head]: _taken, ...kept } = node;
    return kept;
  }
  return { ...node, [head]: without(node[head], rest) };
}

/**
 * The record with every declared document field taken out, and the documents those fields held.
 *
 * A field that is absent, `null` or `""` holds no document and is still taken out, so the
 * payload's shape does not depend on whether a person wrote anything. Any other value that is
 * not a string raises: the spec has named a field that is not text, and either landing it as a
 * document or leaving it in the payload would be a guess about what it is.
 */
export function splitDocuments(
  connector: string,
  entity: ConnectorEntity,
  seen: number,
  record: unknown,
): { readonly payload: unknown; readonly documents: readonly RecordDocument[] } {
  let payload = record;
  const documents: RecordDocument[] = [];
  for (const declared of entity.documents ?? []) {
    const value = getPath(record, declared.path);
    if (typeof value === "string") {
      if (value !== "") {
        documents.push({ part: declared.part, contentType: declared.contentType, text: value });
      }
    } else if (value !== undefined && value !== null) {
      throw new ConnectorError(
        connector,
        entity.name,
        seen,
        `the document field ${JSON.stringify(declared.path)} holds something that is not text`,
      );
    }
    payload = without(payload, parsePath(declared.path));
  }
  return { payload, documents };
}
