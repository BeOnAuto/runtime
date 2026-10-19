import { Effect, Logger, Redacted } from 'effect';
import { decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';

import { until } from '../testing/until.ts';
import { postgresqlSecretStore, type SecretConnections } from './postgresql-secret-store.ts';

interface Asked {
  readonly text: string;
  readonly values: readonly unknown[];
}

interface FakeConnections {
  readonly pools: (bounds: { readonly max: number }) => SecretConnections;
  readonly asked: readonly Asked[];
  readonly bounds: readonly number[];
  readonly lose: (error: Readonly<Error>) => void;
  readonly ended: () => number;
}

function rowsAnswering(text: string, kept: readonly unknown[]): readonly unknown[] {
  if (text.startsWith('SELECT sealed')) {
    return kept.map((sealed) => ({ sealed, version: 1, claimed_until: null }));
  }
  return text.startsWith('SELECT id, sealed, version')
    ? kept.map((sealed) => ({ id: 'secret-1', sealed, version: 2 }))
    : [];
}

function connectionsKeepingWhatTheyAreGiven(): FakeConnections {
  const asked: Asked[] = [];
  const bounds: number[] = [];
  const listeners: ((error: Readonly<Error>) => void)[] = [];
  const kept: unknown[] = [];
  let ended = 0;
  const connections: SecretConnections = {
    query: (text, values) => {
      asked.push({ text, values });
      kept.push(...(text.startsWith('INSERT') ? [values[2]] : []));
      return Promise.resolve({ rows: rowsAnswering(text, kept) });
    },
    on: (_event, listener) => {
      listeners.push(listener);
    },
    end: () => {
      ended += 1;
      return Promise.resolve();
    },
  };
  return {
    pools: ({ max }) => {
      bounds.push(max);
      return connections;
    },
    asked,
    bounds,
    lose: (error) => {
      listeners.forEach((listener) => {
        listener(error);
      });
    },
    ended: () => ended,
  };
}

const keys = { current: Redacted.make(new Uint8Array(32).fill(5)) };

function revealed(read: Redacted.Redacted | undefined): string | undefined {
  return read === undefined ? read : Redacted.value(read);
}

function statementsOf(asked: readonly Asked[]): readonly string[] {
  return asked.map(({ text }) => text.replaceAll(/\s+/gu, ' '));
}

describe('the secret store on PostgreSQL, without a database', () => {
  it('keeps, reads and forgets a secret on a pool of two connections of its own, binding every value', async () => {
    const fake = connectionsKeepingWhatTheyAreGiven();

    const store = await Effect.runPromise(postgresqlSecretStore({ pools: fake.pools, keys }));
    const id = await Effect.runPromise(store.keep(Redacted.make('pasted-key')));
    const read = await Effect.runPromise(store.read(id));
    await Effect.runPromise(store.forget(id));
    await store.close();

    expect(fake.bounds).toEqual([2]);
    expect(revealed(read?.value)).toBe('pasted-key');
    expect(statementsOf(fake.asked)).toEqual([
      'INSERT INTO sealed_secrets (id, kid, sealed, version, kept_at, ends_with) VALUES ($1, $2, $3, $4, $5, $6)',
      'SELECT sealed, version, CASE WHEN claimed_until IS NOT NULL AND claimed_until > $1 THEN claimed_until END AS claimed_until FROM sealed_secrets WHERE id = $2',
      'DELETE FROM sealed_secrets WHERE id = $1',
    ]);
    expect(fake.asked[0]?.values).toEqual([id, store.kid, expect.any(String), 1, expect.any(String), null]);
    expect(decodeProtectedHeader(String(fake.asked[0]?.values[2]))).toMatchObject({ kid: store.kid });
    expect(JSON.stringify(fake.asked)).not.toContain('pasted-key');
    expect(fake.ended()).toBe(1);
  });

  it('logs a connection its pool loses as a lost connection of the ledger, through the loggers it was opened with', async () => {
    const logged: string[] = [];
    const capture = Logger.map(Logger.formatJson, (line: string) => {
      logged.push(line);
    });
    const fake = connectionsKeepingWhatTheyAreGiven();
    await Effect.runPromise(
      postgresqlSecretStore({ pools: fake.pools, keys }).pipe(Effect.provide(Logger.layer([capture]))),
    );

    fake.lose(new Error('terminating connection due to administrator command'));

    await until(() => {
      expect(logged).toEqual([
        expect.stringContaining(
          '{"message":"A connection to the PostgreSQL database of the ledger was lost; the ledger opens another when it needs one","level":"WARN"',
        ),
      ]);
    });
    expect(logged[0]).toContain('"annotations":{"error":"terminating connection due to administrator command"}');
  });
});

describe('a row of the secret store on PostgreSQL, without a database', () => {
  it('is replaced and claimed in one conditional update each, binding every value', async () => {
    const fake = connectionsKeepingWhatTheyAreGiven();

    const store = await Effect.runPromise(postgresqlSecretStore({ pools: fake.pools, keys }));
    const replaced = await Effect.runPromise(store.replace('secret-1', 1, Redacted.make('replacing-key')));
    const claimed = await Effect.runPromise(store.claim('secret-1', 1, 30_000));
    await store.close();

    expect({ replaced, claimed }).toEqual({ replaced: { replaced: false }, claimed: { claimed: false } });
    expect(statementsOf(fake.asked)).toEqual([
      'UPDATE sealed_secrets SET kid = $1, sealed = $2, version = version + 1, kept_at = $3, claimed_until = NULL, ends_with = NULL WHERE id = $4 AND version = $5 RETURNING version',
      'UPDATE sealed_secrets SET claimed_until = $1 WHERE id = $2 AND version = $3 AND NOT (claimed_until IS NOT NULL AND claimed_until > $4) RETURNING id',
    ]);
    expect(fake.asked.map(({ values }) => values)).toEqual([
      [store.kid, expect.any(String), expect.any(String), 'secret-1', 1],
      [expect.any(String), 'secret-1', 1, expect.any(String)],
    ]);
    expect(JSON.stringify(fake.asked)).not.toContain('replacing-key');
  });

  it('is sealed again under the current key only while it holds the version the rotation read', async () => {
    const previous = Redacted.make(new Uint8Array(32).fill(6));
    const fake = connectionsKeepingWhatTheyAreGiven();
    const sealing = await Effect.runPromise(postgresqlSecretStore({ pools: fake.pools, keys: { current: previous } }));
    await Effect.runPromise(sealing.keep(Redacted.make('pasted-key')));
    const rotating = await Effect.runPromise(postgresqlSecretStore({ pools: fake.pools, keys: { ...keys, previous } }));

    const resealed = await Effect.runPromise(rotating.rotated());

    expect(resealed).toBe(0);
    expect(statementsOf(fake.asked.slice(1))).toEqual([
      'SELECT id, sealed, version FROM sealed_secrets WHERE kid = $1 ORDER BY id LIMIT $2',
      'UPDATE sealed_secrets SET kid = $1, sealed = $2 WHERE id = $3 AND kid = $4 AND version = $5 RETURNING id',
    ]);
    expect(fake.asked[2]?.values).toEqual([rotating.kid, expect.any(String), 'secret-1', sealing.kid, 2]);
  });
});
