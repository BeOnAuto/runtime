import { describe, expect, it, onTestFinished } from 'vitest';

import { openConnection } from '../testing/open-ledger.ts';
import { statement, textOnPostgreSQL } from './statement.ts';

const runKey = 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

describe('a statement beside the ledger', () => {
  it('numbers its values on PostgreSQL, in the order they appear', () => {
    const due = statement`UPDATE workflow_timers SET due_at = ${2000} WHERE run_key = ${runKey} AND timer_id = ${'1'}`;

    expect([textOnPostgreSQL(due), due.values]).toEqual([
      'UPDATE workflow_timers SET due_at = $1 WHERE run_key = $2 AND timer_id = $3',
      [2000, runKey, '1'],
    ]);
  });

  it('binds the same values on SQLite', async () => {
    const { connection, dispose } = await openConnection(':memory:');
    onTestFinished(dispose);

    const rows = await connection.read(statement`SELECT ${7} AS seven, ${null} AS empty`);

    expect(rows).toEqual([{ seven: 7, empty: null }]);
  });
});
