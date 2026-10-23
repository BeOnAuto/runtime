import { Effect } from 'effect';

import { hostDatabaseOpenedOn, type DatabaseSettings } from '../src/ledger-testing/ledger-connections.ts';
import { playbookCreated, definitionRecorded } from '../src/reaction-testing/playbook-writes.ts';
import { ledgerRunLogStore } from '../src/runs/ledger-run-store.ts';
import { runKeyOf } from '../src/runs/run-address.ts';
import { header, measuredHost, runAt, startOf } from './measured-host.ts';
import { anEventTrigger, savedNow, type TriggersOf } from './trigger-sets.ts';

export interface Lateness {
  readonly timers: number;
  readonly p50: number;
  readonly p99: number;
  readonly most: number;
}

const pausing = { document: header, do: [{ pause: { wait: 'PT2S' } }] };

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

async function latenessOf(database: DatabaseSettings, runs: number): Promise<readonly number[]> {
  const opened = await hostDatabaseOpenedOn(database);
  const runStore = ledgerRunLogStore(opened);
  const late = await Effect.runPromise(
    Effect.forEach(
      Array.from({ length: runs }, (_, index) => runAt(index)),
      (run) =>
        Effect.map(runStore.eventsAfter(runKeyOf(run), 0), ([started, fired]) => {
          const armed = started?.event.outputs.find(
            (output) => output.kind === 'arm_timer' && output.purpose === 'wait',
          );
          const dueAt = armed?.kind === 'arm_timer' ? armed.dueAt : Number.NaN;
          return (fired?.event.receipt.at ?? Number.NaN) - dueAt;
        }),
    ),
  );
  await opened.close();
  return late;
}

async function reactingWorkflows(database: DatabaseSettings, count: number, triggersOf: TriggersOf): Promise<void> {
  const opened = await hostDatabaseOpenedOn(database);
  await playbookCreated(opened.store, 'alpha');
  await Array.from({ length: count }, (_, index) => index).reduce<Promise<void>>(
    (before, index) =>
      before.then(() =>
        definitionRecorded(opened.store, {
          name: `w${index}`,
          version: 1,
          triggers: triggersOf(`com.measure.t${index}`),
          when: savedNow(),
        }),
      ),
    Promise.resolve(),
  );
  await opened.close();
}

export async function timerLatenessOn(
  database: DatabaseSettings,
  timers: number,
  reacting = 0,
  triggersOf: TriggersOf = anEventTrigger,
): Promise<Lateness> {
  await reactingWorkflows(database, reacting, triggersOf);
  const measured = await measuredHost(database);
  await Effect.runPromise(
    Effect.forEach(
      Array.from({ length: timers }, (_, index) => runAt(index)),
      (run) => measured.host.start(run, startOf(pausing)),
      { discard: true },
    ),
  );
  await measured.untilSettled(timers);
  await measured.host.stop();
  const late = (await latenessOf(database, timers)).toSorted((first, second) => first - second);
  return { timers, p50: percentile(late, 0.5), p99: percentile(late, 0.99), most: late.at(-1) ?? 0 };
}
