import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { playbookGoalsAgreed } from '../goals/goal-agreements.ts';
import { controls, experiments, oneOff } from '../goals/goal-examples.ts';
import { playbookGoalsIn } from '../goals/playbook-goals.ts';
import { echo } from '../testing/capabilities/echo.ts';
import {
  goalRenamedIn,
  goalsListedIn,
  goalsServedIn,
  inAlphaOf,
  renamer,
  runOf,
  workflowAsSaved,
  workflowSavedIn,
} from '../testing/goal-renaming.ts';
import { harness, type Harness } from '../testing/harness.ts';
import { goalRenamerOf } from './goal-servers.ts';
import { goalRenameRefused, mostFactsInARename } from './rename-checks.ts';

const leadsPerWeek = 'leads-per-week';

function goalNamesIn(definitions: Harness): readonly string[] {
  return definitions.ledger
    .names()
    .filter(({ definitionType }) => definitionType === 'goal')
    .map(({ name, status }) => `${name} ${status}`)
    .toSorted();
}

function versionsIn(definitions: Harness): Promise<readonly unknown[]> {
  const names = ['intake', 'scoring', 'held', 'gone', 'checks'];
  return Promise.all(names.map(async (name) => (await workflowAsSaved(definitions, name))['version']));
}

function servers(count: number) {
  return Array.from({ length: count }, (_, index) => ({ type: 'workflow', name: `serving-${String(index)}` }));
}

async function goalsReadIn(definitions: Harness) {
  return Result.getOrThrow(await inAlphaOf(definitions)(playbookGoalsIn));
}

describe('a goal renamed', () => {
  it("takes its new id under the identity it had, at its version, with the person's yes standing", async () => {
    const definitions = harness();
    await goalsServedIn(definitions);
    await inAlphaOf(definitions)(playbookGoalsAgreed({ goals: [{ id: experiments.id, version: 1 }] }));
    const [before] = (await goalsReadIn(definitions)).held;

    const renamed = await goalRenamedIn(definitions, experiments.id, leadsPerWeek);
    const [after] = (await goalsReadIn(definitions)).held;

    expect(renamed).toEqual(
      Result.succeed({ savedAgain: ['held', 'intake', 'scoring'].map((name) => ({ type: 'workflow', name })) }),
    );
    expect([after?.definition, after?.version, after?.goal.id]).toEqual([before?.definition, 1, leadsPerWeek]);
    expect(after?.agreed).toEqual(before?.agreed);
    expect(after?.agreed).toBeDefined();
    expect(goalNamesIn(definitions)).toEqual(
      [controls.id, oneOff.id, leadsPerWeek].map((name) => `${name} active`).toSorted(),
    );
  });

  it('saves again each workflow not retired that serves it, a paused one too, with only the goal of those contributions changed', async () => {
    const definitions = harness();
    await goalsServedIn(definitions);

    await goalRenamedIn(definitions, experiments.id, leadsPerWeek);
    const intake = await workflowAsSaved(definitions, 'intake');

    expect(await versionsIn(definitions)).toEqual([2, 2, 2, 1, 1]);
    expect(intake['source']).toBe(
      JSON.stringify({
        contributes: [
          [oneOff.id, oneOff.id],
          [leadsPerWeek, experiments.id],
          [controls.id, controls.id],
          [leadsPerWeek, experiments.id],
        ].map(([goal, counted]: readonly string[]) => ({ goal, purpose: `Counts toward ${String(counted)}` })),
      }),
    );
  });
});

describe('a retired goal renamed', () => {
  it('frees the id it kept for another goal to take', async () => {
    const definitions = harness();
    await goalsServedIn(definitions);
    await goalsListedIn(definitions, [experiments, controls, { ...oneOff, retired: true }]);

    const taken = await goalRenamedIn(definitions, experiments.id, oneOff.id);
    const freed = await goalRenamedIn(definitions, oneOff.id, 'first-sale');
    const takenOnceFreed = await goalRenamedIn(definitions, experiments.id, oneOff.id);

    expect(taken).toEqual(Result.fail(expect.objectContaining({ _tag: 'conflict', kind: 'taken' })));
    expect([freed, takenOnceFreed]).toMatchObject([Result.succeed({}), Result.succeed({})]);
    expect(goalNamesIn(definitions)).toEqual(
      [`${controls.id} active`, 'first-sale retired', `${oneOff.id} active`].toSorted(),
    );
  });
});

describe('a goal that is not renamed', () => {
  it('is refused for the id it has, an id no goal has, or an id another goal holds, saving nothing', async () => {
    const definitions = harness();
    await goalsServedIn(definitions);

    const refused = await Promise.all([
      goalRenamedIn(definitions, experiments.id, experiments.id),
      goalRenamedIn(definitions, 'no-such-goal', leadsPerWeek),
      goalRenamedIn(definitions, experiments.id, controls.id),
    ]);

    expect(refused).toEqual([
      Result.fail(
        expect.objectContaining({
          _tag: 'invalid_input',
          issues: [expect.objectContaining({ pointer: '/rename_goal/new_id' })],
        }),
      ),
      Result.fail(
        expect.objectContaining({
          _tag: 'invalid_input',
          issues: [expect.objectContaining({ pointer: '/rename_goal/id' })],
        }),
      ),
      Result.fail(expect.objectContaining({ _tag: 'conflict', kind: 'taken' })),
    ]);
    expect(await versionsIn(definitions)).toEqual([1, 1, 1, 1, 1]);
    expect(goalNamesIn(definitions)).toEqual(
      [controls.id, experiments.id, oneOff.id].map((name) => `${name} active`).toSorted(),
    );
  });
});

describe('a goal whose workflows hold its rename', () => {
  it('is refused while a workflow that serves it has a run that has not ended', async () => {
    const definitions = harness();
    await goalsServedIn(definitions);
    await workflowSavedIn(
      definitions,
      'waiting',
      JSON.stringify({ waits: true, contributes: [{ goal: controls.id, purpose: 'Counts the checks' }] }),
    );
    await runOf(definitions, 'waiting');

    expect(await goalRenamedIn(definitions, controls.id, 'checks-hold')).toEqual(
      Result.fail(expect.objectContaining({ _tag: 'conflict', kind: 'runs_in_progress' })),
    );
    expect(await goalRenamedIn(definitions, experiments.id, leadsPerWeek)).toMatchObject(Result.succeed({}));
  });

  it('is refused where more workflows serve it than one append saves again beside the goal', async () => {
    const definitions = harness();
    const checked = (count: number) =>
      inAlphaOf(definitions)(goalRenameRefused(renamer.started, servers(count), experiments.id));

    expect([await checked(mostFactsInARename - 1), await checked(mostFactsInARename)]).toMatchObject([
      { _tag: 'Success' },
      Result.fail(expect.objectContaining({ _tag: 'conflict' })),
    ]);
  });

  it('cannot be renamed where no workflows are kept, since those that serve it are saved again', () => {
    expect(() => goalRenamerOf([echo], renamer)).toThrow(Error);
  });
});
