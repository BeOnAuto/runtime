import { internalTermsIn } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { assessmentBookOf, experimentsGoal, firstDay, heldGoalOf } from '../reads/assessment-samples.ts';
import type { StandingWorkflow } from './goal-gaps.ts';
import { observationGapsIn, observationRefusedGap } from './observation-gaps.ts';

const contribution = { goal: experimentsGoal.id, purpose: 'Measures what each experiment brought in.' };

const measuring: StandingWorkflow = { name: 'measure', version: 1, paused: false, contributes: [contribution] };

const elsewhere: StandingWorkflow = {
  name: 'tidy',
  version: 3,
  paused: false,
  contributes: [{ goal: 'controls-hold', purpose: 'Checks the controls.' }],
};

const bytes = new TextEncoder();

describe('the gap of evidence that could not be read', () => {
  it('shows for a workflow whose refused evidence no later counted run of it has replaced', async () => {
    const book = assessmentBookOf();
    const id = await book.opened(experimentsGoal, firstDay, { per: 'MAR-41' });
    await book.observed(id, firstDay, { marks: 'chosen' });
    await book.refused(experimentsGoal.id, 'measure', firstDay + 60_000);
    await book.refused(experimentsGoal.id, 'tidy', firstDay + 60_000);

    const gaps = await book.inThePlaybook(
      observationGapsIn({ held: [heldGoalOf(experimentsGoal)], workflows: [measuring, elsewhere] }),
    );

    expect(gaps).toEqual([
      {
        kind: 'observation_refused',
        goal: experimentsGoal.id,
        workflow: 'measure',
        detail:
          'The latest run of measure reported something the goal paying-customers could not read (/contributes/0: The output at /customers is no finite number); fix its output or its contribution, and its next run counts.',
        fixed_by: 'agent',
      },
    ]);
  });

  it('goes once a later run of that workflow is observed for the goal', async () => {
    const book = assessmentBookOf();
    const id = await book.opened(experimentsGoal, firstDay, { per: 'MAR-41' });
    await book.refused(experimentsGoal.id, 'measure', firstDay);
    await book.observed(id, firstDay + 60_000, { marks: 'chosen' });

    expect(
      await book.inThePlaybook(observationGapsIn({ held: [heldGoalOf(experimentsGoal)], workflows: [measuring] })),
    ).toEqual([]);
  });
});

describe('the gap of evidence that could not be read, where it is not shown', () => {
  it('is not shown for a paused workflow, a retired goal, or a workflow with nothing refused', async () => {
    const book = assessmentBookOf();
    await book.refused(experimentsGoal.id, 'measure', firstDay);

    const paused = observationGapsIn({
      held: [heldGoalOf(experimentsGoal)],
      workflows: [{ ...measuring, paused: true }],
    });
    const retired = observationGapsIn({
      held: [heldGoalOf({ ...experimentsGoal, retired: true })],
      workflows: [measuring],
    });
    const unrefused = observationGapsIn({
      held: [heldGoalOf(experimentsGoal)],
      workflows: [{ ...measuring, name: 'count' }],
    });

    expect(await book.inThePlaybook(paused)).toEqual([]);
    expect(await book.inThePlaybook(retired)).toEqual([]);
    expect(await book.inThePlaybook(unrefused)).toEqual([]);
  });
});

describe('the words of the gap of evidence that could not be read', () => {
  it('keep its words plain and within 256 bytes, cutting a long refusal short', () => {
    const { detail } = observationRefusedGap('paying-customers', 'measure', 'é'.repeat(300));

    expect(bytes.encode(detail).length).toBeLessThanOrEqual(256);
    expect(detail).toContain('é…');
    expect(internalTermsIn(observationRefusedGap('paying-customers', 'measure', 'gone').detail)).toEqual([]);
  });
});
