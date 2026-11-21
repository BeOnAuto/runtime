import { PlaybookWriter } from '@on.auto/operations';
import { Option, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { changedMeanwhile } from '../registry/registry-decisions.ts';
import { goalsBook, goalsDocumentOfTheExamples } from '../testing/goals-book.ts';
import { goalDecider, goalStream } from './goal-decider.ts';
import { experiments } from './goal-examples.ts';
import { goalNames } from './goal-names.ts';
import { mostGoals } from './goals-document.ts';

const at = { by: 'acme-admin', at: '2026-11-20T09:00:00.000Z' };

const theGoal = Option.getOrThrow(Option.fromNullishOr(goalsDocumentOfTheExamples([experiments]).goals[0]));

function created(definition: string, id = theGoal.id, retired = false) {
  const command = { type: 'save' as const, goal: { ...theGoal, id, retired }, position: 0, playbook: 'alpha', ...at };
  return { definition, stream: goalStream, decider: goalDecider(definition), command };
}

const renamedBy = { id: at.by, name: at.by };

function renamed(definition: string, from: string, to: string) {
  const command = { type: 'rename' as const, from, to, renamed_by: renamedBy, playbook: 'alpha', ...at };
  return { definition, stream: goalStream, decider: goalDecider(definition), command };
}

function namesKept() {
  const book = goalsBook();
  return {
    appended: (...goals: readonly (readonly [string, string])[]) =>
      book.as()(
        PlaybookWriter.use((writer) =>
          writer.executeOnDefinitions(goals.map(([definition, id]) => created(definition, id))),
        ),
      ),
    retired: (definition: string, id: string) =>
      book.as()(PlaybookWriter.use((writer) => writer.executeOnDefinitions([created(definition, id, true)]))),
    renamed: (...renames: readonly (readonly [string, string, string])[]) =>
      book.as()(
        PlaybookWriter.use((writer) =>
          writer.executeOnDefinitions(renames.map(([definition, from, to]) => renamed(definition, from, to))),
        ),
      ),
    held: () => book.goalNames().map(({ definitionKey, name, status }) => [definitionKey, name, status]),
  };
}

function byKey(one: readonly string[], other: readonly string[]): number {
  return String(one[0]).localeCompare(String(other[0]));
}

const takenWithItsWords = Result.fail(expect.objectContaining({ _tag: 'conflict', kind: 'taken' }));

describe('the names of goals, kept in the append', () => {
  it('hold each goal id of a playbook under the key of the goal', async () => {
    const names = namesKept();

    expect(Result.isSuccess(await names.appended(['goal-1', theGoal.id]))).toBe(true);
    expect(names.held()).toEqual([['definition/acme/goal-1/', theGoal.id, 'active']]);
  });

  it('refuse a goal id another goal of the playbook claims in the same append, or one it holds, as changed meanwhile', async () => {
    const names = namesKept();

    const together = await names.appended(['goal-1', theGoal.id], ['goal-2', theGoal.id]);
    await names.appended(['goal-1', theGoal.id]);
    const after = await names.appended(['goal-2', theGoal.id]);

    expect([together, after]).toEqual([Result.fail(changedMeanwhile), Result.fail(changedMeanwhile)]);
    expect(names.held()).toEqual([['definition/acme/goal-1/', theGoal.id, 'active']]);
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
    expect(names.held().toSorted(byKey)).toEqual([
      ['definition/acme/goal-1/', 'leads-per-week', 'active'],
      ['definition/acme/goal-2/', 'weekly-leads', 'active'],
    ]);
  });

  it('refuse an id another goal of the playbook holds, retired or not, as taken, keeping both ids', async () => {
    const names = namesKept();
    await names.appended(['goal-1', 'weekly-leads'], ['goal-2', 'reply-time']);

    const active = await names.renamed(['goal-1', 'weekly-leads', 'reply-time']);
    await names.retired('goal-2', 'reply-time');
    const retired = await names.renamed(['goal-1', 'weekly-leads', 'reply-time']);

    expect([active, retired]).toEqual([takenWithItsWords, takenWithItsWords]);
    expect(names.held().toSorted(byKey)).toEqual([
      ['definition/acme/goal-1/', 'weekly-leads', 'active'],
      ['definition/acme/goal-2/', 'reply-time', 'retired'],
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
    ]).toEqual([
      { ...held, status: 'retired' },
      undefined,
      undefined,
      undefined,
      'released',
      { ...held, name: 'leads-per-week' },
    ]);
  });
});
