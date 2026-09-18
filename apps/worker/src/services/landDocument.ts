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
 * **The PII boundary.** `raw.documents` is granted to `undercroft_dbt`, so its columns are
 * one `dbt run` from a dashboard. A filename, a mail subject, an address or a folder name
 * therefore goes in `extra` -- the lake manifest, in the access-controlled object store --
 * and never in `metadata` or in the key. The split is the whole reason this function takes
 * them as two separate arguments rather than one bag it could pick from.
 */

import { documentKeyOf } from "@undercroft/contracts";
import type { LakeStore } from "@undercroft/lake";

/**
 * 25 MiB, which is also Gmail's own attachment ceiling. Raising it means giving the lake a
 * streaming path first; see the module docstring.
 */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export interface DocumentToLand {
  readonly documentId: string;
  readonly contentType: string;
  /** What the provider says it weighs, before fetching. Decimal digits, never a number. */
  readonly declaredBytes: string;
  /** Opaque ids, timestamps, enumerated types and counts. Reaches dbt. */
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Names a human wrote. Reaches the lake manifest only. */
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly sourceUpdatedAt: string | null;
  /** Fetch the bytes. Deferred so the size guard can refuse before any download starts. */
  fetchBytes(): Promise<Uint8Array>;
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
  let created = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;

  for (const document of input.documents) {
    const identity = {
      source: input.source,
      tenantId: input.tenantId,
      documentId: document.documentId,
    };

    if (tooLarge(document.declaredBytes)) {
      skipped += 1;
      results.push({
        documentId: document.documentId,
        status: "skipped",
        byteLength: document.declaredBytes,
        reason: `declared ${document.declaredBytes} bytes, over the ${MAX_DOCUMENT_BYTES} ceiling`,
      });
      continue;
    }

    try {
      const key = documentKeyOf(identity);
      const bytes = await document.fetchBytes();
      const put = await lake.put(key, bytes, {
        runId: input.runId,
        reason: input.reason ?? "",
        // No `stream`. The record loader decodes every journalled object as JSON text for
        // `payload jsonb`; a PDF on that path is mojibake in a jsonb column. Documents are
        // catalogued directly by the caller instead.
        extra: {
          ...document.manifest,
          contentType: document.contentType,
          sourceUpdatedAt: document.sourceUpdatedAt,
        },
      });
      if (put.status === "created") {
        created += 1;
      } else {
        unchanged += 1;
      }
      results.push({
        documentId: document.documentId,
        status: put.status,
        sha256: put.sha256,
        lakeKey: key,
        byteLength: String(bytes.byteLength),
      });
    } catch (error) {
      // One bad document is a reported failure, never an aborted batch -- the same rule
      // `land.ts` follows, and what lets the caller turn any failure into a 422.
      failed += 1;
      results.push({
        documentId: document.documentId,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { created, unchanged, skipped, failed, results };
}

/**
 * Compare declared size to the ceiling without going through a float.
 *
 * `BigInt` rather than `Number`: a declared size arrives as provider-controlled text, and
 * `Number("99999999999999999999")` is a silent rounding rather than a refusal.
 */
function tooLarge(declaredBytes: string): boolean {
  if (!/^\d+$/.test(declaredBytes)) {
    return false; // Unreadable is not oversized; the fetch itself will report the truth.
  }
  return BigInt(declaredBytes) > BigInt(MAX_DOCUMENT_BYTES);
}
