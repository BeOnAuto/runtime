import { defaultLimits } from '@on.auto/workflow-engine/testing';
import { Effect, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  closeHostParts,
  hostWakeUp,
  openHostParts,
  openWorkflowStore,
  runKeyOf,
  runRequestsOf,
  type HostClock,
  type NextWake,
  type RunRequests,
  type WorkflowStore,
  type Woken,
} from '../index.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, connectedOn, leaseHoldersOn } from '../testing/host-files.ts';
import { recordedOptionsOf } from '../testing/host-runs.ts';
import { watchedClock } from '../testing/watched-clock.ts';
import { steppedClock } from '../views-testing/stepped-sweeps.ts';

const sooner = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const later = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

interface OwnClocked {
  readonly store: WorkflowStore;
  readonly armed: () => readonly number[];
  readonly settled: () => readonly string[];
  readonly troubles: () => readonly string[];
  readonly started: (runId: string, duration: string) => Promise<unknown>;
  readonly requests: RunRequests;
  readonly wakeUp: (woken: Woken) => Promise<NextWake>;
  readonly closed: () => Promise<void>;
}

async function ownClocked(clock: HostClock): Promise<OwnClocked> {
  const store = await openWorkflowStore(await connectedOn({ store: 'sqlite', file: aSQLiteFile() }), []);
  const recorded = recordedOptionsOf({ sweepEveryMs: 1000 });
  const armed: number[] = [];
  const parts = openHostParts(store, { ...recorded.options, clock }, (dueAt) => {
    armed.push(dueAt);
  });
  const work = hostWakeUp(parts, { raised: Function.constVoid, renewed: Function.constVoid });
  return {
    store,
    armed: () => armed,
    settled: () => [...recorded.settlements().keys()],
    troubles: recorded.troubles,
    started: (runId, duration) => {
      recorded.know(runId);
      const start = startOf(workflow(`do:\n  - pause: { wait: ${duration} }`));
      return Effect.runPromise(
        parts.submitted({ ...start, kind: 'started', runId: runKeyOf(runAt(runId)), at: clock.now() }),
      );
    },
    requests: runRequestsOf({ database: store.database, clock, serving: () => parts }),
    wakeUp: (woken) => Effect.runPromise(work.wakeUp(woken)),
    closed: async () => {
      await Effect.runPromise(work.stop());
      await closeHostParts(parts);
    },
  };
}

describe('the parts of a host, woken by a clock of its own', () => {
  it('fire the timers due at each wake-up and answer when they are next due, with no loop and no claim', async () => {
    const start = Date.now();
    const stepped = steppedClock(start);
    const clock = watchedClock(stepped);
    const own = await ownClocked(clock);
    await own.started(sooner, 'PT1S');
    await own.started(later, 'PT2S');

    stepped.step(1000);
    const first = await own.wakeUp({ now: clock.now(), sweep: true });
    const settledAtFirst = own.settled();
    stepped.step(1000);
    const second = await own.wakeUp({ now: clock.now(), sweep: false });
    await own.closed();

    const deadline = start + defaultLimits.mostDurationMs;
    expect(own.armed()).toEqual([deadline, start + 1000, deadline, start + 2000]);
    expect([first, second]).toEqual([{ nextDueAt: start + 2000 }, { nextDueAt: null }]);
    expect([settledAtFirst, own.settled()]).toEqual([[sooner], [sooner, later]]);
    expect([clock.asked(), await leaseHoldersOn(own.store.database), own.troubles()]).toEqual([[], [], []]);
  });
});

const listening = workflow('do:\n  - approval: { listen: { to: { one: { with: { type: com.acme.approved } } } } }');

describe('the requests of runs over the parts of a host a clock of its own wakes', () => {
  it('start a run, give it an event and read its state, with no loop and no claim', async () => {
    const clock = steppedClock(Date.now());
    const own = await ownClocked(clock);
    const run = runAt(sooner);

    const started = await Effect.runPromise(own.requests.start(run, startOf(listening)));
    const again = await Effect.runPromise(own.requests.start(run, startOf(listening)));
    const delivered = await Effect.runPromise(
      own.requests.deliver(run, { id: 'approved-1', type: 'com.acme.approved' }),
    );
    const { status } = await Effect.runPromise(own.requests.stateOf(runKeyOf(run)));
    await own.closed();

    expect([started, again, delivered, status, await leaseHoldersOn(own.store.database)]).toEqual([
      'started',
      'going',
      'delivered',
      'ended',
      [],
    ]);
  });
});
