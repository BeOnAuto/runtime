import { Conflict } from '@on.auto/operations';
import { Function, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { EncodedEvent, LedgerStore } from '../index.ts';
import { at } from '../multi-stream/multi-stream-cases.ts';
import { postgresqlEventStore } from '../postgresql/postgresql-ledger.ts';
import { postgresqlConnected, postgresqlDatabasesOn } from '../testing/postgresql-databases.ts';
import { aStatementGate, type StatementGate } from '../testing/statement-gate.ts';
import type { DefinitionNames } from './definition-names.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase: aDatabase } = postgresqlDatabasesOn(server);

const Claimed = Schema.Struct({ definition: Schema.String, name: Schema.String });

const claimedBy = Schema.decodeUnknownSync(Claimed);

const alpha = 'playbook/acme/alpha/';

const sharingOneStream: DefinitionNames = {
  types: ['claimed'],
  holdsNames: () => true,
  definitionKeyOf: ({ data }) => `definition/acme/${claimedBy(data).definition}/`,
  nameAfter: (_held, { data }) => ({
    playbookKey: alpha,
    definitionType: 'reasoning',
    name: claimedBy(data).name,
    status: 'active',
    hasTriggers: false,
  }),
  takenBy: () => new Conflict({ detail: 'The name is taken', kind: 'taken' }),
};

function claim(definition: string, name: string): EncodedEvent {
  return { type: 'claimed', data: { definition, name } };
}

async function aStoreOn(database: string, gate: StatementGate): Promise<LedgerStore> {
  const store = postgresqlEventStore({
    pools: gate.pools(database),
    reportLostConnection: Function.constVoid,
    definitionNames: sharingOneStream,
  });
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

const locksInTheirOrder = [
  ['definition a', 'definition/acme/a/'],
  ['definition b', 'definition/acme/b/'],
  ['name x', `${alpha}reasoning/x`],
  ['name y', `${alpha}reasoning/y`],
] as const;

async function heldNow(database: string): Promise<readonly boolean[]> {
  const probing = await postgresqlConnected(database);
  const { rows } = await probing.query<{ readonly free: boolean }>(
    `SELECT pg_try_advisory_lock(hashtextextended(lock, 0)) AS free
      FROM unnest($1::text[]) WITH ORDINALITY AS locks (lock, place) ORDER BY place`,
    [locksInTheirOrder.map(([, key]) => `definition_names_1:${key}`)],
  );
  await probing.query('SELECT pg_advisory_unlock_all()');
  return rows.map(({ free }) => !free);
}

describe.skipIf(skipped)(`The names of definitions on PostgreSQL${notice}`, () => {
  it.each(locksInTheirOrder.map(([lock, key], index) => [lock, key, index] as const))(
    'locks every definition of an append and then every name it claims, each in their order, whatever the order of its facts: when it asks for %s, it holds every lock before it and none after',
    async (_lock, key, index) => {
      const database = await aDatabase();
      const gate = aStatementGate();
      const store = await aStoreOn(database, gate);
      const asking = gate.stopBefore(`definition_names_1:${key}`);

      const appending = store.append(
        'playbook/acme/alpha/definitions/reasoning',
        [claim('b', 'y'), claim('a', 'x')],
        at(0),
      );
      await asking.reached;
      const held = await heldNow(database);
      asking.go();
      await appending;

      expect(held).toEqual(locksInTheirOrder.map((_, before) => before < index));
    },
  );
});
