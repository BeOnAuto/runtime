import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

import type { SettleRun } from '@on.auto/definitions';
import type { CallResult } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { workflowHostOnALedger } from './src/ledger-testing/ledger-connections.ts';
import { recordedReactions } from './src/reaction-testing/recorded-reactions.ts';
import { startOf, testMachine } from './src/testing/host-documents.ts';
import { databaseSettingsOf, type ProcessDatabase } from './src/testing/host-processes.ts';
import { recordedWaiting } from './src/waiting-testing/recorded-waiting.ts';

const [settingsText = '', mode = '', settlementsFile = '', sweepEveryMs = '20'] = process.argv.slice(2);

const database: ProcessDatabase = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({ store: Schema.Literal('sqlite'), file: Schema.String }),
      Schema.Struct({ store: Schema.Literal('postgresql'), connectionString: Schema.String }),
    ]),
  ),
)(settingsText);

const run = { org: 'acme', playbook: 'alpha', runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' };

const notifying = {
  document: { dsl: '1.0.3', namespace: 'acme', name: 'notifying', version: '1.0.0' },
  do: [{ notify: { call: 'notify', with: { to: 'ada' } } }],
};

function said(line: string): Effect.Effect<void> {
  return Effect.sync(() => {
    process.stdout.write(`${line}\n`);
  });
}

const hangs = Effect.never;

const answered: Effect.Effect<CallResult> = Effect.succeed({ status: 'succeeded', output: 'sent' });

const settle: SettleRun = ({ id }, settlement) =>
  mode === 'hang-on-settle'
    ? Effect.andThen(said('settling'), hangs)
    : Effect.sync(() => {
        appendFileSync(settlementsFile, `${JSON.stringify({ id, settlement })}\n`);
        return {
          run_id: id,
          type: 'workflow',
          name: 'notifying',
          definition_version: 1,
          status: 'succeeded',
          started_at: '2026-10-05T09:00:00.000Z',
          started_by: { id: 'acme-admin', name: 'acme-admin' },
        } as const;
      });

async function stoppedOnceSettled(stop: () => Promise<void>): Promise<void> {
  if (existsSync(settlementsFile) && readFileSync(settlementsFile, 'utf8') !== '') {
    await stop();
    return;
  }
  await setTimeout(20);
  await stoppedOnceSettled(stop);
}

const host = await workflowHostOnALedger(databaseSettingsOf(database), {
  machine: testMachine,
  perform: () => (mode === 'hang-on-call' ? Effect.andThen(said('calling'), hangs) : answered),
  settle,
  reports: {
    unsettled: () => Effect.void,
    trouble: () => Effect.void,
    note: () => Effect.void,
  },
  sweepEveryMs: Number(sweepEveryMs),
  mostCallsAtOnce: 1,
  reactions: recordedReactions().options,
  waiting: recordedWaiting().options,
});

if (mode === 'finish') {
  await stoppedOnceSettled(host.stop);
} else {
  await Effect.runPromise(host.start(run, { ...startOf(notifying), attributes: {} }));
}
