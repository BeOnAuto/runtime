import { dumbo } from '@event-driven-io/dumbo';
import { Effect } from 'effect';

import { sqliteEventStore, type AnyDriver, type SQLiteStoreOptions } from '../sqlite-event-store.ts';
import { receivedWebhooksOn, type ReceivedWebhooks } from './received-webhooks.ts';

export function sqliteReceivedWebhooksOn<Driver extends AnyDriver>(
  optionsOf: () => SQLiteStoreOptions<Driver>,
): Effect.Effect<ReceivedWebhooks> {
  return Effect.promise(async () => {
    const options = optionsOf();
    const pool = dumbo({ serialization: options.serialization, ...options.driver.mapToDumboOptions(options) });
    const store = sqliteEventStore(() => ({ ...options, pool }));
    await store.migrate();
    return receivedWebhooksOn(pool.execute, () => store.close());
  });
}
