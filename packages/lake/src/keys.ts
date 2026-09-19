/**
 * The key grammar of the raw lake.
 *
 * Its own module because these are rules about the STORE rather than behaviour of any one
 * class, and one of them is load-bearing for safety: `validateSourceKey` refusing a container
 * key is what keeps retention from walking an entity directory and deleting a customer's
 * data. `.claude/rules/raw-lake.md`.
 */

/** Reserved key prefixes, written only by the store. `validateSourceKey` keeps callers out. */
const RESERVED_PREFIXES = ["_blobs/", "_journal/"] as const;

const TRIM_SLASHES = /^\/+|\/+$/gu;

export function validateStream(stream: string): string {
  const s = stream.replace(TRIM_SLASHES, "");
  if (s === "") {
    throw new RangeError("journal stream must not be empty");
  }
  if (s.split("/").includes("..")) {
    throw new RangeError(`journal stream must not traverse: ${JSON.stringify(stream)}`);
  }
  if (RESERVED_PREFIXES.some((p) => `${s}/`.startsWith(p))) {
    throw new RangeError(
      `journal stream must not shadow a reserved prefix: ${JSON.stringify(stream)}`,
    );
  }
  return s;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

export function blobKey(digest: string): string {
  return `_blobs/${digest.slice(0, 2)}/${digest}`;
}

export function journalKey(stream: string, stamp: string, digest: string): string {
  // Stream first, then stamp, so listing `_journal/{stream}/` sorts by observation
  // time and a plain `StartAfter` over it is an incremental-load cursor. The digest
  // tail disambiguates two observations that share a microsecond.
  return `_journal/${validateStream(stream)}/${stamp}/${digest.slice(0, 12)}`;
}

/**
 * Reject key shapes that make pruning dangerous.
 *
 * In a provenance store, listing every subdirectory of a key and treating each as a
 * version means a key naming an *intermediate* node makes prune walk entity directories
 * and delete customer data. The shape is enforced here, at the only place keys enter
 * the store, rather than promised in a docstring no line of code keeps.
 */
export function validateSourceKey(sourceKey: string): string {
  const key = sourceKey.replace(TRIM_SLASHES, "");
  if (key === "") {
    throw new RangeError("source_key must not be empty");
  }
  const segments = key.split("/");
  if (segments.includes("..")) {
    throw new RangeError(`source_key must not traverse: ${JSON.stringify(sourceKey)}`);
  }
  if (RESERVED_PREFIXES.some((p) => `${key}/`.startsWith(p))) {
    throw new RangeError(
      `source_key must not shadow a reserved prefix: ${JSON.stringify(sourceKey)}`,
    );
  }
  if (segments.length < 2) {
    throw new RangeError(
      `source_key ${JSON.stringify(sourceKey)} is too shallow: it must name a leaf ` +
        "(e.g. 'xero/invoices/INV-001'), not a container. A container key would make " +
        "retention prune sibling entities.",
    );
  }
  return key;
}
