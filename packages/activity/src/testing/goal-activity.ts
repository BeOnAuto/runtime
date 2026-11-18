import type { PlaybookAddress } from '@on.auto/operations';
import { goalsText, leadGoalId, plainGoalId } from '@on.auto/playbooks/testing';
import { Effect, type Schema } from 'effect';

import { activityOperationsKeepingGoals } from '../goal-activity/goal-operations.ts';
import type { GoalsRead } from '../goal-activity/goal-set-aside.ts';
import { listActivity } from '../operations/list-activity.ts';
import { markActivitySeen } from '../operations/mark-activity-seen.ts';
import { goalOverdueRows, goalVerdictRows } from '../projections/goal-rows.ts';
import { activityHarness, ada, priya, type ActivityServed } from './harness.ts';
import type { RecordedFact } from './recorded-facts.ts';

export const passedHere = '6f1c7a2e-3b4d-5e6f-8a9b-0c1d2e3f4a5b';

export const overdueHere = '7a2d8b3f-4c5e-5f60-9b0a-1d2e3f4a5b6c';

const quietHere = '8b3e9c40-5d6f-5071-8c1b-2e3f4a5b6c7d';

export const failedThere = '9c4fad51-6e70-5182-9d2c-3f4a5b6c7d8e';

export const at = (time: string) => `2026-11-01T${time}:00.000Z`;

const context = (time: string) => ({ at: at(time), by: 'playbook:finance' });

const fact = (type: string, data: Schema.JsonObject, time: string): RecordedFact => ({
  type,
  data,
  context: context(time),
});

export const opened = (goal: string, time: string) =>
  fact(
    'goal_assessment_opened',
    { goal, goals_version: 1, rule: { settles: 'on_crossing', target: { at_least: 1 } }, milestones: [] },
    time,
  );

const observed = (time: string) =>
  fact(
    'goal_observed',
    {
      source: { record: 'record-1', run: 'run-1', workflow: 'measure', version: 1, entry: 0 },
      at: at(time),
      title: 'Webinar',
      says: 'Two customers signed up',
    },
    time,
  );

export const assessed = (verdict: string, told: string, time: string) =>
  fact('goal_assessed', { verdict, at: at(time), by: 'crossing', told }, time);

const overdue = (time: string) => fact('goal_overdue', { since: at(time), told: 'now' }, time);

export const assessments = (playbook: string, id: string) => `playbook/acme/${playbook}/assessments/${id}`;

export const goalsOfFinance: GoalsRead = {
  read: ({ playbook }: PlaybookAddress) =>
    playbook === 'finance'
      ? Effect.succeed({ goals: { source: goalsText, version: 1, gaps: [] } })
      : Effect.die(new Error('The playbook could not be reached')),
  setAside: () => Effect.succeed(new Map()),
};

const nullFields = {
  by_name: null,
  change: null,
  trigger: null,
  definition: null,
  run_id: null,
  output_shape: null,
  message: null,
  answer_schema: null,
  detail: null,
  status: null,
  waits_on: null,
  expires_at: null,
  about: null,
};

export const projections = [goalVerdictRows, goalOverdueRows];

async function activityOf(served: ActivityServed) {
  const harness = activityHarness(undefined, served);
  const { created, record } = harness;
  await created(priya, 'finance', at('09:00'));
  await created(ada, 'sales', at('09:00'));
  await record(
    assessments('finance', passedHere),
    opened(leadGoalId, '10:00'),
    observed('10:30'),
    assessed('passed', 'now', '11:00'),
  );
  await record(assessments('finance', overdueHere), opened(leadGoalId, '10:00'), overdue('12:00'));
  await record(assessments('finance', quietHere), opened(plainGoalId, '10:00'), assessed('passed', 'quiet', '12:30'));
  await record(assessments('sales', failedThere), opened(plainGoalId, '10:00'), assessed('failed', 'summary', '13:00'));
  return harness;
}

export const goalsKept = () => activityOf({ ...activityOperationsKeepingGoals(goalsOfFinance), projections });

export const goalsNotKept = () => activityOf({ listActivity, markActivitySeen, projections });

export const ofGoals = { kind: 'goal,goal_overdue' };

export const failedThereRow = {
  kind: 'goal',
  address: `sales/assessments/${failedThere}`,
  playbook: 'sales',
  at: at('13:00'),
  by: 'playbook:finance',
  ...nullFields,
  seen: false,
  goal: plainGoalId,
  outcome: 'failed',
  word: null,
  title: null,
  says: null,
};

export const overdueHereRow = {
  kind: 'goal_overdue',
  address: `finance/assessments/${overdueHere}`,
  playbook: 'finance',
  at: at('12:00'),
  by: 'playbook:finance',
  ...nullFields,
  seen: null,
  goal: leadGoalId,
  outcome: 'overdue',
  word: null,
  title: null,
  says: null,
};

export const passedHereRow = {
  kind: 'goal',
  address: `finance/assessments/${passedHere}`,
  playbook: 'finance',
  at: at('11:00'),
  by: 'playbook:finance',
  ...nullFields,
  seen: false,
  goal: leadGoalId,
  outcome: 'passed',
  word: 'Brought a customer',
  title: 'Webinar',
  says: 'Two customers signed up',
};
