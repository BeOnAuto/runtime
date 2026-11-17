import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe } from 'vitest';

import { AssessmentEventSchema, GoalRefusalEventSchema, GoalSummaryEventSchema } from './goal-facts.ts';

const ofThePlaybook = { at: '2026-11-09T18:00:00.000Z', by: 'playbook:alpha' };

const window = {
  opens: '2026-11-02T17:00:00.000Z',
  closes: '2026-11-09T17:00:00.000Z',
  due: '2026-11-10T17:00:00.000Z',
};

const source = {
  record: '0b9f1c2e-5d4a-4f7e-9a61-3c2d8e7f1a05',
  run: '6a1e2b3c-4d5e-4f60-8a71-92b3c4d5e6f7',
  workflow: 'measure-experiments',
  version: 3,
  entry: 0,
  item: 2,
};

const opened = {
  type: 'goal_assessment_opened',
  data: {
    goal: 'paying-customers',
    goals_version: 1,
    per: { id: 'experiment-7' },
    window,
    rule: { settles: 'on_crossing', target: { at_least: 1 }, window: { after: 'live', for: 'P7D', grace: 'P1D' } },
    milestones: [
      { id: 'chosen', label: 'Idea chosen', by: 'person' },
      { id: 'live', label: 'Taken live', by: 'person' },
      { id: 'measured', label: 'Measured', by: 'auto' },
    ],
  },
  context: ofThePlaybook,
} as const;

const observed = {
  type: 'goal_observed',
  data: {
    source,
    at: '2026-11-09T09:00:00.000Z',
    marks: 'live',
    measurement: { value: 1, final: false, as_of: '2026-11-09T08:30:00.000Z' },
    title: 'Experiment 7',
    link: 'https://example.com/experiments/7',
    says: 'One customer paid through the experiment',
    window,
  },
  context: ofThePlaybook,
} as const;

const assessed = {
  type: 'goal_assessed',
  data: { verdict: 'passed', at: '2026-11-09T09:00:00.000Z', by: 'crossing', told: 'now', source },
  context: ofThePlaybook,
} as const;

const overdue = {
  type: 'goal_overdue',
  data: { since: '2026-11-10T17:00:00.000Z', told: 'summary' },
  context: ofThePlaybook,
} as const;

const noticeStarted = {
  type: 'goal_notice_started',
  data: { change: 'passed', run: '9c8b7a6d-5e4f-5a3b-8c2d-1e0f9a8b7c6d' },
  context: ofThePlaybook,
} as const;

const noticeRefused = {
  type: 'goal_notice_refused',
  data: {
    change: 'passed',
    attempt: 2,
    detail: 'The function tell-owner could not be started now',
    retry_at: '2026-11-09T09:04:00.000Z',
  },
  context: ofThePlaybook,
} as const;

const ended = {
  type: 'goal_assessment_ended',
  data: { reason: 'no_result' },
  context: ofThePlaybook,
} as const;

const stopped = {
  type: 'goal_stopped',
  data: {
    run: '019a8f2e-7b6c-7d5e-8f40-3a2b1c0d9e8f',
    at: '2026-11-09T10:00:00.000Z',
    reason: 'The lookup of the experiment failed, so nothing was measured.',
  },
  context: ofThePlaybook,
} as const;

const summaryStarted = {
  type: 'goal_summary_started',
  data: {
    due: '2026-11-13T17:00:00.000Z',
    window: { from: '2026-11-06T17:00:00.000Z', to: '2026-11-13T17:00:00.000Z' },
    run: '2f3e4d5c-6b7a-5980-9a1b-2c3d4e5f6a7b',
  },
  context: ofThePlaybook,
} as const;

const observationRefused = {
  type: 'goal_observation_refused',
  data: {
    run: '6a1e2b3c-4d5e-4f60-8a71-92b3c4d5e6f7',
    detail: 'The output at /customers_attributed is no finite number',
  },
  context: ofThePlaybook,
} as const;

const folder = new URL('.', import.meta.url);

describe('the facts of an assessment', () => {
  recordedFactsBehaviour({
    schema: AssessmentEventSchema,
    folder,
    releases: {
      '0.57.0': [opened, observed, assessed, overdue, noticeStarted, noticeRefused, ended],
      '0.63.0': [stopped],
    },
  });
});

describe('the facts of the summaries of a goal', () => {
  recordedFactsBehaviour({
    schema: GoalSummaryEventSchema,
    folder,
    releases: { '0.57.0': [summaryStarted, noticeRefused] },
  });
});

describe('the facts of the observations a goal refused', () => {
  recordedFactsBehaviour({
    schema: GoalRefusalEventSchema,
    folder,
    releases: { '0.57.0': [observationRefused] },
  });
});
