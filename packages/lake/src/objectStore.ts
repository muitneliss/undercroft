/**
 * The storage seam.
 *
 * Narrow on purpose. S3, MinIO and the in-memory test double all satisfy it, so every
 * test above this line runs with no network and no credentials.
 */

export interface ObjectStore {
  get: (key: string) => Promise<Uint8Array>;
  put: (key: string, data: Uint8Array) => Promise<void>;
  exists: (key: string) => Promise<boolean>;
  /** Keys under `prefix`, sorted. Materialised, so a caller may delete while iterating. */
  list: (prefix: string) => Promise<string[]>;
  delete: (key: string) => Promise<void>;
}

/**
 * The order `list` promises: lexicographic by UTF-16 code unit.
 *
 * Spelled out rather than left to a bare `.sort()`, which means the same thing but says so
 * only by omission. It must NOT become `localeCompare`: that orders by locale, so the same
 * keys would come back in a different order on a different machine, and `list` is what
 * retention walks to decide what to prune. It is also the order S3 itself returns keys in,
 * which is what lets the in-memory store stand in for it.
 */
export function byCodeUnit(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/** Raised when a requested object is not present. */
export class ObjectNotFound extends Error {
  constructor(key: string, options?: { cause?: unknown }) {
    super(`no such object: ${key}`, options);
    this.name = "ObjectNotFound";
  }
}
