import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { textToKeep } from '@on.auto/operations';
import { Effect, Layer, Logger } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { sqliteLedgerOpened } from '../connection/sqlite-opening.ts';
import { ledgerLayerOver } from '../ledger-layer.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { until } from '../testing/until.ts';
import { sweptHourly, unnamedChunksLastMs, type ContentSweeping } from './content-sweep.ts';

interface Sweeps extends ContentSweeping {
  readonly asked: readonly number[];
}

function sweepsFailingAt(failing: number): Sweeps {
  const asked: number[] = [];
  return {
    asked,
    sweepContent: (before) => {
      asked.push(before);
      return asked.length === failing ? Promise.reject(new Error('The database went away')) : Promise.resolve();
    },
  };
}

function capturing() {
  const logged: string[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    logged.push(line);
  });
  return { logged, layer: Logger.layer([capture]) };
}

const anHour = unnamedChunksLastMs;

const couldNotSweep =
  'The ledger could not sweep what puts that never finished left of their content; it sweeps again in an hour';

describe('the sweep of the chunks no head names', () => {
  it('runs at once and then every hour, sweeping what an hour has left, and logs a first sweep that fails and goes on', async () => {
    const sweeps = sweepsFailingAt(1);
    const { logged, layer } = capturing();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* TestClock.setTime(10 * anHour);
          yield* sweptHourly(sweeps);
          yield* TestClock.adjust('1 hour');
          yield* TestClock.adjust('1 hour');
        }),
      ).pipe(Effect.provide(Layer.merge(TestClock.layer(), layer))),
    );

    expect(sweeps.asked).toEqual([9 * anHour, 10 * anHour, 11 * anHour]);
    expect(logged).toEqual([expect.stringContaining(couldNotSweep)]);
    expect(logged[0]).toContain('The database went away');
  });

  it('never holds the ledger back from opening, though its first sweep fails', async () => {
    const sweeps = sweepsFailingAt(1);
    const { logged, layer } = capturing();
    const opened = () => {
      const { store, connection } = sqliteLedgerOpened({
        optionsOf: () => ({ driver: sqlite3EventStoreDriver, fileName: ':memory:' }),
        inMemory: true,
      });
      return { store: { ...store, sweepContent: sweeps.sweepContent }, connection };
    };
    const { ledger, dispose } = await openLedgerWith(ledgerLayerOver(opened).pipe(Layer.provide(layer)));
    onTestFinished(dispose);

    const kept = await Effect.runPromise(
      ledger.content.put({ org: 'acme', playbook: 'alpha' }, textToKeep('{}', 'application/json')),
    );

    expect(kept).toMatchObject({ bytes: 2, mediaType: 'application/json' });
    await until(() => {
      expect(logged).toEqual([expect.stringContaining(couldNotSweep)]);
    });
  });
});
