import { randomUUID } from 'node:crypto';

import { Effect } from 'effect';

import { hostLease, leaseMsFor } from '../lease/host-lease.ts';
import { keptLease } from '../lease/lease-keeper.ts';
import type { HostParts } from './host-parts.ts';
import { startServing, type Serving, type ServingOptions } from './host-serving.ts';
import type { WorkflowStore } from './workflow-store.ts';

export interface Standing {
  readonly serving: () => HostParts | undefined;
  readonly stopReacting: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

export async function standingOn(
  store: WorkflowStore,
  options: ServingOptions,
  holder: string = randomUUID(),
): Promise<Standing> {
  const { reports, sweepEveryMs, clock } = options;
  const lastsMs = leaseMsFor(sweepEveryMs);
  const lease = hostLease(store.database, holder, lastsMs, clock);
  const current: { serving: Serving | null } = { serving: null };
  const servedNoMore = Effect.promise(async () => {
    const { serving } = current;
    await serving?.stopReacting();
    current.serving = null;
    await serving?.stop();
  });
  const keeper = await keptLease({
    lease,
    clock,
    sweepEveryMs,
    lastsMs,
    held: (before) =>
      Effect.andThen(
        Effect.sync(() => {
          current.serving = startServing(store, options);
        }),
        before === 'standing_by' ? reports.note({ kind: 'took_over', holder }) : Effect.void,
      ),
    standingBy: ({ holder: elsewhere, until }) =>
      Effect.andThen(servedNoMore, reports.note({ kind: 'standing_by', holder: elsewhere, until })),
    trouble: reports.trouble,
    context: options.context,
  });
  return {
    serving: () => current.serving?.parts,
    stopReacting: async () => {
      await current.serving?.stopReacting();
    },
    stop: async () => {
      await keeper.stop();
      await Effect.runPromise(servedNoMore);
      await Effect.runPromise(Effect.ignore(lease.released()));
    },
  };
}
