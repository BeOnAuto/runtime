import { chatDelivery, notificationDocument } from '@on.auto/interaction/testing';
import { Schema } from 'effect';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { chatEnvironment, chatServer } from '../testing/interaction-servers/chat-deliveries.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { workflowSource } from '../testing/servers/workflow-server.ts';
import { createdWithGoals, leadGoalId, servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

const telling = workflowSource(
  'telling',
  [
    'contributes:',
    `  - goal: ${leadGoalId}`,
    '    purpose: Tells the owner where each experiment stands.',
    '    per_id: /experiment',
    '    marks: chosen',
    'do:',
    '  - tell: { call: run_definition, with: { type: interaction, name: tell-owner, input: { owner: ada, campaign: Spring } } }',
    '',
  ].join('\n'),
);

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

async function servedWithChat(): Promise<ReasoningServer> {
  const chat = await chatServer();
  const on = await servingReasoningWithGoals([], chatEnvironment(chat.url), undefined, { ledger });
  server = on;
  return on;
}

const GoalsReadSchema = Schema.Struct({
  goals: Schema.Array(
    Schema.Struct({
      connections: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
      gaps: Schema.Array(Schema.Struct({ kind: Schema.String, ask: Schema.optionalKey(Schema.String) })),
    }),
  ),
});

async function leadGoalOf(on: ReasoningServer) {
  const read = await on.call('GET', `${alpha}/goals`);
  const [lead] = Schema.decodeUnknownSync(GoalsReadSchema)(read.body).goals;
  return {
    connections: lead?.connections,
    missing: lead?.gaps.filter(({ kind }) => kind === 'connection_missing').map(({ ask }) => ask),
  };
}

describe('the connections of a goal on the Node server', () => {
  it('list the server its workflow uses through the function it calls, and a gap for the person once it is gone', async () => {
    const on = await servedWithChat();
    expect((await createdWithGoals(on)).status).toBe(201);
    const saves = [
      await on.call('POST', `${alpha}/definitions/interaction`, {
        body: { name: 'tell-owner', source: notificationDocument(chatDelivery), diagram: 'none' },
      }),
      await on.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'telling', source: telling } }),
    ];
    const served = await leadGoalOf(on);
    await on.stop();
    server = await servingReasoningWithGoals([], {}, undefined, { ledger });
    const gone = await leadGoalOf(server);

    expect(saves.map(({ status }) => status)).toEqual([201, 201]);
    expect(served).toEqual({
      connections: [{ server: 'chat', name: 'chat', connected: true, workflows: ['telling'] }],
      missing: [],
    });
    expect(gone).toEqual({
      connections: [{ server: 'chat', name: 'chat', connected: false, workflows: ['telling'] }],
      missing: ['Connect chat in Studio'],
    });
  });
});
