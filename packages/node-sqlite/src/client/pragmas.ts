import {
  DEFAULT_SQLITE_PRAGMA_OPTIONS,
  parsePragmasFromConnectionString,
  type SQLitePragmaOptions,
} from '@event-driven-io/dumbo/sqlite';

export interface Pragma {
  readonly pragma: string;
  readonly value: string | number | undefined;
}

export interface Pragmas {
  readonly busyTimeout: number;
  readonly ofTheConnection: readonly Pragma[];
  readonly journalMode: string | undefined;
}

const unlessABusyTimeoutIsGiven = { busy_timeout: 0 };

export function pragmasOf(location: string, given: Readonly<Partial<SQLitePragmaOptions>> = {}): Pragmas {
  const pragmas = {
    ...unlessABusyTimeoutIsGiven,
    ...DEFAULT_SQLITE_PRAGMA_OPTIONS,
    ...parsePragmasFromConnectionString(location),
    ...given,
  };
  return {
    busyTimeout: pragmas.busy_timeout,
    ofTheConnection: [
      { pragma: 'synchronous', value: pragmas.synchronous },
      { pragma: 'cache_size', value: pragmas.cache_size },
      { pragma: 'foreign_keys', value: pragmas.foreign_keys === true ? 'ON' : 'OFF' },
      { pragma: 'temp_store', value: pragmas.temp_store },
      { pragma: 'mmap_size', value: pragmas.mmap_size },
    ],
    journalMode: pragmas.journal_mode,
  };
}
