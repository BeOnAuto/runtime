import { dumbo } from '@event-driven-io/dumbo';
import type { SecretRows } from '@on.auto/secrets';
import { Effect } from 'effect';

import { sqliteEventStore, type AnyDriver, type SQLiteStoreOptions } from '../sqlite-event-store.ts';
import { secretRowsOn } from './secret-rows.ts';

export interface SecretRowsOptions {
  readonly fileName: string;
}

export function sqliteSecretRowsOn<Driver extends AnyDriver>(
  optionsOf: () => SQLiteStoreOptions<Driver>,
): Effect.Effect<SecretRows> {
  return Effect.promise(async () => {
    const options = optionsOf();
    const pool = dumbo({ serialization: options.serialization, ...options.driver.mapToDumboOptions(options) });
    const store = sqliteEventStore(() => ({ ...options, pool }));
    await store.migrate();
    return secretRowsOn(pool.execute, () => store.close());
  });
}
