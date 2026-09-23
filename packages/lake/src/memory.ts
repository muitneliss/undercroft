/**
 * In-memory {@link ObjectStore}, for tests and local runs.
 *
 * A real implementation of the contract, not a mock. It stores bytes, raises on a
 * missing key, and behaves like the S3 client. So the tests exercising the lake test the
 * actual store logic rather than asserting a mock was called -- the failure mode where a
 * suite is green and the code has never run.
 */

import { byCodeUnit, ObjectNotFound, type ObjectStore } from "./objectStore.ts";

/** How many calls of each kind a store has served. One per S3 round trip. */
export interface ObjectStoreCalls {
  readonly get: number;
  readonly put: number;
  readonly exists: number;
  readonly list: number;
  readonly delete: number;
}

export class InMemoryObjectStore implements ObjectStore {
  readonly #objects = new Map<string, Uint8Array>();
  readonly #calls = { get: 0, put: 0, exists: 0, list: 0, delete: 0 };

  get(key: string): Promise<Uint8Array> {
    this.#calls.get += 1;
    const value = this.#objects.get(key);
    if (value === undefined) {
      return Promise.reject(new ObjectNotFound(key));
    }
    return Promise.resolve(value);
  }

  put(key: string, data: Uint8Array): Promise<void> {
    this.#calls.put += 1;
    this.#objects.set(key, data);
    return Promise.resolve();
  }

  exists(key: string): Promise<boolean> {
    this.#calls.exists += 1;
    return Promise.resolve(this.#objects.has(key));
  }

  list(prefix: string, startAfter?: string): Promise<string[]> {
    this.#calls.list += 1;
    // Materialised and sorted, so a caller may delete while iterating -- which prune
    // does, and which a lazy generator over a live map would break.
    //
    // `startAfter` is strictly greater, matching S3: a caller passing the last key it
    // handled gets the next one, not that one again.
    const keys = [...this.#objects.keys()]
      .filter((k) => k.startsWith(prefix) && (startAfter === undefined || k > startAfter))
      .sort(byCodeUnit);
    return Promise.resolve(keys);
  }

  delete(key: string): Promise<void> {
    this.#calls.delete += 1;
    this.#objects.delete(key);
    return Promise.resolve();
  }

  // -- test affordances -----------------------------------------------------

  /**
   * How many calls of each kind this store has served.
   *
   * A count of real work, not a record that a function was called: against S3 every one of
   * these is a network round trip, and what a pass costs IS the number of them. The lake's
   * loader issued a LIST per record for as long as nothing above the seam could see it --
   * which typechecked, passed every test, and turned projecting a mailbox into eight
   * silent minutes. A count is the only form in which that is visible from above.
   */
  get calls(): ObjectStoreCalls {
    return { ...this.#calls };
  }

  get size(): number {
    return this.#objects.size;
  }

  get totalBytes(): number {
    let total = 0;
    for (const value of this.#objects.values()) {
      total += value.byteLength;
    }
    return total;
  }
}
