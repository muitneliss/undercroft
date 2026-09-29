/**
 * A generator's return value, kept where `for await` would throw it away.
 *
 * Split from `runPaths.ts`, which reads each entity through it: `readEntity` returns what a read
 * that got to the end can say about the source, and the loop that lands its records must still
 * be able to ask for that afterwards.
 */

/** Where {@link keepingEnd} puts what a generator returned. Empty until it has returned. */
export interface Ended<R> {
  value?: R;
}

/**
 * The same generator, with what it RETURNS put in `end` -- which `for await` would throw away.
 *
 * Only a generator that runs to the end returns anything. One that throws never does, and a
 * `break` out of the loop closes this wrapper and, through `yield*`, the generator inside it,
 * so `end` stays empty. That is what makes `end` safe to decide from: `readEntity` returns the
 * listing of the whole source, and a read that did not finish must not be taken as one.
 */
export async function* keepingEnd<T, R>(
  generator: AsyncGenerator<T, R>,
  end: Ended<R>,
): AsyncGenerator<T> {
  end.value = yield* generator;
}
