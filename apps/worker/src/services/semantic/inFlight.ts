/**
 * Work through a list with a bounded number of calls waiting on a provider at once. ADR 0102.
 *
 * WHY NOT ONE AT A TIME. A classifier call is ~0.5 s of waiting on the network, and the provider
 * allows far more than one in flight (40 requests and 100K tokens a second for jev-1.13). A pass
 * that waits on each call in turn uses about 5% of that and takes ten times as long for the same
 * tokens.
 *
 * A STOP IS HONOURED BEFORE A CALL, NEVER DURING ONE. Once `stop` is aborted nothing new starts,
 * and every call already started is awaited: its answer has been paid for, and the caller writes
 * it. A failure is treated the same way -- nothing new starts, the calls in flight settle, then
 * the first error is thrown -- so a defect never leaves work running behind the caller's back.
 */

export async function inFlight<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
  stop?: AbortSignal,
): Promise<{ stopped: boolean }> {
  const queue = items[Symbol.iterator]();
  const state: { stopped: boolean; failed: boolean; error: unknown } = {
    stopped: false,
    failed: false,
    error: null,
  };

  async function lane(): Promise<void> {
    let step = queue.next();
    while (step.done !== true && !state.failed) {
      if (stop?.aborted === true) {
        state.stopped = true;
        return;
      }
      try {
        await work(step.value);
      } catch (error) {
        if (!state.failed) {
          state.failed = true;
          state.error = error;
        }
        return;
      }
      step = queue.next();
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  if (state.failed) {
    throw state.error;
  }
  return { stopped: state.stopped };
}
