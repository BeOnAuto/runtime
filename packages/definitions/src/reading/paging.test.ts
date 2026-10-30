import { mostExaminedInAPage, type Outcome } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostInputBytes } from '../runs/recorded-size.ts';
import { runDecider } from '../runs/run-decider.ts';
import { acmeAdmin, globexAdmin, recordedAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { relay } from '../testing/capabilities/relay.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const PageSchema = Schema.Struct({
  output: Schema.Struct({
    runs: Schema.optionalKey(Schema.Array(Schema.Struct({ run_id: Schema.String }))),
    events: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String, type: Schema.String }))),
    has_more: Schema.Boolean,
    next_cursor: Schema.NullOr(Schema.String),
  }),
});

const pageOf = Schema.decodeUnknownSync(PageSchema);

function idOf(index: number): string {
  return `0199a3c4-7d2e-7c1a-9b3f-${String(index).padStart(12, '0')}`;
}

async function playbookWithEchoes(count: number, input: object = {}) {
  const operations = definitionOperationsFor([echo, relay().capability]);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting":"Hi"}' }),
  );
  const run = (index: number) =>
    definitions.dispatch(
      operations.runDefinition,
      toAlpha(acmeAdmin, { type: 'echo', name: 'greet', input, run_id: idOf(index) }),
    );
  await definitions.run(
    Effect.forEach(
      Array.from({ length: count }, (_, index) => index + 1),
      run,
    ),
  );
  const running = (index: number) => definitions.run(run(index));
  const listing = (request: object) => definitions.call(operations.listRuns, toAlpha(acmeAdmin, request));
  const reading = (request: object) => definitions.call(operations.getRunHistory, toAlpha(acmeAdmin, request));
  return { ...definitions, ...operations, running, listing, reading };
}

type Page = (typeof PageSchema.Type)['output'];

async function everyPage(
  read: (cursor: string | undefined) => Promise<Outcome>,
  between: () => Promise<unknown> = () => Promise.resolve(),
  cursor?: string,
): Promise<readonly Page[]> {
  const { output } = pageOf(await read(cursor));
  await between();
  const rest = output.next_cursor === null ? [] : await everyPage(read, between, output.next_cursor);
  return [output, ...rest];
}

function cursorOf({ output }: typeof PageSchema.Type): string {
  return output.next_cursor ?? 'none';
}

function withCursor(cursor: string | undefined): object {
  return cursor === undefined ? {} : { cursor };
}

describe('paging through the runs of a playbook', () => {
  it('delivers every run once, newest first, while more runs start', async () => {
    const { running, listing } = await playbookWithEchoes(7);
    let next = 8;

    const pages = await everyPage(
      (cursor) => listing({ limit: 2, ...withCursor(cursor) }),
      async () => {
        await running(next);
        next += 1;
      },
    );

    expect(pages.map(({ runs = [] }) => runs.map(({ run_id: id }) => id))).toEqual([
      [idOf(7), idOf(6)],
      [idOf(5), idOf(4)],
      [idOf(3), idOf(2)],
      [idOf(1)],
    ]);
    expect(pages.map(({ has_more: hasMore }) => hasMore)).toEqual([true, true, true, false]);
  });
});

describe('the bounds of a page of runs', () => {
  it('end a page at 4 MiB of stored data, with fewer runs than its limit and a cursor', async () => {
    const { listing } = await playbookWithEchoes(9, { text: 'x'.repeat(mostInputBytes - 16) });

    const pages = await everyPage((cursor) => listing(withCursor(cursor)));

    expect(pages.map(({ runs = [] }) => runs.length)).toEqual([7, 2]);
    expect(pages.map(({ has_more: hasMore, next_cursor: next }) => [hasMore, next === null])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it.each([[{ status: 'failed' }], [{ type: 'relay' }], [{ name: 'wave' }]] as const)(
    'end a page filtered by %j after looking at a thousand runs, though none matched',
    async (filter) => {
      const { ledger, listing, run } = await playbookWithEchoes(0);
      const starting = Array.from({ length: mostExaminedInAPage + 1 }, (_, index) =>
        ledger.service.execute(`playbook/acme/alpha/runs/${idOf(index)}`, runDecider, {
          type: 'start',
          started_by: recordedAdmin,
          definition_type: 'echo',
          name: 'greet',
          definition_version: 1,
          calls_tools: false,
          input: {},
          runId: idOf(index),
          by: 'acme-admin',
          at: '2026-10-01T09:00:00.000Z',
        }),
      );
      await run(Effect.orDie(Effect.all(starting)));

      const pages = await everyPage((cursor) => listing({ ...filter, ...withCursor(cursor) }));

      expect(pages.map(({ runs, has_more: hasMore, next_cursor: next }) => [runs, hasMore, next === null])).toEqual([
        [[], true, false],
        [[], false, true],
      ]);
    },
  );
});

describe('paging through the runs of one definition', () => {
  it('fills a page of one name from the runs behind newer runs of another, and has no more after the last', async () => {
    const { call, createDefinition, runDefinition, listing } = await playbookWithEchoes(3);
    await call(createDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'wave', source: '{"greeting":"Hey"}' }));
    await call(runDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'wave', run_id: idOf(4) }));
    await call(runDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', run_id: idOf(5) }));
    await call(runDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', run_id: idOf(6) }));

    const pages = await everyPage((cursor) => listing({ name: 'greet', limit: 2, ...withCursor(cursor) }));
    const { output: wave } = pageOf(await listing({ name: 'wave', limit: 2 }));

    expect(pages.map(({ runs = [] }) => runs.map(({ run_id: id }) => id))).toEqual([
      [idOf(6), idOf(5)],
      [idOf(3), idOf(2)],
      [idOf(1)],
    ]);
    expect(pages.map(({ has_more: hasMore }) => hasMore)).toEqual([true, true, false]);
    expect([wave.runs?.map(({ run_id: id }) => id), wave.has_more, wave.next_cursor]).toEqual([[idOf(4)], false, null]);
  });
});

describe('paging through the history of a run', () => {
  it('delivers every event once in either order', async () => {
    const { reading } = await playbookWithEchoes(1);
    const historyOf = (order: string) =>
      everyPage((cursor) => reading({ run_id: idOf(1), order, limit: 1, ...withCursor(cursor) }));

    const oldestFirst = await historyOf('asc');
    const newestFirst = await historyOf('desc');

    expect(oldestFirst.flatMap(({ events = [] }) => events.map(({ type }) => type))).toEqual([
      'run_started',
      'run_succeeded',
    ]);
    expect(newestFirst.flatMap(({ events = [] }) => events.map(({ id }) => id))).toEqual(
      oldestFirst.flatMap(({ events = [] }) => events.map(({ id }) => id)).toReversed(),
    );
  });
});

describe('a cursor', () => {
  it('that does not decode, or that another playbook gave, is refused at /cursor', async () => {
    const { call, createDefinition, runDefinition, listRuns, listing } = await playbookWithEchoes(2);
    const toGamma = toPlaybook('globex', 'gamma');
    await call(createDefinition, toGamma(globexAdmin, { type: 'echo', name: 'greet', source: '{"greeting":"Hi"}' }));
    await call(runDefinition, toGamma(globexAdmin, { type: 'echo', name: 'greet' }));
    await call(runDefinition, toGamma(globexAdmin, { type: 'echo', name: 'greet' }));
    const ofGamma = await listing({
      cursor: cursorOf(pageOf(await call(listRuns, toGamma(globexAdmin, { limit: 1 })))),
    });
    expect([await listing({ cursor: 'not-a-cursor' }), ofGamma]).toEqual([
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The cursor is malformed',
        issues: [
          { detail: 'Expected a next_cursor or the cursor of an event, as a read gives it', pointer: '/cursor' },
        ],
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The cursor was not given by a read of this playbook',
        issues: [
          {
            detail: 'Expected a next_cursor or the cursor of an event that a read of this playbook gave',
            pointer: '/cursor',
          },
        ],
      },
    ]);
  });
});
