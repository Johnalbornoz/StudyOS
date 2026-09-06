/**
 * Run `worker` over `items` with at most `limit` promises in flight at
 * once, returning results in INPUT order (never completion order).
 *
 * Pure scheduling primitive: no retries, no timeout, no error
 * swallowing. Rejects with the first worker rejection, like
 * `Promise.all` -- already-started workers are not cancelled (JS has no
 * cancellation) but no further items are picked up once one has
 * failed.
 *
 * Introduced for Phase 6 Closeout C1 to replace a serial `for...of
 * await` over per-concept reads in the Phase 4 decision path with a
 * bounded fan-out that keeps the same reads, the same result order,
 * and therefore the same LearningDecision output -- only the IO
 * schedule changes. `limit` is an operational concurrency bound
 * (chosen against the pg pool size), never a learning-policy value and
 * never client-configurable.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let nextIndex = 0;
  // Mutable container, not a `let` -- CFA cannot narrow an object
  // property across the `await Promise.all` below, so `failure.hit`
  // stays observable after the workers settle.
  const failure: { hit: boolean; error: unknown } = { hit: false, error: undefined };

  async function run(): Promise<void> {
    while (!failure.hit) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        if (!failure.hit) {
          failure.hit = true;
          failure.error = err;
        }
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => run()));
  if (failure.hit) throw failure.error;
  return results;
}
