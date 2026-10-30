import { setTimeout as delay } from 'node:timers/promises';

import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { anthropicModels } from '../provider-testing/model-lists.ts';
import { jsonResponse, type Responder } from '../provider-testing/recording-fetch.ts';
import { catalogFor, idsIn, type CatalogHarness } from '../testing/catalog-harness.ts';
import type { ModelList } from './model-list.ts';

const startedAt = Date.parse('2026-10-01T09:00:00.000Z');

const anthropic = { ANTHROPIC_API_KEY: 'sk-ant-key' };

function listOf(catalog: CatalogHarness): Effect.Effect<ModelList> {
  return catalog.access.catalog.list();
}

function onTestClock<A>(scenario: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(
    TestClock.setTime(startedAt).pipe(Effect.andThen(scenario), Effect.provide(TestClock.layer())),
  );
}

function failingFrom(attempt: number): Responder {
  return (_request, made) =>
    made >= attempt ? jsonResponse({ error: 'overloaded' }, 529) : jsonResponse(anthropicModels);
}

const failingFirst: Responder = (_request, made) =>
  made === 1 ? jsonResponse({}, 503) : jsonResponse(anthropicModels);

describe('the list of a provider', () => {
  it('is read once and kept for five minutes, then read again', async () => {
    const catalog = await catalogFor(anthropic, () => jsonResponse(anthropicModels));

    const reads = await onTestClock(
      Effect.gen(function* () {
        yield* listOf(catalog);
        yield* TestClock.adjust('299 seconds');
        const kept = yield* listOf(catalog);
        const readsWhileKept = catalog.requests().length;
        yield* TestClock.adjust('1 second');
        const renewed = yield* listOf(catalog);
        return { readsWhileKept, kept: kept.listed_at, renewed: renewed.listed_at };
      }),
    );

    expect(reads).toEqual({
      readsWhileKept: 1,
      kept: '2026-10-01T09:00:00.000Z',
      renewed: '2026-10-01T09:05:00.000Z',
    });
    expect(catalog.requests()).toHaveLength(2);
  });

  it('is read once for calls that arrive while it is being read', async () => {
    const catalog = await catalogFor(anthropic, async () => {
      await delay(20);
      return jsonResponse(anthropicModels);
    });

    const lists = await Effect.runPromise(
      Effect.all([listOf(catalog), listOf(catalog), listOf(catalog)], { concurrency: 'unbounded' }),
    );

    expect(catalog.requests()).toHaveLength(1);
    expect(lists.map((list) => idsIn(list).length)).toEqual([3, 3, 3]);
  });
});

describe('a list of a provider that cannot be read again', () => {
  it('is served as it was last read, marked partial, and is not asked for again until a minute has passed', async () => {
    const catalog = await catalogFor(anthropic, failingFrom(2));

    const lists = await onTestClock(
      Effect.gen(function* () {
        yield* listOf(catalog);
        yield* TestClock.adjust('6 minutes');
        const stale = yield* listOf(catalog);
        yield* TestClock.adjust('59 seconds');
        const remembered = yield* listOf(catalog);
        const asked = catalog.requests().length;
        yield* TestClock.adjust('1 second');
        const again = yield* listOf(catalog);
        return { lists: [stale, remembered, again], asked };
      }),
    );

    expect(
      lists.lists.map(({ catalog_status: status, listed_at: listedAt, data }) => [status, listedAt, data.length]),
    ).toEqual([
      ['partial', '2026-10-01T09:00:00.000Z', 3],
      ['partial', '2026-10-01T09:00:00.000Z', 3],
      ['partial', '2026-10-01T09:00:00.000Z', 3],
    ]);
    expect([lists.asked, catalog.requests().length]).toEqual([2, 3]);
    expect(catalog.reports().map(({ status }) => status)).toEqual([529, 529]);
  });

  it('is complete again once it can be read, a minute after it could not', async () => {
    const catalog = await catalogFor(anthropic, failingFirst);

    const { failed, remembered, recovered } = await onTestClock(
      Effect.gen(function* () {
        const first = yield* listOf(catalog);
        const second = yield* listOf(catalog);
        yield* TestClock.adjust('1 minute');
        return { failed: first, remembered: second, recovered: yield* listOf(catalog) };
      }),
    );

    expect([failed, remembered, recovered].map(({ catalog_status: status, data }) => [status, data.length])).toEqual([
      ['partial', 0],
      ['partial', 0],
      ['complete', 3],
    ]);
    expect(catalog.requests()).toHaveLength(2);
  });
});
