import { describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

const contribution = [
  'contributes:',
  '  - goal: first-customer',
  '    purpose: Notes where the orders of the shop are posted.',
];

const noted = (channel: string, contributes: readonly string[] = contribution) =>
  [
    'document:',
    "  dsl: '1.0.3'",
    '  namespace: sales',
    '  name: noted',
    "  version: '1.0.0'",
    'do:',
    '  - noted:',
    '      set:',
    `        channel: ${channel}`,
    ...contributes,
  ].join('\n');

const askedFor = (change: string) =>
  `Ask the person: What is the value of the blank CHANNEL? The source still holds it on line 9; write the value in its place ${change}`;

const goals = [
  '- id: first-customer',
  '  statement: Land the first paying customer for the shop.',
  '  success:',
  '    label: Paying customers',
  '    settles: on_crossing',
  '    target: { at_least: 1 }',
  '    passed: Landed',
  '    failed: Missed',
  '  notify: { passed: quiet, failed: quiet }',
  '',
].join('\n');

async function withAPlaybook<A>(
  serving: typeof servingReasoning,
  act: (server: ReasoningServer) => Promise<A>,
  kept: { readonly goals?: string } = {},
) {
  const server = await serving([]);
  try {
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha', ...kept } });
    return await act(server);
  } finally {
    await server.stop();
  }
}

describe('a server that keeps goals', () => {
  it('refuses to create a workflow active, save it while active or resume it while its source holds a blank', async () => {
    const answers = await withAPlaybook(
      servingReasoningWithGoals,
      async ({ call }) => {
        const created = await call('POST', `${alpha}/definitions/workflow`, {
          body: { name: 'noted', source: noted('AUTO_BLANK_CHANNEL') },
        });
        await call('POST', `${alpha}/definitions/workflow`, { body: { name: 'noted', source: noted('C04ABC12DE') } });
        const updated = await call('PUT', `${alpha}/definitions/workflow/noted`, {
          body: { source: noted('AUTO_BLANK_CHANNEL') },
        });
        await call('POST', `${alpha}/definitions/workflow/noted/pause`, { body: {} });
        const savedPaused = await call('PUT', `${alpha}/definitions/workflow/noted`, {
          body: { source: noted('AUTO_BLANK_CHANNEL') },
        });
        const resumed = await call('POST', `${alpha}/definitions/workflow/noted/resume`, { body: {} });
        return [created, updated, savedPaused, resumed].map(({ status, body }) => [status, body]);
      },
      { goals },
    );

    expect(answers).toMatchObject([
      [409, { reason: 'conflict', detail: askedFor('before you create it') }],
      [
        409,
        {
          reason: 'conflict',
          detail: askedFor('before you save it, because an active definition cannot keep a blank'),
        },
      ],
      [200, { status: 'paused', version: 2 }],
      [409, { reason: 'conflict', detail: askedFor('with update_definition before you resume it') }],
    ]);
  });
});

describe('a server that does not keep goals', () => {
  it('creates a workflow whose source holds a blank as it creates any other', async () => {
    const created = await withAPlaybook(servingReasoning, ({ call }) =>
      call('POST', `${alpha}/definitions/workflow`, {
        body: { name: 'noted', source: noted('AUTO_BLANK_CHANNEL', []) },
      }),
    );

    expect([created.status, created.body]).toMatchObject([201, { status: 'active', version: 1 }]);
  });
});
