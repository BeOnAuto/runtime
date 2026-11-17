import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { chatEnvironment, chatServer } from '../testing/interaction-servers/chat-deliveries.ts';
import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { createdWithGoals, servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

const GappedSchema = Schema.Struct({
  goals: Schema.Struct({ gaps: Schema.Array(Schema.Struct({ kind: Schema.String })) }),
});

const kindsIn = (body: unknown) => Schema.decodeUnknownSync(GappedSchema)(body).goals.gaps.map(({ kind }) => kind);

const fenced = /^```\n([\s\S]*?)^```$/gmu;

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function guideExamples(on: ReasoningServer): Promise<readonly string[]> {
  const guide = await fetch(`${on.origin}/v1/guides/goals`);
  const blocks: string[] = [];
  for (const [, block] of (await guide.text()).matchAll(fenced)) {
    blocks.push(String(block));
  }
  return blocks;
}

async function servedWithChat(): Promise<ReasoningServer> {
  return (await servedBesideChat()).on;
}

async function servedBesideChat() {
  const chat = await chatServer();
  server = await servingReasoningWithGoals([], chatEnvironment(chat.url));
  return { on: server, chat };
}

interface Saving {
  readonly playbook: string;
  readonly type: 'interaction' | 'workflow';
  readonly name: string;
  readonly source: string;
}

function saved(on: ReasoningServer, { playbook, type, name, source }: Saving) {
  return on.call('POST', `/v1/orgs/acme/playbooks/${playbook}/definitions/${type}`, {
    body: type === 'workflow' ? { name, source } : { name, source, diagram: 'none' },
  });
}

const workflowOf = (name: string, contributes: string) =>
  workflowSource(name, `${contributes}do:\n  - check: { set: { failed: 0 } }\n`);

describe('the worked examples of the goals guide, saved as the guide says on a server that keeps goals', () => {
  it('give the experiments goal its notification function and two workflows, and leave it no gap', async () => {
    const on = await servedWithChat();
    const [experiments, , weekly, hourly, , notifier] = await guideExamples(on);

    const created = await createdWithGoals(on, {
      playbook: 'experiments',
      name: 'Experiments',
      goals: String(experiments),
    });
    const saves = [
      await saved(on, { playbook: 'experiments', type: 'interaction', name: 'tell-owner', source: String(notifier) }),
      await saved(on, {
        playbook: 'experiments',
        type: 'workflow',
        name: 'next-experiment',
        source: workflowOf('next-experiment', String(weekly)),
      }),
      await saved(on, {
        playbook: 'experiments',
        type: 'workflow',
        name: 'track-experiments',
        source: workflowOf('track-experiments', String(hourly)),
      }),
    ];
    const read = await on.call('GET', '/v1/orgs/acme/playbooks/experiments');

    expect(created.status).toBe(201);
    expect(kindsIn(created.body)).toEqual([
      'measure_unreported',
      'milestone_unmarked',
      'milestone_unmarked',
      'window_never_starts',
      'milestone_unmarked',
      'notice_function_missing',
    ]);
    expect(saves.map(({ status }) => status)).toEqual([201, 201, 201]);
    expect(kindsIn(read.body)).toEqual([]);
  });
});

describe('the worked examples of the goals guide, saved as the guide says on a server that keeps goals', () => {
  it('give the daily controls goal its notification function and its one workflow, and leave it no gap', async () => {
    const on = await servedWithChat();
    const [, controls, , , daily, notifier] = await guideExamples(on);

    const created = await createdWithGoals(on, { playbook: 'controls', name: 'Controls', goals: String(controls) });
    const saves = [
      await saved(on, { playbook: 'controls', type: 'interaction', name: 'tell-owner', source: String(notifier) }),
      await saved(on, {
        playbook: 'controls',
        type: 'workflow',
        name: 'daily-check',
        source: workflowOf('daily-check', String(daily)),
      }),
    ];
    const read = await on.call('GET', '/v1/orgs/acme/playbooks/controls');

    expect(created.status).toBe(201);
    expect(kindsIn(created.body)).toEqual(['measure_unreported', 'notice_function_missing']);
    expect(saves.map(({ status }) => status)).toEqual([201, 201]);
    expect(kindsIn(read.body)).toEqual([]);
  });
});

const owner = { id: 'person:user_2ada', name: 'Ada' };

const controlsGoal = { id: 'controls-hold', statement: 'Every control passes its daily check.' };

const window = { opens: '2026-11-09T00:00:00.000Z', closes: '2026-11-10T00:00:00.000Z' };

const inputsAutoSends: readonly Readonly<Record<string, unknown>>[] = [
  {
    change: 'overdue',
    headline: 'No result yet: Every control passes its daily check.',
    owner,
    goal: controlsGoal,
    window,
  },
  {
    change: 'passed',
    headline: 'All controls held: Every control passes its daily check.',
    detail: 'All 14 controls passed.',
    link: 'https://studio.example.com/?playbook=controls&goal=controls-hold',
    owner,
    goal: controlsGoal,
    window,
    measure: { label: 'Failing controls', value: 0, target: 0 },
    says: 'All 14 controls passed.',
  },
  {
    change: 'summary',
    headline: 'Every control passes its daily check: 0 passed, 0 failed, 0 with no result',
    detail: 'Nothing passed, failed or became overdue since Monday, November 9.',
    window: { from: window.opens, to: window.closes },
    counts: { passed: 0, failed: 0, overdue: 0, no_result: 0 },
    lines: [],
    more: 0,
    owner,
    goal: controlsGoal,
  },
];

describe('the notification function of the goals guide, run with what Auto sends it', () => {
  it('takes an overdue message with no detail or link, a passed one with both, and a summary, and posts each', async () => {
    const { on, chat } = await servedBesideChat();
    const [, controls, , , , notifier] = await guideExamples(on);
    await createdWithGoals(on, { playbook: 'controls', name: 'Controls', goals: String(controls) });
    await saved(on, { playbook: 'controls', type: 'interaction', name: 'tell-owner', source: String(notifier) });

    const settled = await inputsAutoSends.reduce<Promise<readonly unknown[]>>(async (before, input) => {
      const earlier = await before;
      const started = await on.call('POST', '/v1/orgs/acme/playbooks/controls/definitions/interaction/tell-owner/run', {
        body: { input },
      });
      const run = await settledRun(on, `/v1/orgs/acme/playbooks/controls/runs/${runIdIn(started.body)}`);
      return [...earlier, run.body];
    }, Promise.resolve([]));

    expect(settled).toMatchObject([{ status: 'succeeded' }, { status: 'succeeded' }, { status: 'succeeded' }]);
    expect(chat.chat.posted()).toMatchObject([
      { channel: '#compliance', text: 'No result yet: Every control passes its daily check.\n' },
      {
        channel: '#compliance',
        text: 'All controls held: Every control passes its daily check.\n\nAll 14 controls passed.\n\nhttps://studio.example.com/?playbook=controls&goal=controls-hold\n',
      },
      {
        channel: '#compliance',
        text: 'Every control passes its daily check: 0 passed, 0 failed, 0 with no result\n\nNothing passed, failed or became overdue since Monday, November 9.\n',
      },
    ]);
  });
});
