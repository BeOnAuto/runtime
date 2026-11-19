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

import type { LedgerChores } from '../content/content-sweep.ts';
import type { StatementExecutor } from '../event-store.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import type { KeptTables, ProjectionParts } from './projection-parts.ts';

export interface FillEntry {
  readonly aDatabase: () => Promise<string>;
  readonly executedOn: <A>(database: string, work: (execute: StatementExecutor) => Promise<A>) => Promise<A>;
  readonly ledgerOn: (
    database: string,
    kept: Pick<KeptTables, 'projections' | 'holders'>,
  ) => Layer.Layer<Ledger | LedgerChores>;
  readonly projectionsOf: (
    kept: KeptTables,
  ) => Pick<ProjectionParts, 'prepare' | 'caughtUp' | 'registrations' | 'readerOn' | 'dialect'>;
}

type AnyLedger = Ledger['Service'];

const mebibyte = 1024 * 1024;

export const bytesOfALargeFact = 80 * 1024;

const alpha = { org: 'acme', playbook: 'alpha' };

const everyRow = { where: [], orderBy: [], order: 'asc', limit: 1000 } as const;

const decodeRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      data: Schema.optionalKey(Schema.Unknown),
      point: Schema.optionalKey(Schema.Unknown),
      size: Schema.optionalKey(Schema.Unknown),
    }),
  ),
);

interface Reads {
  readonly loads: readonly number[];
  readonly facts: readonly number[];
  readonly points: readonly unknown[];
  readonly windows: readonly number[];
}

interface Measured extends Reads {
  readonly execute: StatementExecutor;
}

function measuring(execute: StatementExecutor): Measured {
  const [loads, facts, points, windows]: [number[], number[], unknown[], number[]] = [[], [], [], []];
  return {
    loads,
    facts,
    points,
    windows,
    execute: {
      query: async (sql) => {
        const answer = await execute.query(sql);
        const rows = decodeRows(answer.rows);
        const read = rows.filter(({ data }) => data !== undefined);
        loads.push(read.reduce((sum: number, { data }) => sum + JSON.stringify(data).length, 0));
        facts.push(read.length);
        points.push(...read.map(({ point }) => point));
        const listed = rows.filter(({ data, size }) => data === undefined && size !== undefined).length;
        windows.push(...(listed === 0 ? [] : [listed]));
        return answer;
      },
      command: (sql) => execute.command(sql),
    },
  };
}

export async function aLedgerOn(
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

export function aLargeStart(index: number): RunFact {
  return { type: 'run_began', data: { at: '2026-10-01T09:00:00.000Z', fn: largeText(index) } };
}

export function indexes(count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => index);
}

export function notedLarge(ledger: AnyLedger, count: number): Promise<void> {
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

export function filledMeasured(entry: FillEntry, database: string, kept: KeptTables): Promise<Reads> {
  return entry.executedOn(database, async (execute) => {
    const measured = measuring(execute);
    const parts = entry.projectionsOf(kept);
    await parts.prepare(measured.execute, (work) => work(measured.execute));
    await parts.caughtUp((work) => work(measured.execute));
    return measured;
  });
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

export async function heldOf(ledger: AnyLedger, projection: string, column: string): Promise<readonly string[]> {
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

    it('fills the holds of content in reads bounded by the bytes they load, so facts that each keep a mebibyte outside are read as many at once as the listing grows to, not four at a time', async () => {
      const database = await entry.aDatabase();
      await wroteHeldPayloads(await aLedgerOn(entry, database, { holders: noteHolders }), 20, 5);
      await entry.executedOn(database, (execute) => execute.command(SQL`DROP TABLE content_references_2`));

      const { facts } = await filledMeasured(entry, database, {
        holders: noteHolders,
        mostBytesFilledAtOnce: 4 * mebibyte,
      });

      expect(facts.filter((read) => read > 0)).toEqual([1, 2, 4, 8, 16, 32, 37]);
    });
  });
}
