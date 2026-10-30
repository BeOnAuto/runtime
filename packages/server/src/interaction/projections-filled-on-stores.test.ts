import { conversations, listInteractions, openRequests, openRequestsName } from '@on.auto/interaction';
import {
  alpha,
  answeringAnyRun,
  answererId,
  chatHarness,
  conversationRows,
  farAhead,
  nudging,
  type HarnessLedger,
} from '@on.auto/interaction/testing';
import { plainPoolsOn, postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { advancedColumnsOf, Ledger, projectedTableOf } from '@on.auto/operations';
import { Effect, Layer, ManagedRuntime, Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { onTheLedgerIn, tableDropped } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const projections = [openRequests, conversations];

const tables = projections.map((projection) => projectedTableOf(projection));

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const answeredId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const nudgedId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';

const namesakeId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7d';

async function opened(layer: Layer.Layer<Ledger>): Promise<HarnessLedger> {
  const runtime = ManagedRuntime.make(layer);
  onTestFinished(() => runtime.dispose());
  const service = await runtime.runPromise(Ledger);
  return { service, layer: Layer.succeed(Ledger, service) };
}

interface Place {
  readonly open: () => Promise<HarnessLedger>;
  readonly dropTables: () => Promise<void>;
}

function onSQLite(): Promise<Place> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return Promise.resolve({
    open: () => opened(ledgerLayer({ fileName: ledger.fileName, projections })),
    dropTables: async () => {
      await onTheLedgerIn(ledger.fileName, (connection) =>
        Promise.all(tables.map((table) => connection.write(tableDropped(table)))),
      );
    },
  });
}

async function administer(connectionString: string, statement: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function onPostgreSQL(): Promise<Place> {
  const name = `filled_${crypto.randomUUID().replaceAll('-', '')}`;
  await administer(postgresql, `CREATE DATABASE ${name}`);
  onTestFinished(() => administer(postgresql, `DROP DATABASE ${name} WITH (FORCE)`));
  const url = new URL(postgresql);
  url.pathname = `/${name}`;
  return {
    open: () => opened(postgresqlLedgerLayer({ pools: plainPoolsOn(url.href), projections })),
    dropTables: () => administer(url.href, tables.map((table) => `DROP TABLE ${table}`).join('; ')),
  };
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

const advancedByTheReader = new Set(advancedColumnsOf(conversations));

function foldedColumnsOf(row: Readonly<Record<string, unknown>>) {
  return Object.fromEntries(
    Object.entries(row).filter(([column]: readonly [string, unknown]) => !advancedByTheReader.has(column)),
  );
}

function requestRowsOf(ledger: HarnessLedger) {
  return Effect.runPromise(
    ledger.service.readProjectedRows(openRequestsName, alpha, { where: [], orderBy: [], order: 'asc', limit: 50 }),
  );
}

const decodeSent = Schema.decodeUnknownSync(Schema.Struct({ sent_id: Schema.String }));

async function threadOfRun(ledger: HarnessLedger, run: string): Promise<string> {
  const requests = await requestRowsOf(ledger);
  return decodeSent(requests.find(({ key }) => key === run)?.row).sent_id;
}

async function rowsOf(ledger: HarnessLedger) {
  const requests = await requestRowsOf(ledger);
  const conversationsRead = await conversationRows(ledger);
  return {
    requests: requests.map(({ row }) => row),
    conversations: conversationsRead.map(({ row }) => foldedColumnsOf(row)),
  };
}

const decodeListing = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ interactions: Schema.Array(Schema.Struct({ run_id: Schema.String })) }) }),
);

describe.each(stores)('the projections of the requests and the conversations on $store', ({ skipped, aPlace }) => {
  it.skipIf(skipped)(
    'are filled from the history of the playbook when their tables are new, each row as the appends folded it, the cadence its reader advances aside',
    async () => {
      const place = await aPlace();
      const playbook = await chatHarness({ ledger: await place.open(), others: [nudging] });
      await playbook.askInThread(runId);
      await playbook.askInThread(answeredId);
      await playbook.performDue(Date.now());
      const thread = await threadOfRun(playbook.ledger, runId);
      playbook.chat.reply({ channel: '#approvals-sales', thread, user: answererId, text: 'maybe later' });
      await playbook.performReads(Date.now() + farAhead);
      await playbook.call(answeringAnyRun, { run_id: answeredId, answer: { choice: 'approve' } });
      await playbook.defineAs('nudging', 'forecast', 'Go?');
      await playbook.askAs('nudging', 'forecast', {}, nudgedId);
      const kept = await rowsOf(playbook.ledger);

      await place.dropTables();
      const filled = await rowsOf(await place.open());

      expect(kept.requests).toMatchObject([
        { function: 'approve-brief', version: 1, standing: 'delivered', reply_refusals: 1, refusals_told: 1 },
        { type: 'interaction', standing: 'answered', open: false, ended: null },
        { type: 'nudging', function: 'forecast', standing: 'to_deliver', open: true, message: 'Go?' },
      ]);
      expect(kept.conversations).toHaveLength(2);
      expect(filled).toEqual(kept);
    },
  );
});

describe.each(stores)('the open requests listed on $store', ({ skipped, aPlace }) => {
  it.skipIf(skipped)('are those of one type, or of one function with its type or without, newest first', async () => {
    const playbook = await chatHarness({ ledger: await (await aPlace()).open(), others: [nudging] });
    await playbook.askInThread(runId);
    await playbook.defineAs('nudging', 'forecast', 'Go?');
    await playbook.askAs('nudging', 'forecast', {}, nudgedId);
    await playbook.defineAs('nudging', 'approve-brief', 'Approve?');
    await playbook.askAs('nudging', 'approve-brief', {}, namesakeId);
    const listed = async (filters: Readonly<Record<string, string>>) =>
      decodeListing(await playbook.call(listInteractions, filters)).output.interactions.map(({ run_id: id }) => id);

    expect([
      await listed({ type: 'nudging' }),
      await listed({ type: 'interaction' }),
      await listed({ type: 'nudging', function: 'approve-brief' }),
      await listed({ type: 'interaction', function: 'approve-brief' }),
      await listed({ function: 'approve-brief' }),
    ]).toEqual([[namesakeId, nudgedId], [runId], [namesakeId], [runId], [namesakeId, runId]]);
  });
});
