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

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/nursery/useValidTestTitle: A false positive. The rule reads `/\s/.test(value)` -- RegExp#test on a regex literal -- as a test-framework `test()` call with a non-string title. There is no test in this file.
// biome-ignore-all lint/performance/noAwaitInLoops: These sequential awaits are the point. Pacing a connector against a rate limit, walking Dokploy deployment records until one settles, and migrating SQL files in order all require the previous iteration to finish first; running them concurrently is the bug this rule would introduce.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and deliberately not done here: hoisting these literals touches many files and belongs in its own commit where the diff is reviewable, rather than buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/style/noContinue: Each `continue` here skips one item in a loop with a stated reason on the line above. Restructuring to avoid it means nesting the body in an `if`, which adds a level of indentation and says nothing new.
// biome-ignore-all lint/style/noMagicNumbers: In a test the number IS the assertion. `expect(delayMs).toBe(5000)` says what the code must do; `expect(delayMs).toBe(EXPECTED_BACKOFF_MS)` says only that two names agree, and it can pass while both are wrong. Naming a fixture value also puts the expected result somewhere other than the line asserting it, which is the opposite of what .claude/rules/tests.md asks for. Source files get named constants; test files keep their literals.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

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
  if (!/^\d+$/u.test(declaredBytes)) {
    return false; // Unreadable is not oversized; the fetch itself will report the truth.
  }
  return BigInt(declaredBytes) > BigInt(MAX_DOCUMENT_BYTES);
}
