import { steppedClock, type SteppedClock } from '@on.auto/workflow-host/testing';
import { Effect } from 'effect';

import type { Playbook } from './playbook.ts';
import { hostSweepsEveryMs } from './test-host.ts';

interface Settlement {
  readonly heard: Promise<void>;
  readonly hear: () => void;
  readonly done: () => boolean;
}

export interface HostSettlements {
  readonly clock: SteppedClock;
  readonly settling: (nested: Playbook) => Playbook;
  readonly settledOn: (runId: string, stillRuns: () => Promise<boolean>) => Promise<void>;
}

function settlementAwaited(): Settlement {
  const { promise, resolve } = Promise.withResolvers<void>();
  const state = { done: false };
  return {
    heard: promise,
    hear: () => {
      state.done = true;
      resolve();
    },
    done: () => state.done,
  };
}

/**
 * The settlements of the runs of a host on a stepped clock: a test waits for a run to be settled by stepping the clock
 * a sweep on each time the host rests before it is, and a run it finds already ended is settled at once.
 */
export function hostSettlementsOn(): HostSettlements {
  const clock = steppedClock(Date.now());
  const settlements = new Map<string, Settlement>();
  const settlementOf = (runId: string): Settlement => {
    const kept = settlements.get(runId);
    const settlement = kept === undefined || kept.done() ? settlementAwaited() : kept;
    settlements.set(runId, settlement);
    return settlement;
  };
  const stepped = async (heard: Promise<void>): Promise<void> => {
    const rested = await Promise.race([heard.then(() => 'heard' as const), clock.atRest()]);
    if (rested !== 'heard') {
      clock.step(hostSweepsEveryMs);
      await stepped(heard);
    }
  };
  return {
    clock,
    settling: (nested) => ({
      ...nested,
      settle: (address, settlement, lineage) =>
        Effect.tap(nested.settle(address, settlement, lineage), () =>
          Effect.sync(() => {
            settlementOf(address.id).hear();
          }),
        ),
    }),
    settledOn: async (runId, stillRuns) => {
      const settlement = settlementOf(runId);
      if (await stillRuns()) {
        await stepped(settlement.heard);
      }
    },
  };
}
