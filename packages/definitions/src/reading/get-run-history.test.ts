import { memoryRecordedContent } from '@on.auto/content/testing';
import {
  ActedOnRunContextSchema,
  changingNothing,
  type Decided,
  type Decider,
  factOf,
  type Presenter,
  type RecordedPage,
  type RecordedPageRequest,
  type RecordedSelection,
} from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters, runCanceller, runSettler } from '../index.ts';
import { runStartCursorIn } from '../run-work/recorded-runs.ts';
import type { RunCommand, RunResult } from '../runs/run-commands.ts';
import { runDecider } from '../runs/run-decider.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { asQueryString, firstMoment, harness, type LedgerRead, runStreamIn, toPlaybook } from '../testing/harness.ts';
import { relayedId, settledAt, withHandOn } from '../testing/relaying.ts';
import { succeededRunsPageOf, type SucceededRunsReader } from './succeeded-runs.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const otherId = '0199a3c4-7d2e-7c1a-9b3f-000000000001';

const KeySchema = Schema.Struct({ key: Schema.String });

const StandInLogEventSchema = Schema.Union([
  factOf('input_applied', KeySchema, ActedOnRunContextSchema),
  factOf('state_patched', KeySchema, ActedOnRunContextSchema),
]);

type StandInLogEvent = Decided<typeof StandInLogEventSchema.Type>;

interface Logging {
  readonly event: StandInLogEvent;
  readonly at: string;
}

const runLog: Decider<null, Logging, typeof StandInLogEventSchema.Type> = {
  initialState: null,
  evolve: (state) => state,
  decide: ({ event }) => Result.succeed([event]),
  context: ({ at }) => ({ at, by: 'playbook:alpha', runId }),
  eventSchema: StandInLogEventSchema,
};

const decodeKey = Schema.decodeUnknownSync(KeySchema);

const runLogPresenter: Presenter = {
  streamKind: 'run-logs',
  publicNames: { input_applied: ['input_applied'], state_patched: [] },
  present: ({ data }) => [{ type: 'input_applied', summary: 'An input was applied.', data: decodeKey(data) }],
  changes: changingNothing(['input_applied', 'state_patched']),
};

async function playbookWithRun(presenters: readonly Presenter[] = makeDefinitionPresenters([echo])) {
  const operations = definitionOperationsFor([echo], presenters);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting":"Hi"}' }),
  );
  const running = (id: string, at: string) =>
    definitions.call(operations.runDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', run_id: id }), at);
  const reading = (input: object) =>
    definitions.call(operations.getRunHistory, toAlpha(acmeAdmin, { run_id: runId, ...input }));
  const logging = (event: StandInLogEvent, at: string, recordedAt: string) =>
    definitions.run(
      Effect.orDie(definitions.ledger.service.execute(`playbook/acme/alpha/run-logs/${runId}`, runLog, { event, at })),
      recordedAt,
    );
  return { ...definitions, ...operations, running, reading, logging };
}

function withCursor(cursor: string | undefined): object {
  return cursor === undefined ? {} : { cursor };
}

const nextCursorOf = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ next_cursor: Schema.NullOr(Schema.String) }) }),
);

function typesIn(outcome: unknown): readonly string[] {
  return Schema.decodeUnknownSync(
    Schema.Struct({ output: Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }) }),
  )(outcome).output.events.map(({ type }) => type);
}

async function runWithLog(presenters?: readonly Presenter[]) {
  const playbook = await playbookWithRun(presenters);
  await playbook.running(runId, '2026-10-01T09:00:10.000Z');
  await playbook.logging(
    { type: 'input_applied', data: { key: 'early' } },
    '2026-10-01T09:00:05.000Z',
    '2026-10-01T09:00:11.000Z',
  );
  await playbook.logging(
    { type: 'state_patched', data: { key: 'patch' } },
    '2026-10-01T09:00:06.000Z',
    '2026-10-01T09:00:11.000Z',
  );
  await playbook.logging(
    { type: 'input_applied', data: { key: 'same' } },
    '2026-10-01T09:00:10.000Z',
    '2026-10-01T09:00:12.000Z',
  );
  await playbook.logging(
    { type: 'input_applied', data: { key: 'late' } },
    '2026-10-01T09:00:20.000Z',
    '2026-10-01T09:00:21.000Z',
  );
  return playbook;
}

const keysAndTypesOf = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({
      events: Schema.Array(
        Schema.Struct({ type: Schema.String, data: Schema.Struct({ key: Schema.optionalKey(Schema.String) }) }),
      ),
    }),
  }),
);

function keysAndTypesIn(outcome: unknown): readonly string[] {
  return keysAndTypesOf(outcome).output.events.map(({ type, data }) => data.key ?? type);
}

const withRunLog = [...makeDefinitionPresenters([echo]), runLogPresenter];

async function everyKeyAndType(
  read: (cursor: string | undefined) => Promise<unknown>,
  cursor?: string,
): Promise<readonly (readonly string[])[]> {
  const page = await read(cursor);
  const next = nextCursorOf(page).output.next_cursor;
  const rest = next === null ? [] : await everyKeyAndType(read, next);
  return [keysAndTypesIn(page), ...rest];
}

const emptyAndEnded = { status: 'succeeded', output: { events: [], has_more: false, next_cursor: null } };

const childId = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const unknownId = '0199a3c4-7d2e-7c1a-9b3f-0000000000d1';

const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: childId };

const pageOf = (run: string, page: object) => ({ selection: { kind: 'run', run }, page });

const newestHeadOf = (run: string) => pageOf(run, { order: 'desc', limit: 1, dataOf: [] });

async function readsOf<A>(ledgerReads: () => readonly LedgerRead[], read: () => Promise<A>) {
  const before = ledgerReads().length;
  const answer = await read();
  return { answer, reads: ledgerReads().slice(before) };
}

const BrokenSchema = factOf('run_deferred', Schema.Struct({ at: Schema.String }), ActedOnRunContextSchema);

const broken: Decider<null, Decided<typeof BrokenSchema.Type>, typeof BrokenSchema.Type> = {
  initialState: null,
  evolve: (state) => state,
  decide: (event) => Result.succeed([event]),
  context: () => ({ at: '2026-10-01T09:00:00.000Z', by: 'acme-admin', runId }),
  eventSchema: BrokenSchema,
};

const alpha = { org: 'acme', playbook: 'alpha' };

const greet = { type: 'echo', name: 'greet' };

const latestRunId = '55555555-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function playbookWithRuns() {
  const operations = definitionOperationsFor([echo]);
  const definitions = harness();
  const creating = (name: string, greeting: string) =>
    definitions.call(
      operations.createDefinition,
      toAlpha(acmeAdmin, { type: 'echo', name, source: JSON.stringify({ greeting }) }),
    );
  const running = (name: string, input: unknown, runningId: string, at: string) =>
    definitions.call(
      operations.runDefinition,
      toAlpha(acmeAdmin, { type: 'echo', name, input, run_id: runningId }),
      at,
    );
  await creating('greet', 'Hi');
  await creating('wave', 'Hey');
  await running('greet', { who: 'Ada' }, '11111111-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '2026-10-01T09:01:00.000Z');
  await running('greet', ['not an object'], '22222222-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '2026-10-01T09:02:00.000Z');
  await running('wave', { who: 'Grace' }, '33333333-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '2026-10-01T09:03:00.000Z');
  await running('greet', { who: 'Linus' }, '44444444-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '2026-10-01T09:04:00.000Z');
  await running('greet', { who: 'Barbara' }, latestRunId, '2026-10-01T09:05:00.000Z');
  const after = await Effect.runPromise(runStartCursorIn(definitions.ledger.service, { ...alpha, id: latestRunId }));
  return { ledger: definitions.ledger, after };
}

const linus = {
  run_id: '44444444-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definition_version: 1,
  started_at: '2026-10-01T09:04:00.000Z',
  finished_at: '2026-10-01T09:04:00.000Z',
  output: { inline: { greeting: 'Hi', input: { who: 'Linus' } } },
};

const someWords: unknown = expect.any(String);

const answered = '0199a3c4-7d2e-7c1a-9b3f-00000000a001';

const stopped = '0199a3c4-7d2e-7c1a-9b3f-00000000a002';

const endedAt = '2026-10-01T09:00:05.000Z';

const answeredFromWhatItHad: RunResult = {
  type: 'run_succeeded',
  data: { output: { greeting: 'Hi' }, record: {}, incomplete_details: { reason: 'max_input_tokens' } },
};

const stoppedBeforeItFinished: RunResult = {
  type: 'run_rejected',
  data: {
    rejection: {
      reason: 'conflict',
      detail: 'The run needed more tool calls than it may make',
      kind: 'effect_unknown',
      because: 'max_tool_calls',
    },
  },
};

async function playbookWithRunsEndedAtALimit() {
  const operations = definitionOperationsFor([echo]);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting":"Hi"}' }),
  );
  const ended = (runIdRunsAtLimit: string, result: RunResult) => {
    const stream = runStreamIn(definitions.ledger, { type: 'echo', name: 'greet' }, runIdRunsAtLimit);
    const execute = (command: RunCommand) => definitions.ledger.service.execute(stream, runDecider, command);
    const start: RunCommand = {
      type: 'start',
      definition_type: 'echo',
      name: 'greet',
      input: {},
      started_by: { id: acmeAdmin.id, name: acmeAdmin.name },
      playbook: 'alpha',
      definition_version: 1,
      calls_tools: false,
      runId: runIdRunsAtLimit,
      by: acmeAdmin.id,
      at: firstMoment,
    };
    return Effect.orDie(
      Effect.andThen(
        execute(start),
        execute({
          type: 'finish',
          result,
          attempt: { fencingToken: 1, version: 1 },
          runId: runIdRunsAtLimit,
          by: acmeAdmin.id,
          at: endedAt,
        }),
      ),
    );
  };
  await definitions.run(
    Effect.andThen(ended(answered, answeredFromWhatItHad), ended(stopped, stoppedBeforeItFinished)),
  );
  return { ...definitions, ...operations };
}

const ofTheRun = {
  type: 'echo',
  name: 'greet',
  definition_version: 1,
  started_at: firstMoment,
  started_by: { id: acmeAdmin.id, name: acmeAdmin.name },
  finished_at: endedAt,
};

describe('the history of a run', () => {
  it('holds the facts of the run oldest first, each with its data whole within 2 KiB and its metadata', async () => {
    const { running, reading } = await playbookWithRun();
    await running(runId, '2026-10-01T09:00:10.000Z');
    const metadata = {
      stream: `playbook/acme/alpha/runs/${runId}`,
      at: '2026-10-01T09:00:10.000Z',
      by: 'acme-admin',
      run_id: runId,
      definition: { type: 'echo', name: 'greet', version: 1 },
    };

    expect(await reading({})).toMatchObject({
      status: 'succeeded',
      output: {
        events: [
          {
            type: 'run_started',
            summary: 'A run of the greeting “greet” started.',
            data: { input: {} },
            metadata: { ...metadata, position: 1 },
          },
          {
            type: 'run_succeeded',
            summary: 'A run finished.',
            data: { output: { greeting: 'Hi', input: {} }, record: { greeting: 'Hi' } },
            metadata: { ...metadata, position: 2 },
          },
        ],
        has_more: false,
        next_cursor: null,
      },
    });
  });

  it('reads a run that finished later, newest first, from a query string with its id in any case, without its deferral', async () => {
    const { call, running, getRunHistory, settling } = await withHandOn();
    await running();
    await settling({ status: 'succeeded', output: 'done', record: {} });

    const read = await call(
      getRunHistory,
      asQueryString(toAlpha(acmeAdmin, { run_id: relayedId.toUpperCase(), order: 'desc' })),
    );

    expect(typesIn(read)).toEqual(['run_succeeded', 'run_started']);
    expect(read).toMatchObject({ output: { events: [{ metadata: { at: settledAt } }, {}] } });
  });
});

describe('the history of a run with a log of its own', () => {
  it('follows the order the playbook recorded both streams in, whatever the time of each event', async () => {
    const { reading } = await runWithLog(withRunLog);
    const recorded = ['run_started', 'run_succeeded', 'early', 'same', 'late'];

    expect(keysAndTypesIn(await reading({}))).toEqual(recorded);
    expect(keysAndTypesIn(await reading({ order: 'desc' }))).toEqual(recorded.toReversed());
  });

  it('reads on from where each page ends to the events after it, in either order', async () => {
    const { reading } = await runWithLog(withRunLog);
    const after = (order: string) =>
      Promise.all(
        [1, 2, 3, 4].map(async (limit) => {
          const page = await reading({ order, limit });
          const rest = await reading({ order, cursor: String(nextCursorOf(page).output.next_cursor) });
          return [keysAndTypesIn(page), keysAndTypesIn(rest)].flat();
        }),
      );
    const recorded = ['run_started', 'run_succeeded', 'early', 'same', 'late'];

    expect([await after('asc'), await after('desc')]).toEqual([
      [recorded, recorded, recorded, recorded],
      [recorded.toReversed(), recorded.toReversed(), recorded.toReversed(), recorded.toReversed()],
    ]);
  });

  it('pages through both streams without a gap or a repeat', async () => {
    const { reading } = await runWithLog(withRunLog);

    const pages = await everyKeyAndType((cursor) => reading({ limit: 2, ...withCursor(cursor) }));

    expect(pages).toEqual([['run_started', 'run_succeeded'], ['early'], ['same', 'late']]);
  });

  it('shows the facts of the run alone when no presenter presents its log', async () => {
    const { reading } = await runWithLog();

    expect(keysAndTypesIn(await reading({}))).toEqual(['run_started', 'run_succeeded']);
  });
});

describe('get_run_history rejecting', () => {
  it('a run the playbook does not have, with a cursor or without', async () => {
    const { running, reading } = await playbookWithRun();
    await running(otherId, '2026-10-01T09:00:10.000Z');
    const notFound = {
      status: 'rejected',
      reason: 'not_found',
      detail: `There is no run ${runId} in this playbook`,
    };
    const firstOfAnother = nextCursorOf(await reading({ run_id: otherId, limit: 1 })).output.next_cursor;

    expect(await reading({})).toEqual(notFound);
    expect(await reading({ cursor: String(firstOfAnother) })).toEqual(notFound);
  });

  it('a cursor that does not decode', async () => {
    const { running, reading } = await playbookWithRun();
    await running(runId, '2026-10-01T09:00:10.000Z');

    expect(await reading({ cursor: 'not-a-cursor' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/cursor' }],
    });
  });
});

describe('the end of the history of a run', () => {
  it('is a page that says nothing more remains, without a cursor', async () => {
    const { running, reading } = await playbookWithRun();
    await running(runId, '2026-10-01T09:00:10.000Z');
    const afterTheFirst = nextCursorOf(await reading({ limit: 1 })).output.next_cursor;

    expect(await reading({ limit: 1, cursor: String(afterTheFirst) })).toMatchObject({
      status: 'succeeded',
      output: { events: [{ type: 'run_succeeded' }], has_more: false, next_cursor: null },
    });
  });
});

describe('a page of the history of a run whose records are all hidden', () => {
  it('is empty, and the run is found', async () => {
    const { running, reading } = await playbookWithRun([]);
    await running(runId, '2026-10-01T09:00:10.000Z');

    expect(await reading({})).toEqual(emptyAndEnded);
  });
});

describe('a page of the history of a run', () => {
  it('reads the page alone, however large the run, and never the whole run', async () => {
    const handed = await withHandOn();
    await handed.running(262_000);

    const { answer, reads } = await readsOf(handed.ledgerReads, handed.history);

    expect(answer).toMatchObject({ status: 'succeeded' });
    expect(reads).toEqual([pageOf(relayedId, { order: 'asc', limit: 100 })]);
  });

  it('that holds nothing but a cancel reads the newest head of the run, without its data, to tell it holds a run', async () => {
    const handed = await withHandOn();
    await handed.running();
    await handed.cancelling({ reason: 'Not needed' });

    const { answer, reads } = await readsOf(handed.ledgerReads, () =>
      handed.call(handed.getRunHistory, toAlpha(acmeAdmin, { run_id: relayedId, order: 'desc', limit: 1 })),
    );

    expect(answer).toMatchObject({ status: 'succeeded', output: { events: [{ type: 'run_cancel_requested' }] } });
    expect(reads).toEqual([pageOf(relayedId, { order: 'desc', limit: 1 }), newestHeadOf(relayedId)]);
  });

  it('of a stream that holds its caller’s cancel alone, or of no stream, is not found, from one head read', async () => {
    const handed = await withHandOn();
    await Effect.runPromise(
      runCanceller(handed.ledger.service)(
        { org: 'acme', playbook: 'alpha', id: childId, definitionType: 'relay', name: 'hand-on' },
        { kind: 'parent_ended', reason: 'The run that waited for it ended first' },
        lineage,
      ),
    );
    const historyOf = (id: string) => () => handed.call(handed.getRunHistory, toAlpha(acmeAdmin, { run_id: id }));

    const cancelledFirst = await readsOf(handed.ledgerReads, historyOf(childId));
    const unknown = await readsOf(handed.ledgerReads, historyOf(unknownId));

    expect([cancelledFirst.answer, unknown.answer]).toMatchObject([
      { status: 'rejected', reason: 'not_found' },
      { status: 'rejected', reason: 'not_found' },
    ]);
    expect([cancelledFirst.reads, unknown.reads]).toEqual([
      [pageOf(childId, { order: 'asc', limit: 20 }), newestHeadOf(childId)],
      [pageOf(unknownId, { order: 'asc', limit: 20 }), newestHeadOf(unknownId)],
    ]);
  });
});

describe('a cancelled run in the list of runs', () => {
  it('shows the reason cancelled with its kind, as rejected, and is kept by the status rejected', async () => {
    const { call, running, ledger, listRuns, run } = await withHandOn();
    await running();
    await run(
      Effect.orDie(
        runSettler(ledger.service)(
          { org: 'acme', playbook: 'alpha', id: relayedId },
          { status: 'rejected', reason: 'cancelled', detail: 'Not needed', kind: 'parent_ended' },
        ),
      ),
    );

    expect(await call(listRuns, toPlaybook('acme', 'alpha')(acmeAdmin, { status: 'rejected' }))).toMatchObject({
      output: {
        runs: [{ run_id: relayedId, status: 'rejected', rejection: { reason: 'cancelled', kind: 'parent_ended' } }],
      },
    });
  });
});

describe('a stored event of a run that no longer decodes', () => {
  it('fails the list of runs and the read of its history', async () => {
    const { getRunHistory, listRuns } = definitionOperationsFor([echo]);
    const { call, ledger, run } = harness();
    await run(
      Effect.orDie(
        ledger.service.execute(`playbook/acme/alpha/runs/${runId}`, broken, {
          type: 'run_deferred',
          data: { at: '2026-10-01T09:00:00.000Z' },
        }),
      ),
    );

    expect(await call(getRunHistory, toAlpha(acmeAdmin, { run_id: runId }))).toMatchObject({
      status: 'failed',
    });
    expect(await call(listRuns, toAlpha(acmeAdmin))).toMatchObject({ status: 'failed' });
  });
});

describe('a page of the runs of a definition that succeeded', () => {
  it('holds those started before the run it is read after, newest first, and the start of the oldest run it looked at', async () => {
    const { ledger, after } = await playbookWithRuns();

    expect(
      await Effect.runPromise(succeededRunsPageOf(ledger.service, { place: alpha, definition: greet, after })),
    ).toEqual({
      runs: [
        linus,
        {
          run_id: '11111111-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
          definition_version: 1,
          started_at: '2026-10-01T09:01:00.000Z',
          finished_at: '2026-10-01T09:01:00.000Z',
          output: { inline: { greeting: 'Hi', input: { who: 'Ada' } } },
        },
      ],
      reached: '2026-10-01T09:01:00.000Z',
    });
  });

  it('looks at no run started before since', async () => {
    const { ledger, after } = await playbookWithRuns();
    const since = '2026-10-01T09:02:00.000Z';

    expect(
      await Effect.runPromise(succeededRunsPageOf(ledger.service, { place: alpha, definition: greet, after, since })),
    ).toEqual({ runs: [linus], reached: since });
  });
});

describe('the read of a page of the runs of a definition that succeeded', () => {
  it('asks the ledger for the definition’s runs that succeeded after a place, newest first, loading only their ends', async () => {
    const asked: { selection?: RecordedSelection; page?: RecordedPageRequest } = {};
    const nextPage: RecordedPage = { records: [], hasMore: true, nextCursor: 'the-next-page', lastExamined: null };
    const reader: SucceededRunsReader = {
      readRecorded: (_, selection, page) =>
        Effect.sync(() => {
          asked.selection = selection;
          asked.page = page;
          return nextPage;
        }),
      content: memoryRecordedContent(),
    };

    expect(
      await Effect.runPromise(succeededRunsPageOf(reader, { place: alpha, definition: greet, after: 'this-page' })),
    ).toEqual({ runs: [], next: 'the-next-page' });
    expect(asked).toEqual({
      selection: { kind: 'runs', notBeginningWith: ['run_cancel_requested'], definitionType: 'echo', name: 'greet' },
      page: {
        order: 'desc',
        limit: 100,
        types: ['run_succeeded'],
        dataOf: ['run_succeeded'],
        cursor: 'this-page',
      },
    });
  });
});

describe('a run whose input and output hold U+0000', () => {
  it('lists, filters and reads like any other', async () => {
    const { createDefinition, runDefinition, getRunHistory, listRuns } = definitionOperationsFor([echo]);
    const { call } = harness();
    await call(
      createDefinition,
      toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting":"Hi\\u0000"}' }),
    );
    await call(
      runDefinition,
      toAlpha(acmeAdmin, { type: 'echo', name: 'greet', input: { text: 'a\u0000b' }, run_id: runId }),
    );

    expect(
      await call(listRuns, toAlpha(acmeAdmin, { status: 'succeeded', name: 'greet', type: 'echo' })),
    ).toMatchObject({ status: 'succeeded', output: { runs: [{ run_id: runId }] } });
    expect(await call(getRunHistory, toAlpha(acmeAdmin, { run_id: runId }))).toMatchObject({
      status: 'succeeded',
      output: {
        events: [
          { data: { input: { text: 'a\u0000b' } } },
          { data: { output: { greeting: 'Hi\u0000', input: { text: 'a\u0000b' } } } },
        ],
      },
    });
  });
});

describe('a run that ended at a limit, as get_run reads it', () => {
  it('says the limit an answer was shaped by beside the answer, and the limit a run stopped at in its rejection', async () => {
    const { call, getRun } = await playbookWithRunsEndedAtALimit();

    expect([
      await call(getRun, toAlpha(acmeAdmin, { run_id: answered })),
      await call(getRun, toAlpha(acmeAdmin, { run_id: stopped })),
    ]).toEqual([
      {
        status: 'succeeded',
        output: {
          ...ofTheRun,
          run_id: answered,
          status: 'succeeded',
          output: { greeting: 'Hi' },
          incomplete_details: { reason: 'max_input_tokens' },
          record: {},
        },
      },
      {
        status: 'succeeded',
        output: {
          ...ofTheRun,
          run_id: stopped,
          status: 'rejected',
          rejection: stoppedBeforeItFinished.data.rejection,
        },
      },
    ]);
  });
});

describe('a run that ended at a limit, as list_runs lists it', () => {
  it('lists the limit an answer was shaped by, and the because of the limit a run stopped at', async () => {
    const { call, listRuns } = await playbookWithRunsEndedAtALimit();

    expect(await call(listRuns, toAlpha(acmeAdmin))).toMatchObject({
      status: 'succeeded',
      output: {
        runs: [
          {
            ...ofTheRun,
            run_id: stopped,
            status: 'rejected',
            rejection: { reason: 'conflict', kind: 'effect_unknown', because: 'max_tool_calls' },
          },
          { ...ofTheRun, run_id: answered, status: 'succeeded', incomplete_details: { reason: 'max_input_tokens' } },
        ],
      },
    });
  });
});

describe('a run that ended at a limit, in its history', () => {
  it('says in words that the answer came from what the run had, and shows the limit in its data', async () => {
    const { call, getRunHistory } = await playbookWithRunsEndedAtALimit();

    expect(await call(getRunHistory, toAlpha(acmeAdmin, { run_id: answered, order: 'desc', limit: 1 }))).toMatchObject({
      status: 'succeeded',
      output: {
        events: [
          {
            type: 'run_succeeded',
            summary: someWords,
            data: { output: { greeting: 'Hi' }, record: {}, incomplete_details: { reason: 'max_input_tokens' } },
          },
        ],
      },
    });
  });
});

describe('what makes a read of a definition or of a run’s history stale', () => {
  it('is a change of the definition by its type and name, or any run, for a definition, and any event for a history', () => {
    const { getDefinition, getRunHistory } = definitionOperationsFor([echo]);

    expect([getDefinition.registration.staleOn, getRunHistory.registration.staleOn]).toEqual([
      [{ kind: 'definition', keyedBy: { type: 'type', name: 'name' } }, { kind: 'run' }],
      [{ kind: 'event' }],
    ]);
  });
});
