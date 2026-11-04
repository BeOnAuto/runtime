import { Buffer } from 'node:buffer';

import { mostResultBytes, type SucceededRun, type SucceededRunsReader } from '@on.auto/definitions';
import type { RecordedEvent, RecordedPageRequest } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { runsRead, type RunsAsked } from './runs-read.ts';
import { wordsIn } from './word-matching.ts';

const definition = { type: 'computation', name: 'campaign-pace' };

const theStart = 'the-start-of-the-run-that-reads';

const asked: RunsAsked = {
  place: { org: 'acme', playbook: 'alpha' },
  definition,
  start: theStart,
  since: undefined,
  words: [],
};

function runOf(day: number, output: Schema.Json, startedAt = `2026-10-${String(day).padStart(2, '0')}T09:00:00.000Z`) {
  return {
    run_id: `0199a3c4-0000-7000-8000-${String(day).padStart(12, '0')}`,
    definition_version: 1,
    started_at: startedAt,
    finished_at: startedAt,
    output,
  };
}

function headsOf({ run_id: runId, definition_version: version, started_at, finished_at, output }: SucceededRun) {
  const context = {
    by: 'acme-admin',
    runId,
    definitionType: definition.type,
    definitionName: definition.name,
    definitionVersion: version,
  };
  const head = {
    causationId: null,
    correlationId: runId,
    stream: `runs/${runId}`,
    cursor: runId,
    recordedAt: started_at,
  };
  const heads: readonly RecordedEvent[] = [
    {
      ...head,
      id: `${runId}/1`,
      version: 1,
      globalPosition: 1,
      type: 'run_started',
      data: undefined,
      context: { ...context, at: started_at },
    },
    {
      ...head,
      id: `${runId}/2`,
      version: 2,
      globalPosition: 2,
      type: 'run_succeeded',
      data: { output, record: {} },
      context: { ...context, at: finished_at },
    },
  ];
  return heads;
}

interface Page {
  readonly runs: readonly SucceededRun[];
  readonly reached?: string;
}

interface PagedReader {
  readonly reader: SucceededRunsReader;
  readonly asked: () => readonly RecordedPageRequest[];
}

function pagedReader(pages: readonly Page[]): PagedReader {
  const requests: RecordedPageRequest[] = [];
  return {
    reader: {
      readRecorded: (_, __, page) =>
        Effect.sync(() => {
          requests.push(page);
          const index = page.cursor === theStart ? 0 : Number(page.cursor);
          const { runs = [], reached } = pages[index] ?? {};
          const later = index + 1 < pages.length;
          return {
            records: runs.flatMap((run) => headsOf(run)),
            hasMore: later,
            nextCursor: later ? String(index + 1) : null,
            lastExamined: reached === undefined ? null : { cursor: 'the-place-it-reached', recordedAt: reached },
          };
        }),
    },
    asked: () => requests,
  };
}

const cursorsOf = (pages: readonly RecordedPageRequest[]) => pages.map(({ cursor }) => cursor);

function bytesOf(value: Schema.Json): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function read(reader: SucceededRunsReader, mostPages: number, changed: Partial<RunsAsked> = {}) {
  return Effect.runPromise(runsRead(reader, { ...asked, ...changed }, mostPages));
}

type ShownRun = Readonly<ReturnType<typeof runOf>>;

const fifth = runOf(5, { note: 'Day 5' });

const fourth = runOf(4, { note: 'Day 4' });

const third = runOf(3, { note: 'Day 3' });

const second = runOf(2, { note: 'Day 2' });

const first = runOf(1, { note: 'Day 1' });

const sizedOf = ({ output, ...run }: ShownRun) => ({ ...run, bytes: bytesOf(output) });

const reachedPastTheFirst = '2026-09-30T09:00:00.000Z';

const threePages: readonly Page[] = [
  { runs: [fifth, fourth], reached: fourth.started_at },
  { runs: [third], reached: '2026-10-02T12:00:00.000Z' },
  { runs: [second, first], reached: reachedPastTheFirst },
];

describe('a read of the runs of a definition', () => {
  it('answers every run of every page from its own start, newest first, with how many it examined and how far it went', async () => {
    const { reader, asked: pages } = pagedReader(threePages);

    expect(await read(reader, 10)).toEqual({
      output: { runs: [fifth, fourth, third, second, first], more: false },
      record: { examined: 5, through: reachedPastTheFirst },
    });
    expect(cursorsOf(pages())).toEqual([theStart, '1', '2']);
  });

  it('reads no more pages than its bound, and says there are more and how far it went', async () => {
    const { reader, asked: pages } = pagedReader(threePages);

    expect(await read(reader, 2)).toEqual({
      output: { runs: [fifth, fourth, third], more: true },
      record: { examined: 3, through: '2026-10-02T12:00:00.000Z' },
    });
    expect(cursorsOf(pages())).toEqual([theStart, '1']);
  });

  it('answers nothing, examining nothing, where the definition has no run that succeeded', async () => {
    expect(await read(pagedReader([{ runs: [] }]).reader, 10)).toEqual({
      output: { runs: [], more: false },
      record: { examined: 0, through: null },
    });
  });
});

describe('the runs a read reads', () => {
  it('asks the ledger for the runs since its day, and ends at the first started before it all the same', async () => {
    const since = '2026-10-03T00:00:00.000Z';
    const { reader, asked: pages } = pagedReader([
      { runs: [fifth, fourth, third], reached: third.started_at },
      { runs: [second, first], reached: first.started_at },
    ]);

    expect(await read(reader, 10, { since: Date.parse(since) })).toEqual({
      output: { runs: [fifth, fourth, third], more: false },
      record: { examined: 3, through: third.started_at },
    });
    expect(pages().map((page) => page.since)).toEqual([since, since]);
  });

  it('keeps the runs whose output holds every word, folded, counting the others it examined', async () => {
    const street = runOf(3, { address: 'Hauptstraße 5', city: 'İstanbul' });
    const { reader } = pagedReader([{ runs: [fifth, fourth, street, second] }]);

    expect(await read(reader, 10, { words: wordsIn('STRASSE İstanbul') })).toEqual({
      output: { runs: [street], more: false },
      record: { examined: 4, through: second.started_at },
    });
  });
});

const answerOf = (run: ShownRun) => ({ runs: [run], more: false });

const recordOf = (run: ShownRun) => ({ examined: 1, through: run.started_at });

function filling(room: number): ShownRun {
  const empty = runOf(5, '');
  return runOf(5, 'x'.repeat(mostResultBytes - room - bytesOf(answerOf(empty)) - bytesOf(recordOf(empty))));
}

describe('a read whose answer is full', () => {
  it('gives the first output that does not fit by its size, says there are more, and reads no further', async () => {
    const half = runOf(5, 'x'.repeat(mostResultBytes / 2));
    const whole = runOf(4, 'y'.repeat(mostResultBytes / 2));
    const { reader, asked: pages } = pagedReader([{ runs: [half, whole] }, { runs: [third] }]);

    expect(await read(reader, 10)).toEqual({
      output: { runs: [half, sizedOf(whole)], more: true },
      record: { examined: 2, through: whole.started_at },
    });
    expect(pages()).toHaveLength(1);
  });

  it('ends before an output it cannot give even by its size, and before a run or a reach whose record would not fit', async () => {
    const nearlyFull = filling(10);
    const full = filling(0);
    const longer = '2026-10-04T09:00:00.000000Z';
    const later = runOf(4, 'note', longer);
    const unread = {
      sized: pagedReader([{ runs: [nearlyFull, fourth] }]).reader,
      run: pagedReader([{ runs: [full, later] }]).reader,
      reach: pagedReader([{ runs: [full], reached: longer }, { runs: [fourth] }]).reader,
    };

    expect([
      await read(unread.sized, 10),
      await read(unread.run, 10, { words: ['x'] }),
      await read(unread.reach, 10),
    ]).toEqual([
      { output: { runs: [nearlyFull], more: true }, record: recordOf(nearlyFull) },
      { output: { runs: [full], more: true }, record: recordOf(full) },
      { output: { runs: [full], more: true }, record: recordOf(full) },
    ]);
  });
});
