import {
  labelFacts,
  labelRows,
  labelRowsByNote,
  runFacts,
  runTallyRows,
  topicFacts,
  topicRows,
  type TopicFact,
} from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  aLargeStart,
  aLedgerOn,
  bytesOfALargeFact,
  filledMeasured,
  heldOf,
  indexes,
  notedLarge,
  type FillEntry,
} from '../projections/keyed-fill-behaviour.ts';

type AnyLedger = Awaited<ReturnType<typeof aLedgerOn>>;

const autumnOpened: TopicFact = { type: 'topic_opened', data: { topic: 'autumn', at: 1000 } };

function notedOfSizes(ledger: AnyLedger, sizes: readonly number[]): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(
      [autumnOpened, ...sizes.map((bytes, index) => aNoteOf(bytes, index))],
      (fact, index) => ledger.execute(`playbook/acme/alpha/notes/s${index}`, topicFacts, [fact]),
      { discard: true },
    ),
  );
}

function aNoteOf(bytes: number, index: number): TopicFact {
  return { type: 'topic_noted', data: { topic: 'autumn', note: `${index}:${'n'.repeat(bytes)}` } };
}

function labelledTwiceOver(ledger: AnyLedger): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(
      indexes(4),
      (index) =>
        Effect.andThen(
          ledger.execute(`playbook/acme/alpha/notes/l${index}`, labelFacts, [
            { type: 'labels_set', data: { note: `l${index}`, labels: ['urgent'] } },
          ]),
          ledger.execute(`playbook/acme/alpha/runs/r${index}`, runFacts, [aLargeStart(index)]),
        ),
      { discard: true },
    ),
  );
}

function windowsAndReads(entry: FillEntry): void {
  it('lists one fact, then twice as many after each window, as many as fit its bound at the sizes it saw', async () => {
    const database = await entry.aDatabase();
    await notedOfSizes(
      await aLedgerOn(entry, database),
      indexes(299).map(() => 8),
    );

    const { windows } = await filledMeasured(entry, database, { projections: [topicRows] });

    expect(windows).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 45]);
  });

  it('reads the data of each fact once, however many of the tables it fills fold it', async () => {
    const database = await entry.aDatabase();
    await labelledTwiceOver(await aLedgerOn(entry, database));

    const { points } = await filledMeasured(entry, database, {
      projections: [labelRows, labelRowsByNote, runTallyRows],
    });

    expect([points.length, new Set(points).size]).toEqual([8, 8]);
  });
}

function theBoundsOfARead(entry: FillEntry): void {
  it('reads a fact larger than its bound alone, and the facts around it within the bound', async () => {
    const database = await entry.aDatabase();
    await notedOfSizes(await aLedgerOn(entry, database), [8, 8, 8, 8, bytesOfALargeFact, 8, 8, 8, 8]);

    const { loads, facts } = await filledMeasured(entry, database, {
      projections: [topicRows],
      mostBytesFilledAtOnce: 1024,
    });
    const next = await aLedgerOn(entry, database, { projections: [topicRows] });

    const largest = Math.max(...loads);
    expect([largest > 1024, facts[loads.indexOf(largest)]]).toEqual([true, 1]);
    expect(loads.toSorted((left, right) => right - left)[1]).toBeLessThanOrEqual(1024);
    expect(await heldOf(next, 'topics', 'note')).toEqual(['8']);
  });

  it('reads no fact as a store opens whose tables are all caught up', async () => {
    const database = await entry.aDatabase();
    await notedLarge(await aLedgerOn(entry, database, { projections: [topicRows, runTallyRows] }), 3);

    const { points, windows } = await filledMeasured(entry, database, { projections: [topicRows, runTallyRows] });

    expect([points, windows]).toEqual([[], []]);
  });
}

export function catchUpReadsBehaviour(entry: FillEntry): void {
  describe('the catch-up of the keyed tables, in pages of a window of the store each', () => {
    windowsAndReads(entry);
    theBoundsOfARead(entry);
  });
}
