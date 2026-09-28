/**
 * Which of a Gmail message's attachments a harvest takes, and what it keeps of the rest.
 *
 * One piece of knowledge, split from `gmail.ts` (which talks to Gmail and builds what lands)
 * because both of its halves turn on it and nothing else there does. A read SORTS a message's
 * attachment parts into what the file-type choice allows, which is offered to the lake, and
 * what it leaves behind -- refused by the choice, or over the size ceiling -- which is kept on
 * the message's mark as a {@link LeftBehindDocument}: the id it would land under, its bare MIME
 * type, its extension and its declared size, and never its filename, since `raw.records` is
 * readable by dbt (`pii.md`). A later run PLANS from those lists: a held message is read again
 * only when the current choice allows something it left behind and the ceiling admits it.
 * Writing the list and reading it back are the same contract, so they live together.
 *
 * Both questions are asked of FACTS through `allowsFacts`, never of a verdict stored at the
 * time, so it is always this release's matcher that answers -- an upgrade that admits a new
 * spelling of a chosen type (`image/jpg` for JPEG) finds what it now admits exactly the way a
 * widened choice does. Both ask the ceiling through the sink's own `overCeiling`, so a part too
 * large to land is never a reason to read its message again. ADR 0076, #292.
 */

import { allowsFacts, type FileFacts, fileFactsOf } from "@undercroft/contracts";
import { getPath, getStringPath } from "@undercroft/core";

import { overCeiling } from "../landDocument.ts";
import type { HeldRecord, LeftBehindDocument } from "./harvest.ts";

/** One message this run will fetch, and which of its parts it is fetching it for. */
export interface PlannedRead {
  readonly messageId: string;
  /**
   * The document ids of the parts to consider, or `null` for every attachment part: a message
   * read for the first time, or a held one whose mark never said what it left behind.
   */
  readonly lookAt: ReadonlySet<string> | null;
  /** For a held message read again, what its earlier harvests already landed; else `null`. */
  readonly landedBefore: number | null;
}

export interface ReadPlan {
  readonly reads: readonly PlannedRead[];
  /** Held, and not read. */
  readonly skipped: number;
  /** Held, and read again. Among {@link ReadPlan.reads}. */
  readonly reread: number;
}

/**
 * Which listed messages to fetch, and for what.
 *
 * Not held: read in full. Held, with a mark that never listed what it left behind (every row
 * marked before ADR 0076): read in full once more, because what it carries is not known and a
 * skip would be a guess that it carries nothing wanted -- CLAUDE.md rule 2. Held with a list:
 * read again only if something on the list is allowed by the CURRENT choice and under the
 * ceiling, and then only the listed parts are looked at, so an attachment already landed is not
 * fetched twice. Otherwise skipped, which is what keeps narrowing the choice, or adding a type
 * no held message carries, from costing a single request.
 *
 * The ceiling is asked here as well as by the sink so that a part too large to land is not a
 * reason to read its message on every run for ever -- the trap `markHarvested` already refuses
 * for the count. It stays on the list, so a ceiling raised one day finds it.
 *
 * The question is asked of stored FACTS, through `allowsFacts`, so it is the matcher of this
 * release that answers: an upgrade that teaches the catalogue a new spelling of a chosen type
 * finds the parts it now admits the same way a widened choice does.
 */
export function planReads(
  messageIds: readonly string[],
  known: ReadonlyMap<string, HeldRecord>,
  fileTypes: readonly string[],
): ReadPlan {
  const reads: PlannedRead[] = [];
  let skipped = 0;
  let reread = 0;

  for (const messageId of messageIds) {
    const mark = known.get(messageId);
    if (mark === undefined) {
      reads.push({ messageId, lookAt: null, landedBefore: null });
    } else if (mark.documentsLeftBehind === null) {
      reads.push({ messageId, lookAt: null, landedBefore: 0 });
      reread += 1;
    } else if (mark.documentsLeftBehind.some((part) => wantedNow(fileTypes, part))) {
      const lookAt = new Set(mark.documentsLeftBehind.map((part) => part.documentId));
      reads.push({ messageId, lookAt, landedBefore: mark.documentsLanded });
      reread += 1;
    } else {
      skipped += 1;
    }
  }

  return { reads, skipped, reread };
}

/** A part left behind that this run would land: the choice allows it, the ceiling admits it. */
function wantedNow(fileTypes: readonly string[], part: LeftBehindDocument): boolean {
  return allowsFacts(fileTypes, part) && !overCeiling(part.declaredBytes);
}

export interface AttachmentPart {
  readonly index: number;
  /** `(messageId, partIndex)`, the id it lands under. See the module docstring. */
  readonly documentId: string;
  readonly attachmentId: string;
  readonly filename: string;
  readonly size: string;
  readonly mimeType: string;
  /** What matching reads, and what is kept of the part if it is left behind. */
  readonly facts: FileFacts;
}

/**
 * Every part of a message that carries an attachment, walked depth-first.
 *
 * Recursive because a forwarded mail nests `parts` inside `parts`, and an attachment two
 * levels down is still an attachment. The index counts every part visited, so it is stable
 * for a given message shape -- which is what makes it usable as half of the document id, and
 * what lets a part left behind on one read be found again on the next.
 */
function attachmentParts(messageId: string, message: unknown): AttachmentPart[] {
  const found: AttachmentPart[] = [];
  let index = 0;

  function walk(part: unknown): void {
    index += 1;
    const mimeType = str(part, "mimeType");
    const attachmentId = str(part, "body.attachmentId");
    const filename = str(part, "filename");
    if (attachmentId !== "") {
      found.push({
        index,
        documentId: `${messageId}:${String(index).padStart(3, "0")}`,
        attachmentId,
        filename,
        size: str(part, "body.size") || "0",
        mimeType,
        facts: fileFactsOf({ mimeType, name: filename }),
      });
    }
    for (const child of asArray(getPath(part, "parts"))) {
      walk(child);
    }
  }

  for (const part of asArray(getPath(message, "payload.parts"))) {
    walk(part);
  }
  return found;
}

/** What one read of a message does with its attachment parts. */
export interface SortedParts {
  /** Allowed by the choice: offered to the sink, which refuses one over the ceiling itself. */
  readonly offered: readonly AttachmentPart[];
  /** Refused by the choice or over the ceiling: kept on the mark, so a wider choice finds it. */
  readonly leftBehind: readonly LeftBehindDocument[];
}

/**
 * Split the parts this read looks at into what it offers and what it leaves behind.
 *
 * `lookAt` is `null` for every attachment part, or the ids a held message's mark left behind.
 * A part outside it was landed by an earlier read and is neither fetched again nor listed
 * again -- which is also why narrowing the choice and widening it back re-reads nothing that
 * already landed.
 *
 * A part over the ceiling is offered when the choice allows it, so the sink refuses it with its
 * reason as it always has, AND listed as left behind, because that is what the sink will do with
 * it: the mark's count then leaves it out and `planReads` does not read the message again for it.
 * Both are the same `overCeiling` the sink asks.
 */
export function sortParts(
  messageId: string,
  message: unknown,
  lookAt: ReadonlySet<string> | null,
  fileTypes: readonly string[],
): SortedParts {
  const offered: AttachmentPart[] = [];
  const leftBehind: LeftBehindDocument[] = [];
  for (const part of attachmentParts(messageId, message)) {
    if (lookAt !== null && !lookAt.has(part.documentId)) {
      continue;
    }
    const allowed = allowsFacts(fileTypes, part.facts);
    if (allowed) {
      offered.push(part);
    }
    if (!allowed || overCeiling(part.size)) {
      leftBehind.push({
        documentId: part.documentId,
        mimeType: part.facts.mimeType,
        extension: part.facts.extension,
        declaredBytes: part.size,
      });
    }
  }
  return { offered, leftBehind };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A string at a dotted path, or `""`. Through `getStringPath`, as `gmail.ts` says why. */
function str(root: unknown, path: string): string {
  return getStringPath(root, path) ?? "";
}
