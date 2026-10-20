import { plainPoolsOn, type PoolBounds } from '@on.auto/ledger/postgresql';
import { unreachableDatabase } from '@on.auto/ledger/testing';
import { sha256Of } from '@on.auto/operations';
import { Effect, Logger, type Context } from 'effect';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { readSettings } from '../settings/settings.ts';
import { secretsKey } from '../testing/databases/secrets-key.ts';
import { messagesOf } from '../testing/processes/stderr-lines.ts';
import { ledgerStoresOpenedBy } from './ledger-stores.ts';

async function aContextLogging(): Promise<{ readonly context: Context.Context<never>; readonly lines: string[] }> {
  const lines: string[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    lines.push(line);
  });
  const context = await Effect.runPromise(Effect.context().pipe(Effect.provide(Logger.layer([capture]))));
  return { context, lines };
}

describe('the stores of a ledger in PostgreSQL, as the server opens them, without a database', () => {
  it('open the secret store on a pool of two connections of its own, which nothing reaches without a previous key, and end it once the work stops', async () => {
    const { url, port } = await unreachableDatabase();
    const { context, lines } = await aContextLogging();
    const bounds: number[] = [];
    const endedYet: (() => boolean)[] = [];
    const stopped: string[] = [];
    const recordedPools = ({ max }: PoolBounds): Pool => {
      const pool = plainPoolsOn(url)({ max });
      bounds.push(max);
      endedYet.push(() => pool.ended);
      return pool;
    };

    const stores = await ledgerStoresOpenedBy(context, readSettings({ DATABASE_URL: url, SECRETS_KEY: secretsKey }), {
      store: 'postgresql',
      pools: recordedPools,
    });
    const served = stores.withSecretsClosed({
      routes: [],
      stopWork: () => {
        stopped.push('the work');
        return Promise.resolve();
      },
    });
    await served.stopWork();

    expect(messagesOf(lines.join('\n'))).toEqual([
      `The ledger is kept in PostgreSQL, in the database playbooks on 127.0.0.1:${port}`,
      "Content is kept in the ledger's database",
      `Secrets are kept in the ledger's database, sealed under the key ${sha256Of(Buffer.from(secretsKey, 'base64')).slice(0, 16)} that SECRETS_KEY holds, and 0 sealed under the previous key were sealed again under it`,
    ]);
    expect({ bounds, ended: endedYet.map((ended) => ended()) }).toEqual({ bounds: [2], ended: [true] });
    expect(stopped).toEqual(['the work']);
  });
});
