import { describe, expect, it } from 'vitest';

import type { AssessmentFact } from './assessment-facts.ts';
import { assessmentAfter, assessmentOf, unopened, type AssessmentState } from './assessment-state.ts';
import { factsRestoredByAsking, factsDismissing, mostRequestsSetAside, type Dismissing } from './dismissing.ts';
import { factsStopping } from './stopping.ts';

const minute = (offset: number) => Date.UTC(2026, 10, 9, 9, offset);

const iso = (at: number) => new Date(at).toISOString();

const owner = { id: 'person:owner', name: 'Owner' };

const helper = { id: 'person:helper', name: 'Helper' };

const byTheCalendar = {
  goal: 'replies',
  goals_version: 1,
  rule: { settles: 'on_crossing', target: { at_least: 1 } },
  milestones: [{ id: 'answered', label: 'Answered', by: 'person' }],
} as const;

const opened: AssessmentFact = {
  type: 'goal_assessment_opened',
  data: { ...byTheCalendar, per: { id: 'request-7' } },
};

const open = assessmentOf([opened]);

const thing = { goal: 'replies', per: 'request-7' };

const after = (state: AssessmentState, facts: readonly AssessmentFact[]) =>
  facts.reduce((before, fact) => assessmentAfter(before, fact), state);

const dismissing = (at: number, by: Dismissing['by'] = owner, requests: readonly string[] = []): Dismissing => ({
  dismissed: true,
  at,
  by,
  requests,
});

const restoring = (at: number, by: Dismissing['by'] = owner): Dismissing => ({
  dismissed: false,
  at,
  by,
  requests: [],
});

describe('dismissing a thing of a goal', () => {
  it('records which thing of which goal, who dismissed it, when, and the questions it set aside, and keeps it dismissed', () => {
    const facts = factsDismissing(open, dismissing(minute(0), owner, ['ask-2', 'ask-1']));

    expect(facts).toEqual([
      { type: 'goal_dismissed', data: { ...thing, at: iso(minute(0)), by: owner, requests: ['ask-2', 'ask-1'] } },
    ]);
    expect(after(open, facts).dismissed).toEqual({ at: minute(0), by: owner, requests: ['ask-2', 'ask-1'] });
  });

  it('records the goal alone for a thing with no per, such as a day judged by the calendar', () => {
    const day = assessmentOf([{ type: 'goal_assessment_opened', data: byTheCalendar }]);
    const dismissed = after(day, factsDismissing(day, dismissing(minute(0))));

    expect([factsDismissing(day, dismissing(minute(0))), factsDismissing(dismissed, restoring(minute(1)))]).toEqual([
      [{ type: 'goal_dismissed', data: { goal: 'replies', at: iso(minute(0)), by: owner, requests: [] } }],
      [{ type: 'goal_restored', data: { goal: 'replies', at: iso(minute(1)), by: owner } }],
    ]);
  });

  it('sets aside at most ten questions, the first ten it is given', () => {
    const asked = Array.from({ length: mostRequestsSetAside + 2 }, (_, index) => `ask-${String(index)}`);

    expect(factsDismissing(open, dismissing(minute(0), owner, asked))).toEqual([
      {
        type: 'goal_dismissed',
        data: { ...thing, at: iso(minute(0)), by: owner, requests: asked.slice(0, mostRequestsSetAside) },
      },
    ]);
  });

  it('is decided by the latest fact: dismissed, restored, dismissed again', () => {
    const dismissed = after(open, factsDismissing(open, dismissing(minute(0))));
    const restored = after(dismissed, factsDismissing(dismissed, restoring(minute(1), helper)));
    const again = after(restored, factsDismissing(restored, dismissing(minute(2), helper, ['ask-3'])));

    expect([dismissed.dismissed?.at, restored.dismissed, again.dismissed]).toEqual([
      minute(0),
      undefined,
      { at: minute(2), by: helper, requests: ['ask-3'] },
    ]);
    expect(restored).toEqual(open);
  });
});

describe('a dismissal that changes nothing', () => {
  it('appends nothing to dismiss a dismissed thing, nor to restore one that is not dismissed', () => {
    const dismissed = after(open, factsDismissing(open, dismissing(minute(0))));

    expect([
      factsDismissing(dismissed, dismissing(minute(1), helper)),
      factsDismissing(open, restoring(minute(1))),
    ]).toEqual([[], []]);
  });

  it('appends nothing for a thing never opened, and folds nothing into one', () => {
    const dismissal: AssessmentFact = {
      type: 'goal_dismissed',
      data: { ...thing, at: iso(minute(0)), by: owner, requests: [] },
    };

    expect([factsDismissing(unopened, dismissing(minute(0))), assessmentAfter(unopened, dismissal)]).toEqual([
      [],
      unopened,
    ]);
  });
});

describe('a dismissed thing as it moves on', () => {
  it('may dismiss and restore a thing already judged, which keeps its verdict', () => {
    const judged = after(open, [
      { type: 'goal_assessed', data: { verdict: 'passed', at: iso(minute(0)), by: 'crossing', told: 'quiet' } },
    ]);
    const dismissed = after(judged, factsDismissing(judged, dismissing(minute(1))));
    const restored = after(dismissed, factsDismissing(dismissed, restoring(minute(2))));

    expect([dismissed.verdict, dismissed.dismissed?.at, restored.dismissed, restored.verdict]).toEqual([
      'passed',
      minute(1),
      undefined,
      'passed',
    ]);
  });

  it('stays dismissed as the thing is stopped and then judged', () => {
    const dismissed = after(open, factsDismissing(open, dismissing(minute(0), owner, ['ask-1'])));
    const stopped = after(dismissed, factsStopping(dismissed, { run: 'ask-1', at: minute(5), reason: 'No reply.' }));
    const judged = after(stopped, [
      { type: 'goal_assessed', data: { verdict: 'failed', at: iso(minute(9)), by: 'deadline', told: 'now' } },
    ]);

    expect([stopped.stopped?.run, judged.verdict, judged.dismissed]).toEqual([
      'ask-1',
      'failed',
      { at: minute(0), by: owner, requests: ['ask-1'] },
    ]);
  });
});

describe('a new question about a dismissed thing', () => {
  const auto = { id: 'playbook:replies', name: 'replies' };
  const dismissed = after(open, factsDismissing(open, dismissing(minute(0), owner, ['ask-1'])));

  it('restores the thing, by Auto, when it was asked after the dismissal', () => {
    const facts = factsRestoredByAsking(dismissed, { asked: minute(3), at: minute(4), by: auto });

    expect(facts).toEqual([{ type: 'goal_restored', data: { ...thing, at: iso(minute(4)), by: auto } }]);
    expect(after(dismissed, facts)).toEqual(open);
  });

  it('leaves it dismissed for a question asked before the dismissal or at its moment, and a thing not dismissed alone', () => {
    expect([
      factsRestoredByAsking(dismissed, { asked: minute(0) - 1, at: minute(4), by: auto }),
      factsRestoredByAsking(dismissed, { asked: minute(0), at: minute(4), by: auto }),
      factsRestoredByAsking(open, { asked: minute(3), at: minute(4), by: auto }),
    ]).toEqual([[], [], []]);
  });

  it('can be dismissed again once it is back, and a question asked before that dismissal leaves it dismissed', () => {
    const back = after(dismissed, factsRestoredByAsking(dismissed, { asked: minute(3), at: minute(4), by: auto }));
    const again = after(back, factsDismissing(back, dismissing(minute(5), helper, ['ask-2'])));

    expect([again.dismissed, factsRestoredByAsking(again, { asked: minute(3), at: minute(6), by: auto })]).toEqual([
      { at: minute(5), by: helper, requests: ['ask-2'] },
      [],
    ]);
  });
});
