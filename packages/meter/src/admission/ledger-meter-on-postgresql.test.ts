import { plainPoolsOn, postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { postgresqlDatabaseOn } from '@on.auto/ledger/postgresql-testing';
import { Client } from 'pg';
import { describe } from 'vitest';

import { meterOnADatabaseBehaviour } from '../meter-testing/meter-behaviour.ts';
import type { LedgerAt } from '../testing/ledgers.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

async function postgresqlLedger(): Promise<LedgerAt> {
  const { url, remove } = await postgresqlDatabaseOn(server);
  return {
    name: 'PostgreSQL',
    layer: () => postgresqlLedgerLayer({ pools: plainPoolsOn(url) }),
    rows: async (statement, values = []) => {
      const client = new Client({ connectionString: url });
      await client.connect();
      try {
        let place = 0;
        const numbered = statement.replaceAll('?', () => {
          place += 1;
          return `$${place}`;
        });
        return (await client.query<Readonly<Record<string, unknown>>>(numbered, [...values])).rows;
      } finally {
        await client.end();
      }
    },
    dataOf: (stored) => {
      const data: unknown = JSON.parse(String(Reflect.get(new Object(stored), 'json')));
      return data;
    },
    stored: (data) => JSON.stringify({ json: JSON.stringify(data) }),
    unreadable: JSON.stringify({ json: '{not json' }),
    remove,
  };
}

describe.skipIf(server === '')('with PostgreSQL', () => {
  meterOnADatabaseBehaviour('PostgreSQL', postgresqlLedger);
});
