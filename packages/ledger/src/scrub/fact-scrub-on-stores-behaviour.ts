import {
  messageIdOf,
  type KeyedProjection,
  type Ledger,
  type ProjectedRow,
  type ProjectedRowsQuery,
} from '@on.auto/operations';
import {
  RemarkFactSchema,
  factScrubBehaviour,
  remarkFacts,
  remarkRows,
  runFacts,
  tallyRowsOf,
  topicFacts,
  topicRows,
  type RemarkFact,
  type RunFact,
  type TopicFact,
} from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { FactScrubStore, LedgerStore } from '../event-store.ts';
import { makeLedger } from '../ledger-service.ts';
import { aLedger, aStore, type LedgerEntry } from '../testing/ledger-entry.ts';
import { factScrubberOf } from './fact-scrub.ts';

type AnyLedger = Ledger['Service'];

const alpha = { org: 'acme', playbook: 'alpha' };

const remarks = 'playbook/acme/alpha/remarks/r1';

const erasedContext = { at: '2026-10-06T09:00:00.000Z', by: 'eraser' };

const everyRow: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 10 };

export const madeWithANumber: RemarkFact = { type: 'remark_made', data: { text: 'call me on 0123' } };

export function remarked(ledger: AnyLedger, stream: string, ...facts: readonly RemarkFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, remarkFacts, facts));
}

function erased(ledger: AnyLedger, stream: string, position: number) {
  return Effect.runPromise(
    ledger.scrubFact(stream, position, {
      eventSchema: RemarkFactSchema,
      data: { text: '', kept: 'call me on 0123' },
      erasure: { type: 'remark_erased', data: { position } },
      context: erasedContext,
    }),
  );
}

function storedOf(entry: LedgerEntry, database: string, columns: string) {
  return entry.queried(
    database,
    `SELECT ${columns} FROM emt_messages WHERE stream_id = '${remarks}' ORDER BY stream_position`,
  );
}

const everyColumnButTheData = 'stream_position, global_position, message_type, message_metadata, message_id, created';

function storedInPlace(entry: LedgerEntry): void {
  describe('a fact scrubbed in a database', () => {
    it('changes the stored data of its row, to the shape of the fact alone, and nothing else of it', async () => {
      const database = await entry.aDatabase();
      const ledger = await aLedger(entry, database);
      await remarked(ledger, remarks, madeWithANumber);
      const [before] = await storedOf(entry, database, everyColumnButTheData);

      await erased(ledger, remarks, 1);
      const [after, erasure] = await storedOf(entry, database, everyColumnButTheData);

      expect(after).toEqual(before);
      expect(erasure).toMatchObject({ message_type: 'remark_erased' });
      expect(JSON.stringify(await storedOf(entry, database, 'message_data'))).not.toContain('0123');
    });

    it('is filled as scrubbed into the table of a projection made after it', async () => {
      const database = await entry.aDatabase();
      const first = await aLedger(entry, database);
      await remarked(first, remarks, madeWithANumber);
      await erased(first, remarks, 1);

      const next = await aLedger(entry, database, undefined, [remarkRows]);

      expect(
        (await Effect.runPromise(next.readProjectedRows('remarks', alpha, everyRow))).map(({ row }) => row),
      ).toMatchObject([{ text: '', remarks: 1, erasures: 1 }]);
    });
  });
}

const began: RunFact = { type: 'run_began', data: { at: '2026-10-01T09:00:00.000Z', fn: 'call me on 0123' } };

function scrubAtomic(entry: LedgerEntry): void {
  describe('a scrub whose fold breaks down inside its transaction', () => {
    it('keeps nothing: neither the scrubbed data, nor the erasure, nor a row it changed', async () => {
      const breaking: KeyedProjection = tallyRowsOf(2, (row) => row['fn'] === 'erased');
      const ledger = await aLedger(entry, undefined, undefined, [breaking]);
      const run = 'playbook/acme/alpha/runs/r1';
      await Effect.runPromise(ledger.execute(run, runFacts, [began]));

      const scrub = Effect.runPromise(
        ledger.scrubFact(run, 1, {
          eventSchema: runFacts.eventSchema,
          data: { at: '2026-10-01T09:00:00.000Z', fn: 'erased' },
          erasure: { type: 'run_noted', data: {} },
          context: erasedContext,
        }),
      );

      await expect(scrub).rejects.toThrow('The projection broke down');
      expect(await Effect.runPromise(ledger.load(run, runFacts))).toMatchObject({ version: 1 });
      expect(await Effect.runPromise(ledger.readRecordedEvent(alpha, messageIdOf(run, 1)))).toEqual(
        expect.objectContaining({ data: began.data }),
      );
      expect(
        (await Effect.runPromise(ledger.readProjectedRows('run_tallies', alpha, everyRow))).map(({ row }) => row['fn']),
      ).toEqual(['call me on 0123']);
    });
  });
}

function overtakenOnce(store: LedgerStore): FactScrubStore {
  const overtaken = { yet: false };
  return {
    scrub: store.scrub,
    factAt: async (stream, position) => {
      const at = await store.factAt(stream, position);
      if (!overtaken.yet && at.found === 'fact') {
        overtaken.yet = true;
        await store.append(stream, [{ type: 'remark_made', data: { text: 'meanwhile' } }], {
          expectedVersion: at.version,
          context: erasedContext,
        });
      }
      return at;
    },
  };
}

function scrubRetried(entry: LedgerEntry): void {
  describe('a scrub that another append overtakes', () => {
    it('reads the stream again and appends its erasure at the new head', async () => {
      const store = await aStore(entry);
      const ledger = { ...makeLedger(store), ...factScrubberOf(overtakenOnce(store)) };
      await remarked(ledger, remarks, madeWithANumber);

      const scrubbed = await erased(ledger, remarks, 1);

      expect(scrubbed).toEqual({ version: 3 });
      expect((await Effect.runPromise(ledger.load(remarks, remarkFacts))).version).toBe(3);
    });
  });
}

const notesInAnAppend = 8;

const notes = 40 * notesInAnAppend;

function notedOften(ledger: AnyLedger, stream: string): Promise<unknown> {
  const appends = Array.from({ length: notes / notesInAnAppend }, (_, append) =>
    Array.from({ length: notesInAnAppend }, (__, index): TopicFact => ({
      type: 'topic_noted',
      data: { topic: 'spring', note: `note ${append * notesInAnAppend + index}` },
    })),
  );
  return Effect.runPromise(
    Effect.forEach(appends, (facts: readonly TopicFact[]) => ledger.execute(stream, topicFacts, facts), {
      discard: true,
    }),
  );
}

function refoldedOverBatches(entry: LedgerEntry): void {
  describe('a row folded from more facts than one read of its fold takes', () => {
    it('is folded again from every one of them, in the order they were appended', async () => {
      const ledger = await aLedger(entry, undefined, undefined, [topicRows]);
      const noted = 'playbook/acme/alpha/notes/n1';
      await Effect.runPromise(
        ledger.execute('playbook/acme/alpha/runs/r1', topicFacts, [
          { type: 'topic_opened', data: { topic: 'spring', at: 0 } },
        ]),
      );
      await notedOften(ledger, noted);

      await Effect.runPromise(
        ledger.scrubFact(noted, 1, {
          eventSchema: topicFacts.eventSchema,
          data: { topic: 'spring', note: 'a note was erased' },
          erasure: { type: 'topic_noted', data: { topic: 'erased', note: 'a note was erased' } },
          context: erasedContext,
        }),
      );

      expect(
        (await Effect.runPromise(ledger.readProjectedRows('topics', alpha, everyRow))).map(({ row }) => [
          row['note'],
          row['last_message'],
        ]),
      ).toEqual([[`note ${notes - 1}`, messageIdOf(noted, notes)]]);
    });
  });
}

export const projectionOfTwentyOneKinds: KeyedProjection = {
  ...remarkRows,
  kinds: Array.from({ length: 21 }, (_, index) => `remarks${index}`),
};

export const ofTheFirstKind = 'playbook/acme/alpha/remarks0/r1';

export const ofTheLastKind = 'playbook/acme/alpha/remarks20/r1';

export async function remarksRowsOf(ledger: AnyLedger): Promise<readonly ProjectedRow[]> {
  return (await Effect.runPromise(ledger.readProjectedRows('remarks', alpha, everyRow))).map(({ row }) => row);
}

function refoldedOverManyKinds(entry: LedgerEntry): void {
  describe('a row of a projection of twenty-one kinds', () => {
    it('is folded again from the facts of every kind, in the order they were appended', async () => {
      const ledger = await aLedger(entry, undefined, undefined, [projectionOfTwentyOneKinds]);
      await remarked(ledger, ofTheLastKind, madeWithANumber);
      await remarked(ledger, ofTheFirstKind, { type: 'remark_made', data: { text: 'later' } });

      await erased(ledger, ofTheLastKind, 1);

      expect(await remarksRowsOf(ledger)).toEqual([
        { text: 'later', remarks: 2, erasures: 1, last_message: messageIdOf(ofTheLastKind, 2) },
      ]);
    });
  });
}

export function factScrubOnStoresBehaviour(entry: LedgerEntry): void {
  factScrubBehaviour({ aLedger: (projections, runOutcomes) => aLedger(entry, undefined, runOutcomes, projections) });
  storedInPlace(entry);
  scrubAtomic(entry);
  scrubRetried(entry);
  refoldedOverBatches(entry);
  refoldedOverManyKinds(entry);
}
