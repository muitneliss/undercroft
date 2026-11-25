/**
 * Landing documents into the raw lake and the catalogue.
 *
 * The byte sibling of `land.ts`, and one writer for the same reason: whatever collects a
 * PDF -- Gmail today, a Drive export, a scanned statement dropped through the API later --
 * goes through here, so create-only and content-addressing hold whatever called it.
 *
 * TWO THINGS THIS FILE IS RESPONSIBLE FOR AND THE REPO IS NOT.
 *
 * **The size ceiling.** `LakeStore.read` re-hashes an entire object on every read and
 * `S3ObjectStore.put` takes one whole `Uint8Array`; there is no streaming path. A 300 MB
 * attachment therefore does not merely run slowly, it ends the worker process mid-run.
 * `MAX_DOCUMENT_BYTES` is checked against the size the provider *declares*, before the
 * bytes are fetched, and an oversized document is reported with a reason rather than
 * dropped -- "no evidence" is never "pass".
 *
 * **What reaches Postgres, and what reaches only the lake.** `raw.documents` is granted to
 * `undercroft_dbt`, so its columns are one `dbt run` from a dashboard. Since ADR 0161 a
 * document's bytes are purged once extraction has had its go at them, so the catalogue row is
 * how a person finds the file again: its `fileName` and its `link` at the source cross into
 * Postgres, deliberately and by name -- the owner's decision, superseding ADR 0015 on this one
 * point. Everything ELSE a human wrote -- a mail subject, an address, a folder name -- still goes
 * in `manifest`, the lake manifest in the access-controlled object store, and never in
 * `metadata` or in the key. Three fields rather than one bag, so which side of the line each
 * name falls on is visible at every call site.
 */

import { documentKeyOf } from "@undercroft/contracts";
import type { LakeStore } from "@undercroft/lake";

/**
 * 25 MiB, which is also Gmail's own attachment ceiling. Raising it means giving the lake a
 * streaming path first; see the module docstring.
 */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** A declared size we can read. Provider-controlled text, so anything else is unreadable. */
const DIGITS_ONLY = /^\d+$/u;

export interface DocumentToLand {
  readonly documentId: string;
  readonly contentType: string;
  /** What the provider says it weighs, before fetching. Decimal digits, never a number. */
  readonly declaredBytes: string;
  /** Opaque ids, timestamps, enumerated types and counts. Reaches dbt. */
  readonly metadata: Readonly<Record<string, unknown>>;
  /**
   * What the source calls the file. Reaches `raw.documents.file_name`, and so dbt (ADR 0161),
   * and the manifest as `filename`. `null` where the source gives the document no name -- a
   * mail's body, a note -- never one made up.
   */
  readonly fileName: string | null;
  /**
   * Where a person opens it at the source. Reaches `raw.documents.source_url`. `null` where it
   * cannot be derived from what the landing holds; never a guessed link.
   */
  readonly link: string | null;
  /** Every other name a human wrote. Reaches the lake manifest only. */
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly sourceUpdatedAt: string | null;
  /** Fetch the bytes. Deferred so the size guard can refuse before any download starts. */
  fetchBytes: () => Promise<Uint8Array>;
}

export interface LandedDocument {
  readonly documentId: string;
  readonly status: "created" | "unchanged" | "skipped" | "failed";
  readonly sha256?: string;
  readonly lakeKey?: string;
  readonly byteLength?: string;
  readonly reason?: string;
}

export interface LandDocumentsResult {
  readonly created: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly failed: number;
  readonly results: LandedDocument[];
}

export async function landDocuments(
  lake: LakeStore,
  input: {
    source: string;
    tenantId: string;
    runId: string;
    reason?: string;
    documents: readonly DocumentToLand[];
  },
): Promise<LandDocumentsResult> {
  const results: LandedDocument[] = [];
  const tally: Record<LandedDocument["status"], number> = {
    created: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
  };

  for (const document of input.documents) {
    const result = await landOne(lake, input, document);
    results.push(result);
    tally[result.status] += 1;
  }

  return { ...tally, results };
}

/**
 * Land one document, reporting rather than raising.
 *
 * Every outcome -- too large to fetch, fetched and stored, fetched and identical, failed --
 * comes back as a row. One bad document must never abort a batch: that is the rule `land.ts`
 * follows, and it is what lets the caller turn any failure into a 422 without losing the
 * documents that did land.
 */
async function landOne(
  lake: LakeStore,
  input: { source: string; tenantId: string; runId: string; reason?: string },
  document: DocumentToLand,
): Promise<LandedDocument> {
  if (overCeiling(document.declaredBytes)) {
    return {
      documentId: document.documentId,
      status: "skipped",
      byteLength: document.declaredBytes,
      reason: `declared ${document.declaredBytes} bytes, over the ${MAX_DOCUMENT_BYTES} ceiling`,
    };
  }

  try {
    const key = documentKeyOf({
      source: input.source,
      tenantId: input.tenantId,
      documentId: document.documentId,
    });
    const bytes = await document.fetchBytes();
    const put = await lake.put(key, bytes, {
      runId: input.runId,
      reason: input.reason ?? "",
      // No `stream`. The record loader decodes every journalled object as JSON text for
      // `payload jsonb`; a PDF on that path is mojibake in a jsonb column. Documents are
      // catalogued directly by the caller instead.
      extra: {
        ...document.manifest,
        // The manifest has said `filename` since the first landing, and the operator's trace
        // backfill reads it there for documents landed before the column existed (ADR 0161).
        filename: document.fileName,
        link: document.link,
        contentType: document.contentType,
        sourceUpdatedAt: document.sourceUpdatedAt,
      },
    });
    return {
      documentId: document.documentId,
      status: put.status,
      sha256: put.sha256,
      lakeKey: key,
      byteLength: String(bytes.byteLength),
    };
  } catch (error) {
    return {
      documentId: document.documentId,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Whether a declared size is over the ceiling, so the document will be refused unfetched.
 *
 * Exported because a Gmail harvest records a part it left behind for its size, and must not
 * read the message again for it until the ceiling moves (ADR 0076) -- the same question, so the
 * same function, rather than a second copy of the ceiling that could drift from this one.
 *
 * `BigInt` rather than `Number`: a declared size arrives as provider-controlled text, and
 * `Number("99999999999999999999")` is a silent rounding rather than a refusal.
 */
export function overCeiling(declaredBytes: string): boolean {
  if (!DIGITS_ONLY.test(declaredBytes)) {
    return false; // Unreadable is not oversized; the fetch itself will report the truth.
  }
  return BigInt(declaredBytes) > BigInt(MAX_DOCUMENT_BYTES);
}
