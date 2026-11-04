import {
  ContextSchema,
  type CalledBy,
  type Decided,
  type Decider,
  type RecordedPage,
  type RecordedPageRequest,
  type RecordedSelection,
} from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { details, inAlpha, reading, stamped, type AnyLedger, type LedgerMaker } from '../testing/happenings.ts';

const RunFactSchema = Schema.Struct({
  type: Schema.String,
  data: Schema.Struct({ detail: Schema.Json }),
  context: ContextSchema,
});

type RunFact = Decided<typeof RunFactSchema.Type>;

interface RunFacts {
  readonly facts: readonly RunFact[];
  readonly definitionType?: string;
  readonly definitionName?: string;
  readonly calledBy?: CalledBy;
}

const runFacts: Decider<null, RunFacts, typeof RunFactSchema.Type> = {
  initialState: null,
  evolve: () => null,
  decide: ({ facts }) => Result.succeed(facts),
  context: ({ definitionType, definitionName, calledBy }) => ({
    ...stamped,
    ...(definitionType === undefined ? {} : { definitionType }),
    ...(definitionName === undefined ? {} : { definitionName }),
    ...(calledBy === undefined ? {} : { calledBy }),
  }),
  eventSchema: RunFactSchema,
};

const runsOfTheReport = Array.from({ length: 28 }, (_, index) => index);

function factOfType(type: string, detail: Schema.Json = null): RunFact {
  return { type, data: { detail } };
}

function runOfTheReport(index: number): RunFacts {
  const facts = [factOfType('run_started'), factOfType(index % 9 === 2 ? 'run_rejected' : 'run_succeeded')];
  return index === 27
    ? { facts }
    : {
        facts,
        definitionType: index % 4 === 0 ? 'workflow' : 'reasoning',
        definitionName: index % 4 === 1 ? 'qualify-enquiry' : 'summary',
      };
}

function recordedRun(ledger: AnyLedger, run: string, facts: RunFacts): Effect.Effect<unknown, unknown> {
  return ledger.execute(inAlpha(`runs/${run}`), runFacts, facts);
}

async function twentyEightRuns(aLedger: LedgerMaker): Promise<AnyLedger> {
  const ledger = await aLedger();
  await Effect.runPromise(
    Effect.forEach(runsOfTheReport, (index) => recordedRun(ledger, `run-${index}`, runOfTheReport(index)), {
      discard: true,
    }),
  );
  return ledger;
}

type RunsOnAPage = readonly [runs: readonly string[], hasMore: boolean];

function runsOn({ records, hasMore }: RecordedPage): RunsOnAPage {
  const runsListed = new Set(records.map(({ stream }) => stream.slice(inAlpha('runs/').length)));
  return [[...runsListed], hasMore];
}

async function everyPageOfRuns(
  ledger: AnyLedger,
  selection: RecordedSelection,
  page: RecordedPageRequest,
): Promise<readonly RunsOnAPage[]> {
  const read = await reading(ledger, selection, page);
  return read.nextCursor === null
    ? [runsOn(read)]
    : [runsOn(read), ...(await everyPageOfRuns(ledger, selection, { ...page, cursor: read.nextCursor }))];
}

const runsOfWorkflows: RecordedSelection = { kind: 'runs', definitionType: 'workflow' };

function theRunsOfOneType(aLedger: LedgerMaker): void {
  it('fill every page with the runs of the definition type asked for, five then two, and have no more after the last', async () => {
    const ledger = await twentyEightRuns(aLedger);

    const pages = await everyPageOfRuns(ledger, runsOfWorkflows, { order: 'desc', limit: 5 });

    expect(pages).toEqual([
      [['run-24', 'run-20', 'run-16', 'run-12', 'run-8'], true],
      [['run-4', 'run-0'], false],
    ]);
  });
}

function theRunsOfOneName(aLedger: LedgerMaker): void {
  it('page through the seven runs of the name asked for, two at a time', async () => {
    const ledger = await twentyEightRuns(aLedger);

    const pages = await everyPageOfRuns(ledger, { kind: 'runs', name: 'qualify-enquiry' }, { order: 'desc', limit: 2 });

    expect(pages).toEqual([
      [['run-25', 'run-21'], true],
      [['run-17', 'run-13'], true],
      [['run-9', 'run-5'], true],
      [['run-1'], false],
    ]);
  });
}

function theRejectedRuns(aLedger: LedgerMaker): void {
  it('answer a rejected run one at a time behind newer runs that succeeded, of any definition or of one', async () => {
    const ledger = await twentyEightRuns(aLedger);
    const rejectedOneAtATime = { order: 'desc', limit: 1, types: ['run_rejected'] } as const;

    const pages = await Promise.all([
      everyPageOfRuns(ledger, { kind: 'runs' }, rejectedOneAtATime),
      everyPageOfRuns(ledger, runsOfWorkflows, rejectedOneAtATime),
    ]);

    expect(pages).toEqual([
      [
        [['run-20'], true],
        [['run-11'], true],
        [['run-2'], false],
      ],
      [[['run-20'], false]],
    ]);
  });
}

function runOfAWeek(index: number): RunFacts {
  const facts = [factOfType('run_started'), factOfType('run_succeeded')];
  return index % 3 === 0
    ? { facts, definitionType: 'workflow', definitionName: 'close-the-week' }
    : {
        facts,
        definitionType: 'reasoning',
        definitionName: 'total-the-week',
        calledBy: { runId: `run-${index - (index % 3)}`, reference: `/do/${index % 3}/total`, run: 1 },
      };
}

function theRunsNoStepStarted(aLedger: LedgerMaker): void {
  it('leave out the runs whose start names the step that started them, alone or with the type asked for', async () => {
    const ledger = await aLedger();
    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: 9 }, (_, index) => index),
        (index) => recordedRun(ledger, `run-${index}`, runOfAWeek(index)),
        { discard: true },
      ),
    );
    const noStepStarted: RecordedSelection = { kind: 'runs', called: false };

    const pages = await Promise.all([
      everyPageOfRuns(ledger, noStepStarted, { order: 'desc', limit: 2 }),
      everyPageOfRuns(ledger, { ...noStepStarted, definitionType: 'reasoning' }, { order: 'desc', limit: 2 }),
      everyPageOfRuns(ledger, { kind: 'runs', definitionType: 'reasoning' }, { order: 'desc', limit: 4 }),
    ]);

    expect(pages).toEqual([
      [
        [['run-6', 'run-3'], true],
        [['run-0'], false],
      ],
      [[[], false]],
      [
        [['run-8', 'run-7', 'run-5', 'run-4'], true],
        [['run-2', 'run-1'], false],
      ],
    ]);
  });
}

function endsOfAWeek(index: number): RunFacts {
  const end = index === 1 ? 'run_rejected' : 'run_succeeded';
  return {
    facts: [factOfType('run_started', 'the input'), factOfType(end, `the end of run ${index}`)],
    definitionType: 'workflow',
    definitionName: 'close-the-week',
  };
}

const endsThatSucceeded: RecordedPageRequest = {
  order: 'desc',
  limit: 100,
  types: ['run_succeeded'],
  dataOf: ['run_succeeded'],
};

function theEndsOfTheRunsThatSucceeded(aLedger: LedgerMaker): void {
  it('answer the runs of one definition that succeeded, newest first, with the data of their ends alone', async () => {
    const ledger = await aLedger();
    await Effect.runPromise(
      Effect.forEach([0, 1, 2], (index) => recordedRun(ledger, `run-${index}`, endsOfAWeek(index)), { discard: true }),
    );

    const { records } = await reading(
      ledger,
      { kind: 'runs', definitionType: 'workflow', name: 'close-the-week' },
      endsThatSucceeded,
    );

    expect(records.map(({ stream, type, data }) => [stream.slice(inAlpha('runs/').length), type, data])).toEqual([
      ['run-2', 'run_started', undefined],
      ['run-2', 'run_succeeded', { detail: 'the end of run 2' }],
      ['run-0', 'run_started', undefined],
      ['run-0', 'run_succeeded', { detail: 'the end of run 0' }],
    ]);
  });
}

const awkwardText = {
  nul: 'a NUL \u0000 inside',
  unpaired: 'half a pair \uD800 alone',
  escapedBackslash: String.raw`\u0000 is six characters`,
  beforeNul: '\\\u0000',
  emoji: '😀',
  escapedNul: String.raw`a\u0000b`,
};

function theDefinitionOfAnAwkwardRun(aLedger: LedgerMaker): void {
  it('is read from the context of the first message alone, exactly as recorded, whatever its data holds', async () => {
    const ledger = await aLedger();
    const awkward = { definition_type: 'workflow', name: 'qualify-enquiry', text: awkwardText };
    const summary = { definitionType: 'reasoning', definitionName: 'summary' };
    await Effect.runPromise(
      recordedRun(ledger, 'awkward', { facts: [factOfType('run_started', awkward)], ...summary }),
    );
    await Effect.runPromise(
      recordedRun(ledger, 'named-awkwardly', {
        facts: [factOfType('run_started', 'named awkwardly')],
        definitionType: 'reasoning',
        definitionName: awkwardText.escapedNul,
      }),
    );
    const newest = { order: 'desc', limit: 10 } as const;

    const pages = await Promise.all([
      reading(ledger, { kind: 'runs', definitionType: 'reasoning', name: 'summary' }, newest),
      reading(ledger, runsOfWorkflows, newest),
      reading(ledger, { kind: 'runs', name: 'qualify-enquiry' }, newest),
      reading(ledger, { kind: 'runs', name: awkwardText.escapedNul }, newest),
      reading(ledger, { kind: 'runs', name: 'a' }, newest),
    ]);

    expect(pages.map((page) => details(page))).toEqual([[awkward], [], [], ['named awkwardly'], []]);
  });
}

export function runFiltersBehaviour(aLedger: LedgerMaker): void {
  describe('the runs of one definition', () => {
    theRunsOfOneType(aLedger);
    theRunsOfOneName(aLedger);
    theRejectedRuns(aLedger);
    theRunsNoStepStarted(aLedger);
    theEndsOfTheRunsThatSucceeded(aLedger);
    theDefinitionOfAnAwkwardRun(aLedger);
  });
}
