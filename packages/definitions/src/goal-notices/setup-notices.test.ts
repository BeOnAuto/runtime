import { describe, expect, it } from 'vitest';

import type { Goal } from '../goals/goals-document.ts';
import { goalsSaveNoticesOf, workflowSaveNoticesOf, type SetupWorkflow } from './setup-notices.ts';

const success = {
  label: 'Checks that failed or did not report',
  settles: 'on_crossing',
  target: { at_most: 0 },
  passed: 'All passed',
  failed: 'Failed or gone quiet',
} as const;

const checks: Goal = {
  id: 'compliance-checks',
  name: 'Compliance checks',
  statement: 'Every compliance check passes.',
  per: 'run',
  window: { after: 'started', for: 'PT3M' },
  success,
  milestones: [
    { id: 'started', label: 'Started', by: 'auto' },
    { id: 'reported', label: 'All reported', by: 'auto' },
    { id: 'looked-into', label: 'Looked into', by: 'person' },
  ],
};

const experiments: Goal = {
  id: 'paying-customers',
  statement: 'Bring in paying customers through my experiments.',
  per: 'experiment',
  window: { after: 'live', for: 'P7D' },
  success: { ...success, label: 'New paying customers', target: { at_least: 1 } },
  milestones: [
    { id: 'chosen', label: 'Idea chosen', by: 'person' },
    { id: 'live', label: 'Launched', by: 'auto' },
    { id: 'measured', label: 'Result in', by: 'auto' },
  ],
};

const daily: Goal = {
  id: 'daily-controls',
  statement: 'Every control passes its daily check.',
  window: { calendar: 'day' },
  success,
};

function unwindowed({ window: _window, ...goal }: Goal): Goal {
  return goal;
}

function workflow(name: string, contributes: SetupWorkflow['contributes'], more: Partial<SetupWorkflow> = {}) {
  return { name, asks: false, runsADay: 1, contributes, ...more };
}

const everyMinute = workflow(
  'watch-checks',
  [
    { goal: checks.id, purpose: 'Sees a run start.', per_id: '/run_id', marks: 'started' },
    { goal: checks.id, purpose: 'Counts what failed.', per_id: '/run_id', measures: '/failed', says: '/summary' },
  ],
  { runsADay: 1440 },
);

describe('the notices of a goals save', () => {
  it("names a per that is one of Auto's own words, with what the person reads and that it cannot change", () => {
    expect(goalsSaveNoticesOf([checks], [])[0]).toEqual({
      kind: 'per_is_an_auto_word',
      detail:
        'The goal Compliance checks is judged per run, a word Auto uses for its own parts. The person reads it as the name of their thing everywhere in Studio. Ask what they call one, such as an order or a check, and use their word: it cannot change once saved. If run is their own word, carry on.',
      at: '/0/per',
      certainty: 'likely',
    });
    expect(
      ['check run', 'Jobs', 'step', 'event', 'function', 'workflow', 'experiment', 'order', 'runway'].map(
        (per) => goalsSaveNoticesOf([{ ...unwindowed(daily), per }], []).length,
      ),
    ).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0]);
  });

  it('says how many rows a day a frequent opening workflow gives a goal judged thing by thing, and suggests judging by the day', () => {
    const everyFiveMinutes = { ...everyMinute, name: 'sweep', runsADay: 288 };
    const notices = goalsSaveNoticesOf(
      [{ ...checks, per: 'check', milestones: [] }],
      [everyFiveMinutes, everyMinute, { ...everyFiveMinutes, name: 'sweep-again' }],
    );

    expect(notices).toEqual([
      {
        kind: 'judged_too_often',
        detail:
          'The goal Compliance checks judges each check on its own, and watch-checks opens one with each run, about 1,440 times a day, so the person reads about 1,440 rows a day in Studio. Unless they asked for each one, suggest judging by the day (window calendar: day, no per) and say back what they will see. If they asked for each one, carry on.',
        certainty: 'likely',
      },
    ]);
  });

  it('says nothing of frequency for an hourly workflow, one that does not open the thing, or a goal judged on a calendar', () => {
    const hourly = { ...everyMinute, runsADay: 24 };
    const notOpening = workflow('later', [{ goal: checks.id, purpose: 'Marks it.', marks: 'reported' }], {
      runsADay: 1440,
    });
    const goal = { ...checks, per: 'check', milestones: [] };

    expect(goalsSaveNoticesOf([goal], [hourly, notOpening])).toEqual([]);
    expect(
      goalsSaveNoticesOf([daily], [workflow('w', [{ goal: daily.id, purpose: 'x' }], { runsADay: 1440 })]),
    ).toEqual([]);
    expect(
      goalsSaveNoticesOf([unwindowed(goal)], [workflow('w', [{ goal: goal.id, purpose: 'x' }], { runsADay: 96 })]),
    ).toMatchObject([{ kind: 'judged_too_often' }]);
  });
});

describe('the notices of a goals save, about the milestones the person does', () => {
  it("reminds that a person's milestone needs a request while no workflow that asks them marks it", () => {
    const goal: Goal = {
      ...experiments,
      milestones: [
        { id: 'chosen', label: 'Idea chosen', by: 'person' },
        { id: 'live', label: 'Launched', by: 'auto' },
        { id: 'kept', label: 'Lesson kept', by: 'person' },
      ],
    };
    const asking = workflow('choose-idea', [{ goal: goal.id, purpose: 'Asks.', marks: 'chosen' }], { asks: true });
    const watching = workflow('watch', [{ goal: goal.id, purpose: 'Sees.', marks: 'kept' }]);

    expect(goalsSaveNoticesOf([goal], [])).toEqual([
      {
        kind: 'person_milestone_unasked',
        detail:
          '"Idea chosen" and "Lesson kept" of the goal paying-customers are the person\'s to do, and no workflow asks them for it yet. A person\'s milestone needs a request that asks them and marks it on their answer; with nothing asking them it is never marked. Build that request, or leave it out with their yes. If you are building it next, carry on.',
        certainty: 'reminder',
      },
    ]);
    expect(
      goalsSaveNoticesOf([goal], [asking, watching]).map(({ detail }) =>
        detail.startsWith('"Lesson kept" of the goal paying-customers is the person\'s'),
      ),
    ).toEqual([true]);
    expect(goalsSaveNoticesOf([experiments], [asking])).toEqual([]);
  });

  it('leaves retired goals alone, and orders the notices by what matters most', () => {
    expect(goalsSaveNoticesOf([{ ...checks, retired: true }], [])).toEqual([]);
    expect(goalsSaveNoticesOf([experiments, checks], []).map(({ kind }) => kind)).toEqual([
      'per_is_an_auto_word',
      'person_milestone_unasked',
      'person_milestone_unasked',
    ]);
  });
});

describe('the notices of a workflow save', () => {
  it('says how often it judges, that it marks a milestone the person does without asking them, and that the title is the id', () => {
    const saved = workflow(
      'watch-checks',
      [
        { goal: checks.id, purpose: 'Sees a run start.', per_id: '/run_id', title: '/run_id', marks: 'started' },
        { goal: checks.id, purpose: 'Sees it looked into.', per_id: '/run_id', marks: 'looked-into' },
        { goal: checks.id, purpose: 'Counts.', per_id: '/run_id', measures: '/failed', says: '/summary' },
      ],
      { runsADay: 1440 },
    );

    expect(workflowSaveNoticesOf([checks], saved)).toEqual([
      expect.objectContaining({ kind: 'judged_too_often' }),
      {
        kind: 'person_milestone_unasked',
        detail:
          'watch-checks marks "Looked into" for the goal Compliance checks, which the person does, but it asks them nothing, and Studio shows it as theirs to do. A person\'s milestone needs a request that asks them and marks it on their answer. If Auto only sees it happen, ask the person to make it by: auto. If it asks them another way, carry on.',
        certainty: 'likely',
      },
      {
        kind: 'title_reads_as_an_id',
        detail:
          'watch-checks titles each run of the goal Compliance checks from /run_id, the same field as its id. The person reads the title in every list and heading: point it at the name a person would call it, such as "Cold email batch to dental clinics". If /run_id holds that name, carry on.',
        certainty: 'exact',
      },
    ]);
    expect(workflowSaveNoticesOf([checks], { ...saved, asks: true, runsADay: 1 }).map(({ kind }) => kind)).toEqual([
      'title_reads_as_an_id',
    ]);
  });
});

describe('the notices of a workflow save, about what the person reads', () => {
  it('takes a title from a field named like an id or a time as likely, and one from a name as fine', () => {
    const titled = (title: string) =>
      workflowSaveNoticesOf(
        [experiments],
        workflow('watch', [
          { goal: experiments.id, purpose: 'Names it.', per_id: '/id', title, says: '/why', marks: 'live' },
        ]),
      );

    expect(
      ['/run_id', '/started_at', '/items/uuid', '/created-time'].map((title) => titled(title)[0]?.certainty),
    ).toEqual(['likely', 'likely', 'likely', 'likely']);
    expect([titled('/title'), titled('/name'), titled('/batch')]).toEqual([[], [], []]);
    expect(
      workflowSaveNoticesOf(
        [daily],
        workflow('daily', [{ goal: daily.id, purpose: 'x', title: '/id', measures: '/n', says: '/s' }]),
      ),
    ).toEqual([]);
  });
});

describe('the notices of a workflow save, about the sentence the person reads', () => {
  it('asks for the sentence the person reads when it measures without says, or marks with no sentence at all', () => {
    const measuring = workflow('count', [
      { goal: experiments.id, purpose: 'Marks it live.', per_id: '/id', marks: 'live' },
      { goal: experiments.id, purpose: 'Counts.', per_id: '/id', measures: '/customers' },
    ]);

    expect(workflowSaveNoticesOf([experiments], measuring)).toEqual([
      {
        kind: 'says_missing',
        detail:
          'count measures the goal paying-customers with no says. In Studio the person reads that sentence about each result: one plain sentence with the numbers and the names of what is missing or failed, such as "9 of 14 checks reported. Missing: audit-trail." Have the workflow write it and point says at it. If the number says it all, carry on.',
        at: '/contributes/1',
        certainty: 'likely',
      },
    ]);
    expect(
      workflowSaveNoticesOf(
        [experiments],
        workflow('watch', [
          { goal: experiments.id, purpose: 'Marks.', per_id: '/id', marks: 'live' },
          { goal: experiments.id, purpose: 'Marks.', per_id: '/id', marks: 'measured' },
        ]),
      ),
    ).toEqual([
      {
        kind: 'says_missing',
        detail:
          'watch marks "Launched" and "Result in" for the goal paying-customers with no says, so the person sees the tick and no sentence about what happened. Point says at one plain sentence written for them, with what happened and any numbers. If the tick says it all, carry on.',
        certainty: 'reminder',
      },
    ]);
  });
});

describe('the notices of a workflow save that does it well', () => {
  it('says nothing of a workflow that serves no goal in play, or that does everything the person reads well', () => {
    const fine = workflow('watch', [
      {
        goal: experiments.id,
        purpose: 'Counts.',
        per_id: '/id',
        title: '/title',
        marks: 'live',
        measures: '/customers',
        says: '/evidence',
      },
    ]);

    expect(workflowSaveNoticesOf([experiments], fine)).toEqual([]);
    expect(workflowSaveNoticesOf([{ ...checks, retired: true }], everyMinute)).toEqual([]);
    expect(workflowSaveNoticesOf([experiments], everyMinute)).toEqual([]);
  });
});
