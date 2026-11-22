import { appendFileSync } from 'node:fs';

import type { SettleRun } from '@on.auto/definitions';
import type { CallResult } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { workflowHostOnALedger } from './src/ledger-testing/ledger-connections.ts';
import { recordedReactions } from './src/reaction-testing/recorded-reactions.ts';
import { definitionOfTheTests, startOf, testMachine } from './src/testing/host-documents.ts';
import { databaseSettingsOf, type ProcessDatabase } from './src/testing/host-processes.ts';
import { steppedClock } from './src/testing/stepped-clock.ts';
import { recordedWaiting } from './src/waiting-testing/recorded-waiting.ts';

const [settingsText = '', mode = '', settlementsFile = '', sweepEveryMs = '20', startsAt = '0'] = process.argv.slice(2);

const database: ProcessDatabase = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({ store: Schema.Literal('sqlite'), file: Schema.String }),
      Schema.Struct({ store: Schema.Literal('postgresql'), connectionString: Schema.String }),
    ]),
  ),
)(settingsText);

const run = {
  org: 'acme',
  playbook: 'alpha',
  definition: definitionOfTheTests,
  runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
};

const notifying = {
  document: { dsl: '1.0.3', namespace: 'acme', name: 'notifying', version: '1.0.0' },
  do: [{ notify: { call: 'notify', with: { to: 'ada' } } }],
};

/** The host's clock, which moves only when the test says "step <ms>" on standard input. */
const clock = steppedClock(Number(startsAt));

function said(line: string): Effect.Effect<void> {
  return Effect.sync(() => {
    process.stdout.write(`${line}\n`);
  });
}

/** A call or a settlement that never answers waits on the host's clock, so the host still comes to rest. */
const hangs: Effect.Effect<never> = Effect.andThen(clock.sleep(Number.POSITIVE_INFINITY), Effect.never);

const answered: Effect.Effect<CallResult> = Effect.succeed({ status: 'succeeded', output: 'sent' });

const settled = Promise.withResolvers<void>();

const settle: SettleRun = ({ id }, settlement) =>
  mode === 'hang-on-settle'
    ? Effect.andThen(said('settling'), hangs)
    : Effect.sync(() => {
        appendFileSync(settlementsFile, `${JSON.stringify({ id, settlement })}\n`);
        process.stdout.write('settled\n');
        settled.resolve();
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
  clock,
  context: clock.watching(),
});

async function steppedBy(line: string): Promise<void> {
  const [, milliseconds = '0'] = line.split(' ');
  await clock.atRest();
  clock.step(Number(milliseconds));
  await clock.atRest();
  process.stdout.write(`stepped ${String(clock.now())}\n`);
}

/** Each line "step <ms>" on standard input steps the host's clock from its rest, said once the host rests again. */
const unread = { text: '' };

process.stdin.setEncoding('utf8').on('data', (chunk: string) => {
  const lines = `${unread.text}${chunk}`.split('\n');
  unread.text = lines.pop() ?? '';
  for (const line of lines.filter((each) => each.startsWith('step '))) {
    void steppedBy(line);
  }
});

if (mode === 'finish') {
  await new Promise<void>((closed) => {
    process.stdin.on('end', closed);
  });
  await settled.promise;
  await host.stop();
} else {
  await Effect.runPromise(host.start(run, { ...startOf(notifying), attributes: {} }));
}
