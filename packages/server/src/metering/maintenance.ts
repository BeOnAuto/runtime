import type { RuntimeRuns, SelfHostedMeter } from '@on.auto/meter';
import type { StreamReader } from '@on.auto/operations';
import { choreWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';

export function meterMaintenance(
  meter: Pick<SelfHostedMeter, 'maintain'>,
  runs: Pick<RuntimeRuns, 'reconcile'>,
  reader: StreamReader,
) {
  let afterId: string | undefined;
  async function maintain(now: number): Promise<number> {
    const [settled, maintained] = await Promise.allSettled([
      runs.reconcile({ reader, ...(afterId === undefined ? {} : { afterId }) }),
      meter.maintain(),
    ]);
    if (settled.status === 'fulfilled') afterId = settled.value.afterId;
    if (settled.status === 'rejected' || maintained.status === 'rejected')
      throw new Error('runtime_meter_maintenance_failed');
    return now + Math.min(afterId === undefined ? 30_000 : 1000, maintained.value.retryInMilliseconds);
  }
  return choreWork({
    name: 'runtime meter',
    perform: (now) =>
      Effect.uninterruptible(
        Effect.tryPromise({
          try: () => maintain(now),
          catch: () => new Error('runtime_meter_maintenance_failed'),
        }).pipe(
          Effect.catch(() => Effect.as(Effect.logWarning('Runtime metering maintenance will retry.'), now + 30_000)),
        ),
      ),
  });
}
