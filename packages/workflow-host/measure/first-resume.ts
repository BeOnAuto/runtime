import { Effect, type Schema } from 'effect';

import { hostDatabaseOpenedOn, type DatabaseSettings } from '../src/ledger-testing/ledger-connections.ts';
import { bareEngineOn } from '../src/waiting-testing/crashed-host.ts';
import { passedOverRow, pendingCancelRowsAfter } from '../src/waiting/pending-cancel-rows.ts';
import { pendingCancelsGivenOnce } from '../src/waiting/pending-cancels.ts';
import { header, measuredHost, runAt, startOf } from './measured-host.ts';

export interface FirstResume {
  readonly going: number;
  readonly pending: number;
  readonly startedMs: number;
  readonly resumedMs: number;
  readonly troubles: number;
  readonly left: number;
}

const pausing: Schema.JsonObject = { document: header, do: [{ pause: { wait: 'PT1H' } }] };

const cancel = { by: 'acme-admin', kind: 'requested', reason: 'Measured' } as const;

function runKeyAt(index: number): string {
  return `acme/alpha/${runAt(index).runId}`;
}

async function goingRuns(database: DatabaseSettings, going: number): Promise<void> {
  const measured = await measuredHost(database);
  await Effect.runPromise(
    Effect.forEach(
      Array.from({ length: going }, (_, index) => index),
      (index) => measured.host.start(runAt(index), startOf(pausing)),
      { concurrency: 16, discard: true },
    ),
  );
  await measured.host.stop();
}

export async function firstResumeOn(database: DatabaseSettings, going: number, pending: number): Promise<FirstResume> {
  const started = performance.now();
  await goingRuns(database, going);
  const startedMs = performance.now() - started;
  const opened = await hostDatabaseOpenedOn(database);
  await Effect.runPromise(
    Effect.forEach(
      Array.from({ length: pending }, (_, index) => index),
      (index) => passedOverRow(opened, { runKey: runKeyAt(index), cause: `${runKeyAt(index)}-asked`, cancel }),
      { discard: true },
    ),
  );
  const engine = bareEngineOn(opened);
  const troubles: string[] = [];
  const cancelsAsked = pendingCancelsGivenOnce(
    { database: opened, submitted: engine.submitted, now: Date.now },
    (what) =>
      Effect.sync(() => {
        troubles.push(what);
      }),
  );
  const resumed = performance.now();
  await Effect.runPromise(cancelsAsked);
  const resumedMs = performance.now() - resumed;
  const left = await Effect.runPromise(pendingCancelRowsAfter(opened, '', pending + 1));
  await opened.close();
  return { going, pending, startedMs, resumedMs, troubles: troubles.length, left: left.length };
}
