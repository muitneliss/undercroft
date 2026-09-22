/**
 * `raw.document_text`: what each landed document says, and how it came to be read.
 *
 * Three statements, and the first is the one that decides the bill. `pendingDocuments` answers
 * "which documents does this tenant have that nobody has read, has read from bytes that have
 * since changed, or refused with a reader older than the one we now have" -- the LEFT JOIN on
 * `source_sha256` is the whole mechanism for the middle case. A document whose sha matches what
 * was extracted from is not returned at all, so a second extract run over an unchanged tenant
 * spawns nothing and re-OCRs nothing. Without it the only options are re-reading 252 MB of PDFs
 * on every run, or never noticing a file that changed.
 *
 * The third case is the READER GENERATION, and it is why these functions take one. A refusal
 * is a fact about the readers we had, not about the document, and a platform that never revisits
 * one ships each new reader as a no-op over the files it was written for. `reader_version`
 * (`packages/db/sql/240_reader_version.sql`) is the stamp; the predicate below is the rule.
 *
 * THE UNIT OF WORK IS BYTES, NOT A CATALOGUE ROW. This table's key is a document, and a document
 * is provenance-addressed: Gmail's only stable identity is `(messageId, partIndex)`, so one
 * attachment quoted down a reply chain is one row per message. Production holds 4,476 documents
 * over 2,030 distinct `sha256`. The lake underneath already deduplicates by content
 * (`packages/lake/src/store.ts`) and the catalogue above it reintroduced the duplication, which
 * since the OCR readers landed costs a `pdftoppm` and up to thirty `tesseract` children to
 * reproduce text we hold verbatim. So `pendingDocuments` offers one row per distinct digest and
 * `upsertDocumentText` writes the answer back to every document of that scope holding those
 * bytes -- see `WRITE_BY_DIGEST`, which carries the tenant boundary that makes it safe.
 *
 * A tombstoned document (`deleted_at`) is skipped: its bytes are gone from the source, and
 * re-reading a document the customer deleted is the opposite of what the tombstone records.
 *
 * `pendingScopes` asks the SAME question one level up -- which (tenant, source) pairs have
 * any such document -- because the scheduler needs a list to start runs from and must not
 * start one that would find nothing to do. The two share `PENDING_JOIN` rather than spelling
 * the predicate twice: two definitions of "pending" drifting apart would show up as a flow
 * that ticks forever over a tenant whose documents the run then declines to read.
 *
 * Nothing here decides anything. Which reader a content type gets, and what counts as a
 * readable text layer, are decisions one layer up in `../services/extract/`.
 */

import type { SqlExecutor } from "@undercroft/db";

/** One document waiting to be read, with what a reader needs to fetch and open it. */
export interface PendingDocument {
  readonly documentId: string;
  readonly lakeKey: string;
  readonly sha256: string;
  readonly contentType: string;
}

/**
 * What was true of the pass as a whole, rather than of one document.
 *
 * `readerVersion` belongs here and not on a row: it is the generation of the reader TABLE that
 * ran, so every document in one pass was read by the same one. A per-row field would invite a
 * caller to write two generations in a single batch, which is a state nothing downstream could
 * interpret.
 */
export interface ExtractStamp {
  readonly extractedAt: string;
  readonly runId: string;
  readonly readerVersion: number;
}

/** One document's text, ready to be written. `method` or `reason` -- never neither. */
export interface DocumentTextRow {
  /**
   * The document the bytes were read from. A LABEL, not the target: the write is keyed by
   * `sourceSha256`, so this names which read a caller is being answered about and nothing else.
   * `upsertDocumentText` returns its counts under it.
   */
  readonly documentId: string;
  readonly sourceSha256: string;
  readonly method: string | null;
  readonly reason: string | null;
  readonly text: string;
  readonly truncated: boolean;
}

interface Scope {
  readonly tenantId: string;
  readonly source: string;
}

/**
 * "Landed, not tombstoned, and either never read, read from bytes that have since changed, or
 * refused by an older generation of readers."
 *
 * ONE definition, used by all three statements below -- the two readers AND the write, which
 * fans an answer out to exactly the documents this predicate would otherwise have offered a
 * later run. A constant rather than a parameter because it is the repo's own SQL and nothing
 * outside this module composes with it: two definitions of "pending" drifting apart would show
 * up as a flow that ticks forever over a tenant whose documents the run then declines to read,
 * or -- now that the write uses it too -- as a fan-out that answers a document the backlog does
 * not consider answered.
 *
 * `$1` IS THE CURRENT READER GENERATION IN ALL THREE, by construction -- each binds it first
 * and numbers its own parameters from `$2`. That is what lets one shared string name the value
 * at all. The repo cannot reach for the constant itself: `CURRENT_READER_VERSION` lives beside
 * the `READERS` map in the service layer, and a repo importing upward is the thing
 * `layering.md` forbids outright. So it arrives as a bind parameter, which is also the only
 * form that keeps a number out of a concatenated SQL string.
 *
 * THE `t.method IS NULL` SCOPE IS A SAFETY PROPERTY, NOT AN OPTIMISATION. Read that again
 * before widening it, because it reads exactly like a performance tweak and is not one.
 *
 * A ROW THAT WAS READ IS NEVER RE-QUEUED BY A GENERATION BUMP. A sibling project at this
 * company recorded its worst extraction bug as precisely this hazard: a re-parse run launched
 * without OCR configured overwrote 2,602 already-OCR'd documents with empty text, and every
 * gate it had stayed green because the row count never changed. Their law from it -- never swap
 * text for empty; when a cheap re-run can overwrite an expensive one, block it in code and not
 * in the operator's memory -- is this clause. The cost of bumping the constant is therefore
 * bounded to the refusals: on production, 1,190 documents once, and not the 409 good ones every
 * time.
 *
 * Spelled `t.method IS NULL` rather than `t.reason IS NOT NULL`, which selects the same rows
 * today -- the `document_text_said_why` CHECK means one is null exactly when the other is not --
 * but says the property itself. A future reader that records a method AND a caveat (text read,
 * but by a degraded engine) would be re-queued by the `reason` spelling and could then be
 * blanked by a worse run, which is the 2,602 documents again by a different door.
 */
const PENDING_JOIN = `FROM raw.documents d
       LEFT JOIN raw.document_text t
         ON t.source = d.source
        AND t.tenant_id = d.tenant_id
        AND t.document_id = d.document_id
      WHERE d.deleted_at IS NULL
        AND (t.document_id IS NULL
          OR t.source_sha256 <> d.sha256
          OR (t.method IS NULL AND t.reader_version < $1))`;

/** The generation of readers the caller is running. Named, so two numbers cannot swap places. */
interface Generation {
  readonly readerVersion: number;
}

/**
 * The documents this run has to read: never read, read from different bytes, or refused by a
 * reader generation older than `readerVersion` -- ONE PER DISTINCT DIGEST.
 *
 * `DISTINCT ON` is where the duplication stops costing CPU. The siblings it leaves out are not
 * skipped; `upsertDocumentText` answers them from the same read. The scope columns are named in
 * the `DISTINCT ON` even though the `WHERE` already pins them to one value each, so the identity
 * being collapsed reads as `(tenant, source, digest)` -- the same triple the write fans out
 * over -- rather than as a digest that happens to be scoped by a clause three lines away.
 *
 * WHAT THIS DOES NOT DO, said here because the alternative is a reader finding out: reuse is
 * WITHIN A PASS. A document landing after its twin was read in an EARLIER pass is offered and
 * read again, because the only text this module copies is text the caller has just produced.
 * Copying out of a row already in the table is a different operation -- it has to answer whose
 * `run_id` a copy carries -- and it is the next slice rather than a clause to add here.
 *
 * Ordered by that digest so a capped run is resumable: the next run asks the same question and
 * gets the same answer minus what the last one wrote, rather than a fresh arbitrary slice of
 * the same backlog. `document_id` is the tie-break, so a pass interrupted between the read and
 * the write picks the same representative when it comes round again.
 *
 * `limit` and `readerVersion` arrive named rather than as two positional numbers: a call
 * reading `(exec, scope, 500, 1)` is one a reviewer cannot check, and swapping them silently
 * reads one document per pass against a generation of 500.
 */
export async function pendingDocuments(
  exec: SqlExecutor,
  scope: Scope,
  { limit, readerVersion }: Generation & { readonly limit: number },
): Promise<PendingDocument[]> {
  const { rows } = await exec.query<{
    document_id: string;
    lake_key: string;
    sha256: string;
    content_type: string;
  }>(
    `SELECT DISTINCT ON (d.tenant_id, d.source, d.sha256)
            d.document_id, d.lake_key, d.sha256, d.content_type
       ${PENDING_JOIN}
        AND d.source = $2
        AND d.tenant_id = $3
      ORDER BY d.tenant_id, d.source, d.sha256, d.document_id
      LIMIT $4`,
    [readerVersion, scope.source, scope.tenantId, limit],
  );

  return rows.map((row) => ({
    documentId: row.document_id,
    lakeKey: row.lake_key,
    sha256: row.sha256,
    contentType: row.content_type,
  }));
}

/**
 * Every (tenant, source) pair with a document waiting to be read.
 *
 * The scheduler's list. `DISTINCT` rather than a count, because the caller starts one run per
 * pair and how many documents that run will find is the run's own business -- and a count
 * over the whole catalogue is the scan this question exists to avoid.
 *
 * A pair vanishes from this list once its documents are read, which is what makes the tick
 * idempotent: an unchanged tenant is not returned, so nothing is started for it. That is the
 * same `source_sha256` mechanism `pendingDocuments` relies on, reached through the same
 * predicate -- and it is why this takes a generation too. A scheduler answering an older
 * question than the run it starts would tick over a tenant the run then finds nothing to do
 * for, which is the drift `PENDING_JOIN` exists to make impossible.
 *
 * It takes no `DISTINCT ON`, and that is agreement rather than an omission: collapsing a scope's
 * pending rows by digest cannot empty a scope that had one, so the pair set is the same either
 * way. A scope is listed exactly when `pendingDocuments` would hand its run something to read.
 */
export async function pendingScopes(
  exec: SqlExecutor,
  { readerVersion }: Generation,
): Promise<Scope[]> {
  const { rows } = await exec.query<{ tenantId: string; source: string }>(
    `SELECT DISTINCT d.tenant_id AS "tenantId", d.source
       ${PENDING_JOIN}
      ORDER BY 1, 2`,
    [readerVersion],
  );
  return rows.map((row) => ({ tenantId: row.tenantId, source: row.source }));
}

/**
 * How many DOCUMENTS are waiting, in full -- not the reads a run is about to do.
 *
 * `pendingDocuments` answers with at most `limit` rows AND one row per distinct digest, so its
 * length says "how much work this run will do" twice over and never "how much is left". This
 * counts catalogue rows, matching the unit `tally` reports and the unit the sentence beside it
 * uses. The difference is the whole diagnosis: a run refusing 245 while 2,337 wait behind it is
 * draining a backlog, and the identical run with nothing behind it is a fault. Reported once per
 * run and stored on it (`250_run_trace.sql`), because recomputing it tomorrow answers about
 * tomorrow.
 *
 * The same `PENDING_JOIN` as everything else here, for the reason they all share it: another
 * definition of "pending" would drift, and this one drifting would put a confident wrong number
 * beside a run rather than no number at all.
 */
export async function countPendingDocuments(
  exec: SqlExecutor,
  scope: Scope,
  { readerVersion }: Generation,
): Promise<number> {
  const { rows } = await exec.query<{ pending: string | number }>(
    `SELECT count(*) AS pending
       ${PENDING_JOIN}
        AND d.source = $2
        AND d.tenant_id = $3`,
    [readerVersion, scope.source, scope.tenantId],
  );
  // `count(*)` is int8, and the pool pins int8 to a string so an amount can never lose digits
  // (`money.md`). A queue depth is an index, not an amount, so `parseInt` is the right spelling
  // here and the one the money plugin deliberately leaves alone.
  const pending = rows[0]?.pending ?? 0;
  return typeof pending === "number" ? pending : Number.parseInt(pending, 10);
}

/**
 * Write what was read to EVERY document of this scope holding those bytes and still awaiting an
 * answer -- the read itself among them.
 *
 * `raw.documents` names bytes several times over, so the document the reader opened is one of a
 * set and not the interesting member of it. Copying rather than re-reading is exact, not an
 * approximation: `reader_version` is the generation of the whole reader table, so identical
 * bytes through one generation produce identical text by construction. A REFUSAL COPIES TOO, and
 * that is the same statement read the other way -- bytes a generation cannot open are bytes it
 * cannot open. It is not the 2,602-document hazard, which was a DIFFERENT toolchain blanking
 * good text, and the clause that guards against that (`t.method IS NULL`, in `PENDING_JOIN`)
 * governs which documents are eligible here exactly as it governs the backlog.
 *
 * THE COPY IS SCOPED `(tenant_id, source)` AND THE SCOPE IS A BIND PARAMETER, NEVER THE DATA.
 * Read that before widening it. The worker holds `platform_all ... USING (true)` on both tables
 * (`180_document_text.sql`), so row-level security protects READERS and not this writer: a copy
 * across tenants would materialise one customer's contract into a row stamped with another
 * customer's id, and the policy would then serve it faithfully as theirs. Nothing would raise,
 * nothing would go red, and the tenant's own dbt login could `SELECT` it (`pii.md`). The lake
 * DOES share a blob across tenants and that is safe for a reason which does not transfer:
 * reaching `_blobs/xx/<digest>` needs the digest, and only a tenant-scoped manifest hands one
 * out. Text has no second gate. `source` is scoped with it because it is in the primary key;
 * reusing a Gmail attachment's text for the same tenant's Drive copy is a separate argument.
 *
 * Replaced rather than versioned: this table is a projection of the lake, and the only
 * interesting version of a document's text is the one taken from the bytes it currently has.
 * History lives where history is durable, which is the lake (`raw-lake.md`).
 *
 * The stamp's `readerVersion` is written on EVERY row, refusals and copies included -- that is
 * what takes a re-queued refusal back out of the backlog once this generation has had its go at
 * it, and what keeps a fanned-out row honest about which generation produced its text. A write
 * that skipped it for refusals would offer the same 1,190 documents to every run for ever.
 */
const WRITE_BY_DIGEST = `WITH awaiting AS (
         SELECT d.document_id, d.sha256
         ${PENDING_JOIN}
           AND d.source = $2
           AND d.tenant_id = $3
       )
       INSERT INTO raw.document_text
           (source, tenant_id, document_id, source_sha256, method, reason,
            text, chars, truncated, extracted_at, run_id, reader_version)
       SELECT $2, $3, a.document_id, p.source_sha256, p.method, p.reason,
              p.text, char_length(p.text), p.truncated, $4::timestamptz, $5, $1::integer
         FROM unnest($6::text[], $7::text[], $8::text[], $9::text[], $10::boolean[])
           AS p(source_sha256, method, reason, text, truncated)
         JOIN awaiting a ON a.sha256 = p.source_sha256
       ON CONFLICT (source, tenant_id, document_id) DO UPDATE
          SET source_sha256  = excluded.source_sha256,
              method         = excluded.method,
              reason         = excluded.reason,
              text           = excluded.text,
              chars          = excluded.chars,
              truncated      = excluded.truncated,
              extracted_at   = excluded.extracted_at,
              run_id         = excluded.run_id,
              reader_version = excluded.reader_version
       RETURNING source_sha256`;

/**
 * How many documents each read answered, under the `documentId` the caller read it from.
 *
 * A caller counting "documents read" must count THESE and not the rows it handed over: one read
 * of a four-times-quoted attachment answers four. A read missing from the map answered nothing,
 * which is what an ingest replacing a document's bytes mid-pass looks like -- the text was read
 * from a digest the catalogue no longer holds, so the backlog offers it again next run.
 */
export type AnsweredDocuments = ReadonlyMap<string, number>;

/** Count the written rows back onto the reads that produced them. */
function answeredByRead(
  rows: readonly DocumentTextRow[],
  written: readonly { source_sha256: string }[],
): AnsweredDocuments {
  const readFrom = new Map(rows.map((r) => [r.sourceSha256, r.documentId]));
  const answered = new Map<string, number>();
  for (const row of written) {
    const documentId = readFrom.get(row.source_sha256);
    if (documentId !== undefined) {
      answered.set(documentId, (answered.get(documentId) ?? 0) + 1);
    }
  }
  return answered;
}

/**
 * Write what was read. See `WRITE_BY_DIGEST` for what "where" means here and why it is bounded.
 *
 * `rows` must not repeat a digest, which `pendingDocuments` guarantees by construction. Two
 * texts for one digest would try to write the same document twice in one statement, and
 * Postgres refuses that outright rather than picking a winner -- loud, which is the right
 * failure for "the caller read the same bytes twice and got two answers".
 */
export async function upsertDocumentText(
  exec: SqlExecutor,
  scope: Scope,
  rows: readonly DocumentTextRow[],
  stamp: ExtractStamp,
): Promise<AnsweredDocuments> {
  if (rows.length === 0) {
    return new Map();
  }

  const written = await exec.query<{ source_sha256: string }>(WRITE_BY_DIGEST, [
    stamp.readerVersion,
    scope.source,
    scope.tenantId,
    stamp.extractedAt,
    stamp.runId,
    rows.map((r) => r.sourceSha256),
    rows.map((r) => r.method),
    rows.map((r) => r.reason),
    rows.map((r) => r.text),
    rows.map((r) => r.truncated),
  ]);

  return answeredByRead(rows, written.rows);
}
