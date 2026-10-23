import { Effect, Function, type Schema } from 'effect';

import { hostDatabaseOpenedOn, type DatabaseSettings } from '../src/ledger-testing/ledger-connections.ts';
import { alpha, at, playbookCreated, recorded } from '../src/reaction-testing/playbook-writes.ts';
import { header, runAt, startOf } from './measured-host.ts';
import { childOf, waitingHost, type WaitingHost } from './waiting-host.ts';

export interface WaitingLatency {
  readonly runs: number;
  readonly p50: number;
  readonly p99: number;
  readonly most: number;
}

export interface WaitingCase {
  readonly runs: number;
  readonly signalled: boolean;
  readonly oneAtATime: boolean;
}

type Store = Awaited<ReturnType<typeof hostDatabaseOpenedOn>>['store'];

const calling: Schema.JsonObject = { document: header, do: [{ ask: { call: 'notify', with: { to: 'ada' } } }] };

const pausing: Schema.JsonObject = { document: header, do: [{ pause: { wait: 'PT1H' } }] };

const ofTheRun = { at, definitionType: 'workflow', definitionName: 'measured', definitionVersion: 1 };

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function inTurn(count: number, each: (index: number) => Promise<unknown>): Promise<void> {
  return Array.from({ length: count }, (_, index) => index).reduce<Promise<void>>(
    (before, index) => before.then(() => each(index)).then(Function.constVoid),
    Promise.resolve(),
  );
}

function latencyOf(recordedAt: ReadonlyMap<string, number>, { settledAt }: WaitingHost): WaitingLatency {
  const late = [...recordedAt]
    .map(([runId, when]: readonly [string, number]) => (settledAt.get(runId) ?? when) - when)
    .toSorted((a, b) => a - b);
  return { runs: late.length, p50: percentile(late, 0.5), p99: percentile(late, 0.99), most: late.at(-1) ?? 0 };
}

async function measuredOn(
  database: DatabaseSettings,
  { runs, signalled, oneAtATime }: WaitingCase,
  document: Schema.JsonObject,
  record: (store: Store, runId: string) => Promise<void>,
): Promise<WaitingLatency> {
  const opened = await hostDatabaseOpenedOn(database);
  await playbookCreated(opened.store, 'alpha');
  const waiting = await waitingHost(database, opened, signalled);
  await inTurn(runs, (index) => Effect.runPromise(waiting.host.start(runAt(index), startOf(document))));
  if (document === calling) {
    await waiting.untilWaiting(Array.from({ length: runs }, (_, index) => `acme/alpha/${runAt(index).runId}`));
  }
  const recordedAt = new Map<string, number>();
  await inTurn(runs, async (index) => {
    const { runId } = runAt(index);
    await record(opened.store, runId);
    recordedAt.set(runId, Date.now());
    await waiting.untilSettled(oneAtATime ? index + 1 : 0);
  });
  await waiting.untilSettled(runs);
  await waiting.host.stop();
  await opened.close();
  return latencyOf(recordedAt, waiting);
}

export function childEndingLatencyOn(database: DatabaseSettings, measured: WaitingCase): Promise<WaitingLatency> {
  return measuredOn(database, measured, calling, (store, runId) =>
    recorded(
      store,
      `${alpha}runs/${childOf(runId)}`,
      { type: 'run_succeeded', data: { output: 'done', record: {} } },
      { ...ofTheRun, runId: childOf(runId), by: 'playbook:alpha', calledBy: { runId, reference: '/do/0/ask', run: 1 } },
    ),
  );
}

export function cancelLatencyOn(database: DatabaseSettings, measured: WaitingCase): Promise<WaitingLatency> {
  return measuredOn(database, measured, pausing, (store, runId) =>
    recorded(
      store,
      `${alpha}runs/${runId}`,
      { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Measured' } },
      { ...ofTheRun, runId, by: 'acme-admin' },
    ),
  );
}
