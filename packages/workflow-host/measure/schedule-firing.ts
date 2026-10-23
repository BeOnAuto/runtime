import { setTimeout } from 'node:timers/promises';

import { Effect } from 'effect';

import { openWorkflowHost } from '../src/host/workflow-host.ts';
import { hostDatabaseOpenedOn, type DatabaseSettings } from '../src/ledger-testing/ledger-connections.ts';
import { playbookCreated, everyTrigger, definitionRecorded } from '../src/reaction-testing/playbook-writes.ts';
import { recordedReactions } from '../src/reaction-testing/recorded-reactions.ts';
import { testMachine } from '../src/testing/host-documents.ts';
import { recordedWaiting } from '../src/waiting-testing/recorded-waiting.ts';

export interface EveryFiring {
  readonly schedules: number;
  readonly savedMs: number;
  readonly p50: number;
  readonly p99: number;
  readonly most: number;
}

const aMinute = 60_000;

const quiet = {
  unsettled: () => Effect.void,
  trouble: Effect.logWarning,
  note: () => Effect.void,
};

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

async function untilFired(fired: () => number, most: number): Promise<void> {
  if (fired() < most) {
    await setTimeout(5);
    await untilFired(fired, most);
  }
}

export async function everyFiringOn(database: DatabaseSettings, schedules: number): Promise<EveryFiring> {
  const firedAt: number[] = [];
  const opened = await hostDatabaseOpenedOn(database);
  await playbookCreated(opened.store, 'alpha');
  const host = await openWorkflowHost({
    database: { database: opened },
    machine: testMachine,
    perform: () => Effect.succeed({ status: 'succeeded', output: null }),
    settle: () => Effect.die(new Error('The measured runs settle nothing')),
    reports: quiet,
    sweepEveryMs: 1000,
    mostCallsAtOnce: 32,
    reactions: {
      ...recordedReactions().options,
      start: () =>
        Effect.sync(() => {
          firedAt.push(Date.now());
        }),
    },
    waiting: recordedWaiting().options,
  });
  const savedAt = Date.now();
  const when = new Date(savedAt).toISOString();
  await Array.from({ length: schedules }, (_, index) => index).reduce<Promise<void>>(
    (before, index) =>
      before.then(() =>
        definitionRecorded(opened.store, { name: `w${index}`, version: 1, triggers: [everyTrigger(aMinute)], when }),
      ),
    Promise.resolve(),
  );
  const savedMs = Date.now() - savedAt;
  await untilFired(() => firedAt.length, schedules);
  await host.stop();
  await opened.close();
  const late = firedAt.map((at) => at - (savedAt + aMinute)).toSorted((first, second) => first - second);
  return { schedules, savedMs, p50: percentile(late, 0.5), p99: percentile(late, 0.99), most: late.at(-1) ?? 0 };
}
