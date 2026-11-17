import { goalsWantedWordsOf } from '@on.auto/playbooks';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { assessing, savedWorkflow, succeededRunsOf, type Assessing } from '../../testing/goals/assessed-runs.ts';
import { temporaryLedger } from '../../testing/records/temporary-ledger.ts';
import { alpha, servingReasoning } from '../../testing/servers/reasoning-server.ts';
import { workflowSource } from '../../testing/servers/workflow-server.ts';
import { servingReasoningWithGoals } from '../../testing/settings/goals-kept.ts';
import { until } from '../../testing/waiting/until.ts';

const minute = 61_000;

const controlsText = [
  '- id: controls-hold',
  '  name: Daily controls',
  '  statement: Every control passes its daily check.',
  '  window: { calendar: day, grace: PT1H }',
  '  success:',
  '    label: Failing controls',
  '    settles: on_crossing',
  '    target: { at_most: 0 }',
  '    passed: All controls held',
  '    failed: A control failed',
  '  notify: { passed: quiet, failed: now, overdue: now, through: tell-owner }',
  '',
].join('\n');

const failingCheck = [
  'contributes:',
  '  - goal: controls-hold',
  '    purpose: Checks every control each day.',
  '    measures: /failed',
  '    final: /all_reported',
  'schedule:',
  '  every: PT1M',
  'do:',
  '  - check: { set: { failed: 1, all_reported: true } }',
];

const GoalsSchema = Schema.Struct({
  results: Schema.Boolean,
  goals: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.optionalKey(Schema.String),
      gaps: Schema.Array(Schema.Struct({ kind: Schema.String })),
      assessments: Schema.Struct({ current: Schema.NullOr(Schema.Struct({ verdict: Schema.String })) }),
    }),
  ),
});

async function served(messages: boolean): Promise<Assessing> {
  const ledger = temporaryLedger();
  const assessed = await assessing({ ledger, goals: controlsText, results: true, messages });
  onTestFinished(async () => {
    await assessed.server.stop();
    ledger.remove();
  });
  return assessed;
}

async function goalsOf(assessed: Assessing) {
  const read = await assessed.server.call('GET', `${alpha}/goals`);
  expect(read.status).toBe(200);
  return Schema.decodeUnknownSync(GoalsSchema)(read.body);
}

async function failedOnce(assessed: Assessing) {
  expect(await savedWorkflow(assessed.server, 'check', failingCheck)).toBe(201);
  return until(
    async (): Promise<Readonly<{ runs: number; read: Awaited<ReturnType<typeof goalsOf>> }>> => {
      assessed.clock.moveTo(assessed.clock.now() + minute);
      return { runs: await succeededRunsOf(assessed, 'check'), read: await goalsOf(assessed) };
    },
    ({ runs, read }) => runs > 0 && read.goals[0]?.assessments.current?.verdict === 'failed',
  );
}

async function fiveMinutesOn(assessed: Assessing): Promise<void> {
  await Array.from({ length: 5 }).reduce<Promise<void>>(async (before) => {
    await before;
    await assessed.clock.quietAt(assessed.clock.now() + minute, () => assessed.asked.length);
  }, Promise.resolve());
}

async function goalsGuideOf(assessed: Assessing): Promise<string> {
  const guide = await fetch(`${assessed.server.origin}/v1/guides/goals`);
  expect(guide.status).toBe(200);
  return guide.text();
}

describe('a Node server that judges goals with messages off', () => {
  it('judges the failure and tries no message for it, though the goal asks to be told now', async () => {
    const assessed = await served(false);
    const { read } = await failedOnce(assessed);
    await fiveMinutesOn(assessed);
    const later = await goalsOf(assessed);

    expect(read).toMatchObject({ results: true, goals: [{ id: 'controls-hold', name: 'Daily controls' }] });
    expect(later.goals.flatMap(({ gaps }) => gaps.map(({ kind }) => kind))).not.toContain('notice_not_started');
  });

  it('serves the goals guide without messages', async () => {
    const assessed = await served(false);
    const guide = await goalsGuideOf(assessed);

    expect(guide).not.toMatch(/notify\.through|## The notification function|<!--/u);
  });
});

describe('a Node server that judges goals with messages on', () => {
  it('tries the message the goal asks for, and shows the gap when its function is missing', async () => {
    const assessed = await served(true);
    await failedOnce(assessed);
    const gaps = await until(
      async (): Promise<readonly string[]> => {
        assessed.clock.moveTo(assessed.clock.now() + minute);
        return (await goalsOf(assessed)).goals.flatMap((goal) => goal.gaps.map(({ kind }) => kind));
      },
      (kinds) => kinds.includes('notice_not_started'),
    );

    expect(gaps).toContain('notice_not_started');
    expect(await goalsGuideOf(assessed)).toMatch(/## The notification function/u);
  });
});

describe('a Node server that judges goals with messages off, as its agent reads it', () => {
  it('refuses a playbook without goals and a workflow saved in one', async () => {
    const ledger = temporaryLedger();
    onTestFinished(() => {
      ledger.remove();
    });
    const before = await servingReasoning([], {}, undefined, { ledger });
    await before.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await before.stop();
    const server = await servingReasoningWithGoals([], {}, undefined, { ledger, goalsMessages: false });
    onTestFinished(async () => {
      await server.stop();
    });
    const created = await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'beta', name: 'Beta' } });
    const saved = await server.call('POST', `${alpha}/definitions/workflow`, {
      body: {
        name: 'tally',
        source: workflowSource(
          'tally',
          [
            'contributes:',
            '  - goal: weekly',
            '    purpose: Counts.',
            'do:',
            '  - count: { set: { orders: 3 } }',
            '',
          ].join('\n'),
        ),
      },
    });

    expect(created).toMatchObject({ status: 422, body: { detail: goalsWantedWordsOf(false) } });
    expect(saved).toMatchObject({ status: 422, body: { errors: [{ pointer: '' }] } });
  });
});
