import { Effect, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import {
  ContextSchema,
  InvalidCursor,
  cursorOfParts,
  messageIdOf,
  type Context,
  type Decided,
  type Decider,
  type RecordedPage,
  type RecordedPageRequest,
  type RecordedSelection,
} from '../index.ts';
import { prefixedAges } from '../ledger/bound-ports.ts';
import { memoryLedger, type MemoryLedger } from './memory-ledger.ts';

const HappenedSchema = Schema.Struct({
  type: Schema.String,
  data: Schema.Struct({ note: Schema.String }),
  context: ContextSchema,
});

type Happened = Decided<typeof HappenedSchema.Type>;

const noted: Context = { at: '2026-10-05T09:00:00.000Z', by: 'tester' };

const happenings: Decider<null, readonly Happened[], typeof HappenedSchema.Type> = {
  initialState: null,
  evolve: () => null,
  decide: (happened) => Result.succeed(happened),
  context: () => noted,
  eventSchema: HappenedSchema,
};

const alpha = { org: 'acme', playbook: 'alpha' };

function recording(ledger: MemoryLedger, at: number, stream: string, ...types: readonly string[]) {
  return TestClock.setTime(at).pipe(
    Effect.andThen(
      ledger.service.execute(
        stream,
        happenings,
        types.map((type) => ({ type, data: { note: type } })),
      ),
    ),
  );
}

function reading(ledger: MemoryLedger, selection: RecordedSelection, page: RecordedPageRequest) {
  return ledger.service.readRecorded(alpha, selection, page);
}

function typesOf({ records }: RecordedPage): readonly string[] {
  return records.map(({ type }) => type);
}

const everything: RecordedSelection = { kind: 'everything' };

function aPlaybookWith(ledger: MemoryLedger) {
  return Effect.all([
    recording(ledger, 1000, 'playbook/acme/alpha/runs/r1', 'run_started'),
    recording(ledger, 1000, 'playbook/acme/alpha/run-logs/r1', 'input_applied'),
    recording(ledger, 2000, 'playbook/acme/alpha2/notes', 'noted'),
    recording(ledger, 2000, 'org/acme/playbooks', 'playbook_created'),
    recording(ledger, 3000, 'playbook/acme/alpha/runs/r1', 'run_succeeded'),
    recording(ledger, 4000, 'playbook/acme/alpha/runs/r2', 'run_started'),
  ]);
}

function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())));
}

describe('the in-memory read of what a playbook recorded', () => {
  it('reads the playbook alone, in either order, resuming from the cursor of the page before', async () => {
    const ledger = memoryLedger();

    const pages = await run(
      Effect.gen(function* () {
        yield* aPlaybookWith(ledger);
        const first = yield* reading(ledger, everything, { order: 'asc', limit: 3 });
        const second = yield* reading(ledger, everything, { order: 'asc', limit: 3, cursor: String(first.nextCursor) });
        const newest = yield* reading(ledger, everything, { order: 'desc', limit: 3 });
        const older = yield* reading(ledger, everything, {
          order: 'desc',
          limit: 3,
          cursor: String(newest.nextCursor),
        });
        return [first, second, newest, older].map((page) => ({ types: typesOf(page), hasMore: page.hasMore }));
      }),
    );

    expect(pages).toEqual([
      { types: ['run_started', 'input_applied', 'run_succeeded'], hasMore: true },
      { types: ['run_started'], hasMore: false },
      { types: ['run_started', 'run_succeeded', 'input_applied'], hasMore: true },
      { types: ['run_started'], hasMore: false },
    ]);
  });
});

describe('the in-memory read of runs', () => {
  it('reads the two streams of one run, and the first and latest message of each run, newest first', async () => {
    const ledger = memoryLedger();

    const [ofRun, runs, succeeded] = await run(
      Effect.gen(function* () {
        yield* aPlaybookWith(ledger);
        return yield* Effect.all([
          reading(ledger, { kind: 'run', run: 'r1' }, { order: 'asc', limit: 10 }),
          reading(ledger, { kind: 'runs' }, { order: 'desc', limit: 10 }),
          reading(ledger, { kind: 'runs' }, { order: 'desc', limit: 10, types: ['run_succeeded'] }),
        ]);
      }),
    );

    expect(ofRun.records.map(({ stream, type }) => `${stream} ${type}`)).toEqual([
      'playbook/acme/alpha/runs/r1 run_started',
      'playbook/acme/alpha/run-logs/r1 input_applied',
      'playbook/acme/alpha/runs/r1 run_succeeded',
    ]);
    expect(typesOf(runs)).toEqual(['run_started', 'run_started', 'run_succeeded']);
    expect(runs.records.map(({ stream }) => stream)).toEqual([
      'playbook/acme/alpha/runs/r2',
      'playbook/acme/alpha/runs/r1',
      'playbook/acme/alpha/runs/r1',
    ]);
    expect(succeeded.records.map(({ stream }) => stream)).toEqual([
      'playbook/acme/alpha/runs/r1',
      'playbook/acme/alpha/runs/r1',
    ]);
  });
});

describe('the in-memory read from a time or of some types', () => {
  it('starts from the first message recorded at or after a time, and keeps to the types it is given', async () => {
    const ledger = memoryLedger();

    const pages = await run(
      Effect.gen(function* () {
        yield* aPlaybookWith(ledger);
        return yield* Effect.all([
          reading(ledger, everything, { order: 'asc', limit: 10, since: new Date(1000).toISOString() }),
          reading(ledger, everything, { order: 'desc', limit: 10, since: new Date(2500).toISOString() }),
          reading(ledger, everything, { order: 'asc', limit: 10, since: new Date(5000).toISOString() }),
          reading(ledger, everything, { order: 'asc', limit: 10, types: ['run_succeeded', 'input_applied'] }),
        ]);
      }),
    );

    expect(pages.map((page) => ({ types: typesOf(page), next: page.nextCursor }))).toEqual([
      { types: ['run_started', 'input_applied', 'run_succeeded', 'run_started'], next: null },
      { types: ['run_started', 'run_succeeded'], next: null },
      { types: [], next: null },
      { types: ['input_applied', 'run_succeeded'], next: null },
    ]);
    expect(pages[0]?.records.map(({ recordedAt }) => recordedAt).at(-1)).toBe('1970-01-01T00:00:04.000Z');
  });
});

describe('the in-memory read that loads the data of some types alone', () => {
  it('gives every record its version in its stream, and data only to the types asked for', async () => {
    const ledger = memoryLedger();

    const pages = await run(
      Effect.gen(function* () {
        yield* aPlaybookWith(ledger);
        return yield* Effect.all([
          reading(ledger, everything, { order: 'asc', limit: 10, dataOf: ['run_succeeded'] }),
          reading(ledger, { kind: 'runs' }, { order: 'asc', limit: 10, dataOf: [] }),
        ]);
      }),
    );

    expect(
      pages.map(({ records }) => records.map(({ type, version, data }) => [type, version, data !== undefined])),
    ).toEqual([
      [
        ['run_started', 1, false],
        ['input_applied', 1, false],
        ['run_succeeded', 2, true],
        ['run_started', 1, false],
      ],
      [
        ['run_started', 1, false],
        ['run_succeeded', 2, false],
        ['run_started', 1, false],
      ],
    ]);
  });
});

describe('the in-memory read from a cursor', () => {
  it('refuses a cursor of another playbook, or one it cannot read', async () => {
    const ledger = memoryLedger();
    const { records } = await run(
      recording(ledger, 0, 'playbook/acme/beta/notes', 'noted').pipe(
        Effect.andThen(
          ledger.service.readRecorded({ org: 'acme', playbook: 'beta' }, everything, { order: 'asc', limit: 1 }),
        ),
      ),
    );

    const refusals = await run(
      Effect.forEach(
        [
          ...records.map(({ cursor }) => cursor),
          'WyJicmFpbiJd',
          'not a cursor',
          cursorOfParts(['playbook/acme/alpha/', '1', '2']),
          cursorOfParts(['playbook/acme/alpha/', '1', 2, 3]),
        ],
        (cursor) => Effect.flip(reading(ledger, everything, { order: 'asc', limit: 1, cursor })),
      ),
    );

    expect(refusals).toEqual([
      new InvalidCursor({ kind: 'of_another_playbook' }),
      new InvalidCursor({ kind: 'malformed' }),
      new InvalidCursor({ kind: 'malformed' }),
      new InvalidCursor({ kind: 'malformed' }),
      new InvalidCursor({ kind: 'malformed' }),
    ]);
  });
});

describe('the in-memory read from inside a record', () => {
  it('reads on from inside a record, that record first, in either order', async () => {
    const ledger = memoryLedger();
    const pages = await run(
      Effect.gen(function* () {
        yield* aPlaybookWith(ledger);
        const inside = cursorOfParts(['playbook/acme/alpha/', '2', 1]);
        return yield* Effect.all([
          reading(ledger, everything, { order: 'asc', limit: 2, cursor: inside }),
          reading(ledger, everything, { order: 'desc', limit: 2, cursor: inside }),
        ]);
      }),
    );

    expect(pages.map((page) => typesOf(page))).toEqual([
      ['input_applied', 'run_succeeded'],
      ['input_applied', 'run_started'],
    ]);
  });
});

describe('the in-memory lineage of what a playbook recorded', () => {
  it('names each message by its stream and position, with the cause and correlation it was written with', async () => {
    const ledger = memoryLedger();
    const lineage = { causationId: 'cause', correlationId: 'r1' };
    const [correlated, page] = await run(
      Effect.gen(function* () {
        yield* aPlaybookWith(ledger);
        yield* ledger.service.execute(
          'playbook/acme/alpha/run-logs/r1',
          happenings,
          [{ type: 'noted', data: { note: '' } }],
          lineage,
        );
        return yield* Effect.all([
          reading(ledger, { kind: 'correlated', correlation: 'r1' }, { order: 'asc', limit: 10 }),
          reading(ledger, everything, { order: 'asc', limit: 1 }),
        ]);
      }),
    );

    expect(correlated.records.map(({ id, stream, causationId }) => ({ id, stream, causationId }))).toEqual([
      {
        id: messageIdOf('playbook/acme/alpha/run-logs/r1', 2),
        stream: 'playbook/acme/alpha/run-logs/r1',
        causationId: 'cause',
      },
    ]);
    expect(page.records.map(({ id, causationId, correlationId }) => ({ id, causationId, correlationId }))).toEqual([
      { id: messageIdOf('playbook/acme/alpha/runs/r1', 1), causationId: null, correlationId: null },
    ]);
  });
});

describe('the age of the last append to a stream of the memory ledger', () => {
  it('is how long ago by its clock the stream was last appended to, endless for one never appended to', async () => {
    const ledger = memoryLedger();
    const bound = prefixedAges(ledger.service, 'playbook/acme/alpha/');
    const ages = Effect.all([
      ledger.service.ageOfLastAppend('playbook/acme/alpha/runs/r1'),
      bound.ageOfLastAppend('runs/r2'),
      bound.ageOfLastAppend('runs/r3'),
    ]);

    expect(
      await run(aPlaybookWith(ledger).pipe(Effect.andThen(TestClock.setTime(4250)), Effect.andThen(ages))),
    ).toEqual([1250, 250, Number.POSITIVE_INFINITY]);
  });
});
