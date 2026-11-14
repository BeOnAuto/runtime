import { chatDelivery, notificationDocument } from '@on.auto/interaction/testing';
import { Schema } from 'effect';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { chatEnvironment, chatServer } from '../testing/interaction-servers/chat-deliveries.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { workflowSource } from '../testing/servers/workflow-server.ts';
import {
  createdWithGoals,
  goalsText,
  goalsTextGaps,
  leadGoalId,
  plainGoalId,
  servingReasoningWithGoals,
} from '../testing/settings/goals-kept.ts';

const marking = ['chosen', 'prepared', 'live', 'measured'].flatMap((marks) => [
  `  - goal: ${leadGoalId}`,
  '    purpose: Marks where each experiment stands.',
  '    per_id: /experiment',
  `    marks: ${marks}`,
]);

const counting = [
  `  - goal: ${leadGoalId}`,
  '    purpose: Counts the customers each experiment brought in.',
  '    per_id: /experiment',
  '    measures: /customers',
];

const countingFinal = [...counting, '    final: /closed'];

const ordering = [`  - goal: ${plainGoalId}`, '    purpose: Counts the orders of the week.', '    measures: /orders'];

const workflowOf = (name: string, contributes: readonly string[]) =>
  workflowSource(name, ['contributes:', ...contributes, 'do:', '  - count: { set: { orders: 3 } }', ''].join('\n'));

const perThingWithoutMilestones = [
  '- id: closed-invoices',
  '  statement: Get every invoice I send paid in full.',
  '  per: invoice',
  '  success:',
  '    label: Invoices paid',
  '    settles: on_crossing',
  '    target: { at_least: 1 }',
  '    passed: Paid',
  '    failed: Unpaid',
  '  notify: { passed: quiet, failed: quiet }',
  '',
].join('\n');

const changedGoals = goalsText
  .replace('    - { id: prepared, label: Package prepared, by: auto }\n', '')
  .replace('  notify: { passed: quiet, failed: quiet }', '  notify: { passed: quiet, failed: quiet }\n  retired: true');

const GappedSchema = Schema.Struct({
  goals: Schema.Struct({
    gaps: Schema.Array(
      Schema.Struct({
        kind: Schema.String,
        goal: Schema.optionalKey(Schema.String),
        workflow: Schema.optionalKey(Schema.String),
        detail: Schema.String,
      }),
    ),
  }),
});

const gapsIn = (body: unknown) => Schema.decodeUnknownSync(GappedSchema)(body).goals.gaps;

const kindsIn = (body: unknown) => gapsIn(body).map(({ kind, goal, workflow }) => ({ kind, goal, workflow }));

const ofGoal = (kind: string, goal: string) => ({ kind, goal, workflow: undefined });

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

async function saved(on: ReasoningServer, name: string, contributes: readonly string[]): Promise<number> {
  const body = { name, source: workflowOf(name, contributes) };
  return (await on.call('POST', `${alpha}/definitions/workflow`, { body })).status;
}

async function servedWithNotifier(): Promise<ReasoningServer> {
  const chat = await chatServer();
  const on = await servingReasoningWithGoals([], chatEnvironment(chat.url));
  server = on;
  expect(await createdWithGoals(on)).toMatchObject({ status: 201, body: { goals: { gaps: goalsTextGaps } } });
  const notifier = await on.call('POST', `${alpha}/definitions/interaction`, {
    body: { name: 'tell-owner', source: notificationDocument(chatDelivery), diagram: 'none' },
  });
  expect(notifier.status).toBe(201);
  return on;
}

describe('the gaps of goals on the Node server, from the workflows saved beside them', () => {
  it('say a measure nothing calls final and a measure only a paused workflow reports, on get', async () => {
    const on = await servedWithNotifier();
    const saves = [await saved(on, 'marking', [...marking, ...counting]), await saved(on, 'ordering', ordering)];
    const paused = await on.call('POST', `${alpha}/definitions/workflow/ordering/pause`, { body: {} });
    const read = await on.call('GET', alpha);

    expect([...saves, paused.status, read.status]).toEqual([201, 201, 200, 200]);
    expect(kindsIn(read.body)).toEqual([
      ofGoal('measure_never_final', leadGoalId),
      ofGoal('measure_paused', plainGoalId),
    ]);
    expect(gapsIn(read.body).map(({ detail }) => detail)).toEqual([
      'No workflow that reports New paying customers for the goal paying-customers says when it is final, so no window of it can be judged at its close: give one of them final.',
      'Only paused workflows report Orders this week for the goal steady-orders (ordering): resume one, or give an active workflow a contribution that measures it.',
    ]);
  });

  it('are none once everything is served, and name the contributions orphaned when the goals change', async () => {
    const on = await servedWithNotifier();
    const saves = [await saved(on, 'marking', [...marking, ...countingFinal]), await saved(on, 'ordering', ordering)];
    const read = await on.call('GET', alpha);
    const updated = await on.call('PUT', alpha, { body: { goals: changedGoals } });

    expect(saves).toEqual([201, 201]);
    expect(kindsIn(read.body)).toEqual([]);
    expect(updated.status).toBe(200);
    expect(kindsIn(updated.body)).toEqual([
      { kind: 'contribution_orphaned', goal: leadGoalId, workflow: 'marking' },
      { kind: 'contribution_orphaned', goal: plainGoalId, workflow: 'ordering' },
    ]);
  });
});

describe('the gaps of a goal judged per thing on the Node server', () => {
  it('ask the person for its milestones when it names none', async () => {
    server = await servingReasoningWithGoals([]);
    const created = await createdWithGoals(server, { goals: perThingWithoutMilestones });

    expect(created).toMatchObject({
      status: 201,
      body: {
        goals: {
          gaps: [
            {
              kind: 'no_milestones',
              goal: 'closed-invoices',
              fixed_by: 'person',
              ask: 'What has to happen to one invoice, start to finish, and which of those are yours?',
            },
            { kind: 'measure_unreported', goal: 'closed-invoices' },
          ],
        },
      },
    });
  });
});

async function anOlderPlaybook(): Promise<void> {
  const before = await servingReasoning([], {}, undefined, { ledger });
  try {
    await before.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await before.call('POST', `${alpha}/definitions/workflow`, {
      body: { name: 'tally', source: workflowSource('tally', 'do:\n  - count: { set: { orders: 3 } }\n') },
    });
  } finally {
    await before.stop();
  }
}

describe('the gaps of an older playbook on the Node server', () => {
  it('are no_goal until its goals are sent, and then name the workflow saved before them', async () => {
    await anOlderPlaybook();
    server = await servingReasoningWithGoals([], {}, undefined, { ledger });

    const read = await server.call('GET', alpha);
    const updated = await server.call('PUT', alpha, { body: { goals: perThingWithoutMilestones } });

    expect(read).toMatchObject({ status: 200, body: { goals: { gaps: [{ kind: 'no_goal', fixed_by: 'person' }] } } });
    expect(kindsIn(updated.body)).toEqual([
      { kind: 'workflow_without_contribution', goal: undefined, workflow: 'tally' },
      ofGoal('no_milestones', 'closed-invoices'),
      ofGoal('measure_unreported', 'closed-invoices'),
    ]);
  });
});
