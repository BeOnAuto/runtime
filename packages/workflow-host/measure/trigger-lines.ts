import { loadavg } from 'node:os';

import type { DatabaseSettings } from '../src/ledger-testing/ledger-connections.ts';
import { timerLatenessOn } from './lateness.ts';
import { reactionLatencyOn } from './reactions.ts';
import { everyFiringOn } from './schedule-firing.ts';
import { anEventTrigger, threeTriggers, type TriggersOf } from './trigger-sets.ts';

const workflows = 1000;

function loadAverage(): string {
  return (loadavg()[0] ?? 0).toFixed(1);
}

async function measuredWith(
  store: string,
  aDatabase: () => Promise<DatabaseSettings>,
  write: (line: string) => void,
  [carrying, triggersOf]: readonly [string, TriggersOf],
): Promise<void> {
  const lateness = await timerLatenessOn(await aDatabase(), 1000, workflows, triggersOf);
  write(
    `${store}: ${workflows} workflows ${carrying}, ${lateness.timers} timers fired late by ${lateness.p50} ms at the median, ${lateness.p99} ms at p99, ${lateness.most} ms at most, under a load average of ${loadAverage()}`,
  );
  const latencyLine = async (signalled: boolean): Promise<void> => {
    const latency = await reactionLatencyOn(await aDatabase(), { workflows, events: 1000, signalled, triggersOf });
    write(
      `${store}: ${workflows} workflows ${carrying}, ${latency.events} events each matching one, ${signalled ? 'with' : 'without'} the append signal, started their runs ${latency.p50} ms after their append at the median, ${latency.p99} ms at p99, ${latency.most} ms at most, under a load average of ${loadAverage()}`,
    );
  };
  await latencyLine(true);
  await latencyLine(false);
}

export async function triggersMeasuredOn(
  store: string,
  aDatabase: () => Promise<DatabaseSettings>,
  write: (line: string) => void,
): Promise<void> {
  await measuredWith(store, aDatabase, write, ['with an event trigger', anEventTrigger]);
  await measuredWith(store, aDatabase, write, ['with an event trigger, a cron and an every schedule', threeTriggers]);
  const firing = await everyFiringOn(await aDatabase(), workflows);
  write(
    `${store}: ${firing.schedules} every schedules saved in ${(firing.savedMs / 1000).toFixed(1)} s and due at one time a minute after started their runs ${firing.p50} ms late at the median, ${firing.p99} ms at p99, ${firing.most} ms at most, under a load average of ${loadAverage()}`,
  );
}
