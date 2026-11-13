import { randomUUID } from 'node:crypto';

import { statementOf } from '@on.auto/ledger';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import {
  answerDigest,
  answeredAndHeld,
  answeredOnce,
  eventSent,
  formatsOf,
  headsOfTheAnswer,
  notes,
  playbookOn,
  servedOn,
  started,
  succeededWithTheAnswer,
  waitingWithItsAnswerKept,
  type OpenStore,
} from '../testing/interaction-servers/kept-answer-servers.ts';
import {
  endedRunOf,
  postsDraftedOnThePage,
  reactingToTheReview,
} from '../testing/interaction-servers/kept-output-reactions.ts';
import { readOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const postgresqlNotice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

async function administer(sql: string): Promise<void> {
  const client = new Client({ connectionString: postgresql });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function onSQLite(): Promise<OpenStore> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return Promise.resolve({
    environment: {},
    served: { ledger },
    rows: (sql) => readOfTheLedgerIn(ledger.fileName, statementOf([sql], [])),
  });
}

function rowsAt(url: string): OpenStore['rows'] {
  return async (sql) => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      return (await client.query<Record<string, unknown>>(sql)).rows;
    } finally {
      await client.end();
    }
  };
}

async function onPostgreSQL(): Promise<OpenStore> {
  const name = `kept_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administer(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(postgresql);
  database.pathname = `/${name}`;
  return {
    environment: { LEDGER_FILE: '', DATABASE_URL: database.href, SECRETS_KEY: secretsKey },
    served: {},
    rows: rowsAt(database.href),
  };
}

interface KeptStore {
  readonly name: string;
  readonly skipped: boolean;
  readonly open: () => Promise<OpenStore>;
}

const stores: readonly KeptStore[] = [
  { name: 'SQLite', skipped: false, open: onSQLite },
  { name: `PostgreSQL${postgresqlNotice}`, skipped: postgresql === '', open: onPostgreSQL },
];

describe.each(stores)('a workflow handed values its playbook keeps outside, over HTTP, on $name', (store) => {
  it.skipIf(store.skipped)('is handed the answer a person gave past the threshold, kept across a wait', async () => {
    const opened = await store.open();
    const { server, runId } = await waitingWithItsAnswerKept(opened);

    await eventSent(server, runId);

    expect(await server.settled(runId)).toMatchObject(succeededWithTheAnswer);
    expect(await headsOfTheAnswer(opened)).toBe(1);
  });

  it.skipIf(store.skipped)('is handed the kept output of a workflow it called, handed a kept answer', async () => {
    const server = await playbookOn(await store.open());
    const runId = await started(server, 'calling');

    await answeredOnce(server, 1);

    expect(await server.settled(runId)).toMatchObject({
      status: 'succeeded',
      output: { length: notes.length, choice: 'approve' },
    });
  });

  it.skipIf(store.skipped)('keeps the same answer once for two runs, each of whose logs holds it', async () => {
    const opened = await store.open();
    const server = await playbookOn(opened);
    const runs = [await started(server, 'waiting'), await started(server, 'waiting')];

    await answeredAndHeld(opened, server, 2);
    await Promise.all(runs.map((runId) => eventSent(server, runId)));

    expect(await Promise.all(runs.map((runId) => server.settled(runId)))).toMatchObject([
      succeededWithTheAnswer,
      succeededWithTheAnswer,
    ]);
    expect(await headsOfTheAnswer(opened)).toBe(1);
  });
});

describe.each(stores)('a run that keeps values outside, across a restart, on $name', (store) => {
  it.skipIf(store.skipped)('reads the kept answer back once the server that held it stopped', async () => {
    const opened = await store.open();
    const { server, runId } = await waitingWithItsAnswerKept(opened);
    await server.stop();

    const second = await servedOn(opened);
    await eventSent(second, runId);

    expect(await second.settled(runId)).toMatchObject(succeededWithTheAnswer);
  });

  it.skipIf(store.skipped)('goes on with payloads no longer kept outside, its log at format 12', async () => {
    const opened = await store.open();
    const { server, runId } = await waitingWithItsAnswerKept(opened);
    await server.stop();

    const switchedOff = await servedOn(opened, false);
    await eventSent(switchedOff, runId);

    expect(await switchedOff.settled(runId)).toMatchObject(succeededWithTheAnswer);
    expect(await formatsOf(opened, runId)).toEqual([12, 12, 12]);
  });
});

describe.each(stores)('a run of a playbook that turned keeping on, or lost a kept value, on $name', (store) => {
  it.skipIf(store.skipped)('finishes a run begun at format 11, and starts a new one at 12', async () => {
    const opened = await store.open();
    const first = await playbookOn(opened, false);
    const earlier = await started(first, 'waiting');
    await answeredOnce(first, 1);
    await first.stop();

    const keeping = await servedOn(opened);
    await eventSent(keeping, earlier);
    const later = await started(keeping, 'waiting');
    await answeredAndHeld(opened, keeping, 1);
    await eventSent(keeping, later);

    expect([await keeping.settled(earlier), await keeping.settled(later)]).toMatchObject([
      succeededWithTheAnswer,
      succeededWithTheAnswer,
    ]);
    expect([(await formatsOf(opened, earlier))[0], (await formatsOf(opened, later))[0]]).toEqual([11, 12]);
  });

  it.skipIf(store.skipped)('ends rejected when the kept answer is gone from the store', async () => {
    const opened = await store.open();
    const { server, runId } = await waitingWithItsAnswerKept(opened);
    await server.stop();

    const second = await servedOn(opened);
    await opened.rows(`DELETE FROM recorded_content_heads WHERE sha256 = '${answerDigest}'`);
    await eventSent(second, runId);

    expect(await second.settled(runId)).toMatchObject({ status: 'rejected', rejection: { reason: 'unavailable' } });
  });

  it.skipIf(store.skipped)(
    'does not start again once the kept answer is gone from its store, and says so',
    async () => {
      const opened = await store.open();
      const { server } = await waitingWithItsAnswerKept(opened);
      await server.stop();
      await opened.rows(`DELETE FROM recorded_content_heads WHERE sha256 = '${answerDigest}'`);

      await expect(servedOn(opened)).rejects.toThrow(
        /its records name content this server cannot find\. Content is kept in the ledger's database, since CONTENT_STORE_URL is not set, but 1 of the \d+ it looked for is not there/u,
      );
    },
  );
});

describe.each(stores)('a trigger, a listener and a page given the output a run keeps outside, on $name', (store) => {
  it.skipIf(store.skipped)(
    'starts the trigger’s workflow and wakes the listening run with the whole output',
    async () => {
      const opened = await store.open();
      const server = await playbookOn(opened);
      await reactingToTheReview(server);
      const listening = await started(server, 'listening');
      const waiting = await started(server, 'waiting');

      await answeredAndHeld(opened, server, 1);
      await eventSent(server, waiting);

      expect(await server.settled(await endedRunOf(server, 'on-review'))).toMatchObject({
        status: 'succeeded',
        output: { length: notes.length },
      });
      expect(await server.settled(listening)).toMatchObject({ status: 'succeeded', output: { length: notes.length } });
    },
  );

  it.skipIf(store.skipped)(
    'folds the whole output into a page’s view, as it does where the output is inline',
    async () => {
      expect([
        await postsDraftedOnThePage(await store.open(), true),
        await postsDraftedOnThePage(await store.open(), false),
      ]).toEqual(['Since it began, 3 posts were drafted.', 'Since it began, 3 posts were drafted.']);
    },
  );
});
