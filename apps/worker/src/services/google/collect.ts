/**
 * One Google source, collected for one tenant.
 *
 * The same vertical slice `runIngest` drives for a YAML connector -- resolve a token, read
 * the source, land into the lake, project into Postgres -- with the two steps a spec cannot
 * express: bytes, and a per-tenant scope that decides what may be read at all.
 *
 * A scope is REQUIRED. A connection with no recorded selection is refused rather than
 * defaulted, because the two readings of an absent scope are "nobody has chosen yet" and
 * "somebody chose everything", and guessing the second reads a customer's whole mailbox on
 * the strength of a missing row. The UI has a `needs_scope` state for exactly this.
 *
 * ## One pass, and the order inside it is the whole of the resume guarantee
 *
 * This used to read a harvest into arrays, land the records, land the documents, and then
 * re-join the two with a `find` inside a loop over every result -- quadratic in the size of
 * the mailbox, on top of holding the mailbox. It is now one walk of a {@link Harvest}
 * feeding two sinks, which hold a chunk each and nothing else.
 *
 * **A RECORD IS HELD BACK UNTIL ITS DOCUMENTS ARE DOWN, AND THEN IT SAYS HOW MANY.** A
 * message whose record landed while its attachment fetch was still failing would be skipped
 * by every run after it, and the attachment would be lost from the one layer that cannot be
 * recomputed -- rule 2 broken by the resume mechanism itself. So a batch's documents are
 * flushed first, and only the records whose documents all reached the lake are added. A crash
 * between the two re-does the message, which is idempotent by content, and that is the cheap
 * direction to fail in.
 *
 * Presence in `raw.records` was the whole of the next run's test until ADR 0035, on the
 * strength of that ordering alone. It was not enough, and the way it was not enough is the
 * shape of every invariant a codebase asserts and does not record: it bound the rows written
 * after it and said nothing about the rows already there. The rows already there were written
 * records first and documents last, and the ingest oom-killed on 2026-09-21 stopped in
 * between -- 7,786 messages present, zero attachments, and every run since skipped all 7,786
 * on presence. So a released record now carries `documentsLanded` into the sink and the sink
 * records it, and what the next run reads is what some run actually settled rather than what
 * this file promises about itself.
 *
 * A document refused for its declared SIZE does not hold its record back, and is not counted
 * either. That refusal is deterministic: waiting on it would make the message unharvestable
 * rather than incomplete, and counting it would leave the message one document short of its
 * own target on every run forever -- the same loss through the other door. A record held back
 * for a retryable failure is itself refused with a reason, because a record quietly not landed
 * would be the silent drop this is here to prevent.
 *
 * ## Refusals arrive in the order they happened
 *
 * They used to be grouped by kind -- every record refusal, then every document refusal,
 * then every pick. Streamed, they arrive as the run met them, which is the better order:
 * the refusal beside the chunk that caused it, rather than three lists a reader has to
 * interleave by hand to see that one attachment is why one message is missing. A pick's
 * refusal still comes last within its pick, because it is a statement about the whole pick.
 */

import { parseScope, sourceKind } from "@undercroft/contracts";
import { newRunId } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { readConnectionDetail, type RunRefusal } from "@undercroft/db/repos";
import type { LakeStore } from "@undercroft/lake";

import { tombstoneMissing } from "../../repos/rawDocuments.ts";
import { createDocumentSink } from "../documentSink.ts";
import {
  CHUNK,
  type DocumentSink,
  type RecordSink,
  type RefusalWriter,
  type SinkDeps,
} from "../landing.ts";
import { createRecordSink } from "../recordSink.ts";
import { type RunJournal, SILENT_JOURNAL } from "../runJournal.ts";
import type { GoogleApi } from "./api.ts";
import { harvestDrive } from "./drive.ts";
import { harvestGmail } from "./gmail.ts";
import { requireReadGrant } from "./grant.ts";
import { type Harvest, type HarvestItem, type HarvestSummary, heldBy } from "./harvest.ts";

export const GOOGLE_KINDS = ["gmail", "drive"] as const;
export type GoogleKind = (typeof GOOGLE_KINDS)[number];

const GOOGLE_KIND_SET: ReadonlySet<string> = new Set<string>(GOOGLE_KINDS);

/**
 * Whether a source is read by a Google collector -- any account of Gmail or Drive.
 *
 * By KIND: `gmail.3fa9c1d2e0ab` is a second mailbox, and a test on the literal source would
 * send it down the spec path to look for a `gmail.3fa9c1d2e0ab.yaml` that does not exist.
 * ADR 0043.
 */
export function isGoogleSource(source: string): boolean {
  return GOOGLE_KIND_SET.has(sourceKind(source));
}

/**
 * Why a record this run read was not landed: a document of its own did not reach the lake.
 *
 * Deliberately not a silent hold. The record IS coming -- the next run reads the message
 * again, because nothing about it is in `raw.records` to skip -- but a run that read
 * something and landed nothing must say which something and why, or the count is the only
 * evidence and a count cannot be acted on.
 */
export const DOCUMENT_UNLANDED = "a-document-of-this-record-did-not-land";

export class ScopeNotChosen extends Error {
  constructor(source: string, tenantId: string) {
    super(
      `${source} for tenant ${JSON.stringify(tenantId)} has no recorded scope; ` +
        "an admin must choose what to share before a run can read anything",
    );
    this.name = "ScopeNotChosen";
  }
}

export interface CollectDeps {
  readonly lake: LakeStore;
  readonly exec: SqlExecutor;
  readonly api: GoogleApi;
  readonly now?: () => Date;
  /** Where this collection narrates itself. Absent means a caller with no run to narrate. */
  readonly journal?: RunJournal;
}

export interface CollectResult {
  readonly runId: string;
  readonly source: string;
  readonly records: {
    landed: number;
    /**
     * Listed and NOT read, because this tenant already holds it unchanged.
     *
     * Reported because in steady state a run lands nothing, and `landed: 0` on its own
     * makes "the mailbox is empty" and "nothing has changed" the same green run.
     */
    skipped: number;
    loadedCreated: number;
    loadedChanged: number;
    loadedUnchanged: number;
  };
  readonly documents: {
    created: number;
    unchanged: number;
    skipped: number;
    failed: number;
    tombstoned: number;
  };
  /**
   * What this run refused, with why: a record that could not be landed under entity
   * `messages`/`files`, a document skipped over the size ceiling or failed under
   * `documents`, a record held back because a document of its own did not land. The ids are
   * opaque provider ids, never a subject or a filename.
   */
  readonly refusals: RunRefusal[];
}

/**
 * The scope an admin chose, or a refusal.
 *
 * A Google source parses to a Google scope or to nothing; the third shape belongs to another
 * collector and would mean a row written under the wrong source.
 */
async function googleScope(
  deps: CollectDeps,
  input: { source: string; tenantId: string },
): Promise<Exclude<NonNullable<ReturnType<typeof parseScope>>, { kind: "xero" }>> {
  const detail = await readConnectionDetail(deps.exec, input.tenantId, input.source);
  const scope = detail === null ? null : parseScope(input.source, detail.selectionJson);
  if (scope === null || scope.kind === "xero") {
    throw new ScopeNotChosen(input.source, input.tenantId);
  }
  return scope;
}

/** What one walk of a harvest writes through, held together so `drain` takes two arguments. */
interface Landing {
  readonly entity: string;
  readonly records: RecordSink;
  readonly documents: DocumentSink;
  readonly refuse: RefusalWriter;
}

/**
 * Walk a harvest into the two sinks, documents first, and answer with what it said at the end.
 *
 * `pending` is the only thing this holds and it is capped at one chunk of records. A record
 * waits in it until `release` has flushed every document added since the last one -- which
 * is what makes a row in `raw.records` mean the message behind it is complete, and therefore
 * what makes skipping it on the next run safe.
 *
 * **AND THE RECORD CARRIES THE COUNT OUT WITH IT.** The ordering above is what MAKES a landed
 * record complete; `documentsLanded` is what SAYS SO, and the difference cost a customer every
 * attachment in a 7,786-message mailbox. Ordering binds the rows the ordering wrote, and the
 * next run reads rows it did not write -- rows from a release where documents came last, and
 * from a run that died between the two. This is the only layer that knows both halves, so it
 * is where the count is computed: what the harvest offered, intersected with what the sink got
 * down. A size-refused attachment is in neither set and so is counted as what it is, zero,
 * rather than as a message forever one document short of itself. ADR 0035.
 *
 * A manual `next()` loop rather than `for await`, because `for await` discards a generator's
 * return value and the summary IS the return value. Consumed to exhaustion, never broken out
 * of: an abandoned harvest leaves a paged listing half-read, and the symptom is an unrelated
 * "no recorded response" two tests away.
 */
async function drain(harvest: Harvest, at: Landing): Promise<HarvestSummary> {
  const pending: HarvestItem[] = [];

  async function release(): Promise<void> {
    const settled = await at.documents.flush();
    for (const item of pending.splice(0)) {
      if (item.documents.some((document) => settled.unfetched.has(document.documentId))) {
        await at.refuse([
          {
            entity: at.entity,
            sourceRecordId: item.record.sourceRecordId,
            reason: DOCUMENT_UNLANDED,
          },
        ]);
        continue;
      }
      await at.records.add({
        ...item.record,
        documentsLanded: item.documents.filter((document) =>
          settled.landed.has(document.documentId),
        ).length,
      });
    }
  }

  let step = await harvest.next();
  while (!step.done) {
    for (const document of step.value.documents) {
      await at.documents.add(document);
    }
    pending.push(step.value);
    if (pending.length >= CHUNK) {
      await release();
    }
    step = await harvest.next();
  }
  await release();

  return step.value;
}

/** Everything one collection reads through and writes into, wired once. */
interface Collection {
  readonly harvest: Harvest;
  readonly records: RecordSink;
  readonly documents: DocumentSink;
  readonly refuse: RefusalWriter;
  /** The array `refuse` fills. Answered to the caller; see {@link openCollection}. */
  readonly refusals: RunRefusal[];
}

/**
 * Wire one collection: which source to read, where its two halves land, and what it may skip.
 *
 * Refusals are COLLECTED here rather than written. `runGoogleCollect` answers with them and
 * the caller that opened an `ops.run` row is the one that owns writing them; a collector
 * driven with no ledger behind it -- the case `SILENT_JOURNAL` exists for -- has no run row
 * for `ops.run_refusal` to reference and would fail its foreign key on the first one.
 */
function openCollection(
  deps: CollectDeps,
  scope: Awaited<ReturnType<typeof googleScope>>,
  at: { source: string; tenantId: string; runId: string; entity: string; observedAt: string },
  journal: RunJournal,
): Collection {
  const refusals: RunRefusal[] = [];
  const refuse: RefusalWriter = (written): Promise<void> => {
    refusals.push(...written);
    return Promise.resolve();
  };
  const sinks: SinkDeps = { lake: deps.lake, exec: deps.exec, refuse };
  const held = heldBy(deps.exec, { source: at.source, tenantId: at.tenantId, entity: at.entity });

  return {
    harvest:
      scope.kind === "gmail"
        ? harvestGmail(deps.api, scope, journal, held)
        : harvestDrive(deps.api, scope, journal, held),
    records: createRecordSink(sinks, at),
    documents: createDocumentSink(sinks, at),
    refuse,
    refusals,
  };
}

/**
 * What is only decidable once the whole harvest has been walked: the tombstones, and the
 * refusal owed to each pick. Answers how many documents were tombstoned.
 *
 * Tombstoning is DRIVE'S ALONE and skipped when `seenIds` is null. A Gmail message that
 * stops matching a label selection has been relabelled, not deleted, and a tombstone would
 * report a deletion that never happened. It also runs only once every catalogue row is
 * written, because the sweep is a negated `ANY` over the ids this run kept -- a row written
 * after it would look like one nobody saw.
 *
 * A pick's refusal comes last for the same reason it comes at all: it is a statement about
 * the whole pick, and there is no such thing until the pick is exhausted.
 */
async function settleDocuments(
  deps: CollectDeps,
  at: {
    entity: string;
    observedAt: string;
    scoped: { source: string; tenantId: string };
    refuse: RefusalWriter;
  },
  summary: HarvestSummary,
): Promise<number> {
  const tombstoned =
    summary.seenIds === null
      ? 0
      : await tombstoneMissing(deps.exec, at.scoped, {
          keptIds: summary.seenIds,
          observedAt: at.observedAt,
        });

  for (const pick of summary.skipped) {
    await at.refuse([{ entity: at.entity, sourceRecordId: pick.fileId, reason: pick.reason }]);
  }

  return tombstoned;
}

export async function runGoogleCollect(
  deps: CollectDeps,
  input: { source: string; tenantId: string; runId?: string },
): Promise<CollectResult> {
  // The caller that opened an `ops.run` row hands its id down; a caller with no ledger
  // still gets a run id on every object it lands.
  const runId = input.runId ?? newRunId();
  const observedAt = (deps.now ?? ((): Date => new Date()))().toISOString();
  // Before anything is asked of Google: a Drive grant that cannot read a picked folder is
  // answered with an empty listing, not a refusal, and the run would close green on it.
  await requireReadGrant(deps.exec, input);
  const scope = await googleScope(deps, input);
  const entity = scope.kind === "gmail" ? "messages" : "files";

  const journal = deps.journal ?? SILENT_JOURNAL;
  journal.info("entity_started", { entity });

  const scoped = { source: input.source, tenantId: input.tenantId };
  const { harvest, records, documents, refuse, refusals } = openCollection(
    deps,
    scope,
    { ...scoped, runId, entity, observedAt },
    journal,
  );

  const summary = await drain(harvest, { entity, records, documents, refuse });
  const landedRecords = await records.close();
  const landedDocuments = await documents.close();
  const tombstoned = await settleDocuments(deps, { entity, observedAt, scoped, refuse }, summary);

  journal.info("documents_landed", {
    entity: "documents",
    created: landedDocuments.created,
    unchanged: landedDocuments.unchanged,
    skipped: landedDocuments.skipped,
    failed: landedDocuments.failed,
    tombstoned,
  });

  return {
    runId,
    source: input.source,
    records: {
      landed: landedRecords.landed,
      skipped: summary.known,
      loadedCreated: landedRecords.loaded.created,
      loadedChanged: landedRecords.loaded.changed,
      loadedUnchanged: landedRecords.loaded.unchanged,
    },
    refusals,
    documents: {
      created: landedDocuments.created,
      unchanged: landedDocuments.unchanged,
      skipped: landedDocuments.skipped,
      failed: landedDocuments.failed,
      tombstoned,
    },
  };
}
