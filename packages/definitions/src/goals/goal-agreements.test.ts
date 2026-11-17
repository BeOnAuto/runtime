import { Caller, playbookLedgerOf, type CallerIdentity } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, adaOfAcme, savedIn } from '../testing/callers.ts';
import {
  agreementStanding,
  goalAgreementsIn,
  goalAgreementsStream,
  isSameContent,
  playbookGoalsAgreed,
  type GoalsAgreeing,
} from './goal-agreements.ts';
import { changed, controls, experiments, oneOff, textOf } from './goal-examples.ts';
import { goalsDocumentOf } from './goals-check.ts';
import { GoalAgreementsEventSchema, type RecordedGoalAgreementsEvent } from './goals-facts.ts';
import { playbookGoalsSaved } from './goals-stream.ts';

const someWords: unknown = expect.any(String);

function documentOf(goals: readonly unknown[]) {
  return Result.getOrThrow(goalsDocumentOf(textOf(goals)));
}

type Goal = ReturnType<typeof documentOf>['goals'][number];

const factsFold = {
  initialState: [],
  evolve: (seen: readonly RecordedGoalAgreementsEvent[], fact: RecordedGoalAgreementsEvent) => [...seen, fact],
  eventSchema: GoalAgreementsEventSchema,
};

const as =
  (caller: CallerIdentity) =>
  <A, E>(effect: Effect.Effect<A, E, Caller>) =>
    Effect.runPromise(Effect.result(effect.pipe(Effect.provideService(Caller, caller))));

function inThePlaybook() {
  const ledger = memoryLedger().service;
  const context = playbookLedgerOf(ledger, savedIn);
  return {
    saving: async (goals: readonly unknown[]) => {
      const saved = await as(acmeAdmin)(
        playbookGoalsSaved({ document: documentOf(goals), assessed: new Set() }).pipe(Effect.provide(context)),
      );
      return Result.getOrThrow(saved).goals.version;
    },
    agreeing: (agreeing: GoalsAgreeing, caller = adaOfAcme) =>
      as(caller)(playbookGoalsAgreed(agreeing).pipe(Effect.provide(context))),
    reading: () => Effect.runPromise(goalAgreementsIn.pipe(Effect.provide(context))),
    facts: () =>
      Effect.runPromise(ledger.load(`playbook/${savedIn.org}/${savedIn.playbook}/${goalAgreementsStream}`, factsFold)),
  };
}

const [experimentsGoal, controlsGoal] = documentOf([experiments, controls]).goals;

function goalOf(goal: Goal | undefined): Goal {
  if (goal === undefined) {
    throw new Error('The examples hold no such goal');
  }
  return goal;
}

describe('agreeing the goals of a playbook', () => {
  it('records one fact with the yes to every goal that is not retired, at the version the person saw', async () => {
    const book = inThePlaybook();
    const version = await book.saving([experiments, controls, { ...oneOff, retired: true }]);

    const agreed = await book.agreeing({ version });
    const { state } = await book.facts();

    expect(Result.isSuccess(agreed)).toBe(true);
    expect(state.map(({ type, context }) => ({ type, by: context.by }))).toEqual([
      { type: 'playbook_goals_agreed', by: adaOfAcme.id },
    ]);
    expect(state[0]?.data.agreements.map(({ goal, version: at, by, content }) => ({ goal, at, by, content }))).toEqual([
      { goal: experiments.id, at: 1, by: adaOfAcme.id, content: experimentsGoal },
      { goal: controls.id, at: 1, by: adaOfAcme.id, content: controlsGoal },
    ]);
    expect(Result.getOrThrow(agreed).agreements).toEqual(await book.reading());
    expect(Result.getOrThrow(agreed).goals.version).toBe(1);
  });
});

describe('agreeing some of the goals', () => {
  it('records the yes to the goals named alone, and keeps the yes already given to the others', async () => {
    const book = inThePlaybook();
    const version = await book.saving([experiments, controls]);
    await book.agreeing({ version, ids: [controls.id] });
    const first = await book.reading();

    await book.agreeing({ version, ids: [experiments.id] }, acmeAdmin);
    const both = await book.reading();

    expect(first.agreements.map(({ goal }) => goal)).toEqual([controls.id]);
    expect(both.agreements.map(({ goal, by }) => ({ goal, by }))).toEqual([
      { goal: experiments.id, by: acmeAdmin.id },
      { goal: controls.id, by: adaOfAcme.id },
    ]);
    expect(both.agreements[1]).toEqual(first.agreements[0]);
  });

  it('appends nothing when every goal named is already agreed as it is saved', async () => {
    const book = inThePlaybook();
    const version = await book.saving([experiments, controls]);
    await book.agreeing({ version });
    const before = await book.reading();

    const again = await book.agreeing({ version, ids: [experiments.id] });

    expect(Result.getOrThrow(again).agreements).toEqual(before);
    expect((await book.facts()).version).toBe(1);
  });
});

describe('agreeing the goals after they change', () => {
  it('asks for a new yes for a goal saved again with a change, and keeps the yes of a goal left as it was', async () => {
    const book = inThePlaybook();
    await book.saving([experiments, controls]);
    await book.agreeing({ version: 1 });
    const restated = changed(experiments, ['statement'], 'Bring in paying customers through every experiment.');
    const version = await book.saving([restated, controls]);
    const [changedGoal, keptGoal] = documentOf([restated, controls]).goals;
    const standing = await book.reading();

    expect(agreementStanding(goalOf(changedGoal), standing)).toBeUndefined();
    expect(agreementStanding(goalOf(keptGoal), standing)).toMatchObject({ goal: controls.id, version: 1 });

    await book.agreeing({ version });
    const after = await book.reading();

    expect(agreementStanding(goalOf(changedGoal), after)).toMatchObject({ goal: experiments.id, version: 2 });
    expect(agreementStanding(goalOf(keptGoal), after)).toMatchObject({ goal: controls.id, version: 1 });
  });

  it('keeps the yes of a goal that is retired after it, and drops the yes of a goal left out of the goals', async () => {
    const book = inThePlaybook();
    await book.saving([experiments, controls]);
    await book.agreeing({ version: 1 });
    const version = await book.saving([{ ...experiments, retired: true }, oneOff]);
    await book.agreeing({ version });
    const [retired, added] = documentOf([{ ...experiments, retired: true }, oneOff]).goals;
    const after = await book.reading();

    expect(agreementStanding(goalOf(retired), after)).toMatchObject({ goal: experiments.id, version: 1 });
    expect(agreementStanding(goalOf(added), after)).toMatchObject({ goal: oneOff.id, version: 2 });
    expect(after.agreements.map(({ goal }) => goal)).toEqual([experiments.id, oneOff.id]);
  });

  it('is none before any yes is recorded', async () => {
    expect(await inThePlaybook().reading()).toEqual({ agreements: [] });
  });
});

describe('a yes that cannot be recorded', () => {
  it('is refused for a playbook with no saved goals', async () => {
    expect(await inThePlaybook().agreeing({ version: 0 })).toEqual(
      Result.fail(
        expect.objectContaining({
          _tag: 'invalid_input',
          detail: someWords,
          issues: [],
        }),
      ),
    );
  });
});

describe('a yes to goals that changed or are gone', () => {
  it('is refused at a version the goals have moved past, naming both versions, and records nothing', async () => {
    const book = inThePlaybook();
    await book.saving([experiments]);
    await book.saving([experiments, controls]);

    expect(await book.agreeing({ version: 1 })).toEqual(
      Result.fail(
        expect.objectContaining({
          _tag: 'conflict',
          detail: someWords,
        }),
      ),
    );
    expect((await book.facts()).version).toBe(0);
  });

  it('is refused for an id that names no saved goal, or a goal that is retired, pointing at each', async () => {
    const book = inThePlaybook();
    const version = await book.saving([experiments, { ...controls, retired: true }]);

    expect(await book.agreeing({ version, ids: [experiments.id, 'nobody-here', controls.id] })).toEqual(
      Result.fail(
        expect.objectContaining({
          _tag: 'invalid_input',
          detail: "A yes can't be recorded for these goals",
          issues: [
            { pointer: '/ids/1', detail: 'This playbook has no saved goal with the id nobody-here' },
            {
              pointer: '/ids/2',
              detail: `The goal ${controls.id} is retired; a yes is recorded only for goals that are not retired`,
            },
          ],
        }),
      ),
    );
    expect((await book.facts()).version).toBe(0);
  });
});

describe('a yes when every goal is retired', () => {
  it('is refused when every goal is retired', async () => {
    const book = inThePlaybook();
    const version = await book.saving([{ ...experiments, retired: true }]);

    expect(await book.agreeing({ version })).toEqual(
      Result.fail(
        expect.objectContaining({
          _tag: 'invalid_input',
          detail: someWords,
        }),
      ),
    );
  });
});

describe('whether a goal is the one agreed', () => {
  const agreed = goalOf(experimentsGoal);

  it('compares every field the goal holds, whatever their order, and leaves retired out', () => {
    const { id, ...rest } = agreed;
    const reordered: Goal = { ...rest, id };

    expect(isSameContent({ ...agreed }, agreed)).toBe(true);
    expect(isSameContent(reordered, agreed)).toBe(true);
    expect(isSameContent({ ...agreed, retired: true }, agreed)).toBe(true);
    expect(isSameContent({ ...agreed, success: { ...agreed.success, target: { at_least: 2 } } }, agreed)).toBe(false);
  });

  it('counts a field it does not know by name, so a field added to goals later needs a new yes when it changes', () => {
    const named = { ...agreed, name: 'Paying customers' };
    const renamed = { ...agreed, name: 'Customers from experiments' };
    const withName: Goal = named;
    const withOtherName: Goal = renamed;
    const nameFirst = { name: 'Paying customers', ...agreed };
    const reorderedName: Goal = nameFirst;

    expect(isSameContent(withName, withName)).toBe(true);
    expect(isSameContent(reorderedName, withName)).toBe(true);
    expect(isSameContent(withOtherName, withName)).toBe(false);
    expect(isSameContent(agreed, withName)).toBe(false);
  });
});
