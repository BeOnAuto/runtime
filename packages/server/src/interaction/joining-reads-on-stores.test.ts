import { randomUUID } from 'node:crypto';

import { conversations, openRequests } from '@on.auto/interaction';
import {
  answererId,
  chatHarness,
  farAhead,
  flatReplies,
  threadDocument,
  type ChatHarness,
  type HarnessLedger,
} from '@on.auto/interaction/testing';
import { plainPoolsOn, postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { Ledger } from '@on.auto/operations';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const projections = [openRequests, conversations];

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
  return opened(ledgerLayer({ fileName: ledger.fileName, projections }));
}

async function onPostgreSQL(): Promise<HarnessLedger> {
  const name = `joining_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(() => administer(`DROP DATABASE ${name} WITH (FORCE)`));
  const url = new URL(postgresql);
  url.pathname = `/${name}`;
  return opened(postgresqlLedgerLayer({ pools: plainPoolsOn(url.href), projections }));
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

interface ToolCall {
  readonly reference: { readonly tool: string };
}

const first = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const second = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

const channel = '#approvals-sales';

function onceDuringARead(join: () => Promise<void>): (call: ToolCall) => Effect.Effect<void> {
  const pending = { join };
  return ({ reference }) => {
    if (reference.tool !== 'thread_replies') {
      return Effect.void;
    }
    const now = pending.join;
    pending.join = () => Promise.resolve();
    return Effect.promise(now);
  };
}

function secondDeliveredDuringARead() {
  const held: { playbook: ChatHarness | undefined } = { playbook: undefined };
  const join = async () => {
    if (held.playbook !== undefined) {
      await held.playbook.askInThread(second);
      await held.playbook.performDue(Date.now());
    }
  };
  return {
    duringCall: onceDuringARead(join),
    hold: (playbook: ChatHarness) => {
      held.playbook = playbook;
    },
  };
}

describe.each(stores)('a conversation read on $store', ({ skipped, aLedger }) => {
  it.skipIf(skipped)('a delivery joining while a read is in flight is read', async () => {
    const meanwhile = secondDeliveredDuringARead();
    const playbook = await chatHarness({
      ledger: await aLedger(),
      document: threadDocument({ replies: flatReplies }),
      duringCall: meanwhile.duringCall,
    });
    meanwhile.hold(playbook);
    await playbook.askInThread(first);
    await playbook.performDue(Date.now());
    playbook.chat.reply({ channel, user: answererId, text: 'approve' });

    await playbook.performReads(Date.now() + farAhead);
    playbook.chat.reply({ channel, user: answererId, text: 'reject' });
    await playbook.performReads(Date.now() + 2 * farAhead);
    await playbook.performDue(Date.now());

    expect([await playbook.runOf(first), await playbook.runOf(second)]).toMatchObject([
      { output: { status: 'succeeded', output: { choice: 'approve' } } },
      { output: { status: 'succeeded', output: { choice: 'reject' } } },
    ]);
  });
});
