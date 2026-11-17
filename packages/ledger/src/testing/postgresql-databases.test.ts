import { describe, expect, it } from 'vitest';

import { postgresqlDatabasesOn, postgresqlSkipNotice } from './postgresql-databases.ts';

describe('the databases of the tests on PostgreSQL, without a server', () => {
  const { skipped, notice } = postgresqlDatabasesOn('');

  it('are skipped, saying which variable runs them', () => {
    expect({ skipped, notice }).toEqual({ skipped: true, notice: postgresqlSkipNotice });
  });
});
