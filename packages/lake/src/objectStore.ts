/**
 * The storage seam.
 *
 * Narrow on purpose. S3, MinIO and the in-memory test double all satisfy it, so every
 * test above this line runs with no network and no credentials.
 */
export interface ObjectStore {
  get(key: string): Promise<Uint8Array>;
  put(key: string, data: Uint8Array): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Keys under `prefix`, sorted. Materialised, so a caller may delete while iterating. */
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

/** Raised when a requested object is not present. */
export class ObjectNotFound extends Error {
  constructor(key: string) {
    super(`no such object: ${key}`);
    this.name = "ObjectNotFound";
  }
}
