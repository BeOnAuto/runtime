import { randomUUID } from 'node:crypto';

import { conversations, openRequests, readings, tellings } from '@on.auto/interaction';
import {
  chatHarness,
  farAhead,
  keptAsRecorded,
  playbookUser,
  recordedTellingsBefore,
  recordsOf,
  tellingsBefore,
  type ChatHarness,
  type HarnessLedger,
} from '@on.auto/interaction/testing';
import { plainPoolsOn, postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { Ledger, type KeyedProjection } from '@on.auto/operations';
import { Layer, ManagedRuntime } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const projections = [openRequests, conversations, readings, tellings];

interface Opened {
  readonly ledger: HarnessLedger;
  readonly stop: () => Promise<void>;
}

async function opened(layer: Layer.Layer<Ledger>): Promise<Opened> {
  const runtime = ManagedRuntime.make(layer);
  const stopped = { done: false };
  const stop = async () => {
    if (!stopped.done) {
      stopped.done = true;
      await runtime.dispose();
    }
  };
  onTestFinished(stop);
  const service = await runtime.runPromise(Ledger);
  return { ledger: { service, layer: Layer.succeed(Ledger, service) }, stop };
}

type Place = (kept: readonly KeyedProjection[]) => Promise<Opened>;

function onSQLite(): Promise<Place> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return Promise.resolve((kept) => opened(ledgerLayer({ fileName: ledger.fileName, projections: kept })));
}

async function administer(statement: string): Promise<void> {
  const client = new Client({ connectionString: postgresql });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function onPostgreSQL(): Promise<Place> {
  const name = `tellings_before_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(() => administer(`DROP DATABASE ${name} WITH (FORCE)`));
  const url = new URL(postgresql);
  url.pathname = `/${name}`;
  return (kept) => opened(postgresqlLedgerLayer({ pools: plainPoolsOn(url.href), projections: kept }));
}

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly aPlace: () => Promise<Place>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, aPlace: onSQLite },
  { store: `PostgreSQL${notice}`, skipped: postgresql === '', aPlace: onPostgreSQL },
];

const { toldBefore, waitingUntold } = tellingsBefore;

const recorded = recordedTellingsBefore();

const channel = '#approvals-sales';

async function startedOn(place: Place): Promise<ChatHarness & Opened> {
  const started = await place(projections);
  const playbook = await chatHarness({ ledger: started.ledger, inTheChat: recorded.messages });
  return { ...playbook, stop: started.stop };
}

function tellingsCalled(playbook: ChatHarness): readonly unknown[] {
  return playbook.chat
    .calls()
    .filter(({ reference }) => reference.tool === 'post_message')
    .map(({ input }) => input['thread_ts']);
}

describe.each(stores)(
  'a request main told once in a chat that posts as the person who answers, then a restart, on $store',
  ({ skipped, aPlace }) => {
    it.skipIf(skipped)(
      'is told nothing more once this release fills its tables from its facts, across a restart, while the request beside it is told once and knows its telling as its own',
      async () => {
        const place = await aPlace();
        const before = await place([]);
        await keptAsRecorded(before.ledger.service, recorded.facts);
        await before.stop();

        const first = await startedOn(place);
        await first.performReads(Date.now() + farAhead);
        const toldBeforeTheRestart = tellingsCalled(first);
        await first.stop();
        const again = await startedOn(place);
        again.chat.reply({ channel, thread: '1699.000001', user: playbookUser, text: 'approve' });
        again.chat.reply({ channel, thread: '1699.000002', user: playbookUser, text: 'later' });
        await again.performReads(Date.now() + 2 * farAhead);
        await again.performReads(Date.now() + 3 * farAhead);

        expect(toldBeforeTheRestart).toEqual([]);
        expect(tellingsCalled(again)).toEqual(['1699.000002']);
        expect(
          (await recordsOf(again.ledger, 'reply_refused')).map(({ data, context }) => [context['runId'], data]),
        ).toMatchObject([
          [toldBefore, { reply: { id: '1699.000003' }, told: true }],
          [toldBefore, { reply: { id: '1699.000004' }, told: false }],
          [waitingUntold, { told: true }],
        ]);
        expect(await recordsOf(again.ledger, 'request_answered')).toMatchObject([
          { context: { runId: toldBefore }, data: { answer: { choice: 'approve' } } },
        ]);
      },
    );
  },
);
