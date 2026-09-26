/**
 * Bounded concurrency for per-record source reads: enough parallel calls to finish a client's
 * metadata in minutes, few enough to stay under Gmail's per-user rate limit.
 */

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    for (let index = next; index < items.length; index = next) {
      next = index + 1;
      const item = items[index];
      if (item !== undefined) {
        out[index] = await fn(item);
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return out;
}
