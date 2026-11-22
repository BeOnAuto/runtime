import { mostEventsInAMultiStreamAppend } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { mostGoals } from '../goals/goals-document.ts';
import { heldGoalNamed, type PlaybookGoals } from '../goals/playbook-goals.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness } from '../testing/harness.ts';
import { recordOfTheRefusal } from '../testing/move-refusals.ts';
import {
  aGoal,
  agreedIn,
  goalOperations,
  goalsIn,
  goalsSavedIn,
  moveWithGoals,
  moveWithGoalsWhere,
  movingWithGoals,
  serving,
  tellOwner,
  toldThroughTheOwner,
} from '../testing/moving-goals.ts';
import { answerOf, greet, heldIn, moveDefinitions, toAlpha, toBeta, type Definitions } from '../testing/moving.ts';
import { mostDefinitionsMovedAtOnce } from './move-input.ts';

const intake = { type: 'workflow', name: 'intake' };

const answer = { type: 'workflow', name: 'answer' };

const both = { type: 'workflow', name: 'both' };

const callingGreet = { calls: [{ ...greet, steps: [{ number: 1, name: 'say' }] }] };

const withItsWorkflow = { goals: ['weekly-leads'], definitions: [intake, greet, tellOwner] };

const withBoth = { ...withItsWorkflow, definitions: [...withItsWorkflow.definitions, both] };

async function withGoals(): Promise<Definitions> {
  const definitions = harness();
  const created = (playbook: typeof toAlpha, input: object) =>
    definitions.call(goalOperations.createDefinition, playbook(acmeAdmin, input));
  await created(toAlpha, { ...greet, source: '{"greeting":"Hello"}' });
  await created(toAlpha, { ...tellOwner, source: '{"greeting":"Told"}', diagram: 'none' });
  await goalsSavedIn(definitions, 'alpha', [aGoal('weekly-leads', toldThroughTheOwner), aGoal('replies')]);
  await created(toAlpha, { ...intake, source: serving(['weekly-leads'], callingGreet) });
  await created(toAlpha, { ...answer, source: serving(['replies']) });
  return definitions;
}

function idsIn({ goals }: PlaybookGoals): readonly string[] {
  return goals.map(({ id }) => id);
}

function detailOf(outcome: object): string {
  return String(Reflect.get(outcome, 'detail'));
}

function tellOwnerIn(definitions: Definitions) {
  return definitions.call(
    goalOperations.createDefinition,
    toBeta(acmeAdmin, { ...tellOwner, source: '{"greeting":"Hi"}', diagram: 'none' }),
  );
}

describe('move_definitions with a goal', () => {
  it('moves the goal with the workflow that serves it and what that uses, in one append, keeping its identity, version and yes, after the goals there', async () => {
    const definitions = await withGoals();
    await goalsSavedIn(definitions, 'beta', [aGoal('beta-goal')]);
    await agreedIn(definitions, 'alpha', [{ id: 'weekly-leads', version: 1 }]);
    const before = heldGoalNamed(await goalsIn(definitions, 'alpha'), 'weekly-leads');

    const moved = await movingWithGoals(definitions, withItsWorkflow);
    const there = await goalsIn(definitions, 'beta');

    expect(moved).toMatchObject({
      status: 'succeeded',
      output: { definitions: [{ name: 'intake' }, { name: 'greet' }, { name: 'tell-owner' }], goals: ['weekly-leads'] },
    });
    expect([idsIn(there), idsIn(await goalsIn(definitions, 'alpha'))]).toEqual([
      ['beta-goal', 'weekly-leads'],
      ['replies'],
    ]);
    expect(heldGoalNamed(there, 'weekly-leads')).toEqual(before);
    expect(before).toMatchObject({ version: 1, agreed: { version: 1 } });
    expect(heldIn(definitions).filter((held) => held.startsWith('beta'))).toEqual([
      'beta echo greet',
      'beta goal beta-goal',
      'beta goal weekly-leads',
      'beta interaction tell-owner',
      'beta workflow intake',
    ]);
  });
});

describe('move_definitions with a goal alone', () => {
  it('moves a retired goal, which nothing serves, to the place after the largest there, not after their count', async () => {
    const definitions = await withGoals();
    await goalsSavedIn(definitions, 'beta', [aGoal('beta-goal'), aGoal('spare')]);
    await movingWithGoals(definitions, { goals: ['beta-goal'] }, 'beta');
    const kept = [aGoal('weekly-leads', toldThroughTheOwner), aGoal('replies'), aGoal('beta-goal')];
    await goalsSavedIn(definitions, 'alpha', [...kept, aGoal('old', { retired: true })]);

    const moved = await movingWithGoals(definitions, { goals: ['old'] });
    const there = await goalsIn(definitions, 'beta');

    expect(moved).toMatchObject({ status: 'succeeded', output: { definitions: [], goals: ['old'] } });
    expect(idsIn(there)).toEqual(['spare', 'old']);
    expect(heldGoalNamed(there, 'old')?.goal.retired).toBe(true);
  });
});

describe('move_definitions with a goal and the workflows that serve it', () => {
  it('refuses a goal without a workflow that serves it, and a workflow that also serves a goal left behind, and moves both goals together', async () => {
    const definitions = await withGoals();
    await definitions.call(
      goalOperations.createDefinition,
      toAlpha(acmeAdmin, { ...both, source: serving(['weekly-leads', 'replies']) }),
    );

    expect([
      await movingWithGoals(definitions, withItsWorkflow),
      await movingWithGoals(definitions, withBoth),
    ]).toMatchObject([
      { status: 'rejected', reason: 'conflict', kind: 'in_use' },
      { status: 'rejected', reason: 'conflict', kind: 'incomplete' },
    ]);
    expect([
      await recordOfTheRefusal(definitions, withItsWorkflow),
      await recordOfTheRefusal(definitions, withBoth),
    ]).toEqual([{ definitions: [both] }, { goals: ['replies'] }]);
    expect(idsIn(await goalsIn(definitions, 'alpha'))).toEqual(['weekly-leads', 'replies']);
    const together = { goals: ['replies', 'weekly-leads'], definitions: [...withBoth.definitions, answer] };
    expect(await movingWithGoals(definitions, together)).toMatchObject({
      status: 'succeeded',
      output: { goals: together.goals },
    });
    expect(idsIn(await goalsIn(definitions, 'beta'))).toEqual(['replies', 'weekly-leads']);
  });
});

describe('move_definitions with the workflows that serve a goal that stays', () => {
  it('moves with a goal a workflow that serves only a goal that stays, leaves one that serves none, and moves a serving workflow with no goal as before', async () => {
    const definitions = await withGoals();
    await definitions.call(
      goalOperations.createDefinition,
      toAlpha(acmeAdmin, { type: 'workflow', name: 'plain', source: '{}' }),
    );
    const alone = await withGoals();

    expect(
      await movingWithGoals(definitions, { ...withItsWorkflow, definitions: [...withItsWorkflow.definitions, answer] }),
    ).toMatchObject({ status: 'succeeded' });
    expect(heldIn(definitions)).toContain('alpha workflow plain');
    expect(await movingWithGoals(alone, { definitions: [answer] })).toMatchObject({ status: 'succeeded' });
    expect(idsIn(await goalsIn(alone, 'alpha'))).toEqual(['weekly-leads', 'replies']);
  });
});

describe('move_definitions with a goal that sends messages', () => {
  it('refuses it unless its function moves too or one of that name there sends them, and moves it where messages are off', async () => {
    const definitions = await withGoals();
    const withoutTheFunction = { goals: ['weekly-leads'], definitions: [intake, greet] };
    const refused = await movingWithGoals(definitions, withoutTheFunction);
    const record = await recordOfTheRefusal(definitions, withoutTheFunction);
    await tellOwnerIn(definitions);
    await definitions.call(goalOperations.retireDefinition, toBeta(acmeAdmin, tellOwner));
    const retiredThere = await movingWithGoals(definitions, withoutTheFunction);
    const messagesOff = await movingWithGoals(definitions, withoutTheFunction, 'alpha', moveWithGoalsWhere(false));
    const sentThere = await withGoals();
    await tellOwnerIn(sentThere);

    expect([refused, retiredThere, messagesOff, await movingWithGoals(sentThere, withoutTheFunction)]).toMatchObject([
      { status: 'rejected', reason: 'conflict', kind: 'incomplete' },
      { status: 'rejected', reason: 'conflict', kind: 'incomplete' },
      { status: 'succeeded' },
      { status: 'succeeded' },
    ]);
    expect(record).toEqual({ definitions: [tellOwner] });
  });
});

describe('move_definitions with a goal whose notification function a goal that stays shares', () => {
  it('refuses to take the function from a goal that stays, retired or not, moves it where messages are off, and moves it alone as before', async () => {
    const [shared, retiredStays, alone] = [await withGoals(), await withGoals(), await withGoals()];
    const leads = aGoal('weekly-leads', toldThroughTheOwner);
    await goalsSavedIn(shared, 'alpha', [leads, aGoal('replies', toldThroughTheOwner)]);
    await goalsSavedIn(retiredStays, 'alpha', [leads, aGoal('replies', { ...toldThroughTheOwner, retired: true })]);
    const record = await recordOfTheRefusal(shared, withItsWorkflow);

    expect([
      await movingWithGoals(shared, withItsWorkflow),
      await movingWithGoals(retiredStays, withItsWorkflow),
      await movingWithGoals(shared, withItsWorkflow, 'alpha', moveWithGoalsWhere(false)),
      await movingWithGoals(alone, { definitions: [tellOwner] }),
    ]).toMatchObject([
      { status: 'rejected', reason: 'conflict', kind: 'in_use' },
      { status: 'rejected', reason: 'conflict', kind: 'in_use' },
      { status: 'succeeded' },
      { status: 'succeeded' },
    ]);
    expect(record).toEqual({ goals: ['replies'] });
  });
});

describe('move_definitions with a goal the other playbook cannot take', () => {
  it('refuses an id held there, active or retired, as taken, and a playbook of 8 goals, counting goals alone', async () => {
    const definitions = await withGoals();
    await goalsSavedIn(definitions, 'beta', [aGoal('weekly-leads')]);
    const active = await movingWithGoals(definitions, withItsWorkflow);
    await goalsSavedIn(definitions, 'beta', [aGoal('weekly-leads', { retired: true })]);
    const retired = await movingWithGoals(definitions, withItsWorkflow);
    const goals = Array.from({ length: mostGoals }, (_, index) => aGoal(`goal-number-${String(index)}`));
    const [full, roomy] = [await withGoals(), await withGoals()];
    await goalsSavedIn(full, 'beta', goals);
    await goalsSavedIn(roomy, 'beta', goals.slice(1));

    expect([active, retired, await movingWithGoals(full, withItsWorkflow)]).toMatchObject([
      { status: 'rejected', reason: 'conflict', kind: 'taken' },
      { status: 'rejected', reason: 'conflict', kind: 'taken' },
      { status: 'rejected', reason: 'conflict' },
    ]);
    expect(detailOf(active)).not.toBe(detailOf(retired));
    expect(await movingWithGoals(full, withItsWorkflow)).not.toMatchObject({ kind: 'concurrent_change' });
    expect(await movingWithGoals(roomy, withItsWorkflow)).toMatchObject({ status: 'succeeded' });
    expect(idsIn(await goalsIn(roomy, 'beta'))).toHaveLength(mostGoals);
  });
});

describe('move_definitions refusing what a call with goals names', () => {
  it('refuses a call that names nothing to move, a goal this playbook does not hold, and a goal whose workflow has a run not ended', async () => {
    const definitions = await withGoals();
    const running = await withGoals();
    const waiting = serving(['weekly-leads'], { ...callingGreet, waits: true });
    await running.call(goalOperations.updateDefinition, toAlpha(acmeAdmin, { ...intake, source: waiting }));
    await running.call(goalOperations.runDefinition, toAlpha(acmeAdmin, { ...intake, input: {} }));

    expect([
      await movingWithGoals(definitions, {}),
      await movingWithGoals(definitions, { goals: ['weekly-leads', 'nowhere', 'gone'] }),
      await movingWithGoals(running, withItsWorkflow),
    ]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input' },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/goals/1' }, { pointer: '/goals/2' }] },
      { status: 'rejected', kind: 'runs_in_progress' },
    ]);
  });
});

const echoes = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ type: 'echo', name: `echo-${String(index)}` }));

describe('move_definitions with goals, at the limit of one append', () => {
  it('takes 64 definitions with no goal, and refuses whole a call whose definitions and goals together pass 64, each counted once', async () => {
    const definitions = await withGoals();
    const goals = ['weekly-leads', 'replies'];

    expect(mostDefinitionsMovedAtOnce).toBe(mostEventsInAMultiStreamAppend);
    expect([
      await movingWithGoals(definitions, { definitions: echoes(mostDefinitionsMovedAtOnce) }),
      await movingWithGoals(definitions, { goals, definitions: echoes(mostDefinitionsMovedAtOnce - 2) }),
      await movingWithGoals(definitions, { goals: [...goals, ...goals], definitions: echoes(63) }),
    ]).toMatchObject([
      { status: 'rejected', reason: 'not_found' },
      { status: 'rejected', reason: 'not_found' },
      { status: 'rejected', reason: 'invalid_input', issues: [] },
    ]);
  });
});

describe('move_definitions with goals, in its words', () => {
  it('names a call that names nothing, or more than one append keeps, by its task, and a move of no goal as before', async () => {
    const words = moveWithGoals.registration.plainLanguage;
    const asked = { to: 'beta', ...withItsWorkflow };
    const today = { to: 'beta', definitions: [greet] };
    const all = { goals: ['weekly-leads', 'replies'], definitions: [...withItsWorkflow.definitions, answer] };
    const movedAll = answerOf(await movingWithGoals(await withGoals(), all));
    const listed: readonly unknown[] = Object.values(new Object(movedAll['definitions']));
    const outcomeOf = (named: object, moved = 0) =>
      words?.outcome({ definitions: listed.slice(0, moved) }, { to: 'beta', ...named });

    const [nothing, tooMany] = [
      words?.attempt({ to: 'beta' }),
      words?.attempt({ to: 'beta', definitions: echoes(65) }),
    ];

    expect(nothing).toBe(tooMany);
    expect(words?.attempt(asked)).not.toBe(nothing);
    expect(
      new Set([
        outcomeOf({ goals: ['weekly-leads'] }),
        outcomeOf({ goals: ['weekly-leads', 'replies'] }),
        outcomeOf({ goals: ['weekly-leads'], definitions: [greet] }, 1),
        outcomeOf(withItsWorkflow, 3),
        outcomeOf(all, 4),
      ]).size,
    ).toBe(5);
    expect(words?.outcome({ definitions: [] }, today)).toBe(
      moveDefinitions.registration.plainLanguage?.outcome({ definitions: [] }, today),
    );
  });
});
