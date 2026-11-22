import { PlaybookWriter } from '@on.auto/operations';
import { Option, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { changedMeanwhile } from '../registry/registry-decisions.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { goalsBook, goalsDocumentOfTheExamples } from '../testing/goals-book.ts';
import { goalDecider, goalStream } from './goal-decider.ts';
import { experiments } from './goal-examples.ts';
import { goalNames } from './goal-names.ts';
import { mostGoals } from './goals-document.ts';

const at = { by: 'acme-admin', at: '2026-11-20T09:00:00.000Z' };

const someWords: unknown = expect.any(String);

const theGoal = Option.getOrThrow(Option.fromNullishOr(goalsDocumentOfTheExamples([experiments]).goals[0]));

function created(definition: string, id = theGoal.id, playbook = 'alpha', retired = false) {
  const goal = { ...theGoal, id, ...(retired ? { retired } : {}) };
  const command = { type: 'save', goal, position: 0, playbook, ...at } as const;
  return { definition, stream: goalStream, decider: goalDecider(definition), command };
}

const renamedBy = { id: at.by, name: at.by };

function renamed(definition: string, from: string, to: string, playbook = 'alpha') {
  const command = { type: 'rename', from, to, renamed_by: renamedBy, playbook, ...at } as const;
  return { definition, stream: goalStream, decider: goalDecider(definition), command };
}

function movedToBeta(definition: string) {
  const command = {
    type: 'move',
    playbook: 'alpha',
    to: 'beta',
    moved_by: recordedAdmin,
    position: 0,
    expectedVersion: 1,
    ...at,
  } as const;
  return { definition, stream: goalStream, decider: goalDecider(definition), command };
}

type Decision =
  | Readonly<ReturnType<typeof created>>
  | Readonly<ReturnType<typeof renamed>>
  | Readonly<ReturnType<typeof movedToBeta>>;

function namesKept() {
  const book = goalsBook();
  const written = (decided: () => readonly Decision[]) =>
    book.as()(PlaybookWriter.use((writer) => writer.executeOnDefinitions(decided())));
  return {
    appended: (...goals: readonly (readonly [string, string])[]) =>
      written(() => goals.map(([definition, id]) => created(definition, id))),
    retired: (definition: string, id: string) => written(() => [created(definition, id, 'alpha', true)]),
    renamed: (...renames: readonly (readonly [string, string, string])[]) =>
      written(() => renames.map(([definition, from, to]) => renamed(definition, from, to))),
    written,
    held: () =>
      book
        .goalNames()
        .map(({ definitionKey, playbookKey, name, status }) => [definitionKey, playbookKey, name, status] as const)
        .toSorted((one, other) => one[0].localeCompare(other[0])),
  };
}

const inBeta = (index: number) => created(`goal-b${String(index)}`, `goal-number-${String(index)}`, 'beta');

const takenWithItsWords = Result.fail(expect.objectContaining({ _tag: 'conflict', kind: 'taken' }));

const alpha = 'playbook/acme/alpha/';

describe('the names of goals, kept in the append', () => {
  it('hold each goal id of a playbook under the key of the goal', async () => {
    const names = namesKept();

    expect(Result.isSuccess(await names.appended(['goal-1', theGoal.id]))).toBe(true);
    expect(names.held()).toEqual([['definition/acme/goal-1/', 'playbook/acme/alpha/', theGoal.id, 'active']]);
  });

  it('refuse a goal id another goal of the playbook claims in the same append, or one it holds, as changed meanwhile', async () => {
    const names = namesKept();

    const together = await names.appended(['goal-1', theGoal.id], ['goal-2', theGoal.id]);
    await names.appended(['goal-1', theGoal.id]);
    const after = await names.appended(['goal-2', theGoal.id]);

    expect([together, after]).toEqual([Result.fail(changedMeanwhile), Result.fail(changedMeanwhile)]);
    expect(names.held()).toEqual([['definition/acme/goal-1/', 'playbook/acme/alpha/', theGoal.id, 'active']]);
  });

  it(`refuse a goal beyond the ${String(mostGoals)} a playbook keeps, as changed meanwhile`, async () => {
    const names = namesKept();
    await names.appended(
      ...Array.from(
        { length: mostGoals },
        (_, index) => [`goal-${String(index)}`, `goal-number-${String(index)}`] as const,
      ),
    );

    expect(await names.appended(['goal-9', 'one-goal-more'])).toEqual(Result.fail(changedMeanwhile));
    expect(names.held()).toHaveLength(mostGoals);
  });
});

describe('the names of goals, at a move', () => {
  it('place a goal that moves in the playbook it moved to, and free its id where it was', async () => {
    const names = namesKept();
    await names.appended(['goal-1', theGoal.id]);

    expect(Result.isSuccess(await names.written(() => [movedToBeta('goal-1')]))).toBe(true);
    expect(Result.isSuccess(await names.appended(['goal-2', theGoal.id]))).toBe(true);
    expect(names.held()).toEqual([
      ['definition/acme/goal-1/', 'playbook/acme/beta/', theGoal.id, 'active'],
      ['definition/acme/goal-2/', 'playbook/acme/alpha/', theGoal.id, 'active'],
    ]);
  });

  it('refuse a move into a playbook that holds the id, active or retired, as taken, and nothing else of the append is kept', async () => {
    const active = namesKept();
    const retired = namesKept();
    await active.written(() => [created('goal-1'), created('goal-2', theGoal.id, 'beta')]);
    await retired.written(() => [created('goal-1'), created('goal-2', theGoal.id, 'beta', true)]);

    expect([
      await active.written(() => [movedToBeta('goal-1')]),
      await retired.written(() => [movedToBeta('goal-1')]),
    ]).toEqual([
      Result.fail(expect.objectContaining({ _tag: 'conflict', kind: 'taken' })),
      Result.fail(expect.objectContaining({ _tag: 'conflict', kind: 'taken' })),
    ]);
    expect(active.held()).toContainEqual(['definition/acme/goal-1/', 'playbook/acme/alpha/', theGoal.id, 'active']);
  });

  it(`refuse a move into a playbook that keeps ${String(mostGoals)} goals as a conflict of its own, not a change meanwhile`, async () => {
    const names = namesKept();
    await names.written(() => [created('goal-1'), ...Array.from({ length: mostGoals }, (_, index) => inBeta(index))]);

    const refused = await names.written(() => [movedToBeta('goal-1')]);

    expect(refused).toEqual(Result.fail(expect.objectContaining({ _tag: 'conflict', detail: someWords })));
    expect(refused).not.toEqual(Result.fail(changedMeanwhile));
    expect(names.held().filter(([, playbookKey]) => playbookKey === 'playbook/acme/beta/')).toHaveLength(mostGoals);
  });
});

const createdMessage = {
  type: 'goal_created',
  data: { playbook: 'alpha', position: 0, goal: { ...theGoal, retired: true } },
  context: { ...at, definitionId: 'goal-1' },
  id: 'x',
  position: 1,
  stream: 'definition/acme/goal-1/goals/goal',
};

const held = {
  playbookKey: 'playbook/acme/alpha/',
  definitionType: 'goal',
  name: theGoal.id,
  status: 'active',
  hasTriggers: false,
};

function messageOf(type: string, data: object) {
  return { ...createdMessage, type, data };
}

describe('the names of goals, renamed in the append', () => {
  it('free the id a rename gives up and claim the one it takes, which another goal may claim in turn', async () => {
    const names = namesKept();
    await names.appended(['goal-1', 'weekly-leads'], ['goal-2', 'reply-time']);

    expect(Result.isSuccess(await names.renamed(['goal-1', 'weekly-leads', 'leads-per-week']))).toBe(true);
    expect(Result.isSuccess(await names.renamed(['goal-2', 'reply-time', 'weekly-leads']))).toBe(true);
    expect(names.held()).toEqual([
      ['definition/acme/goal-1/', alpha, 'leads-per-week', 'active'],
      ['definition/acme/goal-2/', alpha, 'weekly-leads', 'active'],
    ]);
  });

  it('refuse an id another goal of the playbook holds, retired or not, as taken, keeping both ids', async () => {
    const names = namesKept();
    await names.appended(['goal-1', 'weekly-leads'], ['goal-2', 'reply-time']);

    const active = await names.renamed(['goal-1', 'weekly-leads', 'reply-time']);
    await names.retired('goal-2', 'reply-time');
    const retired = await names.renamed(['goal-1', 'weekly-leads', 'reply-time']);

    expect([active, retired]).toEqual([takenWithItsWords, takenWithItsWords]);
    expect(names.held()).toEqual([
      ['definition/acme/goal-1/', alpha, 'weekly-leads', 'active'],
      ['definition/acme/goal-2/', alpha, 'reply-time', 'retired'],
    ]);
  });

  it(`take a rename in a playbook that keeps ${String(mostGoals)} goals, since the count does not change`, async () => {
    const names = namesKept();
    await names.appended(
      ...Array.from(
        { length: mostGoals },
        (_, index) => [`goal-${String(index)}`, `goal-number-${String(index)}`] as const,
      ),
    );

    expect(Result.isSuccess(await names.renamed(['goal-0', 'goal-number-0', 'goal-number-zero']))).toBe(true);
    expect(names.held()).toHaveLength(mostGoals);
  });
});

describe('the names of goals, renamed and moved one after the other', () => {
  it('place a goal renamed then moved under its new id in the playbook it moved to, and take a rename where it moved', async () => {
    const renamedFirst = namesKept();
    const movedFirst = namesKept();
    await renamedFirst.appended(['goal-1', 'weekly-leads']);
    await movedFirst.appended(['goal-1', 'weekly-leads']);
    await renamedFirst.renamed(['goal-1', 'weekly-leads', 'leads-per-week']);
    await movedFirst.written(() => [movedToBeta('goal-1')]);

    expect([
      await renamedFirst.written(() => [movedToBeta('goal-1')]),
      await movedFirst.written(() => [renamed('goal-1', 'weekly-leads', 'leads-per-week', 'beta')]),
    ]).toMatchObject([{ _tag: 'Success' }, { _tag: 'Success' }]);
    expect([renamedFirst.held(), movedFirst.held()]).toEqual([
      [['definition/acme/goal-1/', 'playbook/acme/beta/', 'leads-per-week', 'active']],
      [['definition/acme/goal-1/', 'playbook/acme/beta/', 'leads-per-week', 'active']],
    ]);
  });
});

describe('the facts the names of goals read', () => {
  it('name the goal a creation claims, retired or not, and nothing of a stream that is not a goal own or a fact it does not read', () => {
    expect([
      goalNames.nameAfter(undefined, createdMessage),
      goalNames.nameAfter(undefined, { ...createdMessage, stream: 'definition/acme/goal-1/definitions/echo' }),
      goalNames.nameAfter(undefined, messageOf('goal_unknown', {})),
      goalNames.definitionKeyOf(createdMessage),
    ]).toEqual([{ ...held, status: 'retired' }, undefined, undefined, 'definition/acme/goal-1/']);
  });

  it('follow whether the goal is retired, release its id when it is removed, and change nothing on any other fact', () => {
    expect([
      goalNames.nameAfter(held, messageOf('goal_updated', { goal: { ...theGoal, retired: true } })),
      goalNames.nameAfter(held, messageOf('goal_updated', { goal: theGoal })),
      goalNames.nameAfter(undefined, messageOf('goal_updated', { goal: theGoal })),
      goalNames.nameAfter(held, messageOf('goal_reordered', { position: 2 })),
      goalNames.nameAfter(held, messageOf('goal_removed', {})),
      goalNames.nameAfter(
        held,
        messageOf('goal_renamed', { from: theGoal.id, to: 'leads-per-week', renamed_by: renamedBy }),
      ),
      goalNames.nameAfter(
        held,
        messageOf('goal_moved', { from: 'alpha', to: 'beta', moved_by: recordedAdmin, position: 3 }),
      ),
    ]).toEqual([
      { ...held, status: 'retired' },
      undefined,
      undefined,
      undefined,
      'released',
      { ...held, name: 'leads-per-week' },
      { ...held, playbookKey: 'playbook/acme/beta/' },
    ]);
  });

  it('answer an id held where a goal is created as changed meanwhile, since a save reads the goals first', () => {
    expect(goalNames.takenBy(held, held, [createdMessage])).toEqual(changedMeanwhile);
  });
});
