/**
 * A spec run's documents: the text a person wrote on a record, which the runtime took out of the
 * record's payload (`documents` in the spec, ADR 0101), landed the way a Gmail body is (ADR 0084).
 *
 * Its own module so `runPaths.ts` asks three questions of it and knows none of the answers' parts:
 * what a document is called, what of it may reach Postgres, and when an entity may move its mark.
 *
 * ## What a document is called
 *
 * `<entity>:<record id>:<part>` -- `notes:51:body`. The entity is in it because HubSpot numbers
 * each object type on its own, so a note and a task can share an id, and two documents under one
 * id would be one document whose history alternates between them. No `/`: a document id is the
 * last segment of its lake key (`documentKeyOf`), and a slash would make one document's key the
 * container of another's, which is the shape `validateSourceKey` exists to keep retention away
 * from. It ends `:<part>` as a Gmail body ends `:body`, so a model, and `documentText.ts`'s
 * measurements, tell a body from a file the same way for both.
 *
 * ## What reaches Postgres
 *
 * `raw.documents.metadata` is `{ entity, sourceRecordId, part }`: opaque ids and an enumerated
 * name, which is all `.claude/rules/pii.md` lets that table hold. The text reaches Postgres only as
 * the document's `raw.document_text.text`, through the extract verb, which the BI role cannot read.
 * The manifest is empty: nothing about the record needs saying that the record does not say.
 *
 * ## When an entity may move its mark
 *
 * The documents are landed by one sink across the whole run, and `settle` is asked before each
 * entity saves its watermark. Under a `client-filter` watermark a record unchanged since the mark
 * is never offered again, so a mark saved past a record whose text failed to land would lose that
 * text for good, with the record in the lake looking whole. So `settle` lands what is held and
 * RAISES if anything could not be landed: the run fails with its counts recorded, keeps the mark
 * where it was, and the next run offers those records -- and their text -- again. A document too
 * large to land is not that case: it is refused the same way every time, recorded with its reason
 * (`documentSink.ts`), and holding the mark for it would stall the entity forever.
 */

import type { RawRecordOut, RecordDocument } from "@undercroft/connector-runtime";
import type { ConnectorSpec } from "@undercroft/contracts";
import { ConnectorError } from "@undercroft/core";
import type { RunEntity } from "@undercroft/db/repos";

import { createDocumentSink, documentsEntity } from "./documentSink.ts";
import type { DocumentToLand } from "./landDocument.ts";
import type { DocumentLanding, SinkDeps } from "./landing.ts";

export interface SpecDocuments {
  /** Hold the documents the runtime handed on beside this record, to be landed. */
  readonly add: (record: RawRecordOut) => Promise<void>;
  /**
   * Land everything held now, and raise when anything could not be: called before an entity
   * saves its watermark, so a mark never passes a record whose text is not in the lake.
   */
  readonly settle: (entity: string, read: number) => Promise<void>;
}

/** What a run's documents are opened with, and where their ledger row goes. */
export interface DocumentsOpening {
  readonly spec: ConnectorSpec;
  readonly sinks: SinkDeps;
  readonly at: DocumentLanding;
  /** Where the run's `documents` row goes, the way every entity's row goes into the ledger. */
  readonly record: (row: RunEntity) => void;
}

/**
 * Read a spec run with its documents open -- `null` for a spec that declares none, which then
 * records no `documents` row, exactly as before the field existed.
 *
 * The row is recorded however the run ends: what landed is evidence on a failed or stopped run
 * too. Only a run that got to the end lands what is still held; one that failed or stopped drops
 * it, which loses nothing because no entity's mark moved past it.
 */
export async function readingDocuments(
  opening: DocumentsOpening,
  read: (documents: SpecDocuments | null) => Promise<void>,
): Promise<void> {
  const opened = openSpecDocuments(opening);
  if (opened === null) {
    await read(null);
    return;
  }
  try {
    await read(opened);
  } catch (error) {
    opening.record(await opened.finish(false));
    throw error;
  }
  opening.record(await opened.finish(true));
}

/** A document's id: see the module docstring for why it is exactly this. */
function documentIdOf(record: RawRecordOut, document: RecordDocument): string {
  return `${record.entity}:${record.sourceRecordId}:${document.part}`;
}

/**
 * One document, ready for the sink. Encoded when it is landed rather than now, so a held chunk is
 * the text the runtime already holds and not a second copy of it in bytes.
 */
function toLand(record: RawRecordOut, document: RecordDocument): DocumentToLand {
  return {
    documentId: documentIdOf(record, document),
    contentType: document.contentType,
    declaredBytes: String(Buffer.byteLength(document.text, "utf8")),
    metadata: { entity: record.entity, sourceRecordId: record.sourceRecordId, part: document.part },
    manifest: {},
    sourceUpdatedAt: record.sourceUpdatedAt,
    fetchBytes: (): Promise<Uint8Array> => Promise.resolve(Buffer.from(document.text, "utf8")),
  };
}

/** The run's documents and how to close them, or `null` for a spec that declares none. */
function openSpecDocuments({
  spec,
  sinks,
  at,
}: DocumentsOpening):
  | (SpecDocuments & { readonly finish: (landRest: boolean) => Promise<RunEntity> })
  | null {
  if (!spec.entities.some((entity) => entity.documents !== undefined)) {
    return null;
  }
  let refused = 0;
  const sink = createDocumentSink(
    {
      ...sinks,
      refuse: (refusals): Promise<void> => {
        refused += refusals.length;
        return sinks.refuse(refusals);
      },
    },
    at,
  );
  return {
    async add(record): Promise<void> {
      for (const document of record.documents) {
        await sink.add(toLand(record, document));
      }
    },
    async settle(entity, read): Promise<void> {
      const { unfetched } = await sink.flush();
      if (unfetched.size > 0) {
        throw new ConnectorError(
          spec.id,
          entity,
          read,
          `${unfetched.size} document(s) of its records could not be landed, the first ${JSON.stringify([...unfetched][0])}; its watermark is kept, so the next run reads them again`,
        );
      }
    },
    async finish(landRest): Promise<RunEntity> {
      const summary = landRest ? await sink.close() : sink.abandon();
      return documentsEntity(summary, refused);
    },
  };
}
