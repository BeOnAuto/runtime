import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { textToKeep } from '@on.auto/operations';
import { Effect, Logger } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { sqliteLedgerOpened } from '../connection/sqlite-opening.ts';
import { ledgerLayerOver } from '../ledger-layer.ts';
import { openChoresWith } from '../testing/open-ledger.ts';
import { orphansSweptOf, unnamedChunksLastMs, type ContentSweeping } from './content-sweep.ts';

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
  it('sweeps what an hour has left at the time it is called, answers that it is due an hour on, and logs a sweep that fails and goes on', async () => {
    const sweeps = sweepsFailingAt(1);
    const { logged, layer } = capturing();
    const sweptAt = (now: number) => Effect.runPromise(orphansSweptOf(sweeps)(now).pipe(Effect.provide(layer)));

    const first = await sweptAt(10 * anHour);
    const second = await sweptAt(first);
    const third = await sweptAt(second);

    expect([first, second, third]).toEqual([11 * anHour, 12 * anHour, 13 * anHour]);
    expect(sweeps.asked).toEqual([9 * anHour, 10 * anHour, 11 * anHour]);
    expect(logged).toEqual([expect.stringContaining(couldNotSweep)]);
    expect(logged[0]).toContain('The database went away');
  });

  it('runs on no clock of the ledger, which sweeps nothing as it opens or keeps content, and sweeps once its chore is called', async () => {
    const sweeps = sweepsFailingAt(0);
    const opened = () => {
      const { store, connection } = sqliteLedgerOpened({
        optionsOf: () => ({ driver: sqlite3EventStoreDriver, fileName: ':memory:' }),
        inMemory: true,
      });
      return { store: { ...store, sweepContent: sweeps.sweepContent }, connection };
    };
    const { ledger, sweptAt, dispose } = await openChoresWith(ledgerLayerOver(opened));
    onTestFinished(dispose);

    const kept = await Effect.runPromise(
      ledger.content.put({ org: 'acme', playbook: 'alpha' }, textToKeep('{}', 'application/json')),
    );
    const before = [...sweeps.asked];
    await sweptAt(5 * anHour);

    expect(kept).toMatchObject({ bytes: 2, mediaType: 'application/json' });
    expect([before, sweeps.asked]).toEqual([[], [4 * anHour]]);
  });
});
