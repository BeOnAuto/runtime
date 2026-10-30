import { randomUUID } from 'node:crypto';

import { openRequests } from '@on.auto/interaction';
import {
  answeringAnyRun,
  askedRunId,
  askedThroughChat,
  attemptedThenStopped,
  broughtBeforeDeciding,
  recordedReply,
  type HarnessLedger,
  type InteractionHarness,
} from '@on.auto/interaction/testing';
import { plainPoolsOn, postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { Ledger } from '@on.auto/operations';
import { Layer, ManagedRuntime } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const days = 24 * 60 * 60_000;

const anyTime: unknown = expect.any(String);

async function administer(statement: string): Promise<void> {
  const client = new Client({ connectionString: postgresql });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function opened(layer: Layer.Layer<Ledger>): Promise<HarnessLedger> {
  const runtime = ManagedRuntime.make(layer);
  onTestFinished(() => runtime.dispose());
  const service = await runtime.runPromise(Ledger);
  return { service, layer: Layer.succeed(Ledger, service) };
}

function onSQLite(): Promise<HarnessLedger> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return opened(ledgerLayer({ fileName: ledger.fileName, projections: [openRequests] }));
}

async function onPostgreSQL(): Promise<HarnessLedger> {
  const name = `crashes_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(() => administer(`DROP DATABASE ${name} WITH (FORCE)`));
  const url = new URL(postgresql);
  url.pathname = `/${name}`;
  return opened(
    postgresqlLedgerLayer({
      pools: plainPoolsOn(url.href),
      projections: [openRequests],
    }),
  );
}

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly aLedger: () => Promise<HarnessLedger>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, aLedger: onSQLite },
  { store: `PostgreSQL${notice}`, skipped: postgresql === '', aLedger: onPostgreSQL },
];

const approved = {
  output: {
    status: 'succeeded',
    output: { choice: 'approve' },
    record: {},
  },
};

function answeredByAReply(playbook: InteractionHarness): Promise<unknown> {
  return recordedReply(playbook.ledger, { choice: 'approve' });
}

describe.each(stores)(
  'a server that stopped between a reply or a delivery and its settlement, on $store',
  ({ skipped, aLedger }) => {
    it.skipIf(skipped)('settles an answer a reply brought from the reply, after the expiry too', async () => {
      const asked = await askedThroughChat({ ledger: await aLedger() });
      await asked.playbook.performDue(asked.askedAt);
      await answeredByAReply(asked.playbook);

      const afterStop = await asked.playbook.firstOpen();
      await asked.playbook.performDue(asked.askedAt + 3 * days);

      expect(afterStop).toBeUndefined();
      expect(await asked.playbook.runOf(askedRunId)).toMatchObject(approved);
      expect(asked.tools.calls()).toHaveLength(1);
    });

    it.skipIf(skipped)('succeeds a delivered notification from the end of its delivery', async () => {
      const asked = await askedThroughChat({ notification: true, ledger: await aLedger() });

      await attemptedThenStopped(asked);
      await asked.playbook.performDue(Date.now());

      expect(await asked.playbook.runOf(askedRunId)).toMatchObject({
        output: { status: 'succeeded', output: {}, record: { delivered_at: anyTime } },
      });
      expect(asked.tools.calls()).toHaveLength(1);
    });
  },
);

describe.each(stores)('a reply taken while another settlement is under way, on $store', ({ skipped, aLedger }) => {
  it.skipIf(skipped)('refuses an answer given meanwhile, and the run settles with the reply’s', async () => {
    const racing = broughtBeforeDeciding(await aLedger(), { choice: 'approve' });
    const asked = await askedThroughChat({ ledger: racing.ledger });
    await racing.started();

    const meanwhile = await asked.playbook.call(answeringAnyRun, {
      run_id: askedRunId,
      answer: { choice: 'reject' },
    });
    await asked.playbook.performDue(Date.now());

    expect(meanwhile).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(await asked.playbook.runOf(askedRunId)).toMatchObject(approved);
  });

  it.skipIf(skipped)('settles a cancel asked after the reply with the reply’s answer', async () => {
    const asked = await askedThroughChat({ ledger: await aLedger() });
    await answeredByAReply(asked.playbook);

    await asked.playbook.cancel(askedRunId);
    await asked.playbook.performDue(Date.now());

    expect(await asked.playbook.runOf(askedRunId)).toMatchObject(approved);
  });
});

describe.each(stores)(
  'a notification delivered while a cancel of its run is under way, on $store',
  ({ skipped, aLedger }) => {
    it.skipIf(skipped)('succeeds as delivered, the cancel reading the run again once it changed', async () => {
      const racing = broughtBeforeDeciding(await aLedger());
      const asked = await askedThroughChat({ notification: true, ledger: racing.ledger });
      await racing.started();

      await asked.playbook.cancel(askedRunId);
      await racing.cancelSettled(asked.playbook.capability);

      expect(await asked.playbook.runOf(askedRunId)).toMatchObject({
        output: { status: 'succeeded', output: {}, record: { delivered_at: anyTime } },
      });
    });
  },
);
