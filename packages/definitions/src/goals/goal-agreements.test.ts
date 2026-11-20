import type { CallerIdentity } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, adaOfAcme } from '../testing/callers.ts';
import { goalsBook, goalsDocumentOfTheExamples as documentOf } from '../testing/goals-book.ts';
import { playbookGoalsAgreed, type GoalSeen } from './goal-agreements.ts';
import { changed, controls, experiments, oneOff } from './goal-examples.ts';
import { playbookGoalsSaved } from './goals-saved.ts';
import { goalVersionIn, playbookGoalsIn, type PlaybookGoals } from './playbook-goals.ts';

const someWords: unknown = expect.any(String);

function inThePlaybook() {
  const book = goalsBook();
  const reading = async (): Promise<PlaybookGoals> => Result.getOrThrow(await book.as()(playbookGoalsIn));
  return {
    ...book,
    saving: async (goals: readonly unknown[]) => {
      await book.as()(playbookGoalsSaved({ document: documentOf(goals), assessed: new Set() }));
      return reading();
    },
    agreeing: (goals: readonly GoalSeen[], caller: CallerIdentity = adaOfAcme) =>
      book.as(caller)(playbookGoalsAgreed({ goals })),
    agreedOf: async () =>
      (await reading()).held.map(({ goal, agreed }) => ({ id: goal.id, version: agreed?.version, by: agreed?.by })),
  };
}

function seenIn(goals: PlaybookGoals, ...ids: readonly string[]): readonly GoalSeen[] {
  return ids.map((id) => ({ id, version: goalVersionIn(goals, id) }));
}

const waiting = { version: undefined, by: undefined };

describe('agreeing the goals of a playbook', () => {
  it('records goal_agreed on each goal named, at the version the person saw, and answers the goals with the yes on each', async () => {
    const book = inThePlaybook();
    const saved = await book.saving([experiments, controls, oneOff]);

    const agreed = await book.agreeing(seenIn(saved, experiments.id, controls.id));

    expect(Result.getOrThrow(agreed).held.map(({ goal, agreed: yes }) => [goal.id, yes?.version])).toEqual([
      [experiments.id, 1],
      [controls.id, 1],
      [oneOff.id, undefined],
    ]);
    expect(
      (await book.factsOf(controls.id)).map(({ type, data, context }) => ({ type, data, by: context.by })),
    ).toEqual([
      expect.objectContaining({ type: 'goal_created' }),
      { type: 'goal_agreed', data: { version: 1 }, by: adaOfAcme.id },
    ]);
    expect((await book.factsOf(oneOff.id)).map(({ type }) => type)).toEqual(['goal_created']);
  });

  it('keeps the yes already given to the others, records the yes to one named twice once, and nothing for a yes that stands', async () => {
    const book = inThePlaybook();
    const saved = await book.saving([experiments, controls]);
    await book.agreeing(seenIn(saved, controls.id));

    await book.agreeing([...seenIn(saved, experiments.id), ...seenIn(saved, experiments.id)], acmeAdmin);
    const again = await book.agreeing(seenIn(saved, experiments.id, controls.id));

    expect(Result.isSuccess(again)).toBe(true);
    expect(await book.agreedOf()).toEqual([
      { id: experiments.id, version: 1, by: acmeAdmin.id },
      { id: controls.id, version: 1, by: adaOfAcme.id },
    ]);
    expect((await book.factsOf(experiments.id)).map(({ type }) => type)).toEqual(['goal_created', 'goal_agreed']);
  });
});

describe('agreeing the goals after they change', () => {
  it('asks for a new yes for a goal saved again with a change, at its new version, and keeps the yes of a goal left as it was', async () => {
    const book = inThePlaybook();
    const first = await book.saving([experiments, controls]);
    await book.agreeing(seenIn(first, experiments.id, controls.id));
    const restated = changed(experiments, ['statement'], 'Bring in paying customers through every experiment.');

    const second = await book.saving([restated, controls]);

    expect(await book.agreedOf()).toEqual([
      { id: experiments.id, ...waiting },
      { id: controls.id, version: 1, by: adaOfAcme.id },
    ]);
    await book.agreeing(seenIn(second, experiments.id));
    expect(await book.agreedOf()).toEqual([
      { id: experiments.id, version: 2, by: adaOfAcme.id },
      { id: controls.id, version: 1, by: adaOfAcme.id },
    ]);
  });

  it('keeps the yes of a goal retired after it and of a goal in a new place, and drops the yes of one left out', async () => {
    const book = inThePlaybook();
    const first = await book.saving([experiments, controls]);
    await book.agreeing(seenIn(first, experiments.id, controls.id));

    await book.saving([oneOff, { ...experiments, retired: true }]);
    await book.saving([oneOff, experiments, controls]);

    expect(await book.agreedOf()).toEqual([
      { id: oneOff.id, ...waiting },
      { id: experiments.id, version: 1, by: adaOfAcme.id },
      { id: controls.id, ...waiting },
    ]);
  });
});

describe('a yes that cannot be recorded', () => {
  it('is refused for a playbook with no saved goals', async () => {
    expect(await inThePlaybook().agreeing([{ id: experiments.id, version: 1 }])).toEqual(
      Result.fail(expect.objectContaining({ _tag: 'invalid_input', detail: someWords, issues: [] })),
    );
  });

  it('is refused at a version a goal has moved past, naming the goal and both versions, and records nothing', async () => {
    const book = inThePlaybook();
    const first = await book.saving([experiments, controls]);
    await book.saving([changed(experiments, ['statement'], 'Bring in customers.'), controls]);

    expect(await book.agreeing(seenIn(first, controls.id, experiments.id))).toEqual(
      Result.fail(expect.objectContaining({ _tag: 'conflict', detail: someWords })),
    );
    expect(await book.agreedOf()).toEqual([
      { id: experiments.id, ...waiting },
      { id: controls.id, ...waiting },
    ]);
  });

  it('is refused for an id that names no saved goal, or a goal that is retired, pointing at each, and records nothing', async () => {
    const book = inThePlaybook();
    const saved = await book.saving([experiments, { ...controls, retired: true }]);
    const named = [...seenIn(saved, experiments.id), { id: 'nobody-here', version: 1 }, ...seenIn(saved, controls.id)];

    expect(await book.agreeing(named)).toEqual(
      Result.fail(
        expect.objectContaining({
          _tag: 'invalid_input',
          detail: "A yes can't be recorded for these goals",
          issues: [
            { pointer: '/goals/1/id', detail: someWords },
            { pointer: '/goals/2/id', detail: someWords },
          ],
        }),
      ),
    );
    expect((await book.factsOf(experiments.id)).map(({ type }) => type)).toEqual(['goal_created']);
  });
});
