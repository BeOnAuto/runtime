import { randomUUID } from 'node:crypto';

import { conversations, openRequests, readings } from '@on.auto/interaction';
import {
  answererId,
  beforeReadings,
  chatHarness,
  farAhead,
  flatReadsNamingReplies,
  keptAsRecorded,
  recordedBeforeReadings,
  recordedFlatReadsNamingReplies,
  recordsOf,
  threadDocument,
  type ChatHarness,
  type ChatHarnessOptions,
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

const projections = [openRequests, conversations, readings];

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
  const name = `before_readings_${randomUUID().replaceAll('-', '')}`;
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

const { older, newer, answeredFlat, waitingFlat } = beforeReadings;

const recorded = recordedBeforeReadings();

const settledAt = recorded.lastAt + 60_000;

async function startedOn(place: Place, options: ChatHarnessOptions = {}): Promise<ChatHarness & Opened> {
  const started = await place(projections);
  const playbook = await chatHarness({ ledger: started.ledger, inTheChat: recorded.messages, ...options });
  return { ...playbook, stop: started.stop };
}

async function outputsOf(playbook: ChatHarness, runIds: readonly string[], at: number): Promise<readonly unknown[]> {
  await playbook.performDue(at);
  return Promise.all(runIds.map((runId) => playbook.runOf(runId)));
}

describe.each(stores)('requests a release before readings left waiting, on $store', ({ skipped, aPlace }) => {
  it.skipIf(skipped)(
    'are each read by a read of their own once this release fills its tables from their facts, across a restart, and no reply is taken twice',
    async () => {
      const place = await aPlace();
      const before = await place([]);
      await keptAsRecorded(before.ledger.service, recorded.facts);
      await before.stop();

      const first = await startedOn(place);
      await first.performReads(Date.now() + farAhead);
      const afterTheFirstRead = await outputsOf(first, [older, newer, waitingFlat], settledAt);
      await first.stop();
      const again = await startedOn(place);
      again.chat.reply({ channel: '#approvals-sales', thread: '1699.000001', user: answererId, text: 'reject, no' });
      again.chat.reply({ channel: '#approvals-ops', user: answererId, text: 'reject' });
      await again.performReads(Date.now() + 2 * farAhead);

      expect(afterTheFirstRead).toMatchObject([
        { output: { status: 'started' } },
        { output: { status: 'succeeded', output: { choice: 'approve' } } },
        { output: { status: 'started' } },
      ]);
      expect(await outputsOf(again, [older, newer, answeredFlat, waitingFlat], settledAt)).toMatchObject([
        { output: { status: 'succeeded', output: { choice: 'reject', note: 'no' } } },
        { output: { status: 'succeeded', output: { choice: 'approve' } } },
        { output: { status: 'succeeded', output: { choice: 'approve' } } },
        { output: { status: 'succeeded', output: { choice: 'reject' } } },
      ]);
      expect((await recordsOf(again.ledger, 'request_answered')).map(({ context }) => context['runId'])).toEqual(
        expect.arrayContaining([answeredFlat, older, newer, waitingFlat]),
      );
      expect(await recordsOf(again.ledger, 'request_answered')).toHaveLength(4);
      expect(await recordsOf(again.ledger, 'reply_refused')).toHaveLength(1);
    },
  );
});

const flat = recordedFlatReadsNamingReplies();

const { answeredOfOneCall, waitingOfOneCall, answeredOfAnother, waitingOfAnother } = flatReadsNamingReplies;

describe.each(stores)(
  'requests main left waiting in channels read flat whose replies may name their message, then a restart, on $store',
  ({ skipped, aPlace }) => {
    it.skipIf(skipped)(
      'take no answer an earlier request took, before the restart or after it, and take the next plain reply',
      async () => {
        const place = await aPlace();
        const before = await place([]);
        await keptAsRecorded(before.ledger.service, flat.facts);
        await before.stop();
        const settled = flat.lastAt + 60_000;

        const first = await startedOn(place, { inTheChat: flat.messages });
        await first.performReads(Date.now() + farAhead);
        const beforeTheRestart = await outputsOf(first, [waitingOfOneCall, waitingOfAnother], settled);
        await first.stop();
        const again = await startedOn(place, { inTheChat: flat.messages });
        await again.performReads(Date.now() + 2 * farAhead);
        const afterTheRestart = await outputsOf(again, [waitingOfOneCall, waitingOfAnother], settled);
        again.chat.reply({ channel: '#approvals-finance', user: answererId, text: 'reject' });
        again.chat.reply({ channel: '#approvals-hr', user: answererId, text: 'reject' });
        await again.performReads(Date.now() + 3 * farAhead);

        expect([...beforeTheRestart, ...afterTheRestart]).toMatchObject(
          Array.from({ length: 4 }, () => ({ output: { status: 'started' } })),
        );
        expect(
          await outputsOf(again, [answeredOfOneCall, waitingOfOneCall, answeredOfAnother, waitingOfAnother], settled),
        ).toMatchObject([
          { output: { status: 'succeeded', output: { choice: 'approve' } } },
          { output: { status: 'succeeded', output: { choice: 'reject' } } },
          { output: { status: 'succeeded', output: { choice: 'approve' } } },
          { output: { status: 'succeeded', output: { choice: 'reject' } } },
        ]);
        expect(await recordsOf(again.ledger, 'request_answered')).toHaveLength(4);
        expect(await recordsOf(again.ledger, 'reply_refused')).toEqual([]);
      },
    );
  },
);

const keyedByTheChannel = threadDocument({
  replies: [
    'replies:',
    '  tool: thread_replies',
    '  with:',
    "    channel: '{{ sent.conversation }}'",
    "    ts: '{{ sent.id }}'",
    `    oldest: '{{ since | default: "0" }}'`,
    '  read:',
    '    list: /messages',
    '    order: oldest_first',
    '    each: { id: /ts, sender: /user, text: /text, to: /thread_ts }',
  ],
});

describe.each(stores)('two requests delivered into one channel, then a restart, on $store', ({ skipped, aPlace }) => {
  it.skipIf(skipped)('take a reply in the newer thread for the newer once the server is back', async () => {
    const place = await aPlace();
    const first = await place(projections);
    const asking = await chatHarness({ ledger: first.ledger, document: keyedByTheChannel });
    await asking.askInThread(older);
    await asking.askInThread(newer);
    await asking.performDue(Date.now());
    const [, newerThread] = asking.chat.posted().map(({ ts }) => ts);
    await first.stop();

    const again = await startedOn(place, { document: keyedByTheChannel, inTheChat: asking.chat.posted() });
    again.chat.reply({ channel: '#approvals-sales', thread: newerThread, user: answererId, text: 'approve' });
    await again.performReads(Date.now() + farAhead);

    expect(await outputsOf(again, [older, newer], Date.now())).toMatchObject([
      { output: { status: 'started' } },
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
    ]);
  });
});
