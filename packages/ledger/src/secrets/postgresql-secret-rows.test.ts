import { Effect, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { until } from '../testing/until.ts';
import { postgresqlSecretRows, type SecretConnections } from './postgresql-secret-rows.ts';

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

const heldRow = { kept_by: 'ledger', held: 'held-1', wrapped_key: 'wrapped-1', kid: 'kid-a' };

function rowsAnswering(text: string): readonly unknown[] {
  if (text.startsWith('SELECT kept_by')) {
    return [{ ...heldRow, version: 1, claimed_until: null }];
  }
  if (text.startsWith('SELECT id, version')) {
    return [{ ...heldRow, id: 'secret-1', version: 2 }];
  }
  return text.startsWith('DELETE') ? [heldRow] : [];
}

function connectionsAnsweringOneRow(): FakeConnections {
  const asked: Asked[] = [];
  const bounds: number[] = [];
  const listeners: ((error: Readonly<Error>) => void)[] = [];
  let ended = 0;
  const connections: SecretConnections = {
    query: (text, values) => {
      asked.push({ text, values });
      return Promise.resolve({ rows: rowsAnswering(text) });
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

const holding = { keptBy: 'ledger', held: 'held-1', wrappedKey: 'wrapped-1', kid: 'kid-a' };

function statementsOf(asked: readonly Asked[]): readonly string[] {
  return asked.map(({ text }) => text.replaceAll(/\s+/gu, ' '));
}

describe('the rows of the secret store on PostgreSQL, without a database', () => {
  it('keep, read and forget a row on a pool of two connections of their own, binding every value', async () => {
    const fake = connectionsAnsweringOneRow();

    const rows = await Effect.runPromise(postgresqlSecretRows({ pools: fake.pools }));
    await Effect.runPromise(rows.keep('secret-1', holding));
    const read = await Effect.runPromise(rows.read('secret-1'));
    const forgotten = await Effect.runPromise(rows.forget('secret-1'));
    await rows.close();

    expect(fake.bounds).toEqual([2]);
    expect({ read, forgotten }).toEqual({ read: { holding, version: 1, claimedUntil: undefined }, forgotten: holding });
    expect(statementsOf(fake.asked)).toEqual([
      'INSERT INTO kept_secrets (id, version, kept_at, ends_with, kept_by, held, wrapped_key, kid) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      'SELECT kept_by, held, wrapped_key, kid, version, CASE WHEN claimed_until IS NOT NULL AND claimed_until > $1 THEN claimed_until END AS claimed_until FROM kept_secrets WHERE id = $2',
      'DELETE FROM kept_secrets WHERE id = $1 RETURNING kept_by, held, wrapped_key, kid',
    ]);
    expect(fake.asked[0]?.values).toEqual([
      'secret-1',
      1,
      expect.any(String),
      null,
      'ledger',
      'held-1',
      'wrapped-1',
      'kid-a',
    ]);
    expect(fake.ended()).toBe(1);
  });

  it('log a connection their pool loses as a lost connection of the ledger, through the loggers they were opened with', async () => {
    const logged: string[] = [];
    const capture = Logger.map(Logger.formatJson, (line: string) => {
      logged.push(line);
    });
    const fake = connectionsAnsweringOneRow();
    await Effect.runPromise(postgresqlSecretRows({ pools: fake.pools }).pipe(Effect.provide(Logger.layer([capture]))));

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
    const fake = connectionsAnsweringOneRow();

    const rows = await Effect.runPromise(postgresqlSecretRows({ pools: fake.pools }));
    const replaced = await Effect.runPromise(rows.replace('secret-1', 1, holding));
    const claimed = await Effect.runPromise(rows.claim('secret-1', 1, 30_000));

    expect({ replaced, claimed }).toEqual({ replaced: { replaced: false }, claimed: { claimed: false } });
    expect(statementsOf(fake.asked)).toEqual([
      'UPDATE kept_secrets SET kept_by = $1, held = $2, wrapped_key = $3, kid = $4, version = version + 1, kept_at = $5, claimed_until = NULL, ends_with = NULL WHERE id = $6 AND version = $7 RETURNING version',
      'UPDATE kept_secrets SET claimed_until = $1 WHERE id = $2 AND version = $3 AND NOT (claimed_until IS NOT NULL AND claimed_until > $4) RETURNING id',
    ]);
    expect(fake.asked.map(({ values }) => values)).toEqual([
      ['ledger', 'held-1', 'wrapped-1', 'kid-a', expect.any(String), 'secret-1', 1],
      [expect.any(String), 'secret-1', 1, expect.any(String)],
    ]);
  });

  it('is read for the start by its keeper and kid, and held again only while its version and its holding are the ones read', async () => {
    const fake = connectionsAnsweringOneRow();
    const rows = await Effect.runPromise(postgresqlSecretRows({ pools: fake.pools }));

    const [read] = await Effect.runPromise(rows.heldBy({ keptBy: 'ledger', kid: 'kid-a' }, 100));
    const reheld = await Effect.runPromise(
      rows.reheld({ id: 'secret-1', version: 2, holding }, { ...holding, wrappedKey: 'wrapped-2', kid: 'kid-b' }),
    );

    expect({ read, reheld }).toEqual({ read: { id: 'secret-1', version: 2, holding }, reheld: false });
    expect(statementsOf(fake.asked)).toEqual([
      'SELECT id, version, kept_by, held, wrapped_key, kid FROM kept_secrets WHERE kept_by = $1 AND kid = $2 ORDER BY id LIMIT $3',
      "UPDATE kept_secrets SET kept_by = $1, held = $2, wrapped_key = $3, kid = $4 WHERE id = $5 AND version = $6 AND kept_by = $7 AND held = $8 AND COALESCE(wrapped_key, '') = $9 AND COALESCE(kid, '') = $10 RETURNING id",
    ]);
    expect(fake.asked.map(({ values }) => values)).toEqual([
      ['ledger', 'kid-a', 100],
      ['ledger', 'held-1', 'wrapped-2', 'kid-b', 'secret-1', 2, 'ledger', 'held-1', 'wrapped-1', 'kid-a'],
    ]);
  });
});
