/**
 * In-memory {@link ObjectStore}, for tests and local runs.
 *
 * A real implementation of the contract, not a mock. It stores bytes, raises on a
 * missing key, and behaves like the S3 client. So the tests exercising the lake test the
 * actual store logic rather than asserting a mock was called -- the failure mode where a
 * suite is green and the code has never run.
 */

import { ObjectNotFound, type ObjectStore } from "./objectStore.ts";

export class InMemoryObjectStore implements ObjectStore {
  readonly #objects = new Map<string, Uint8Array>();

  get(key: string): Promise<Uint8Array> {
    const value = this.#objects.get(key);
    if (value === undefined) return Promise.reject(new ObjectNotFound(key));
    return Promise.resolve(value);
  }

  put(key: string, data: Uint8Array): Promise<void> {
    this.#objects.set(key, data);
    return Promise.resolve();
  }

  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.#objects.has(key));
  }

  list(prefix: string): Promise<string[]> {
    // Materialised and sorted, so a caller may delete while iterating -- which prune
    // does, and which a lazy generator over a live map would break.
    const keys = [...this.#objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    return Promise.resolve(keys);
  }

  delete(key: string): Promise<void> {
    this.#objects.delete(key);
    return Promise.resolve();
  }

  // -- test affordances -----------------------------------------------------

  get size(): number {
    return this.#objects.size;
  }

  get totalBytes(): number {
    let total = 0;
    for (const value of this.#objects.values()) total += value.byteLength;
    return total;
  }
}
