import { describe, expect, it } from 'vitest';

import type { GoalRule } from '../goal-rules/goal-rule.ts';
import type { Observation } from '../observations/observation.ts';
import type { AssessmentFact } from './assessment-facts.ts';
import { assessmentAfter, assessmentOf, unopened, type AssessmentState } from './assessment-state.ts';
import { factsAtMoment } from './judging.ts';
import { factsObserving } from './observing.ts';

const found = Date.parse('2026-11-16T21:25:00.000Z');

const minutes = (count: number) => found + count * 60_000;

const due = Date.parse('2026-11-17T22:25:00.000Z');

const changeRequests: GoalRule = {
  id: 'change-requests',
  per: 'change request',
  window: { after: 'found', for: 'P1D' },
  success: { settles: 'on_crossing', target: { at_least: 1 } },
  milestones: [
    { id: 'found', label: 'Request found', by: 'auto' },
    { id: 'revised', label: 'Revision made', by: 'auto' },
    { id: 'drafted', label: 'Reply drafted', by: 'auto' },
    { id: 'approved', label: 'Approved', by: 'person' },
  ],
  notify: { passed: 'quiet', failed: 'quiet' },
};

const noShot = 'No source record for this shot was found in Drive, so nothing was revised.';

function observed(run: string, at: number, parts: Partial<Observation> = {}): Observation {
  return {
    goal: changeRequests.id,
    source: { record: `record-of-${run}`, run, workflow: 'prepare-revision', version: 2, entry: 2 },
    at,
    per: 'letterhead',
    ...parts,
  };
}

const after = (state: AssessmentState, facts: readonly AssessmentFact[]) =>
  facts.reduce((before, fact) => assessmentAfter(before, fact), state);

const observing = (state: AssessmentState, now: number, ...observations: readonly Observation[]) =>
  after(state, factsObserving(state, { goal: changeRequests, goalVersion: 1, now, observations }));

const foundIt = observing(
  unopened,
  minutes(0),
  observed('find', minutes(0), { marks: 'found', title: 'Swap the logo on the letterhead' }),
);

const notRevised = (run: string, at: number) =>
  observed(run, at, { measurement: { value: 0, final: true, as_of: at }, says: noShot });

const stoppedOnce = observing(foundIt, minutes(1), notRevised('prepare', minutes(1)));

describe('an item whose run ended without a result, by its final measurement', () => {
  it('is stopped with the run and its own words, stays open with no verdict, and keeps its due time', () => {
    expect(stoppedOnce).toMatchObject({
      verdict: 'open',
      stopped: { at: minutes(1), run: 'prepare', reason: noShot },
      window: { due },
    });
    expect(stoppedOnce.ended).toBeUndefined();
  });

  it('is judged at its due time on its final measurement, as any item is', () => {
    const judged = after(
      stoppedOnce,
      factsAtMoment(stoppedOnce, { goal: changeRequests, now: due, playbookRetired: false }),
    );

    expect([judged.verdict, judged.verdictBy, judged.verdictAt]).toEqual(['failed', 'final', due]);
  });

  it('takes the later run that stopped it again, and has no reason when that run says nothing', () => {
    const counting = observing(
      stoppedOnce,
      minutes(2),
      observed('counting', minutes(2), { measurement: { value: 0, final: false, as_of: minutes(2) } }),
    );
    const again = observing(
      counting,
      minutes(3),
      observed('again', minutes(3), { measurement: { value: 0, final: true, as_of: minutes(3) } }),
    );

    expect(again.stopped).toEqual({ at: minutes(3), run: 'again' });
  });
});

describe('an item a final measurement does not stop', () => {
  it('is one whose final measurement meets the target, nor on a goal judged at its close', () => {
    const atClose: GoalRule = { ...changeRequests, success: { settles: 'at_close', target: { at_least: 1 } } };
    const opened = after(
      unopened,
      factsObserving(unopened, {
        goal: atClose,
        goalVersion: 1,
        now: minutes(0),
        observations: [observed('find', minutes(0), { marks: 'found' })],
      }),
    );
    const closing = after(
      opened,
      factsObserving(opened, {
        goal: atClose,
        goalVersion: 1,
        now: minutes(1),
        observations: [notRevised('prepare', minutes(1))],
      }),
    );
    const ready = observing(
      foundIt,
      minutes(1),
      observed('prepare', minutes(1), {
        measurement: { value: 1, final: true, as_of: minutes(1) },
      }),
    );

    expect([closing.stopped, ready.stopped, ready.verdict]).toEqual([undefined, undefined, 'passed']);
  });
});

describe('a stopped item that moves again', () => {
  it('is no longer stopped when a later run marks its next milestone', () => {
    const revised = observing(stoppedOnce, minutes(5), observed('later', minutes(5), { marks: 'revised' }));

    expect([revised.stopped, revised.verdict]).toEqual([undefined, 'open']);
  });

  it('is no longer stopped when a later run measures it with a number that is not final', () => {
    const measured = observing(
      stoppedOnce,
      minutes(5),
      observed('later', minutes(5), {
        measurement: { value: 0, final: false, as_of: minutes(5) },
      }),
    );

    expect(measured.stopped).toBeUndefined();
  });

  it('stays stopped when the run that stopped it also marks a milestone', () => {
    const marked = assessmentAfter(stoppedOnce, {
      type: 'goal_observed',
      data: {
        source: {
          record: 'record-of-prepare-mark',
          run: 'prepare',
          workflow: 'prepare-revision',
          version: 2,
          entry: 0,
        },
        at: new Date(minutes(1)).toISOString(),
        marks: 'revised',
      },
    });

    expect(marked.stopped).toEqual(stoppedOnce.stopped);
  });
});

describe('an item a failed run stopped', () => {
  const failed: AssessmentFact = {
    type: 'goal_stopped',
    data: { run: 'failed-run', at: new Date(minutes(2)).toISOString(), reason: 'The lookup of the shot failed.' },
  };

  it('is stopped with the failed run and its reason, open, with no verdict', () => {
    expect(assessmentAfter(foundIt, failed)).toMatchObject({
      verdict: 'open',
      stopped: { at: minutes(2), run: 'failed-run', reason: 'The lookup of the shot failed.' },
    });
  });

  it('takes no stop once it was judged or ended, nor before it opened', () => {
    const judged = assessmentOf([
      ...factsObserving(unopened, {
        goal: changeRequests,
        goalVersion: 1,
        now: minutes(0),
        observations: [observed('find', minutes(0), { marks: 'found' })],
      }),
      {
        type: 'goal_assessed',
        data: { verdict: 'failed', at: new Date(due).toISOString(), by: 'deadline', told: 'quiet' },
      },
    ]);
    const ended = assessmentAfter(foundIt, { type: 'goal_assessment_ended', data: { reason: 'goal_retired' } });

    expect([
      assessmentAfter(judged, failed).stopped,
      assessmentAfter(ended, failed).stopped,
      assessmentAfter(unopened, failed).stopped,
    ]).toEqual([undefined, undefined, undefined]);
  });
});
