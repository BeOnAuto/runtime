import {
  ActedOnRunContextSchema,
  changingNothing,
  factOf,
  type Decided,
  type Decider,
  type Presenter,
} from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { asQueryString, harness, toPlaybook } from '../testing/harness.ts';
import { relayedId, settledAt, withHandOn } from '../testing/relaying.ts';

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

describe('get_run_history', () => {
  it('is a playbook query at GET /runs/{run_id}/history, served over HTTP alone, that may meet not_found', async () => {
    const { getRunHistory } = await playbookWithRun();

    expect(getRunHistory.registration).toMatchObject({
      scope: 'playbook',
      kind: 'query',
      title: 'Get run history',
      route: { method: 'GET', path: '/runs/{run_id}/history' },
      pathParameters: ['run_id'],
      reasons: ['not_found', 'invalid_input'],
      servedOverHttpAlone: { kind: 'none' },
    });
  });
});

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

const emptyAndEnded = { status: 'succeeded', output: { events: [], has_more: false, next_cursor: null } };

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
