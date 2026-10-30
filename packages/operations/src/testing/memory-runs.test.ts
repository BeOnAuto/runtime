import { Effect, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import {
  ContextSchema,
  type Decided,
  type Decider,
  type InvalidCursor,
  type RecordedPageRequest,
  type RecordedSelection,
} from '../index.ts';
import { memoryLedger, type MemoryLedger } from './memory-ledger.ts';
import { memoryRecordedReader } from './memory-recorded.ts';

const HappenedSchema = Schema.Struct({ type: Schema.String, data: Schema.Struct({}), context: ContextSchema });

type Happened = Decided<typeof HappenedSchema.Type>;

const happenings: Decider<null, Happened, typeof HappenedSchema.Type> = {
  initialState: null,
  evolve: () => null,
  decide: (happened) => Result.succeed([happened]),
  context: () => ({ at: '2026-10-05T09:00:00.000Z', by: 'tester' }),
  eventSchema: HappenedSchema,
};

const runsOnly: RecordedSelection = { kind: 'runs', notBeginningWith: ['run_cancel_requested'] };

const newestHundred: RecordedPageRequest = { order: 'desc', limit: 100 };

function streamsBeginningWith(ledger: MemoryLedger, firstTypes: readonly string[]) {
  return Effect.forEach(firstTypes, (type, index) =>
    TestClock.setTime(1000 + index).pipe(
      Effect.andThen(ledger.service.execute(`playbook/acme/alpha/runs/s${index}`, happenings, { type, data: {} })),
    ),
  );
}

function runsWithOneLeftOutEvery(every: number, count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => (index % every === 0 ? 'run_cancel_requested' : 'run_started'));
}

function read(ledger: MemoryLedger, selection: RecordedSelection) {
  return ledger.service.readRecorded({ org: 'acme', playbook: 'alpha' }, selection, newestHundred);
}

describe('the in-memory read of runs that leaves out the streams beginning with some types', () => {
  it('fills its page from the runs and has no more once they are read, wherever the streams left out lie', async () => {
    const among = memoryLedger();
    const oldest = memoryLedger();

    const pages = await Effect.runPromise(
      Effect.gen(function* () {
        yield* streamsBeginningWith(among, runsWithOneLeftOutEvery(21, 105));
        yield* streamsBeginningWith(oldest, runsWithOneLeftOutEvery(101, 101));
        return yield* Effect.all([read(among, runsOnly), read(oldest, runsOnly), read(oldest, { kind: 'runs' })]);
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(pages.map(({ records, hasMore }) => [records.length, hasMore])).toEqual([
      [100, false],
      [100, false],
      [100, true],
    ]);
    expect(pages[0]?.records.map(({ type }) => type)).not.toContain('run_cancel_requested');
  });
});

const StartSchema = Schema.Struct({
  type: Schema.Literal('run_started'),
  data: Schema.Struct({}),
  context: ContextSchema,
});

interface Start {
  readonly definitionType: string;
  readonly definitionName: string;
}

const starts: Decider<null, Start, typeof StartSchema.Type> = {
  initialState: null,
  evolve: () => null,
  decide: () => Result.succeed([{ type: 'run_started', data: {} }]),
  context: ({ definitionType, definitionName }) => ({
    at: '2026-10-05T09:00:00.000Z',
    by: 'tester',
    definitionType,
    definitionName,
  }),
  eventSchema: StartSchema,
};

function runsWithOneInFourOfEachDefinition(ledger: MemoryLedger) {
  return Effect.forEach(
    Array.from({ length: 28 }, (_, index) => index),
    (index) =>
      ledger.service.execute(`playbook/acme/alpha/runs/r${index}`, starts, {
        definitionType: index % 4 === 0 ? 'workflow' : 'reasoning',
        definitionName: index % 4 === 1 ? 'qualify-enquiry' : 'summary',
      }),
    { discard: true },
  );
}

type PageFigures = readonly [records: number, hasMore: boolean];

function everyPageOf(
  ledger: MemoryLedger,
  selection: RecordedSelection,
  page: RecordedPageRequest,
): Effect.Effect<readonly PageFigures[], InvalidCursor> {
  return Effect.gen(function* () {
    const { records, hasMore, nextCursor } = yield* ledger.service.readRecorded(
      { org: 'acme', playbook: 'alpha' },
      selection,
      page,
    );
    const figures: PageFigures = [records.length, hasMore];
    return nextCursor === null
      ? [figures]
      : [figures, ...(yield* everyPageOf(ledger, selection, { ...page, cursor: nextCursor }))];
  });
}

describe('the in-memory read of the runs of one definition', () => {
  it('fills every page from the runs of the definition type or the name asked for, and has no more after the last', async () => {
    const ledger = memoryLedger();

    const pages = await Effect.runPromise(
      runsWithOneInFourOfEachDefinition(ledger).pipe(
        Effect.andThen(
          Effect.all([
            everyPageOf(ledger, { kind: 'runs', definitionType: 'workflow' }, { order: 'desc', limit: 5 }),
            everyPageOf(ledger, { kind: 'runs', name: 'qualify-enquiry' }, { order: 'desc', limit: 2 }),
            everyPageOf(ledger, { kind: 'runs', definitionType: 'reasoning', name: 'qualify-enquiry' }, newestHundred),
            everyPageOf(ledger, { kind: 'runs', definitionType: 'workflow', name: 'summary' }, newestHundred),
            everyPageOf(ledger, { kind: 'runs', definitionType: 'workflow', name: 'qualify-enquiry' }, newestHundred),
          ]),
        ),
      ),
    );

    expect(pages).toEqual([
      [
        [5, true],
        [2, false],
      ],
      [
        [2, true],
        [2, true],
        [2, true],
        [1, false],
      ],
      [[7, false]],
      [[7, false]],
      [[0, false]],
    ]);
  });
});

describe('the in-memory read of the runs of one definition, over a first record whose context names none', () => {
  it('lists the run when no definition is asked, and finds it of none when one is', async () => {
    const readOneRecord = memoryRecordedReader([
      {
        position: 1,
        id: 'message-1',
        causationId: null,
        correlationId: null,
        stream: 'playbook/acme/alpha/runs/r1',
        streamPosition: 1,
        type: 'run_started',
        data: 'workflow',
        context: { at: '2026-10-07T09:00:00.000Z', by: 'tester' },
        recordedAt: '2026-10-07T09:00:00.000Z',
      },
    ]);
    const reading = (selection: RecordedSelection) =>
      readOneRecord
        .readRecorded({ org: 'acme', playbook: 'alpha' }, selection, newestHundred)
        .pipe(Effect.map(({ records }) => records.map(({ data }) => data)));

    const pages = await Effect.runPromise(
      Effect.all([
        reading({ kind: 'runs' }),
        reading({ kind: 'runs', definitionType: 'workflow' }),
        reading({ kind: 'runs', name: 'workflow' }),
      ]),
    );

    expect(pages).toEqual([['workflow'], [], []]);
  });
});
