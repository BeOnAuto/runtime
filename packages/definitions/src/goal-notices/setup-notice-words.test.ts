import { mostNoticeCharacters } from '@on.auto/phrasing';
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

describe('the notices of a frequent workflow that reads a list', () => {
  it('only reminds, when the workflow reads a list each run, since it may see the same few things again', () => {
    const listing = workflow(
      'track',
      [{ goal: experiments.id, purpose: 'Sees each go live.', each: '/experiments', per_id: '/id', marks: 'live' }],
      { runsADay: 1440 },
    );

    expect(goalsSaveNoticesOf([{ ...experiments, milestones: [] }], [listing])).toEqual([
      {
        kind: 'judged_too_often',
        detail:
          'The goal paying-customers judges each experiment on its own, and track runs about 1,440 times a day: if each run brings a new one, the person reads about 1,440 rows a day in Studio. Unless they asked for each one, suggest judging by the day (window calendar: day, no per) and say back what they will see. If each run sees the same few again, or they asked for each one, carry on.',
        certainty: 'reminder',
      },
    ]);
  });
});

describe('every setup notice', () => {
  it('fits within the characters of a notice, with the longest goal name and names of a usual length', () => {
    const long = 'x'.repeat(40);
    const goal = {
      ...checks,
      name: long,
      per: 'compliance check run',
    };
    const all = [
      ...goalsSaveNoticesOf([goal], [{ ...everyMinute, name: 'watch-the-compliance-checks' }]),
      ...workflowSaveNoticesOf([goal], {
        name: 'watch-the-compliance-checks',
        asks: false,
        runsADay: 100_000,
        contributes: [
          {
            goal: goal.id,
            purpose: 'x',
            per_id: '/a',
            title: `/${long.slice(0, 20)}_id`,
            marks: 'looked-into',
            measures: '/m',
          },
        ],
      }),
    ];

    expect(all.map(({ kind }) => kind)).toHaveLength(6);
    expect(
      all
        .map(({ kind, detail }) => `${kind} ${String(detail.length)}`)
        .filter((line) => Number(line.split(' ')[1]) > mostNoticeCharacters),
    ).toEqual([]);
  });
});
