import { beforeGoingOnOf, type Notice, type PlaybookAddress } from '@on.auto/operations';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { defineCapability } from '../capability/capability.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { noticesWithinBudget, saveNoticesBudgetMs } from './definition-views.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const noticeOf = (kind: string): Notice => ({
  kind,
  detail: `The document says ${kind}; check it.`,
  at: '/text',
  certainty: 'likely',
});

function noticesFor(text: string): Effect.Effect<readonly Notice[]> {
  if (text === 'never') {
    return Effect.never;
  }
  if (text === 'throws') {
    throw new Error('The check of notices threw');
  }
  if (text === 'dies') {
    return Effect.die(new Error('The check of notices died'));
  }
  return Effect.succeed(
    text
      .split(' ')
      .filter((word) => word.startsWith('odd'))
      .map((word) => noticeOf(word)),
  );
}

function noticingCapability() {
  const places: PlaybookAddress[] = [];
  const capability = defineCapability({
    type: 'noticed',
    title: 'Noticed',
    guide: { name: 'noticed' },
    noun: { one: 'noticed function', other: 'noticed functions' },
    describeOutput: () => 'It answered its document.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed({ text: source }),
    notices: ({ text }, place) => {
      places.push(place);
      return noticesFor(text);
    },
    summarize: ({ text }) => ({ description: text }),
    run: ({ text }) => Effect.succeed({ output: text, record: {} }),
  });
  return { capability, places: () => places };
}

function saving() {
  const { capability, places } = noticingCapability();
  const operations = definitionOperationsFor([capability]);
  const { call } = harness();
  const create = (name: string, source: string) =>
    call(operations.createDefinition, toAlpha(acmeAdmin, { type: 'noticed', name, source }));
  const update = (name: string, source: string) =>
    call(operations.updateDefinition, toAlpha(acmeAdmin, { type: 'noticed', name, source }));
  return { call, operations, create, update, places };
}

describe('the notices of a document when it is saved', () => {
  it('are in the answer of a create and of an update, each where its condition holds, with what to do with them and the playbook handed to the check', async () => {
    const { create, update, places } = saving();

    expect(await create('greet', 'odd-word')).toMatchObject({
      status: 'succeeded',
      output: { version: 1, notices: [noticeOf('odd-word')], before_going_on: beforeGoingOnOf(1) },
    });
    expect(await update('greet', 'odd-one odd-two')).toMatchObject({
      status: 'succeeded',
      output: {
        version: 2,
        notices: [noticeOf('odd-one'), noticeOf('odd-two')],
        before_going_on: beforeGoingOnOf(2),
      },
    });
    expect(places()).toEqual([
      { org: 'acme', playbook: 'alpha' },
      { org: 'acme', playbook: 'alpha' },
    ]);
  });

  it('are left out of the answer when nothing holds, and the definition is saved either way', async () => {
    const { create, update } = saving();
    const created = await create('greet', 'plain');
    const updated = await update('greet', 'plainer');

    expect([created, updated]).toMatchObject([
      { status: 'succeeded', output: { version: 1 } },
      { status: 'succeeded', output: { version: 2 } },
    ]);
    expect(JSON.stringify([created, updated])).not.toContain('notices');
  });
});

describe('the notices of a save, bounded', () => {
  it('are at most three in an answer', async () => {
    const { create } = saving();

    expect(await create('greet', 'odd-a odd-b odd-c odd-d')).toMatchObject({
      status: 'succeeded',
      output: { notices: ['odd-a', 'odd-b', 'odd-c'].map((kind) => noticeOf(kind)) },
    });
  });

  it('are none, and the definition saved, when their check throws or dies', async () => {
    const { create } = saving();

    const answers = [await create('throws', 'throws'), await create('dies', 'dies')];

    expect(answers).toMatchObject([
      { status: 'succeeded', output: { version: 1, source: 'throws' } },
      { status: 'succeeded', output: { version: 1, source: 'dies' } },
    ]);
    expect(JSON.stringify(answers)).not.toContain('notices');
  });

  it('are none on a read or a run of the definition', async () => {
    const { call, operations, create } = saving();
    await create('greet', 'odd-word');

    const read = await call(operations.getDefinition, toAlpha(acmeAdmin, { type: 'noticed', name: 'greet' }));
    const run = await call(operations.runDefinition, toAlpha(acmeAdmin, { type: 'noticed', name: 'greet' }));

    expect([read, run]).toMatchObject([{ status: 'succeeded' }, { status: 'succeeded' }]);
    expect(JSON.stringify([read, run])).not.toContain('notices');
  });
});

describe('the notices of a save whose check does not answer', () => {
  it('are given up at the budget of two seconds, and the definition is saved without them', async () => {
    const { capability } = noticingCapability();
    const operations = definitionOperationsFor([capability]);
    const { run, dispatch } = harness();
    const request = toAlpha(acmeAdmin, { type: 'noticed', name: 'greet', source: 'never' });

    const [beforeTheBudget, answer] = await run(
      Effect.gen(function* () {
        const creating = yield* Effect.forkChild(dispatch(operations.createDefinition, request));
        yield* TestClock.adjust(saveNoticesBudgetMs - 1);
        const before = creating.pollUnsafe() !== undefined;
        yield* TestClock.adjust(1);
        return [before, yield* Fiber.join(creating)] as const;
      }),
    );

    expect(beforeTheBudget).toBe(false);
    expect(answer).toMatchObject({ status: 'succeeded', output: { version: 1, source: 'never' } });
    expect(JSON.stringify(answer)).not.toContain('notices');
  });
});

describe('the notices of a prepared definition within a budget', () => {
  it('are none when its capability checks none', async () => {
    expect(await Effect.runPromise(noticesWithinBudget({}, { org: 'acme', playbook: 'alpha' }))).toEqual([]);
  });

  it('are given up at a budget of its own', async () => {
    const prepared = { notices: () => Effect.never };

    expect(await Effect.runPromise(noticesWithinBudget(prepared, { org: 'acme', playbook: 'alpha' }, 10))).toEqual([]);
  });
});
