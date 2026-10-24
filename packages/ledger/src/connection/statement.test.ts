import { describe, expect, it, onTestFinished } from 'vitest';

import { ledgerLayer } from '../sqlite3.ts';
import { openConnectionWith } from '../testing/open-ledger.ts';
import { statement, statementOf, textOnPostgreSQL } from './statement.ts';

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
    const { connection, dispose } = await openConnectionWith(ledgerLayer({ fileName: ':memory:' }));
    onTestFinished(dispose);

    const rows = await connection.read(statement`SELECT ${7} AS seven, ${null} AS empty`);

    expect(rows).toEqual([{ seven: 7, empty: null }]);
  });
});

describe('a statement made of the texts between its values', () => {
  it('is the statement the tag makes of the same texts, its values bound in their order', () => {
    const table = 'workflow_timers';
    const made = statementOf([`UPDATE ${table} SET due_at = `, ' WHERE run_key = ', ''], [2000, runKey]);
    const tagged = statement`UPDATE workflow_timers SET due_at = ${2000} WHERE run_key = ${runKey}`;

    expect([textOnPostgreSQL(made), made.values, [...made.strings.raw]]).toEqual([
      textOnPostgreSQL(tagged),
      tagged.values,
      [...tagged.strings.raw],
    ]);
  });
});
