import { SQL } from '@event-driven-io/dumbo';
import { textToKeep } from '@on.auto/content';
import type { Ledger } from '@on.auto/operations';
import {
  noteHolders,
  runFacts,
  runTallyRows,
  topicFacts,
  topicRows,
  writtenNotes,
  type RunFact,
  type TopicFact,
  type WrittenNote,
} from '@on.auto/operations/testing';
import { Effect, Schema, type Layer } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { StatementExecutor } from '../event-store.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import type { KeptTables, ProjectionParts } from './projection-parts.ts';

export interface FillEntry {
  readonly aDatabase: () => Promise<string>;
  readonly executedOn: <A>(database: string, work: (execute: StatementExecutor) => Promise<A>) => Promise<A>;
  readonly ledgerOn: (database: string, kept: Pick<KeptTables, 'projections' | 'holders'>) => Layer.Layer<Ledger>;
  readonly projectionsOf: (kept: KeptTables) => Pick<ProjectionParts, 'prepare'>;
}

type AnyLedger = Ledger['Service'];

const mebibyte = 1024 * 1024;

const bytesOfALargeFact = 80 * 1024;

const alpha = { org: 'acme', playbook: 'alpha' };

const everyRow = { where: [], orderBy: [], order: 'asc', limit: 1000 } as const;

const decodeData = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ data: Schema.optionalKey(Schema.Unknown) })));

function dataOf(rows: readonly unknown[]): readonly unknown[] {
  return decodeData(rows).flatMap(({ data }) => (data === undefined ? [] : [data]));
}

interface Reads {
  readonly loads: readonly number[];
  readonly facts: readonly number[];
}

interface Measured extends Reads {
  readonly execute: StatementExecutor;
}

function measuring(execute: StatementExecutor): Measured {
  const loads: number[] = [];
  const facts: number[] = [];
  return {
    loads,
    facts,
    execute: {
      query: async (sql) => {
        const answer = await execute.query(sql);
        const read = dataOf(answer.rows);
        loads.push(read.reduce((sum: number, data) => sum + JSON.stringify(data).length, 0));
        facts.push(read.length);
        return answer;
      },
      command: (sql) => execute.command(sql),
    },
  };
}

async function aLedgerOn(
  entry: FillEntry,
  database: string,
  kept: Pick<KeptTables, 'projections' | 'holders'> = {},
): Promise<AnyLedger> {
  const { ledger, dispose } = await openLedgerWith(entry.ledgerOn(database, kept));
  onTestFinished(dispose);
  return ledger;
}

function largeText(index: number): string {
  return `${index}:${'n'.repeat(bytesOfALargeFact)}`;
}

function aLargeNote(index: number): TopicFact {
  return { type: 'topic_noted', data: { topic: 'autumn', note: largeText(index) } };
}

function aLargeStart(index: number): RunFact {
  return { type: 'run_began', data: { at: '2026-10-01T09:00:00.000Z', fn: largeText(index) } };
}

function indexes(count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => index);
}

function notedLarge(ledger: AnyLedger, count: number): Promise<void> {
  return Effect.runPromise(
    Effect.andThen(
      ledger.execute('playbook/acme/alpha/runs/r1', topicFacts, [
        { type: 'topic_opened', data: { topic: 'autumn', at: 1000 } },
      ]),
      Effect.forEach(
        indexes(count),
        (index) => ledger.execute(`playbook/acme/alpha/notes/n${index}`, topicFacts, [aLargeNote(index)]),
        { discard: true },
      ),
    ),
  );
}

function begunLarge(ledger: AnyLedger, count: number): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(
      indexes(count),
      (index) => ledger.execute(`playbook/acme/alpha/runs/b${index}`, runFacts, [aLargeStart(index)]),
      { discard: true },
    ),
  );
}

async function filledMeasured(entry: FillEntry, database: string, kept: KeptTables): Promise<Reads> {
  const { loads, facts } = await entry.executedOn(database, async (execute) => {
    const measured = measuring(execute);
    await entry.projectionsOf(kept).prepare(measured.execute, (work) => work(measured.execute));
    return measured;
  });
  return { loads, facts };
}

async function wroteHeldPayloads(ledger: AnyLedger, appends: number, each: number): Promise<void> {
  const { sha256 } = await Effect.runPromise(
    ledger.content.put(alpha, textToKeep('{"note":"held by every fact"}', 'application/json')),
  );
  const held: WrittenNote = { type: 'note_written', data: { body_sha256: sha256, body_bytes: mebibyte } };
  await Effect.runPromise(
    Effect.forEach(
      indexes(appends),
      () =>
        ledger.execute(
          'playbook/acme/alpha/writings/w1',
          writtenNotes,
          indexes(each).map(() => held),
        ),
      { discard: true },
    ),
  );
}

async function heldOf(ledger: AnyLedger, projection: string, column: string): Promise<readonly string[]> {
  const rows = await Effect.runPromise(ledger.readProjectedRows(projection, alpha, everyRow));
  return rows.map(({ row }) => String(row[column]).replace(/:.*$/su, ''));
}

export function keyedFillBehaviour(entry: FillEntry): void {
  describe('the fill of a projection keyed by its mapping, over facts of 80 KiB', () => {
    it('loads at most 16 MiB of them in one read, fewer than the 256 it lists, and folds every one', async () => {
      const database = await entry.aDatabase();
      await notedLarge(await aLedgerOn(entry, database), 220);

      const { loads } = await filledMeasured(entry, database, { projections: [topicRows] });
      const next = await aLedgerOn(entry, database, { projections: [topicRows] });

      expect(Math.max(...loads)).toBeLessThanOrEqual(16 * mebibyte);
      expect(await heldOf(next, 'topics', 'note')).toEqual(['219']);
    });
  });

  describe('the fill of a store that names the most bytes it fills at once, 4 MiB', () => {
    it('loads at most that in one read, for a projection keyed by its mapping and one keyed by its stream', async () => {
      const database = await entry.aDatabase();
      const first = await aLedgerOn(entry, database);
      await notedLarge(first, 60);
      await begunLarge(first, 60);

      const { loads } = await filledMeasured(entry, database, {
        projections: [topicRows, runTallyRows],
        mostBytesFilledAtOnce: 4 * mebibyte,
      });
      const next = await aLedgerOn(entry, database, { projections: [topicRows, runTallyRows] });

      expect(Math.max(...loads)).toBeLessThanOrEqual(4 * mebibyte);
      expect([await heldOf(next, 'topics', 'note'), (await heldOf(next, 'run_tallies', 'fn')).length]).toEqual([
        ['59'],
        60,
      ]);
    });

    it('fills the holds of content in reads of at most that, counting the payloads a fact keeps outside', async () => {
      const database = await entry.aDatabase();
      await wroteHeldPayloads(await aLedgerOn(entry, database, { holders: noteHolders }), 2, 5);
      await entry.executedOn(database, (execute) => execute.command(SQL`DROP TABLE content_references_1`));

      const { facts } = await filledMeasured(entry, database, {
        holders: noteHolders,
        mostBytesFilledAtOnce: 4 * mebibyte,
      });

      expect([Math.max(...facts), facts.reduce((sum, read) => sum + read, 0)]).toEqual([3, 10]);
    });
  });
}
