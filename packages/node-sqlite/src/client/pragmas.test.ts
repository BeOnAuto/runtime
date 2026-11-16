import { DEFAULT_SQLITE_PRAGMA_OPTIONS } from '@event-driven-io/dumbo/sqlite';
import { describe, expect, it } from 'vitest';

import { pragmasOf } from './pragmas.ts';

describe('the pragmas of a connection', () => {
  it('are the library’s defaults when nothing is given', () => {
    expect(DEFAULT_SQLITE_PRAGMA_OPTIONS).toMatchObject({ busy_timeout: 5000, journal_mode: 'WAL' });
    expect(pragmasOf('/a/ledger.db')).toEqual({
      busyTimeout: 5000,
      ofTheConnection: [
        { pragma: 'synchronous', value: 'NORMAL' },
        { pragma: 'cache_size', value: -1_000_000 },
        { pragma: 'foreign_keys', value: 'ON' },
        { pragma: 'temp_store', value: 'MEMORY' },
        { pragma: 'mmap_size', value: 268_435_456 },
      ],
      journalMode: 'WAL',
    });
  });

  it('take what a connection string names over the defaults, and what is given over both', () => {
    const pragmas = pragmasOf('file:/a/ledger.db?cache_size=-2000&foreign_keys=off&journal_mode=DELETE', {
      cache_size: -8192,
      mmap_size: 0,
      busy_timeout: 0,
    });

    expect(pragmas).toEqual({
      busyTimeout: 0,
      ofTheConnection: [
        { pragma: 'synchronous', value: 'NORMAL' },
        { pragma: 'cache_size', value: -8192 },
        { pragma: 'foreign_keys', value: 'OFF' },
        { pragma: 'temp_store', value: 'MEMORY' },
        { pragma: 'mmap_size', value: 0 },
      ],
      journalMode: 'DELETE',
    });
  });
});
